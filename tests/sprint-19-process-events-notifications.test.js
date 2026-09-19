'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s19-'));
process.env.CDS_DB_PATH = path.join(tmp, 's19.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-19-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db, processService } = require('../backend/src/server');

const password = 'Senha@123';
let server, base, ownerA, ownerB, staffA, companyA, companyB;

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async response => {
    let data = null; try { data = await response.json(); } catch {}
    return { status: response.status, data };
  });
}

async function createProcess(name, responsible = ownerA.user.id) {
  const response = await req('POST', '/api/processos', {
    name, company_id: companyA.id, responsible_user_id: responsible
  }, ownerA.token);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

async function addStep(processId, name, responsible, offset = 0) {
  const response = await req('POST', `/api/processos/${processId}/etapas`, {
    name, responsible_user_id: responsible, due_offset_days: offset, required: true
  }, ownerA.token);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

async function createOccurrence(processId, competence = '2099-01') {
  const response = await req('POST', '/api/processo-ocorrencias', {
    process_id: processId, competence
  }, ownerA.token);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

function eventCount(type, entityId) {
  return db.prepare(
    'SELECT COUNT(*) n FROM domain_events WHERE event_type=? AND entity_id=?'
  ).get(type, entityId).n;
}

function notifications(type, occurrenceId) {
  return db.prepare(
    `SELECT n.* FROM notifications n
     WHERE n.type=? AND n.entity_type='process_occurrence' AND n.entity_id=?`
  ).all(type, occurrenceId);
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 19 A', email: 'owner.a.s19@test.local', password, tenantName: 'Tenant 19 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s19@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 19 B', email: 'owner.b.s19@test.local', password, tenantName: 'Tenant 19 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s19@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 19', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 19', cnpj: '11222333000181'
  }, ownerB.token)).data;

  const staff = await req('POST', '/api/usuarios', {
    name: 'Responsável Etapa 19', email: 'staff.a.s19@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.a.s19@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('ocorrência manual gera evento e notificação não lida para o responsável', async () => {
  const process = await createProcess('Manual 19');
  await addStep(process.id, 'Executar manual', ownerA.user.id);
  const occurrence = await createOccurrence(process.id);

  assert.equal(eventCount('PROCESS_OCCURRENCE_MANUALLY_CREATED', occurrence.id), 1);
  const list = notifications('PROCESS_OCCURRENCE_MANUALLY_CREATED', occurrence.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].recipient_user_id, ownerA.user.id);
  assert.equal(list[0].read_at, null);
  assert.equal(list[0].title, 'Novo processo disponível');
});

test('início e conclusão registram eventos; próxima etapa notifica outro responsável', async () => {
  const process = await createProcess('Fluxo 19');
  await addStep(process.id, 'Etapa do owner', ownerA.user.id);
  await addStep(process.id, 'Etapa do staff', staffA.user.id);
  const occurrence = await createOccurrence(process.id, '2099-02');
  const first = occurrence.steps[0];

  assert.equal((await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${first.id}/start`,
    {}, ownerA.token)).status, 200);
  assert.equal((await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${first.id}/complete`,
    {}, ownerA.token)).status, 200);

  assert.equal(eventCount('PROCESS_OCCURRENCE_STARTED', occurrence.id), 1);
  assert.equal(eventCount('PROCESS_STEP_STARTED', first.id), 1);
  assert.equal(eventCount('PROCESS_STEP_COMPLETED', first.id), 1);
  const next = notifications('PROCESS_STEP_COMPLETED', occurrence.id);
  assert.equal(next.length, 1);
  assert.equal(next[0].recipient_user_id, staffA.user.id);
  assert.equal(next[0].title, 'Nova etapa disponível');
});

test('conclusão da ocorrência gera evento e avisa responsável principal', async () => {
  const process = await createProcess('Conclusão 19');
  await addStep(process.id, 'Única', staffA.user.id);
  const occurrence = await createOccurrence(process.id, '2099-03');
  const step = occurrence.steps[0];
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${step.id}/start`, {}, staffA.token);
  const completed = await req(
    'POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${step.id}/complete`, {}, staffA.token
  );
  assert.equal(completed.status, 200);
  assert.equal(completed.data.status, 'CONCLUIDA');
  assert.equal(eventCount('PROCESS_OCCURRENCE_COMPLETED', occurrence.id), 1);
  const list = notifications('PROCESS_OCCURRENCE_COMPLETED', occurrence.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].recipient_user_id, ownerA.user.id);
});

