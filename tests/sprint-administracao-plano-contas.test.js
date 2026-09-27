'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-plan-admin-'));
process.env.CDS_DB_PATH = path.join(tmp, 'plan-admin.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-administracao-plano-contas-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const chartAdmin = require('../backend/src/chart-of-accounts/admin');
const { app, db } = require('../backend/src/server');

const root = path.resolve(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
const comboJs = fs.readFileSync(path.join(root, 'frontend/public/assets/account-combobox.js'), 'utf8');
const password = 'Senha@123';

let server, base, ownerA, ownerB, staffA, clientToken, companyA, companyA2, companyB;
let planA, accActive, accBank, accSynth;

function uuid() { return crypto.randomUUID(); }

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function uploadImport(buffer, name, token, planName, extra) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  form.append('name', planName || 'Plano admin');
  if (extra && extra.confirm_replace) form.append('confirm_replace', '1');
  if (extra && extra.company_id) form.append('company_id', extra.company_id);
  const r = await fetch(base + '/api/plano-contas/import', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  const data = await r.json();
  return { status: r.status, data };
}

function insertAccount(tenantId, planId, code, classification, type, desc, postable, active) {
  const id = uuid();
  db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, tenantId, planId, code, code, classification, type, desc, null, 1, postable ? 1 : 0, active ? 1 : 0);
  return { id, code, classification, desc };
}

function audit(action, entityId) {
  return db.prepare(
    'SELECT * FROM audit_logs WHERE tenant_id=? AND action=? AND (? IS NULL OR entity_id=?) ORDER BY created_at DESC LIMIT 1'
  ).get(ownerA.user.tenant_id, action, entityId || null, entityId || null);
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório Plan Admin A', email: 'owner.planadmin.a@test.local', password, tenantName: 'Tenant Plan Admin A'
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.planadmin.a@test.local', password, tenant: a.data.tenant_slug
  })).data;

  const b = await req('POST', '/api/auth/register', {
    name: 'Escritório Plan Admin B', email: 'owner.planadmin.b@test.local', password, tenantName: 'Tenant Plan Admin B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.planadmin.b@test.local', password, tenant: b.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', { name: 'Empresa Plan Admin A', cnpj: '11222333000181' }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', { name: 'Empresa Plan Admin A2', cnpj: '33444555000103' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa Plan Admin B', cnpj: '22333444000192' }, ownerB.token)).data;

  const staff = await req('POST', '/api/usuarios', {
    name: 'Staff Plan Admin', email: 'staff.planadmin@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.ok([200, 201].includes(staff.status), JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.planadmin@test.local', password, tenant: a.data.tenant_slug
  })).data;

  const u = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente Plan Admin', email: 'cliente.planadmin@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  const token = u.data.invitation.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + token + '/accept', {
    password, confirmation: password, name: 'Cliente Plan Admin'
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  clientToken = acc.data.token;

  planA = uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planA, ownerA.user.tenant_id, 'Plano Admin A', 'ACTIVE');
  accActive = insertAccount(ownerA.user.tenant_id, planA, '1027', '1110200003', 'A', 'CONTA AZUL', 1, 1);
  accBank = insertAccount(ownerA.user.tenant_id, planA, '8', '1110200001', 'A', 'BANCO DO BRASIL', 1, 1);
  accSynth = insertAccount(ownerA.user.tenant_id, planA, '1', '1', 'S', 'ATIVO', 0, 1);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
});

test('1 desativação', async () => {
  const r = await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 0 }, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.active, 0);
  assert.equal(r.data.status, 'INATIVA');
  const row = db.prepare('SELECT active,account_code,classification_code,description FROM accounts WHERE id=?').get(accActive.id);
  assert.equal(row.active, 0);
  assert.equal(row.account_code, '1027');
  assert.equal(row.classification_code, '1110200003');
  assert.equal(row.description, 'CONTA AZUL');
});

test('2 reativação', async () => {
  const r = await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 1 }, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.active, 1);
  assert.equal(r.data.status, 'ATIVA');
});

test('3 conta inativa não pode receber novo lançamento', async () => {
  await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 0 }, ownerA.token);
  const r = await req('POST', '/api/lancamentos', {
    company_id: companyA.id,
    occurred_on: '2026-09-20',
    description: 'Tentativa com conta inativa',
    lines: [
      { account_id: accActive.id, side: 'D', amount_cents: 1000 },
      { account_id: accBank.id, side: 'C', amount_cents: 1000 }
    ]
  }, ownerA.token);
  assert.equal(r.status, 422, JSON.stringify(r.data));
  assert.match(String(r.data.message || r.data.error || ''), /inativa|ACCOUNT_INACTIVE/i);
  await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 1 }, ownerA.token);
});

