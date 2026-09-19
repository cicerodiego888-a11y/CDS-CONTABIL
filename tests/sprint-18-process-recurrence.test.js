'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s18-'));
process.env.CDS_DB_PATH = path.join(tmp, 's18.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-18-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db, processService } = require('../backend/src/server');
const {
  generationDate, lastDayOfMonth, nextCompetence
} = require('../backend/src/processes/recurrence');

const password = 'Senha@123';
let server, base, ownerA, ownerB, companyA, companyB;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async response => {
    let data = null; try { data = await response.json(); } catch {}
    return { status: response.status, data };
  });
}

async function createProcess(name, owner = ownerA, company = companyA) {
  const response = await req('POST', '/api/processos', {
    name, company_id: company.id, responsible_user_id: owner.user.id
  }, owner.token);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

async function addStep(processId, name, offset, owner = ownerA) {
  const response = await req('POST', `/api/processos/${processId}/etapas`, {
    name, due_offset_days: offset, responsible_user_id: owner.user.id
  }, owner.token);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

async function configure(processId, body, owner = ownerA) {
  return req('PUT', `/api/processos/${processId}/recorrencia`, body, owner.token);
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 18 A', email: 'owner.a.s18@test.local', password, tenantName: 'Tenant 18 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s18@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 18 B', email: 'owner.b.s18@test.local', password, tenantName: 'Tenant 18 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s18@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 18', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 18', cnpj: '11222333000181'
  }, ownerB.token)).data;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('cálculo mensal e último dia válido são determinísticos', () => {
  assert.deepEqual(nextCompetence(2026, 12), { year: 2027, month: 1 });
  assert.deepEqual(nextCompetence(2026, 9), { year: 2026, month: 10 });
  assert.equal(lastDayOfMonth(2027, 2), 28);
  assert.equal(lastDayOfMonth(2028, 2), 29);
  assert.equal(generationDate(2027, 2, 31), '2027-02-28');
  assert.equal(generationDate(2028, 2, 31), '2028-02-29');
  assert.equal(generationDate(2026, 4, 31), '2026-04-30');
});

test('criar, editar, ativar e desativar recorrência mensal', async () => {
  const process = await createProcess('Recorrência CRUD 18');
  const created = await configure(process.id, {
    frequency: 'MENSAL', generation_day: 31, start_competence: '2098-01', active: true
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.frequency, 'MENSAL');
  assert.equal(created.data.generation_day, 31);
  assert.equal(created.data.next_competence, '2098-01');
  assert.equal(created.data.active, true);

  const edited = await configure(process.id, {
    frequency: 'MENSAL', generation_day: 15, start_competence: '2098-02', active: true
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.generation_day, 15);
  assert.equal(edited.data.start_month, 2);

  const disabled = await req('POST', `/api/processos/${process.id}/recorrencia/desativar`, {}, ownerA.token);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.active, false);
  const enabled = await req('POST', `/api/processos/${process.id}/recorrencia/ativar`, {}, ownerA.token);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.active, true);

  const get = await req('GET', `/api/processos/${process.id}/recorrencia`, undefined, ownerA.token);
  assert.equal(get.status, 200);
  assert.equal(get.data.next_competence, '2098-02');
});

test('gerar agora copia etapas, responsáveis, competência e prazos', async () => {
  const process = await createProcess('Gerar Agora 18');
  await addStep(process.id, 'Conferir', 1);
  await addStep(process.id, 'Gerar guia', 5);
  await configure(process.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-03', active: true
  });
  const generated = await req('POST', `/api/processos/${process.id}/recorrencia/gerar-agora`, {
    competence: '2098-03'
  }, ownerA.token);
  assert.equal(generated.status, 201, JSON.stringify(generated.data));
  assert.equal(generated.data.created, true);
  assert.equal(generated.data.occurrence.status, 'PENDENTE');
  assert.equal(generated.data.occurrence.competence, '2098-03');
  assert.equal(generated.data.occurrence.steps.length, 2);
  assert.equal(generated.data.occurrence.steps[0].responsible_user_id, ownerA.user.id);
  assert.equal(generated.data.occurrence.steps[0].due_date, '2098-03-02');
  assert.equal(generated.data.occurrence.steps[1].due_date, '2098-03-06');

  const recurrence = await req('GET', `/api/processos/${process.id}/recorrencia`, undefined, ownerA.token);
  assert.equal(recurrence.data.last_competence, '2098-03');
  assert.equal(recurrence.data.next_competence, '2098-04');
});

