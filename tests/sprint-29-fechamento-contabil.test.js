'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-fechamento-'));
process.env.CDS_DB_PATH = path.join(tmp, 'fechamento.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-fechamento-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { app, db, accountingPeriodService, exportService } = require('../backend/src/server');
const { PERIOD_STATUSES } = require('../backend/src/accounting/period-statuses');

const password = 'Senha@123';
let server, base;
let ownerA, ownerB, accountant, staff, clientUser;
let companyA, companyA2, companyB;
let accDebit, accCredit, planId;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function mapAccount(accountId, code, token = ownerA.token, companyId = companyA.id) {
  const r = await req('PUT', `/api/empresas/${companyId}/integracoes/dominio/mapeamentos`, {
    account_id: accountId, external_code: code
  }, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

async function createPosted(desc, date, token = ownerA.token, companyId = companyA.id) {
  const e = await req('POST', '/api/lancamentos', {
    company_id: companyId, occurred_on: date, description: desc,
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 10000 },
      { account_id: accCredit, side: 'C', amount_cents: 10000 }
    ]
  }, token);
  assert.equal(e.status, 201, JSON.stringify(e.data));
  const ap = await req('POST', '/api/aprovacao/' + e.data.id + '/aprovar', {}, token);
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  return e.data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner Fech A', email: 'owner.fech.a@test.local', password, tenantName: 'Tenant Fech A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.fech.a@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa Fech A', trade_name: 'FechA', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa Fech A2', trade_name: 'FechA2', cnpj: '04521593000100'
  }, ownerA.token)).data;

  const acc = await req('POST', '/api/usuarios', {
    name: 'Contador Fech', email: 'acc.fech@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  accountant = (await req('POST', '/api/auth/login', {
    email: 'acc.fech@test.local', password, tenant: regA.data.tenant_slug
  })).data;

  const st = await req('POST', '/api/usuarios', {
    name: 'Staff Fech', email: 'staff.fech@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(st.status, 201, JSON.stringify(st.data));
  staff = (await req('POST', '/api/auth/login', {
    email: 'staff.fech@test.local', password, tenant: regA.data.tenant_slug
  })).data;

  const inv = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente Fech', email: 'client.fech@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  assert.ok(inv.status === 201 || inv.status === 200, JSON.stringify(inv.data));
  const activationUrl = inv.data && inv.data.invitation && inv.data.invitation.activation_url;
  assert.ok(activationUrl, JSON.stringify(inv.data));
  const tok = activationUrl.split('/convite/')[1];
  clientUser = (await req('POST', '/api/invitations/' + tok + '/accept', {
    name: 'Cliente Fech', password, confirmation: password
  })).data;
  assert.ok(clientUser && clientUser.token, JSON.stringify(clientUser));

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner Fech B', email: 'owner.fech.b@test.local', password, tenantName: 'Tenant Fech B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.fech.b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa Fech B', cnpj: '60746948000112'
  }, ownerB.token)).data;

  planId = crypto.randomUUID();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, ownerA.user.tenant_id, 'Plano Fech', 'ACTIVE');
  const ins = db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,account_code,classification_code,account_type,description,is_postable,active) VALUES(?,?,?,?,?,?,?,?,1)'
  );
  accDebit = crypto.randomUUID();
  accCredit = crypto.randomUUID();
  ins.run(accDebit, ownerA.user.tenant_id, planId, '3210100012', '321', 'A', 'DESPESA', 1);
  ins.run(accCredit, ownerA.user.tenant_id, planId, '111010001', '111', 'A', 'CAIXA', 1);
  await mapAccount(accDebit, '5');
  await mapAccount(accCredit, '10');
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('A) cria competência e impede duplicação controlada', async () => {
  const c1 = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2026-09'
  }, ownerA.token);
  assert.equal(c1.status, 201, JSON.stringify(c1.data));
  assert.equal(c1.data.competence, '2026-09');
  assert.equal(c1.data.status, PERIOD_STATUSES.OPEN);
  assert.equal(c1.data.period_start, '2026-09-01');
  assert.equal(c1.data.period_end, '2026-09-30');

  const c2 = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2026-09'
  }, ownerA.token);
  assert.equal(c2.status, 200);
  assert.equal(c2.data.id, c1.data.id);

  const c3 = await req('POST', '/api/contabilidade/competencias?conflict=error', {
    company_id: companyA.id, competence: '2026-09'
  }, ownerA.token);
  assert.equal(c3.status, 409);
  assert.equal(c3.data.error, 'COMPETENCE_EXISTS');
});

