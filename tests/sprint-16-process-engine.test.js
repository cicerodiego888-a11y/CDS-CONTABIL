'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s16-'));
process.env.CDS_DB_PATH = path.join(tmp, 's16.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-16-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db } = require('../backend/src/server');
const { parseCompetence } = require('../backend/src/processes/competence');

const password = 'Senha@123';
let server, base, ownerA, ownerB, companyA, companyB, staffA;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 16 A', email: 'owner.a.s16@test.local', password, tenantName: 'Tenant 16 A' });
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s16@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório 16 B', email: 'owner.b.s16@test.local', password, tenantName: 'Tenant 16 B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s16@test.local', password, tenant: b.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa A 16', cnpj: '38204469000115' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa B 16', cnpj: '11222333000181' }, ownerB.token)).data;
  await req('POST', '/api/usuarios', { name: 'Staff 16', email: 'staff.s16@test.local', password, role: 'STAFF' }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', { email: 'staff.s16@test.local', password, tenant: a.data.tenant_slug })).data;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('competência estruturada AAAA-MM e MM/AAAA', () => {
  assert.equal(parseCompetence('2026-09').competence, '2026-09');
  assert.equal(parseCompetence('09/2026').competence, '2026-09');
  assert.equal(parseCompetence('09/2026').label, 'Setembro/2026');
  assert.equal(parseCompetence('bad'), null);
});

test('criar, listar, consultar, alterar, ativar e desativar processo', async () => {
  const created = await req('POST', '/api/processos', {
    name: 'Apuração Mensal',
    description: 'Fechamento contábil mensal',
    sector: 'Fiscal',
    company_id: companyA.id,
    responsible_user_id: ownerA.user.id
  }, ownerA.token);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, 'ATIVO');
  assert.equal(created.data.company_id, companyA.id);

  const list = await req('GET', '/api/processos', undefined, ownerA.token);
  assert.equal(list.status, 200);
  assert.ok(list.data.items.some(x => x.id === created.data.id));

  const get = await req('GET', '/api/processos/' + created.data.id, undefined, ownerA.token);
  assert.equal(get.status, 200);
  assert.equal(get.data.name, 'Apuração Mensal');

  const patched = await req('PATCH', '/api/processos/' + created.data.id, { name: 'Apuração Mensal v2', sector: 'Contábil' }, ownerA.token);
  assert.equal(patched.status, 200);
  assert.equal(patched.data.name, 'Apuração Mensal v2');
  assert.equal(patched.data.sector, 'Contábil');

  const off = await req('POST', '/api/processos/' + created.data.id + '/desativar', {}, ownerA.token);
  assert.equal(off.status, 200);
  assert.equal(off.data.status, 'INATIVO');
  const on = await req('POST', '/api/processos/' + created.data.id + '/ativar', {}, ownerA.token);
  assert.equal(on.status, 200);
  assert.equal(on.data.status, 'ATIVO');
});

test('etapas: criar, ordenar, alterar e remover', async () => {
  const proc = (await req('POST', '/api/processos', { name: 'DAS', company_id: companyA.id, sector: 'Fiscal', responsible_user_id: staffA.user.id }, ownerA.token)).data;
  const s1 = await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Conferir movimento', due_offset_days: 1, responsible_user_id: staffA.user.id }, ownerA.token);
  const s2 = await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Apurar imposto', due_offset_days: 3, responsible_user_id: ownerA.user.id }, ownerA.token);
  const s3 = await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Gerar DAS', due_offset_days: 5 }, ownerA.token);
  assert.equal(s1.status, 201);
  assert.equal(s2.status, 201);
  assert.equal(s3.status, 201);
  assert.equal(s1.data.due_offset_days, 1);

  const reordered = await req('PUT', `/api/processos/${proc.id}/etapas/ordem`, { step_ids: [s3.data.id, s1.data.id, s2.data.id] }, ownerA.token);
  assert.equal(reordered.status, 200);
  assert.equal(reordered.data.steps[0].id, s3.data.id);
  assert.equal(reordered.data.steps[0].step_order, 1);

  const upd = await req('PATCH', `/api/processos/${proc.id}/etapas/${s1.data.id}`, { name: 'Conferir movimento bancário', due_offset_days: 2, step_order: 4 }, ownerA.token);
  assert.equal(upd.status, 200);
  assert.equal(upd.data.name, 'Conferir movimento bancário');
  assert.equal(upd.data.due_offset_days, 2);

  const del = await req('DELETE', `/api/processos/${proc.id}/etapas/${s2.data.id}`, undefined, ownerA.token);
  assert.equal(del.status, 200);
  const after = await req('GET', '/api/processos/' + proc.id, undefined, ownerA.token);
  assert.equal(after.data.steps.some(x => x.id === s2.data.id), false);
});