test('4 conta inativa não aparece na seleção normal', async () => {
  await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 0 }, ownerA.token);
  const list = await req('GET', '/api/plano-contas/analiticas?q=AZUL', undefined, ownerA.token);
  assert.equal(list.status, 200);
  const items = list.data.items || list.data;
  assert.ok(!items.some((x) => x.id === accActive.id));
  assert.match(appJs, /filter\(a=>a\.is_postable&&Number\(a\.active\)!==0\)/);
  assert.match(comboJs, /isPostableAccount/);
  assert.match(comboJs, /active === 0/);
  await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 1 }, ownerA.token);
});

test('5 conta com histórico não pode ser apagada', async () => {
  const posted = await req('POST', '/api/lancamentos', {
    company_id: companyA.id,
    occurred_on: '2026-09-21',
    description: 'Histórico preservado',
    lines: [
      { account_id: accActive.id, side: 'D', amount_cents: 2500 },
      { account_id: accBank.id, side: 'C', amount_cents: 2500 }
    ]
  }, ownerA.token);
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  const delAcc = await req('DELETE', '/api/plano-contas/accounts/' + accActive.id, {}, ownerA.token);
  assert.ok(delAcc.status === 404 || delAcc.status === 405 || delAcc.status === 409);
  const still = db.prepare('SELECT id,active FROM accounts WHERE id=?').get(accActive.id);
  assert.ok(still);
});

test('6 plano sem dependências pode ser excluído', async () => {
  const emptyPlan = uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(emptyPlan, ownerA.user.tenant_id, 'Plano Vazio Admin', 'ACTIVE');
  insertAccount(ownerA.user.tenant_id, emptyPlan, '9001', '9001', 'A', 'CONTA TEMP', 1, 1);
  const check = await req('GET', '/api/plano-contas/' + emptyPlan + '/dependencias', undefined, ownerA.token);
  assert.equal(check.status, 200);
  assert.equal(check.data.blocked, false);
  const del = await req('DELETE', '/api/plano-contas/' + emptyPlan, {}, ownerA.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_plans WHERE id=?').get(emptyPlan).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts WHERE plan_id=?').get(emptyPlan).n, 0);
});

test('7 plano com lançamentos bloqueia exclusão', async () => {
  const check = await req('GET', '/api/plano-contas/' + planA + '/dependencias', undefined, ownerA.token);
  assert.equal(check.status, 200);
  assert.equal(check.data.blocked, true);
  assert.match(check.data.message, /não pode ser excluído/);
  const del = await req('DELETE', '/api/plano-contas/' + planA, {}, ownerA.token);
  assert.equal(del.status, 409);
  assert.equal(del.data.error, 'PLAN_DELETE_BLOCKED');
  assert.equal(del.data.message, chartAdmin.BLOCKED_MESSAGE);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts WHERE plan_id=?').get(planA).n >= 3, true);
});

test('8 nova importação após exclusão segura', async () => {
  const cleanTenant = await req('POST', '/api/auth/register', {
    name: 'Escritório Import Clean', email: 'owner.planadmin.clean@test.local', password, tenantName: 'Tenant Plan Clean'
  });
  const cleanOwner = (await req('POST', '/api/auth/login', {
    email: 'owner.planadmin.clean@test.local', password, tenant: cleanTenant.data.tenant_slug
  })).data;
  const csv1 = Buffer.from('codigo;classificacao;descricao;tipo\n5;1110100001;CAIXA GERAL;A\n8;1110200001;BANCO DO BRASIL;A');
  const first = await uploadImport(csv1, 'plano1.csv', cleanOwner.token, 'Plano Clean 1');
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const blocked = await uploadImport(csv1, 'plano1.csv', cleanOwner.token, 'Plano Clean again');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'PLAN_EXISTS');
  const csv2 = Buffer.from('codigo;classificacao;descricao;tipo\n1027;1110200003;CONTA AZUL;A\n1028;1110200004;BANCO BRADESCO;A');
  const second = await uploadImport(csv2, 'plano2.csv', cleanOwner.token, 'Plano Clean 2', { confirm_replace: true });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  assert.notEqual(second.data.planId, first.data.planId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_plans WHERE tenant_id=?').get(cleanOwner.user.tenant_id).n, 1);
});