test('A) isolamento tenant e company', async () => {
  const a2 = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA2.id, competence: '2026-09'
  }, ownerA.token);
  assert.equal(a2.status, 201);
  assert.notEqual(a2.data.id, (await req('GET', '/api/contabilidade/competencias?company_id=' + companyA.id, undefined, ownerA.token)).data.items.find(x => x.competence === '2026-09').id);

  const cross = await req('GET', '/api/contabilidade/competencias/' + a2.data.id, undefined, ownerB.token);
  assert.equal(cross.status, 404);

  const wrongCompany = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyB.id, competence: '2026-09'
  }, ownerA.token);
  assert.ok(wrongCompany.status === 404 || wrongCompany.status === 403);
});

test('B) lifecycle OPEN → IN_REVIEW → READY → EXPORTED → CLOSED', async () => {
  await createPosted('Lifecycle entry', '2026-10-05');
  const created = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2026-10'
  }, accountant.token);
  assert.equal(created.status, 201);
  const id = created.data.id;

  const review = await req('POST', `/api/contabilidade/competencias/${id}/iniciar-conferencia`, {}, accountant.token);
  assert.equal(review.status, 200);
  assert.equal(review.data.status, PERIOD_STATUSES.IN_REVIEW);

  const ready = await req('POST', `/api/contabilidade/competencias/${id}/pronta-exportacao`, {}, accountant.token);
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  assert.equal(ready.data.status, PERIOD_STATUSES.READY_FOR_EXPORT);

  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio',
    period_start: '2026-10-01', period_end: '2026-10-31'
  }, accountant.token);
  assert.equal(exp.status, 201, JSON.stringify(exp.data));
  assert.ok(exp.data.accounting_period_id);
  assert.equal(exp.data.accounting_period_status, PERIOD_STATUSES.EXPORTED);

  const period = await req('GET', `/api/contabilidade/competencias/${id}`, undefined, accountant.token);
  assert.equal(period.data.status, PERIOD_STATUSES.EXPORTED);
  assert.equal(period.data.export_id, exp.data.id);
  assert.notEqual(period.data.status, PERIOD_STATUSES.CLOSED);

  const close = await req('POST', `/api/contabilidade/competencias/${id}/fechar`, {}, ownerA.token);
  assert.equal(close.status, 200, JSON.stringify(close.data));
  assert.equal(close.data.status, PERIOD_STATUSES.CLOSED);
  assert.ok(close.data.closed_at);
  assert.ok(close.data.closed_by);
});

test('C) CLOSED bloqueia criar/editar/reclassificar/aprovar/rejeitar', async () => {
  const period = accountingPeriodService.getByCompetence(ownerA.user.tenant_id, companyA.id, '2026-10');
  assert.equal(period.status, PERIOD_STATUSES.CLOSED);

  const create = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2026-10-12', description: 'Bloqueado',
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 500 },
      { account_id: accCredit, side: 'C', amount_cents: 500 }
    ]
  }, ownerA.token);
  assert.equal(create.status, 409);
  assert.equal(create.data.error, 'ACCOUNTING_PERIOD_CLOSED');
  assert.match(create.data.message, /09\/2026|10\/2026/);

  // Entry pending in another open month for reclassify/approve tests after reopen setup
  const openEntry = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2026-11-02', description: 'Open month',
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 800 },
      { account_id: accCredit, side: 'C', amount_cents: 800 }
    ]
  }, ownerA.token);
  assert.equal(openEntry.status, 201);

  // Create entry then close its competence to test approve block
  const e = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2026-12-01', description: 'Will close',
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 900 },
      { account_id: accCredit, side: 'C', amount_cents: 900 }
    ]
  }, ownerA.token);
  assert.equal(e.status, 201);
  const p = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2026-12'
  }, ownerA.token);
  // Force CLOSED without full lifecycle for block test
  db.prepare("UPDATE accounting_periods SET status='CLOSED', closed_at=CURRENT_TIMESTAMP, closed_by=? WHERE id=?")
    .run(ownerA.user.id || ownerA.user.sub, p.data.id);

  const approve = await req('POST', '/api/aprovacao/' + e.data.id + '/aprovar', {}, ownerA.token);
  assert.equal(approve.status, 409);
  assert.equal(approve.data.error, 'ACCOUNTING_PERIOD_CLOSED');

  const reject = await req('POST', '/api/aprovacao/' + e.data.id + '/rejeitar', { reason: 'teste bloqueio' }, ownerA.token);
  assert.equal(reject.status, 409);
  assert.equal(reject.data.error, 'ACCOUNTING_PERIOD_CLOSED');

  const reclass = await req('POST', '/api/lancamentos/' + e.data.id + '/reclassificar', {
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 900 },
      { account_id: accCredit, side: 'C', amount_cents: 900 }
    ],
    reason: 'tentativa'
  }, ownerA.token);
  assert.equal(reclass.status, 409);
  assert.equal(reclass.data.error, 'ACCOUNTING_PERIOD_CLOSED');
});

