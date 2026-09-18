'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-co-del-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-company-delete-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
const { app, db } = require('../backend/src/server');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const password = 'Senha@123';
let server, base, ownerA, ownerB, staffA, accountantA, companyA, companyB, clientToken;

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
  const a = await req('POST', '/api/auth/register', { name: 'Escritório Del A', email: 'owner.del.a@test.local', password, tenantName: 'Tenant Del A' });
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.del.a@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório Del B', email: 'owner.del.b@test.local', password, tenantName: 'Tenant Del B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.del.b@test.local', password, tenant: b.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Staff Del', email: 'staff.del@test.local', password, role: 'STAFF' }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', { email: 'staff.del@test.local', password, tenant: a.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Contador Del', email: 'acc.del@test.local', password, role: 'ACCOUNTANT' }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', { email: 'acc.del@test.local', password, tenant: a.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa Del A', cnpj: '38204469000115' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa Del B', cnpj: '11222333000181' }, ownerB.token)).data;
  const cu = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Cliente Del', email: 'client.del@test.local', profile: 'CLIENT_ADMIN' }, ownerA.token);
  const tok = cu.data.invitation.activation_url.split('/convite/')[1];
  clientToken = (await req('POST', '/api/invitations/' + tok + '/accept', { name: 'Cliente Del', password, confirmation: password })).data.token;
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('OWNER exclui empresa com motivo, remove do banco e registra auditoria', async () => {
  const co = (await req('POST', '/api/empresas', { name: 'Para Excluir Ltda', cnpj: '22333444000192' }, ownerA.token)).data;
  const del = await req('DELETE', '/api/empresas/' + co.id, { reason: 'Encerramento de contrato', tenant_id: ownerB.user.tenant_id }, ownerA.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, true);
  const row = db.prepare('SELECT * FROM companies WHERE id=?').get(co.id);
  assert.equal(row, undefined);
  const log = db.prepare("SELECT * FROM audit_logs WHERE action='COMPANY_DELETED' AND entity_id=?").get(co.id);
  assert.ok(log);
  assert.equal(log.user_id, ownerA.user.id);
  assert.equal(log.tenant_id, ownerA.user.tenant_id);
  const after = JSON.parse(log.after_json);
  assert.equal(after.reason, 'Encerramento de contrato');
  assert.equal(after.user_role, 'OWNER');
  assert.equal(after.company_id, co.id);
  const listed = await req('GET', '/api/empresas?page=1&page_size=50', undefined, ownerA.token);
  assert.equal((listed.data.items || []).some(x => x.id === co.id), false);
});

test('sem motivo retorna 400; STAFF e CLIENT são bloqueados; outro tenant 404', async () => {
  const co = (await req('POST', '/api/empresas', { name: 'Motivo Obrigatorio', cnpj: '33444555000103' }, ownerA.token)).data;
  const missing = await req('DELETE', '/api/empresas/' + co.id, {}, ownerA.token);
  assert.equal(missing.status, 400);
  assert.equal(missing.data.error, 'DELETION_REASON_REQUIRED');
  const staff = await req('DELETE', '/api/empresas/' + co.id, { reason: 'Tentativa staff' }, staffA.token);
  assert.equal(staff.status, 403);
  const client = await req('DELETE', '/api/empresas/' + co.id, { reason: 'Tentativa cliente' }, clientToken);
  assert.equal(client.status, 403);
  const cross = await req('DELETE', '/api/empresas/' + companyB.id, { reason: 'Outro escritório' }, ownerA.token);
  assert.equal(cross.status, 404);
  assert.equal(db.prepare('SELECT status FROM companies WHERE id=?').get(co.id).status, 'ACTIVE');
});

test('ACCOUNTANT pode excluir; exclusão repetida retorna 404', async () => {
  const co = (await req('POST', '/api/empresas', { name: 'Contador Exclui', cnpj: '44555666000114' }, ownerA.token)).data;
  const first = await req('DELETE', '/api/empresas/' + co.id, { reason: 'Baixa cadastral' }, accountantA.token);
  assert.equal(first.status, 200);
  const second = await req('DELETE', '/api/empresas/' + co.id, { reason: 'Baixa cadastral' }, accountantA.token);
  assert.equal(second.status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='COMPANY_DELETED' AND entity_id=?").get(co.id).n, 1);
  assert.equal(db.prepare('SELECT id FROM companies WHERE id=?').get(co.id), undefined);
});

test('arquivar esconde da listagem operacional e só aparece em Arquivadas', async () => {
  const co = (await req('POST', '/api/empresas', { name: 'Para Arquivar Ltda', cnpj: '55666777000125' }, ownerA.token)).data;
  const missing = await req('POST', '/api/empresas/' + co.id + '/arquivar', {}, ownerA.token);
  assert.equal(missing.status, 400);
  assert.equal(missing.data.error, 'ARCHIVE_REASON_REQUIRED');
  const staff = await req('POST', '/api/empresas/' + co.id + '/arquivar', { reason: 'Tentativa staff' }, staffA.token);
  assert.equal(staff.status, 403);
  const ok = await req('POST', '/api/empresas/' + co.id + '/arquivar', { reason: 'Contrato suspenso' }, ownerA.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const row = db.prepare('SELECT * FROM companies WHERE id=?').get(co.id);
  assert.equal(row.status, 'ARCHIVED');
  assert.ok(row.archived_at);
  assert.equal(row.archived_by, ownerA.user.id);
  assert.equal(row.archive_reason, 'Contrato suspenso');
  const all = await req('GET', '/api/empresas?page=1&page_size=50', undefined, ownerA.token);
  assert.equal((all.data.items || []).some(x => x.id === co.id), false);
  const archived = await req('GET', '/api/empresas?status=ARCHIVED&page=1&page_size=50', undefined, ownerA.token);
  assert.equal((archived.data.items || []).some(x => x.id === co.id), true);
  const restored = await req('POST', '/api/empresas/' + co.id + '/desarquivar', {}, accountantA.token);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.status, 'ACTIVE');
  const again = await req('GET', '/api/empresas?page=1&page_size=50', undefined, ownerA.token);
  assert.equal((again.data.items || []).some(x => x.id === co.id), true);
});

test('menu do escritório oferece Arquivar e Excluir em português', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, />Excluir</);
  assert.match(js, />Arquivar</);
  assert.match(js, /Arquivar empresa\?/);
  assert.match(js, /Excluir empresa\?/);
  assert.match(js, /Motivo \*/);
  assert.match(js, /method:'DELETE'/);
  assert.match(js, /\/arquivar/);
  assert.match(js, /confirmDeleteCompany/);
  assert.match(js, /confirmArchiveCompany/);
  assert.match(js, /removida do banco/);
  assert.doesNotMatch(js, /Delete company/i);
});