test('idempotência impede duplicidade para a mesma competência', async () => {
  const process = await createProcess('Idempotência 18');
  await addStep(process.id, 'Única', 2);
  await configure(process.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-04', active: true
  });
  const first = await req('POST', `/api/processos/${process.id}/recorrencia/gerar-agora`, {
    competence: '2098-04'
  }, ownerA.token);
  const second = await req('POST', `/api/processos/${process.id}/recorrencia/gerar-agora`, {
    competence: '2098-04'
  }, ownerA.token);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.data.created, false);
  assert.equal(second.data.existing, true);
  assert.match(second.data.message, /já existe/);
  const count = db.prepare(
    'SELECT COUNT(*) n FROM process_occurrences WHERE process_id=? AND competence=?'
  ).get(process.id, '2098-04').n;
  assert.equal(count, 1);
});

test('processo inativo e recorrência inativa não geram', async () => {
  const inactiveProcess = await createProcess('Processo inativo 18');
  await configure(inactiveProcess.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-05', active: true
  });
  await req('POST', `/api/processos/${inactiveProcess.id}/desativar`, {}, ownerA.token);
  const blockedProcess = await req('POST',
    `/api/processos/${inactiveProcess.id}/recorrencia/gerar-agora`,
    { competence: '2098-05' }, ownerA.token);
  assert.equal(blockedProcess.status, 409);
  assert.equal(blockedProcess.data.error, 'PROCESS_INACTIVE');

  const inactiveRecurrence = await createProcess('Recorrência inativa 18');
  await configure(inactiveRecurrence.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-06', active: false
  });
  const blockedRecurrence = await req('POST',
    `/api/processos/${inactiveRecurrence.id}/recorrencia/gerar-agora`,
    { competence: '2098-06' }, ownerA.token);
  assert.equal(blockedRecurrence.status, 409);
  assert.equal(blockedRecurrence.data.error, 'RECURRENCE_INACTIVE');
});

test('scheduler gera competências vencidas e respeita processo/recorrência ativos', async () => {
  const automatic = await createProcess('Automático 18');
  await addStep(automatic.id, 'Etapa automática', 5);
  await configure(automatic.id, {
    frequency: 'MENSAL', generation_day: 31, start_competence: '2027-01', active: true
  });
  const paused = await createProcess('Automático pausado 18');
  await configure(paused.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2027-01', active: false
  });
  const result = processService.recurrence.runDue(new Date('2027-02-28T12:00:00Z'));
  assert.ok(result.created >= 2, JSON.stringify(result));
  const generated = db.prepare(
    'SELECT competence FROM process_occurrences WHERE process_id=? ORDER BY competence'
  ).all(automatic.id).map(x => x.competence);
  assert.deepEqual(generated, ['2027-01', '2027-02']);
  assert.equal(db.prepare(
    'SELECT COUNT(*) n FROM process_occurrences WHERE process_id=?'
  ).get(paused.id).n, 0);
  const feb = db.prepare(
    `SELECT s.due_date FROM process_occurrence_steps s
     JOIN process_occurrences o ON o.id=s.occurrence_id
     WHERE o.process_id=? AND o.competence='2027-02'`
  ).get(automatic.id);
  assert.equal(feb.due_date, '2027-02-06');
  const rerun = processService.recurrence.runDue(new Date('2027-02-28T15:00:00Z'));
  assert.equal(rerun.created, 0);
});