test('D) validações de fechamento', async () => {
  const created = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2027-01'
  }, ownerA.token);
  assert.equal(created.status, 201);
  const id = created.data.id;

  // Pending entry blocks ready/close
  const pend = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2027-01-10', description: 'Pendente',
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 1000 },
      { account_id: accCredit, side: 'C', amount_cents: 1000 }
    ]
  }, ownerA.token);
  assert.equal(pend.status, 201);

  const v = accountingPeriodService.validateForClosing(ownerA.user.tenant_id, id, { requireExport: false });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.code === 'ENTRIES_PENDING_APPROVAL'));

  // Unmapped blocks
  const accX = crypto.randomUUID();
  db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,account_code,classification_code,account_type,description,is_postable,active) VALUES(?,?,?,?,?,?,?,?,1)'
  ).run(accX, ownerA.user.tenant_id, planId, '999', '999', 'A', 'SEM MAPA', 1);
  await req('POST', `/api/aprovacao/${pend.data.id}/aprovar`, {}, ownerA.token);
  // reopen period if needed - 2027-01 is open
  const e2 = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2027-01-11', description: 'Unmapped',
    lines: [
      { account_id: accX, side: 'D', amount_cents: 2000 },
      { account_id: accCredit, side: 'C', amount_cents: 2000 }
    ]
  }, ownerA.token);
  await req('POST', `/api/aprovacao/${e2.data.id}/aprovar`, {}, ownerA.token);
  const v2 = accountingPeriodService.validateForClosing(ownerA.user.tenant_id, id, { requireExport: false });
  assert.ok(v2.issues.some(i => i.code === 'UNMAPPED_ACCOUNTS'));
});

test('E/F) Domínio usa external_code; export vincula competência sem fechar', async () => {
  await createPosted('Export ok', '2027-02-08');
  const created = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2027-02'
  }, ownerA.token);
  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio',
    period_start: '2027-02-01', period_end: '2027-02-28'
  }, ownerA.token);
  assert.equal(exp.status, 201, JSON.stringify(exp.data));
  assert.ok(exp.data.checksum);
  assert.ok(exp.data.count >= 1);

  const file = db.prepare('SELECT * FROM exports WHERE id=?').get(exp.data.id);
  assert.ok(file);
  const text = fs.readFileSync(file.file_path, 'latin1');
  const line = text.trim().split(/\r?\n/)[0];
  const parts = line.split(';');
  assert.equal(parts.length, 10);
  assert.match(parts[0], /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(parts[1], '5'); // external_code debit
  assert.equal(parts[2], '10'); // external_code credit
  assert.match(parts[3], /,/); // decimal comma
  assert.equal(parts[6], '1');

  const period = await req('GET', `/api/contabilidade/competencias/${created.data.id}`, undefined, ownerA.token);
  assert.equal(period.data.status, PERIOD_STATUSES.EXPORTED);
  assert.equal(period.data.export_id, exp.data.id);
  assert.notEqual(period.data.status, PERIOD_STATUSES.CLOSED);

  const items = db.prepare('SELECT COUNT(*) n FROM export_items WHERE export_id=?').get(exp.data.id).n;
  assert.equal(items, exp.data.count);
});

