'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s17-'));
process.env.CDS_DB_PATH = path.join(tmp, 's17.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-17-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db } = require('../backend/src/server');
const { dueDateForCompetence, classifyDueDate } = require('../backend/src/processes/service');

const password = 'Senha@123';
let server, base, ownerA, ownerB, companyA, companyB, clientA;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  return (await req('POST', '/api/invitations/' + token + '/accept', {
    name, password, confirmation: password
  })).data;
}

async function processWithSteps(name, competence, steps) {
  const proc = (await req('POST', '/api/processos', {
    name, company_id: companyA.id, responsible_user_id: ownerA.user.id
  }, ownerA.token)).data;
  for (const step of steps) {
    const created = await req('POST', `/api/processos/${proc.id}/etapas`, step, ownerA.token);
    assert.equal(created.status, 201, JSON.stringify(created.data));
  }
  const occurrence = await req('POST', '/api/processo-ocorrencias', {
    process_id: proc.id, competence
  }, ownerA.token);
  assert.equal(occurrence.status, 201, JSON.stringify(occurrence.data));
  return { proc, occurrence: occurrence.data };
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório 17 A', email: 'owner.a.s17@test.local', password, tenantName: 'Tenant 17 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s17@test.local', password, tenant: a.data.tenant_slug
  })).data;
  const b = await req('POST', '/api/auth/register', {
    name: 'Escritório 17 B', email: 'owner.b.s17@test.local', password, tenantName: 'Tenant 17 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s17@test.local', password, tenant: b.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 17', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 17', cnpj: '11222333000181'
  }, ownerB.token)).data;
  const invite = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente A 17', email: 'client.a.s17@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  clientA = await accept(invite.data.invitation, 'Cliente A 17');
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('prazo usa primeiro dia da competência e classificação temporal', () => {
  assert.equal(dueDateForCompetence(2026, 9, 0), '2026-09-01');
  assert.equal(dueDateForCompetence(2026, 9, 3), '2026-09-04');
  assert.equal(classifyDueDate('2026-09-17', 'PENDENTE', '2026-09-18'), 'ATRASADA');
  assert.equal(classifyDueDate('2026-09-20', 'PENDENTE', '2026-09-18'), 'VENCENDO');
  assert.equal(classifyDueDate('2026-09-25', 'PENDENTE', '2026-09-18'), 'NO_PRAZO');
  assert.equal(classifyDueDate('2026-09-17', 'CONCLUIDA', '2026-09-18'), 'CONCLUIDA');
});

test('criação calcula due_date e bloqueia pela etapa obrigatória anterior', async () => {
  const { occurrence } = await processWithSteps('Execução 17 prazo', '09/2026', [
    { name: 'Conferir movimento', due_offset_days: 1, required: true },
    { name: 'Apurar imposto', due_offset_days: 3, required: true },
    { name: 'Publicar DAS', due_offset_days: 5, required: false }
  ]);
  assert.equal(occurrence.steps[0].due_date, '2026-09-02');
  assert.equal(occurrence.steps[1].due_date, '2026-09-04');
  assert.equal(occurrence.steps[0].status, 'PENDENTE');
  assert.equal(occurrence.steps[1].status, 'BLOQUEADA');
  assert.equal(occurrence.steps[2].status, 'BLOQUEADA');
  assert.equal(occurrence.next_step.id, occurrence.steps[0].id);
  assert.equal(occurrence.progress_percent, 0);
});