test('alterar modelo não muda ocorrência automática existente', async () => {
  const process = await createProcess('Snapshot recorrente 18');
  const step = await addStep(process.id, 'Nome original', 3);
  await configure(process.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-07', active: true
  });
  const generated = await req('POST', `/api/processos/${process.id}/recorrencia/gerar-agora`, {
    competence: '2098-07'
  }, ownerA.token);
  await req('PATCH', `/api/processos/${process.id}/etapas/${step.id}`, {
    name: 'Nome alterado', due_offset_days: 20
  }, ownerA.token);
  const occurrence = await req('GET',
    '/api/processo-ocorrencias/' + generated.data.occurrence.id, undefined, ownerA.token);
  assert.equal(occurrence.data.steps[0].name, 'Nome original');
  assert.equal(occurrence.data.steps[0].due_date, '2098-07-04');
});

test('isolamento tenant/company protege configuração e geração', async () => {
  const processA = await createProcess('Isolamento recorrência A');
  await configure(processA.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-08', active: true
  });
  assert.equal((await req('GET',
    `/api/processos/${processA.id}/recorrencia`, undefined, ownerB.token)).status, 404);
  assert.equal((await req('PUT',
    `/api/processos/${processA.id}/recorrencia`,
    { frequency: 'MENSAL', generation_day: 2, start_competence: '2098-08' },
    ownerB.token)).status, 404);
  assert.equal((await req('POST',
    `/api/processos/${processA.id}/recorrencia/gerar-agora`,
    { competence: '2098-08' }, ownerA.token, companyB.id)).status, 404);

  const processB = await createProcess('Isolamento recorrência B', ownerB, companyB);
  await addStep(processB.id, 'Tenant B', 1, ownerB);
  await configure(processB.id, {
    frequency: 'MENSAL', generation_day: 1, start_competence: '2098-09', active: true
  }, ownerB);
  const generatedB = await req('POST', `/api/processos/${processB.id}/recorrencia/gerar-agora`, {
    competence: '2098-09'
  }, ownerB.token);
  assert.equal(generatedB.data.occurrence.tenant_id, ownerB.user.tenant_id);
  assert.equal(generatedB.data.occurrence.company_id, companyB.id);
});

test('auditoria, lista e interface expõem recorrência', async () => {
  const process = await createProcess('Auditoria recorrência 18');
  await addStep(process.id, 'Auditável', 1);
  await configure(process.id, {
    frequency: 'MENSAL', generation_day: 10, start_competence: '2098-10', active: true
  });
  await configure(process.id, {
    frequency: 'MENSAL', generation_day: 11, start_competence: '2098-10', active: true
  });
  await req('POST', `/api/processos/${process.id}/recorrencia/desativar`, {}, ownerA.token);
  await req('POST', `/api/processos/${process.id}/recorrencia/ativar`, {}, ownerA.token);
  await req('POST', `/api/processos/${process.id}/recorrencia/gerar-agora`, {
    competence: '2098-10'
  }, ownerA.token);

  const actions = db.prepare(
    "SELECT action FROM audit_logs WHERE tenant_id=? AND action LIKE 'PROCESS_%' ORDER BY created_at"
  ).all(ownerA.user.tenant_id).map(x => x.action);
  for (const action of [
    'PROCESS_RECURRENCE_CREATED', 'PROCESS_RECURRENCE_UPDATED',
    'PROCESS_RECURRENCE_ACTIVATED', 'PROCESS_RECURRENCE_DEACTIVATED',
    'PROCESS_OCCURRENCE_GENERATION_REQUESTED', 'PROCESS_OCCURRENCE_AUTO_CREATED'
  ]) assert.ok(actions.includes(action), 'faltou ' + action);

  const list = await req('GET', '/api/processos?page_size=100', undefined, ownerA.token);
  const listed = list.data.items.find(x => x.id === process.id);
  assert.equal(listed.recurrence.frequency, 'MENSAL');
  assert.equal(listed.recurrence.next_competence, '2098-11');

  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  for (const token of [
    'Recorrência', 'Competência inicial', 'Dia de geração', 'Gerar agora',
    'Última geração', 'Próxima competência', '/recorrencia/gerar-agora'
  ]) assert.match(js, new RegExp(token));
});