test('ocorrência copia etapas; alteração do modelo não altera ocorrência', async () => {
  const proc = (await req('POST', '/api/processos', { name: 'Fechamento Contábil', company_id: companyA.id, sector: 'Contábil' }, ownerA.token)).data;
  await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Etapa A', due_offset_days: 1 }, ownerA.token);
  await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Etapa B', due_offset_days: 2 }, ownerA.token);

  const occ = await req('POST', '/api/processo-ocorrencias', { process_id: proc.id, competence: '09/2026' }, ownerA.token);
  assert.equal(occ.status, 201, JSON.stringify(occ.data));
  assert.equal(occ.data.competence, '2026-09');
  assert.equal(occ.data.competence_year, 2026);
  assert.equal(occ.data.competence_month, 9);
  assert.match(occ.data.title, /Setembro\/2026/);
  assert.equal(occ.data.steps.length, 2);
  assert.equal(occ.data.steps[0].status, 'PENDENTE');
  const copiedName = occ.data.steps[0].name;

  await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Etapa C nova', due_offset_days: 9 }, ownerA.token);
  await req('PATCH', `/api/processos/${proc.id}/etapas/${(await req('GET', '/api/processos/' + proc.id, undefined, ownerA.token)).data.steps[0].id}`, { name: 'Etapa A alterada no modelo' }, ownerA.token);

  const again = await req('GET', '/api/processo-ocorrencias/' + occ.data.id, undefined, ownerA.token);
  assert.equal(again.status, 200);
  assert.equal(again.data.steps.length, 2);
  assert.equal(again.data.steps[0].name, copiedName);
  assert.equal(again.data.steps.some(s => s.name === 'Etapa C nova'), false);

  const st = await req('PATCH', '/api/processo-ocorrencias/' + occ.data.id, { status: 'EM_ANDAMENTO' }, ownerA.token);
  assert.equal(st.status, 200);
  assert.equal(st.data.status, 'EM_ANDAMENTO');
  assert.ok(st.data.started_at);
});

test('processo inativo não gera ocorrência', async () => {
  const proc = (await req('POST', '/api/processos', { name: 'Inativo Occ', company_id: companyA.id }, ownerA.token)).data;
  await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Só uma' }, ownerA.token);
  await req('POST', `/api/processos/${proc.id}/desativar`, {}, ownerA.token);
  const occ = await req('POST', '/api/processo-ocorrencias', { process_id: proc.id, competence: '2026-10' }, ownerA.token);
  assert.equal(occ.status, 409);
  assert.equal(occ.data.error, 'PROCESS_INACTIVE');
});

test('isolamento tenant/company e responsável inválido', async () => {
  const procA = (await req('POST', '/api/processos', { name: 'Iso A', company_id: companyA.id }, ownerA.token)).data;
  const crossCompany = await req('POST', '/api/processos', { name: 'Cross', company_id: companyB.id }, ownerA.token);
  assert.equal(crossCompany.status, 404);

  const crossUser = await req('POST', '/api/processos', {
    name: 'Cross user', company_id: companyA.id, responsible_user_id: ownerB.user.id
  }, ownerA.token);
  assert.equal(crossUser.status, 400);
  assert.equal(crossUser.data.error, 'INVALID_RESPONSIBLE');

  assert.equal((await req('GET', '/api/processos/' + procA.id, undefined, ownerB.token)).status, 404);
  assert.equal((await req('PATCH', '/api/processos/' + procA.id, { name: 'Hack' }, ownerB.token)).status, 404);

  const occ = (await req('POST', '/api/processo-ocorrencias', { process_id: procA.id, competence: '2026-11' }, ownerA.token)).data;
  assert.equal((await req('GET', '/api/processo-ocorrencias/' + occ.id, undefined, ownerB.token)).status, 404);
  assert.equal((await req('PATCH', '/api/processo-ocorrencias/' + occ.id, { status: 'CANCELADA' }, ownerB.token)).status, 404);

  const spoofHeader = await req('GET', '/api/processos/' + procA.id, undefined, ownerA.token, companyB.id);
  assert.ok(spoofHeader.status === 404 || spoofHeader.status === 403);
});

test('auditoria registra eventos do motor', async () => {
  const proc = (await req('POST', '/api/processos', { name: 'Audit Proc', company_id: companyA.id }, ownerA.token)).data;
  const step = (await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Audit Step' }, ownerA.token)).data;
  await req('PATCH', `/api/processos/${proc.id}/etapas/${step.id}`, { name: 'Audit Step 2' }, ownerA.token);
  await req('DELETE', `/api/processos/${proc.id}/etapas/${step.id}`, undefined, ownerA.token);
  await req('POST', `/api/processos/${proc.id}/desativar`, {}, ownerA.token);
  await req('POST', `/api/processos/${proc.id}/ativar`, {}, ownerA.token);
  await req('POST', `/api/processos/${proc.id}/etapas`, { name: 'Copy me' }, ownerA.token);
  const occ = (await req('POST', '/api/processo-ocorrencias', { process_id: proc.id, competence: '2026-12' }, ownerA.token)).data;
  await req('PATCH', '/api/processo-ocorrencias/' + occ.id, { status: 'CONCLUIDA' }, ownerA.token);

  const actions = db.prepare("SELECT action FROM audit_logs WHERE tenant_id=? AND action LIKE 'PROCESS%'").all(ownerA.user.tenant_id).map(x => x.action);
  for (const needed of [
    'PROCESS_CREATED', 'PROCESS_STEP_CREATED', 'PROCESS_STEP_UPDATED', 'PROCESS_STEP_DELETED',
    'PROCESS_ACTIVATED', 'PROCESS_DEACTIVATED', 'PROCESS_OCCURRENCE_CREATED', 'PROCESS_OCCURRENCE_UPDATED'
  ]) {
    assert.ok(actions.includes(needed), 'faltou ' + needed + ' em ' + actions.join(','));
  }
});

test('interface do escritório inclui menu Processos', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /\['processos','Processos'/);
  assert.match(js, /processesPage/);
  assert.match(js, /Nova ocorrência/);
  assert.match(js, /Adicionar etapa/);
});
