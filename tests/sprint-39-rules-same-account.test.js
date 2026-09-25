'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-rules-same-'));
process.env.CDS_DB_PATH = path.join(tmp, 'rules.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-rules-same-account-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db } = require('../backend/src/server');

const password = 'Senha@123';
let server, base, token, planId, accA, accB;

function req(method, url, body, tok) {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = 'Bearer ' + tok;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await req('POST', '/api/auth/register', {
    name: 'Escritório Rules', email: 'owner.rules@test.local', password, tenantName: 'Tenant Rules'
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  token = (await req('POST', '/api/auth/login', {
    email: 'owner.rules@test.local', password, tenant: reg.data.tenant_slug
  })).data.token;
  planId = require('crypto').randomUUID();
  const tenantId = (await req('POST', '/api/auth/login', {
    email: 'owner.rules@test.local', password, tenant: reg.data.tenant_slug
  })).data.user.tenant_id;
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, tenantId, 'Plano Rules', 'ACTIVE');
  accA = require('crypto').randomUUID();
  accB = require('crypto').randomUUID();
  const ins = db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,account_code,classification_code,account_type,description,level,is_postable) VALUES(?,?,?,?,?,?,?,?,1)');
  ins.run(accA, tenantId, planId, '5', '1110100001', 'A', 'CAIXA GERAL', 0);
  ins.run(accB, tenantId, planId, '200', '3110100001', 'A', 'FRETES', 0);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
});

test('POST regra com débito=crédito → 422 SAME_ACCOUNTS', async () => {
  const r = await req('POST', '/api/regras-contabeis', {
    name: 'Fretes inválido',
    priority: 100,
    confidence: 1,
    debit_account_id: accA,
    credit_account_id: accA,
    conditions: { description: 'Frete', payment_method: 'PIX' }
  }, token);
  assert.equal(r.status, 422, JSON.stringify(r.data));
  assert.equal(r.data.error, 'SAME_ACCOUNTS');
});

test('POST regra com contas distintas → 201', async () => {
  const r = await req('POST', '/api/regras-contabeis', {
    name: 'Fretes pagos por PIX',
    priority: 100,
    confidence: 1,
    debit_account_id: accB,
    credit_account_id: accA,
    conditions: { description: 'Frete', payment_method: 'PIX' }
  }, token);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.notEqual(r.data.debit_account_id, r.data.credit_account_id);
});

test('frontend impede mesma conta no formulário de regra', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /Débito e crédito não podem ser a mesma conta/);
  assert.match(js, /Selecione a conta/);
});