test('iniciar ocorrência e etapa registra executor e impede transições inválidas', async () => {
  const { occurrence } = await processWithSteps('Execução 17 início', '10/2026', [
    { name: 'Primeira', required: true },
    { name: 'Segunda', required: true }
  ]);
  const startedOccurrence = await req('POST', `/api/processo-ocorrencias/${occurrence.id}/start`, {}, ownerA.token);
  assert.equal(startedOccurrence.status, 200);
  assert.equal(startedOccurrence.data.status, 'EM_ANDAMENTO');
  assert.ok(startedOccurrence.data.started_at);
  assert.equal((await req('POST', `/api/processo-ocorrencias/${occurrence.id}/start`, {}, ownerA.token)).status, 409);

  const blocked = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${occurrence.steps[1].id}/start`, {}, ownerA.token);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'STEP_BLOCKED');

  const startStep = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${occurrence.steps[0].id}/start`, {}, ownerA.token);
  assert.equal(startStep.status, 200);
  const first = startStep.data.steps.find(s => s.id === occurrence.steps[0].id);
  assert.equal(first.status, 'EM_ANDAMENTO');
  assert.ok(first.started_at);
  assert.equal(first.started_by, ownerA.user.id);
  assert.equal((await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${first.id}/start`, {}, ownerA.token)).status, 409);
});

test('conclusão atualiza progresso, libera próxima e conclui ocorrência automaticamente', async () => {
  const { occurrence } = await processWithSteps('Execução 17 conclusão', '11/2026', [
    { name: 'Obrigatória 1', required: true },
    { name: 'Obrigatória 2', required: true },
    { name: 'Opcional', required: false }
  ]);
  const firstId = occurrence.steps[0].id;
  const secondId = occurrence.steps[1].id;
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${firstId}/start`, {}, ownerA.token);
  const firstDone = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${firstId}/complete`, {}, ownerA.token);
  assert.equal(firstDone.status, 200);
  assert.equal(firstDone.data.status, 'EM_ANDAMENTO');
  assert.equal(firstDone.data.completed_required_steps, 1);
  assert.equal(firstDone.data.progress_percent, 50);
  assert.equal(firstDone.data.next_step.id, secondId);
  assert.equal(firstDone.data.steps.find(s => s.id === secondId).status, 'PENDENTE');
  assert.ok(firstDone.data.steps.find(s => s.id === firstId).completed_at);
  assert.equal(firstDone.data.steps.find(s => s.id === firstId).completed_by, ownerA.user.id);

  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${secondId}/start`, {}, ownerA.token);
  const complete = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${secondId}/complete`, {}, ownerA.token);
  assert.equal(complete.status, 200);
  assert.equal(complete.data.status, 'CONCLUIDA');
  assert.ok(complete.data.completed_at);
  assert.equal(complete.data.progress_percent, 100);
  assert.equal(complete.data.next_step, null);
  assert.equal(complete.data.steps[2].status, 'PENDENTE', 'etapa opcional não impede conclusão');
});

test('reabertura controlada da ocorrência e etapa', async () => {
  const { occurrence } = await processWithSteps('Execução 17 reabertura', '12/2026', [
    { name: 'Única', required: true }
  ]);
  const stepId = occurrence.steps[0].id;
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/start`, {}, ownerA.token);
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/complete`, {}, ownerA.token);

  const directStep = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/reopen`, {}, ownerA.token);
  assert.equal(directStep.status, 409);
  assert.equal(directStep.data.error, 'OCCURRENCE_REOPEN_REQUIRED');

  const reopenedOccurrence = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/reopen`, {}, ownerA.token);
  assert.equal(reopenedOccurrence.status, 200);
  assert.equal(reopenedOccurrence.data.status, 'EM_ANDAMENTO');
  assert.equal(reopenedOccurrence.data.completed_at, null);

  const reopenedStep = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/reopen`,
    { status: 'PENDENTE' }, ownerA.token);
  assert.equal(reopenedStep.status, 200);
  assert.equal(reopenedStep.data.steps[0].status, 'PENDENTE');
  assert.equal(reopenedStep.data.steps[0].completed_at, null);
  assert.equal(reopenedStep.data.progress_percent, 0);
  assert.equal((await req('POST', `/api/processo-ocorrencias/${occurrence.id}/reopen`, {}, ownerA.token)).status, 409);
});