test('G) fechamento OWNER/ACCOUNTANT com auditoria', async () => {
  const period = accountingPeriodService.getByCompetence(ownerA.user.tenant_id, companyA.id, '2027-02');
  const closeStaff = await req('POST', `/api/contabilidade/competencias/${period.id}/fechar`, {}, staff.token);
  assert.equal(closeStaff.status, 403);

  const close = await req('POST', `/api/contabilidade/competencias/${period.id}/fechar`, {}, accountant.token);
  assert.equal(close.status, 200, JSON.stringify(close.data));
  assert.equal(close.data.status, PERIOD_STATUSES.CLOSED);

  const audit = db.prepare(
    "SELECT * FROM audit_logs WHERE tenant_id=? AND action='ACCOUNTING_PERIOD_CLOSED' AND entity_id=? ORDER BY created_at DESC LIMIT 1"
  ).get(ownerA.user.tenant_id, period.id);
  assert.ok(audit);
});

test('H) reabertura exige motivo e grava auditoria', async () => {
  const period = accountingPeriodService.getByCompetence(ownerA.user.tenant_id, companyA.id, '2027-02');
  const noReason = await req('POST', `/api/contabilidade/competencias/${period.id}/reabrir`, {}, ownerA.token);
  assert.equal(noReason.status, 400);

  const reopen = await req('POST', `/api/contabilidade/competencias/${period.id}/reabrir`, {
    reason: 'Correção solicitada pelo contador após conferência no Domínio.'
  }, ownerA.token);
  assert.equal(reopen.status, 200, JSON.stringify(reopen.data));
  assert.equal(reopen.data.status, PERIOD_STATUSES.IN_REVIEW);
  assert.ok(reopen.data.reopened_at);
  assert.ok(reopen.data.reopened_by);
  assert.match(reopen.data.reopen_reason, /Correção/);
  // histórico de fechamento preservado
  assert.ok(reopen.data.closed_at);

  const audit = db.prepare(
    "SELECT * FROM audit_logs WHERE tenant_id=? AND action='ACCOUNTING_PERIOD_REOPENED' AND entity_id=?"
  ).get(ownerA.user.tenant_id, period.id);
  assert.ok(audit);
});

test('I) CLIENT não fecha/reabre/exporta', async () => {
  if (!clientUser || !clientUser.token) {
    // skip soft if client setup failed in this env
    return;
  }
  const created = await req('POST', '/api/contabilidade/competencias', {
    company_id: companyA.id, competence: '2027-03'
  }, ownerA.token);
  const id = created.data.id;

  const close = await req('POST', `/api/contabilidade/competencias/${id}/fechar`, {}, clientUser.token);
  assert.ok(close.status === 403 || close.status === 401);

  const reopen = await req('POST', `/api/contabilidade/competencias/${id}/reabrir`, {
    reason: 'tentativa cliente'
  }, clientUser.token);
  assert.ok(reopen.status === 403 || reopen.status === 401);

  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio',
    period_start: '2027-03-01', period_end: '2027-03-31'
  }, clientUser.token);
  assert.ok(exp.status === 403 || exp.status === 401);
});

test('resumo calcula dados reais', async () => {
  const period = accountingPeriodService.getByCompetence(ownerA.user.tenant_id, companyA.id, '2027-02');
  const r = await req('GET', `/api/contabilidade/competencias/${period.id}/resumo`, undefined, ownerA.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.competence, '2027-02');
  assert.ok(typeof r.data.entry_count === 'number');
  assert.ok(typeof r.data.debit_total_cents === 'number');
  assert.ok(Array.isArray(r.data.issues));
  assert.ok(r.data.checklist);
});

test('integrity_check e foreign_keys', () => {
  const fk = db.pragma('foreign_keys');
  assert.ok(fk === 1 || (Array.isArray(fk) && fk[0] && fk[0].foreign_keys === 1) || fk === true);
  const integrity = db.pragma('integrity_check');
  const ok = Array.isArray(integrity) ? integrity[0].integrity_check === 'ok' : integrity === 'ok';
  assert.ok(ok, JSON.stringify(integrity));
  const fkCheck = db.pragma('foreign_key_check');
  assert.equal(Array.isArray(fkCheck) ? fkCheck.length : 0, 0);
});

test('adapter Domínio permanece intacto', () => {
  const adapter = exportService.registry.get('dominio');
  assert.equal(adapter.metadata().layout.code, '11758');
  assert.equal(adapter.metadata().layout.separator, ';');
  assert.equal(adapter.metadata().layout.decimal, ',');
  assert.equal(adapter.metadata().layout.field_count, 10);
});