test('9 plano antigo não mistura com plano novo', async () => {
  const clean = db.prepare(
    "SELECT id FROM account_plans WHERE tenant_id=(SELECT tenant_id FROM users WHERE email='owner.planadmin.clean@test.local')"
  ).get();
  const codes = db.prepare('SELECT account_code FROM accounts WHERE plan_id=? ORDER BY account_code').all(clean.id).map((x) => x.account_code);
  assert.deepEqual(codes, ['1027', '1028']);
  assert.ok(!codes.includes('5'));
  assert.ok(!codes.includes('8'));
});

test('10 permissões administrativas', async () => {
  const staffPatch = await req('PATCH', '/api/plano-contas/accounts/' + accBank.id, { active: 0 }, staffA.token);
  assert.equal(staffPatch.status, 403);
  const staffDel = await req('DELETE', '/api/plano-contas/' + planA, {}, staffA.token);
  assert.equal(staffDel.status, 403);
  const ownerOk = await req('PATCH', '/api/plano-contas/accounts/' + accBank.id, { active: 1 }, ownerA.token);
  assert.equal(ownerOk.status, 200);
});

test('11 CLIENT bloqueado', async () => {
  const r = await req('PATCH', '/api/plano-contas/accounts/' + accBank.id, { active: 0 }, clientToken);
  assert.equal(r.status, 403);
  const d = await req('DELETE', '/api/plano-contas/' + planA, {}, clientToken);
  assert.equal(d.status, 403);
  const i = await uploadImport(Buffer.from('codigo;classificacao;descricao;tipo\n1;1;ATIVO;S'), 'x.csv', clientToken, 'x');
  assert.equal(i.status, 403);
});

test('12 auditoria', async () => {
  await req('PATCH', '/api/plano-contas/accounts/' + accBank.id, { active: 0 }, ownerA.token);
  assert.ok(audit('ACCOUNT_DEACTIVATED', accBank.id));
  await req('PATCH', '/api/plano-contas/accounts/' + accBank.id, { active: 1 }, ownerA.token);
  assert.ok(audit('ACCOUNT_REACTIVATED', accBank.id));
  assert.ok(audit('ACCOUNTING_PLAN_DELETE_REQUESTED', planA));
  assert.ok(audit('ACCOUNTING_PLAN_DELETE_BLOCKED', planA));
  const imported = db.prepare(
    "SELECT * FROM audit_logs WHERE action='ACCOUNTING_PLAN_IMPORTED' ORDER BY created_at DESC LIMIT 1"
  ).get();
  assert.ok(imported);
  const after = JSON.parse(imported.after_json || '{}');
  assert.ok(after.tenant_id);
  assert.ok(after.imported != null || after.accounts != null);
});

test('13 isolamento tenant_id', async () => {
  const foreign = await req('DELETE', '/api/plano-contas/' + planA, {}, ownerB.token);
  assert.equal(foreign.status, 404);
  const patch = await req('PATCH', '/api/plano-contas/accounts/' + accActive.id, { active: 0 }, ownerB.token);
  assert.equal(patch.status, 404);
  assert.equal(db.prepare('SELECT active FROM accounts WHERE id=?').get(accActive.id).active, 1);
});

test('14 isolamento company_id', async () => {
  const hijack = await req('DELETE', '/api/plano-contas/' + planA, { company_id: companyB.id }, ownerA.token);
  assert.equal(hijack.status, 403);
  const okScope = await req('GET', '/api/plano-contas/' + planA + '/dependencias', undefined, ownerA.token, companyA.id);
  assert.equal(okScope.status, 200);
  const otherCompanyScope = await req('GET', '/api/plano-contas/' + planA + '/dependencias', undefined, ownerA.token, companyA2.id);
  assert.equal(otherCompanyScope.status, 200);
  assert.equal(otherCompanyScope.data.blocked, true);
});

test('15 integridade do banco', () => {
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('16 foreign_key_check', () => {
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('UI administrativa sem alterar Classificação V2', () => {
  assert.match(appJs, /Excluir plano de contas/);
  assert.match(appJs, /Desativar/);
  assert.match(appJs, /Reativar/);
  assert.match(appJs, /PLAN_EXISTS/);
  assert.match(appJs, /confirm_replace/);
  assert.match(appJs, /CdsAccountCombobox\.mount/);
  assert.match(appJs, /account-combo-host/);
  assert.equal(comboJs.includes('filterAccounts'), true);
});

test('synthetic continua não selecionável', async () => {
  const list = await req('GET', '/api/plano-contas/analiticas?q=ATIVO', undefined, ownerA.token);
  const items = list.data.items || list.data;
  assert.ok(!items.some((x) => x.id === accSynth.id));
});