test('observação pertence à execução da etapa', async () => {
  const { occurrence } = await processWithSteps('Execução 17 observação', '01/2027', [
    { name: 'Conferir documentação', required: true }
  ]);
  const stepId = occurrence.steps[0].id;
  const updated = await req('PATCH',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}`,
    { observation: 'Documentação conferida com o cliente.', company_id: companyB.id },
    ownerA.token);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.steps[0].observation, 'Documentação conferida com o cliente.');
});

test('dashboard e filtros identificam vencendo e atrasada', async () => {
  const overdue = await processWithSteps('Execução 17 atraso', '02/2027', [
    { name: 'Atrasada', required: true }
  ]);
  const dueSoon = await processWithSteps('Execução 17 vencendo', '03/2027', [
    { name: 'Vencendo', required: true }
  ]);
  db.prepare("UPDATE process_occurrence_steps SET due_date=date('now','-1 day') WHERE occurrence_id=?")
    .run(overdue.occurrence.id);
  db.prepare("UPDATE process_occurrence_steps SET due_date=date('now','+1 day') WHERE occurrence_id=?")
    .run(dueSoon.occurrence.id);

  const dashboard = await req('GET', '/api/processos/dashboard', undefined, ownerA.token);
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.data.atrasadas >= 1);
  assert.ok(dashboard.data.vencendo >= 1);

  const lateList = await req('GET',
    '/api/processo-ocorrencias?deadline_status=ATRASADA&page_size=100', undefined, ownerA.token);
  assert.ok(lateList.data.items.some(x => x.id === overdue.occurrence.id));
  assert.equal(lateList.data.items.some(x => x.id === dueSoon.occurrence.id), false);

  const soonList = await req('GET',
    '/api/processo-ocorrencias?deadline_status=VENCENDO&page_size=100', undefined, ownerA.token);
  assert.ok(soonList.data.items.some(x => x.id === dueSoon.occurrence.id));
});

test('isolamento de tenant, empresa e perfil CLIENT bloqueia execução', async () => {
  const { occurrence } = await processWithSteps('Execução 17 isolamento', '04/2027', [
    { name: 'Isolada', required: true }
  ]);
  const stepId = occurrence.steps[0].id;
  const crossTenant = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/start`, {}, ownerB.token);
  assert.equal(crossTenant.status, 404);
  const crossCompany = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/start`, {}, ownerA.token, companyB.id);
  assert.equal(crossCompany.status, 404);
  const client = await req('POST',
    `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/start`, {}, clientA.token);
  assert.equal(client.status, 403);
});

test('auditoria e interface cobrem execução, conclusão e reabertura', async () => {
  const { occurrence } = await processWithSteps('Execução 17 auditoria', '05/2027', [
    { name: 'Auditável', required: true }
  ]);
  const stepId = occurrence.steps[0].id;
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/start`, {}, ownerA.token);
  await req('PATCH', `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}`,
    { observation: 'Auditada' }, ownerA.token);
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/complete`, {}, ownerA.token);
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/reopen`, {}, ownerA.token);
  await req('POST', `/api/processo-ocorrencias/${occurrence.id}/steps/${stepId}/reopen`, {}, ownerA.token);

  const actions = db.prepare(
    "SELECT action FROM audit_logs WHERE tenant_id=? AND entity_id IN (?,?)"
  ).all(ownerA.user.tenant_id, occurrence.id, stepId).map(x => x.action);
  for (const action of [
    'PROCESS_OCCURRENCE_STARTED', 'PROCESS_STEP_STARTED', 'PROCESS_STEP_UPDATED',
    'PROCESS_STEP_COMPLETED', 'PROCESS_OCCURRENCE_COMPLETED',
    'PROCESS_OCCURRENCE_REOPENED', 'PROCESS_STEP_REOPENED'
  ]) assert.ok(actions.includes(action), 'faltou ' + action);

  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  for (const token of [
    'PROGRESSO', 'PRÓXIMA AÇÃO', 'Checklist da ocorrência', 'Iniciar ocorrência',
    'Reabrir ocorrência', 'Salvar observação', '/processos/dashboard'
  ]) assert.match(js, new RegExp(token));
});
