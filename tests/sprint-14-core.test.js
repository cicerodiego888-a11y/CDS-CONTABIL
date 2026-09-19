'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s14-'));
process.env.CDS_DB_PATH = path.join(tmp, 's14.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-14-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db, documentStorage } = require('../backend/src/server');
const { resolveSafePath } = require('../backend/src/documents/storage');
const { validateAccountingSemantics } = require('../backend/src/accounting/semantics');
const { loadConfig } = require('../backend/src/config');

const password = 'Senha@123';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

let server, base, ownerA, ownerB, companyA, companyB, clientA, clientB;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}
async function upload(token, companyId, filename, buf) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), filename);
  if (companyId) fd.append('company_id', companyId);
  const r = await fetch(base + '/api/documentos/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  return (await req('POST', '/api/invitations/' + token + '/accept', { name, password, confirmation: password })).data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 14 A', email: 'owner.a.s14@test.local', password, tenantName: 'Tenant 14 A' });
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s14@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório 14 B', email: 'owner.b.s14@test.local', password, tenantName: 'Tenant 14 B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s14@test.local', password, tenant: b.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa A 14', cnpj: '38204469000115' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa B 14', cnpj: '11222333000181' }, ownerB.token)).data;
  const u1 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Cliente A', email: 'ca.s14@test.local', profile: 'CLIENT_ADMIN' }, ownerA.token);
  const u2 = await req('POST', `/api/empresas/${companyB.id}/users`, { name: 'Cliente B', email: 'cb.s14@test.local', profile: 'CLIENT_ADMIN' }, ownerB.token);
  clientA = await accept(u1.data.invitation, 'Cliente A');
  clientB = await accept(u2.data.invitation, 'Cliente B');
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('novo documento grava caminho relativo e arquivo criptografado', async () => {
  const up = await upload(ownerA.token, companyA.id, 'nota.pdf', pdf);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const row = db.prepare('SELECT * FROM documents WHERE id=?').get(up.data.id);
  assert.ok(!path.isAbsolute(row.storage_path));
  assert.match(row.storage_path.replace(/\\/g, '/'), /^documents\/.+\/nota\.pdf$/);
  assert.doesNotMatch(row.storage_path, /C:\\|D:\\|Users\\/i);
  assert.equal(up.data.storage_path, undefined);
  const abs = documentStorage.physical(row.storage_path);
  const disk = fs.readFileSync(abs);
  assert.notEqual(disk.subarray(0, 5).toString(), '%PDF-');
  assert.equal(documentStorage.readPlain(row.storage_path).subarray(0, 5).toString(), '%PDF-');
  assert.equal(row.sha256, crypto.createHash('sha256').update(pdf).digest('hex'));
});

