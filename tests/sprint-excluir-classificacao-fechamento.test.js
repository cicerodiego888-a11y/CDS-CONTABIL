'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-excluir-'));
process.env.CDS_DB_PATH = path.join(tmp, 'excluir.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-excluir-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { app, db } = require('../backend/src/server');
const { PERIOD_STATUSES } = require('../backend/src/accounting/period-statuses');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');

const password = 'Senha@123';
let server, base, owner, company, accDebit, accCredit;

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

function uuid() { return crypto.randomUUID(); }

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await req('POST', '/api/auth/register', {
    name: 'Owner Excluir', email: 'owner.excluir@test.local', password, tenantName: 'Tenant Excluir'
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  owner = (await req('POST', '/api/auth/login', {
    email: 'owner.excluir@test.local', password, tenant: reg.data.tenant_slug
  })).data;
  company = (await req('POST', '/api/empresas', {
    name: 'Empresa Excluir', trade_name: 'ExcluirCo', cnpj: '11222333000181'
  }, owner.token)).data;

  const planId = uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, owner.user.tenant_id, 'Plano Excluir', 'ACTIVE');
  accDebit = uuid();
  accCredit = uuid();
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(accDebit, owner.user.tenant_id, planId, '32101', '32101', '32101', 'A', 'DESPESA', null, 1, 1, 1);
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(accCredit, owner.user.tenant_id, planId, '11101', '11101', '11101', 'A', 'BANCO', null, 1, 1, 1);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('UI: Classificação e Fechamento têm Excluir', () => {
  assert.match(html, /app\.js\?v=s40-doc-preview/);
  assert.match(js, /deleteUnclassifiedEntry/);
  assert.match(js, /fc-del/);
  assert.match(js, /fcDelete/);
  assert.match(js, /Excluir competência/);
});

test('DELETE lançamento NEEDS_CLASSIFICATION remove entry e despesa', async () => {
  const exp = await req('POST', '/api/despesas', {
    company_id: company.id, occurred_on: '2026-09-20', description: 'Frete para excluir',
    amount: '80,00', payment_method: 'PIX'
  }, owner.token);
  assert.equal(exp.status, 201, JSON.stringify(exp.data));
  assert.equal(exp.data.status, 'NEEDS_CLASSIFICATION');
  const entryId = exp.data.entry_id;
  const expenseId = exp.data.id;

  const del = await req('DELETE', '/api/lancamentos/' + entryId, {}, owner.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, true);

  const gone = await req('GET', '/api/lancamentos/' + entryId, undefined, owner.token);
  assert.equal(gone.status, 404);
  const expRow = db.prepare('SELECT id FROM expenses WHERE id=?').get(expenseId);
  assert.equal(expRow, undefined);
});

test('DELETE com análise de documento vinculada não quebra por FK', async () => {
  const exp = await req('POST', '/api/despesas', {
    company_id: company.id, occurred_on: '2026-09-22', description: 'Pix com análise',
    amount: '150,00', payment_method: 'PIX'
  }, owner.token);
  assert.equal(exp.status, 201, JSON.stringify(exp.data));
  const entryId = exp.data.entry_id;
  const expenseId = exp.data.id;
  const analysisId = uuid();
  const docId = uuid();
  db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status,origin,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(docId, owner.user.tenant_id, company.id, 'comp.jpeg', path.join(tmp, 'comp.jpeg'), 'image/jpeg', 10, 'abc', owner.user.id, 'ACTIVE', 'PORTAL_ESCRITORIO', 'OFFICE');
  db.prepare(`INSERT INTO expense_document_analyses(
    id,document_id,tenant_id,company_id,status,expense_id,attempt_count,requested_by,requested_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
    analysisId, docId, owner.user.tenant_id, company.id, 'SAVED', expenseId, 1, owner.user.id
  );

  const del = await req('DELETE', '/api/lancamentos/' + entryId, {}, owner.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(db.prepare('SELECT id FROM expenses WHERE id=?').get(expenseId), undefined);
  const analysis = db.prepare('SELECT expense_id FROM expense_document_analyses WHERE id=?').get(analysisId);
  assert.equal(analysis.expense_id, null);
});

test('DELETE lançamento classificado (PENDING) é bloqueado', async () => {
  const e = await req('POST', '/api/lancamentos', {
    company_id: company.id, occurred_on: '2026-09-21', description: 'Já classificado',
    lines: [
      { account_id: accDebit, side: 'D', amount_cents: 5000 },
      { account_id: accCredit, side: 'C', amount_cents: 5000 }
    ]
  }, owner.token);
  assert.equal(e.status, 201, JSON.stringify(e.data));
  const del = await req('DELETE', '/api/lancamentos/' + e.data.id, {}, owner.token);
  assert.equal(del.status, 409);
  assert.equal(del.data.error, 'ENTRY_ALREADY_CLASSIFIED');
});

test('DELETE competência aberta funciona', async () => {
  const created = await req('POST', '/api/contabilidade/competencias', {
    company_id: company.id, competence: '2026-11'
  }, owner.token);
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
  assert.equal(created.data.status, PERIOD_STATUSES.OPEN);
  assert.equal(created.data.can_delete, true);

  const del = await req('DELETE', '/api/contabilidade/competencias/' + created.data.id, {}, owner.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, true);

  const gone = await req('GET', '/api/contabilidade/competencias/' + created.data.id, undefined, owner.token);
  assert.equal(gone.status, 404);
});

test('DELETE competência fechada é bloqueado', async () => {
  const created = await req('POST', '/api/contabilidade/competencias', {
    company_id: company.id, competence: '2026-12'
  }, owner.token);
  assert.ok([200, 201].includes(created.status));
  db.prepare("UPDATE accounting_periods SET status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(created.data.id);

  const del = await req('DELETE', '/api/contabilidade/competencias/' + created.data.id, {}, owner.token);
  assert.equal(del.status, 409);
  assert.equal(del.data.error, 'PERIOD_DELETE_FORBIDDEN');
});
