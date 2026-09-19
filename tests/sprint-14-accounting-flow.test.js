'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s14f-'));
process.env.CDS_DB_PATH = path.join(tmp, 's14f.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-14-flow-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';

const { app, db } = require('../backend/src/server');
const password = 'Senha@123';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

let server, base, owner, company, client, accD, accC;

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 14F', email: 'owner.s14f@test.local', password, tenantName: 'Tenant 14F' });
  owner = (await req('POST', '/api/auth/login', { email: 'owner.s14f@test.local', password, tenant: a.data.tenant_slug })).data;
  company = (await req('POST', '/api/empresas', { name: 'Empresa 14F', cnpj: '38204469000115' }, owner.token)).data;
  const plan = db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(require('crypto').randomUUID(), owner.user.tenant_id, 'Plano', 'ACTIVE');
  const planId = db.prepare('SELECT id FROM account_plans WHERE tenant_id=?').get(owner.user.tenant_id).id;
  const ins = db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,account_code,classification_code,account_type,description,is_postable,active) VALUES(?,?,?,?,?,?,?,?,1)');
  accD = require('crypto').randomUUID();
  accC = require('crypto').randomUUID();
  ins.run(accD, owner.user.tenant_id, planId, '3.1', '31', 'A', 'Despesa combustível', 1);
  ins.run(accC, owner.user.tenant_id, planId, '1.1', '11', 'A', 'Caixa', 1);
  const u = await req('POST', `/api/empresas/${company.id}/users`, { name: 'Cli 14F', email: 'cli.s14f@test.local', profile: 'CLIENT_FINANCE' }, owner.token);
  const tok = u.data.invitation.activation_url.split('/convite/')[1];
  client = (await req('POST', '/api/invitations/' + tok + '/accept', { name: 'Cli 14F', password, confirmation: password })).data;
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fluxo cliente→despesa→documento→classifica→aprova→POSTED→export', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'cupom.pdf');
  const up = await fetch(base + '/api/client/documentos', { method: 'POST', headers: { Authorization: 'Bearer ' + client.token }, body: fd });
  const doc = await up.json();
  assert.equal(up.status, 201, JSON.stringify(doc));
  const stored = db.prepare('SELECT storage_path,sha256,company_id,tenant_id FROM documents WHERE id=?').get(doc.id);
  assert.match(stored.storage_path.replace(/\\/g, '/'), /^documents\//);
  assert.equal(stored.company_id, company.id);

  const exp = await req('POST', '/api/client/despesas', {
    occurred_on: '2026-09-18', description: 'Combustível sprint 14', amount: '50,00', payment_method: 'PIX', document_id: doc.id
  }, client.token);
  assert.equal(exp.status, 201, JSON.stringify(exp.data));
  assert.equal(exp.data.company_id, company.id);

  const same = await req('POST', '/api/lancamentos', {
    company_id: company.id, occurred_on: '2026-09-18', description: 'semantico',
    lines: [{ account_id: accD, side: 'D', amount_cents: 5000 }, { account_id: accD, side: 'C', amount_cents: 5000 }]
  }, owner.token);
  assert.equal(same.status, 422);
  assert.equal(same.data.error, 'SEMANTIC_INVALID');

  const rec = await req('POST', '/api/lancamentos/' + exp.data.entry_id + '/reclassificar', {
    reason: 'Classificação do contador',
    lines: [{ account_id: accD, side: 'D', amount_cents: 5000 }, { account_id: accC, side: 'C', amount_cents: 5000 }]
  }, owner.token);
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  const lines = rec.data.lines;
  const d = lines.filter(x => x.side === 'D').reduce((a, x) => a + x.amount_cents, 0);
  const c = lines.filter(x => x.side === 'C').reduce((a, x) => a + x.amount_cents, 0);
  assert.equal(d, c);

  const ap = await req('POST', '/api/aprovacao/' + exp.data.entry_id + '/aprovar', {}, owner.token);
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.equal(ap.data.status, 'POSTED');

  const expx = await req('POST', '/api/exportacoes/gerar', {
    company_id: company.id, system_key: 'contaazul', period_start: '2026-09-01', period_end: '2026-09-30'
  }, owner.token);
  assert.equal(expx.status, 201, JSON.stringify(expx.data));
  const posted = db.prepare("SELECT action FROM audit_logs WHERE entity_id=? AND action IN('ENTRY_APPROVED','ENTRY_POSTED')").all(exp.data.entry_id);
  assert.ok(posted.length >= 1);
});