test('geração automática publica evento e notifica sem quebrar idempotência', async () => {
  const process = await createProcess('Automático 19');
  await addStep(process.id, 'Automática', ownerA.user.id);
  await req('PUT', `/api/processos/${process.id}/recorrencia`, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2099-04', active: true
  }, ownerA.token);

  const recurrence = processService.recurrence.get(ownerA.user.tenant_id, process.id);
  const first = processService.recurrence.generateCompetence(recurrence, '2099-04', {
    source: 'AUTOMATIC'
  });
  const second = processService.recurrence.generateCompetence(recurrence, '2099-04', {
    source: 'AUTOMATIC'
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(eventCount('PROCESS_OCCURRENCE_AUTO_CREATED', first.occurrence.id), 1);
  assert.equal(notifications('PROCESS_OCCURRENCE_AUTO_CREATED', first.occurrence.id).length, 1);
});

test('scheduler de atrasos gera um único evento e uma única notificação', async () => {
  const process = await createProcess('Atraso 19');
  await addStep(process.id, 'Gerar DAS', ownerA.user.id, 0);
  const occurrence = await createOccurrence(process.id, '2020-01');
  const step = occurrence.steps[0];

  const first = processService.events.scanOverdue(new Date('2020-02-01T12:00:00Z'));
  const second = processService.events.scanOverdue(new Date('2020-02-01T13:00:00Z'));
  assert.ok(first.checked >= 1);
  assert.ok(second.checked >= 1);
  assert.equal(second.emitted, 0);
  assert.equal(second.notified, 0);
  assert.equal(eventCount('PROCESS_STEP_OVERDUE', step.id), 1);
  const list = notifications('PROCESS_STEP_OVERDUE', occurrence.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].recipient_user_id, ownerA.user.id);
  assert.match(list[0].message, /Gerar DAS.*atrasada/);
});

test('API expõe referência contextual e marca notificação como lida com auditoria', async () => {
  const process = await createProcess('Referência 19');
  await addStep(process.id, 'Abrir referência', ownerA.user.id);
  const occurrence = await createOccurrence(process.id, '2099-05');
  const listing = await req('GET', '/api/notificacoes?page=1&page_size=100', undefined, ownerA.token);
  assert.equal(listing.status, 200);
  const item = listing.data.items.find(n =>
    n.occurrence_id === occurrence.id &&
    n.event_type === 'PROCESS_OCCURRENCE_MANUALLY_CREATED'
  );
  assert.ok(item, JSON.stringify(listing.data));
  assert.deepEqual(item.reference, {
    process_id: process.id, occurrence_id: occurrence.id, step_id: null
  });
  const marked = await req('POST', `/api/notificacoes/${item.id}/lida`, {}, ownerA.token);
  assert.equal(marked.status, 200);
  assert.ok(db.prepare('SELECT read_at FROM notifications WHERE id=?').get(item.id).read_at);
  assert.ok(db.prepare(
    "SELECT id FROM audit_logs WHERE action='PROCESS_NOTIFICATION_READ' AND entity_id=?"
  ).get(item.id));
});

test('notificações e referências permanecem isoladas por tenant', async () => {
  const process = await createProcess('Isolamento 19');
  await addStep(process.id, 'Privada', ownerA.user.id);
  const occurrence = await createOccurrence(process.id, '2099-06');
  const listB = await req('GET', '/api/notificacoes?page=1&page_size=100', undefined, ownerB.token);
  assert.equal(listB.status, 200);
  assert.equal(listB.data.items.some(n => n.occurrence_id === occurrence.id), false);
  assert.equal((await req(
    'GET', `/api/processo-ocorrencias/${occurrence.id}`, undefined, ownerB.token
  )).status, 404);
});

test('STAFF sem acesso à empresa não recebe notificação operacional', async () => {
  const otherStaffId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users(id,tenant_id,name,email,password_hash,role,active)
     SELECT ?,tenant_id,'Staff atribuído','staff.assigned.s19@test.local',password_hash,'STAFF',1
     FROM users WHERE id=?`
  ).run(otherStaffId, ownerA.user.id);
  db.prepare('UPDATE tenants SET assign_staff_companies=1 WHERE id=?').run(ownerA.user.tenant_id);
  db.prepare(
    'INSERT INTO company_assignees(id,tenant_id,company_id,user_id,assigned_by) VALUES(?,?,?,?,?)'
  ).run(crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, otherStaffId, ownerA.user.id);

  const process = await createProcess('Permissão 19', staffA.user.id);
  await addStep(process.id, 'Restrita', staffA.user.id);
  const occurrence = await createOccurrence(process.id, '2099-07');
  assert.equal(notifications('PROCESS_OCCURRENCE_MANUALLY_CREATED', occurrence.id).length, 0);
});

test('auditoria e frontend cobrem criação, leitura e ação contextual', () => {
  assert.ok(db.prepare(
    "SELECT id FROM audit_logs WHERE action='PROCESS_NOTIFICATION_CREATED' LIMIT 1"
  ).get());
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'public', 'assets', 'app.js'), 'utf8'
  );
  assert.match(source, /Abrir processo/);
  assert.match(source, /Este processo não está mais disponível/);
  assert.match(source, /Última atividade:/);
});