test('visualização autorizada e isolamento A/B', async () => {
  const up = await upload(ownerA.token, companyA.id, 'iso.pdf', pdf);
  const view = await fetch(base + '/api/documentos/' + up.data.id + '/view', { headers: { Authorization: 'Bearer ' + ownerA.token } });
  assert.equal(view.status, 200);
  const buf = Buffer.from(await view.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const other = await fetch(base + '/api/documentos/' + up.data.id + '/view', { headers: { Authorization: 'Bearer ' + ownerB.token } });
  assert.equal(other.status, 404);
  const client = await fetch(base + '/api/client/documentos/' + up.data.id + '/view', { headers: { Authorization: 'Bearer ' + clientB.token } });
  assert.equal(client.status, 404);
  const audit = db.prepare("SELECT action FROM audit_logs WHERE entity_id=? AND action='DOCUMENT_VIEWED'").get(up.data.id);
  assert.ok(audit);
});

test('path traversal bloqueado', () => {
  const root = process.env.UPLOAD_DIR;
  assert.equal(resolveSafePath('../package.json', root), null);
  assert.equal(resolveSafePath(path.resolve(__dirname, '../package.json'), root), null);
});

test('credencial configurada sem senha na API', async () => {
  const list = await req('GET', `/api/empresas/${companyA.id}/users`, undefined, ownerA.token);
  const row = list.data.find(x => x.email === 'ca.s14@test.local');
  assert.equal(row.credential_status, 'CONFIGURADA');
  assert.equal(row.password, undefined);
  assert.equal(row.password_hash, undefined);
  const denyPw = await req('POST', `/api/client-users/${row.id}/password`, {}, ownerA.token);
  assert.equal(denyPw.status, 403);
  assert.equal(denyPw.data.error, 'PASSWORD_NOT_RECOVERABLE');
  const sensitive = db.prepare("SELECT action FROM audit_logs WHERE action='SENSITIVE_DATA_ACCESSED' AND entity_id=?").get(row.id);
  assert.ok(sensitive);
});

test('semântica: mesma conta em despesa é rejeitada; transferência passa', () => {
  assert.throws(() => validateAccountingSemantics({
    sourceType: 'EXPENSE',
    lines: [{ account_id: '1', side: 'D', amount_cents: 100 }, { account_id: '1', side: 'C', amount_cents: 100 }]
  }), /mesma conta/);
  assert.doesNotThrow(() => validateAccountingSemantics({
    sourceType: 'MANUAL',
    entryKind: 'TRANSFER',
    lines: [{ account_id: '1', side: 'D', amount_cents: 100 }, { account_id: '1', side: 'C', amount_cents: 100 }]
  }));
});

test('health sem demo e revogação de sessão isolada', async () => {
  const h = await req('GET', '/api/health');
  assert.equal(h.data.demo, false);
  await req('POST', '/api/usuarios', { name: 'Revoke 14', email: 'revoke.s14@test.local', password, role: 'STAFF' }, ownerA.token);
  const sess = (await req('POST', '/api/auth/login', { email: 'revoke.s14@test.local', password, tenant: ownerA.user.tenant_slug })).data;
  const out = await req('POST', '/api/auth/logout', { revoke: true }, sess.token);
  assert.equal(out.status, 200);
  const blocked = await req('GET', '/api/auth/me', undefined, sess.token);
  assert.equal(blocked.status, 401);
});

test('cliente B não lê despesa/receita/lançamento/conta/notificação/solicitação de A', async () => {
  const exp = await req('POST', '/api/despesas', { company_id: companyA.id, occurred_on: '2026-09-18', description: 'iso-s14', amount: '10,00', payment_method: 'PIX' }, ownerA.token);
  assert.ok(exp.status === 201, JSON.stringify(exp.data));
  const cross = await req('GET', '/api/client/despesas', undefined, clientB.token);
  assert.equal(cross.status, 200);
  assert.ok(Array.isArray(cross.data));
  assert.equal(cross.data.some(x => x.id === exp.data.id), false);
  const docCross = await req('GET', '/api/client/documentos/' + crypto.randomUUID(), undefined, clientA.token);
  assert.ok(docCross.status === 404 || docCross.status === 403);
  const n = await req('GET', '/api/client/notificacoes', undefined, clientB.token);
  assert.ok(n.status === 200);
  const dump = JSON.stringify(n.data);
  assert.doesNotMatch(dump, new RegExp(companyA.id));
});

test('config oficial CDS_DB_PATH e produção exige chaves', () => {
  const cfg = loadConfig({ ...process.env, NODE_ENV: 'development', JWT_SECRET: 'ok', CDS_DB_PATH: 'x.db' });
  assert.equal(cfg.CDS_DB_PATH, 'x.db');
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: '', CDS_DB_PATH: 'x.db' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'strong-secret-16+', DOCUMENT_ENCRYPTION_KEY: 'short', CDS_DB_PATH: 'x.db' }), /DOCUMENT_ENCRYPTION_KEY/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'strong-secret-16+', DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', DEMO_MODE: 'true', CDS_DB_PATH: 'x.db' }), /DEMO_MODE/);
});
