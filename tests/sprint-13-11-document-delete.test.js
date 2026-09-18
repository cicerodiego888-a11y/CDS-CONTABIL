'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s1311-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-13-11-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
const { app, db, documentOwnership } = require('../backend/src/server');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const password = 'Senha@123';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

let server, base, ownerA, ownerB, staffA, accountantA, companyA, companyA2, companyB;
let joao, maria, pedro, ana;
let officeDoc, clientDoc, financeDoc;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}
async function uploadOffice(token, companyId, filename, buf, type, extra) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), filename);
  fd.append('company_id', extra && extra.company_id !== undefined ? extra.company_id : companyId);
  if (extra && extra.origin) fd.append('origin', extra.origin);
  if (extra && extra.source) fd.append('source', extra.source);
  if (extra && extra.tenant_id) fd.append('tenant_id', extra.tenant_id);
  const headers = { Authorization: 'Bearer ' + token };
  if (companyId) headers['X-Company-Id'] = companyId;
  const r = await fetch(base + '/api/documentos/upload', { method: 'POST', headers, body: fd });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function uploadClient(token, filename, buf, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), filename);
  const r = await fetch(base + '/api/client/documentos', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  const r = await req('POST', '/api/invitations/' + token + '/accept', { name, password, confirmation: password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
function row(id) {
  return db.prepare('SELECT * FROM documents WHERE id=?').get(id);
}
function audits(action, entityId) {
  return db.prepare('SELECT * FROM audit_logs WHERE action=? AND entity_id=? ORDER BY created_at').all(action, entityId);
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 1311 A', email: 'owner.a.s1311@test.local', password, tenantName: 'Tenant 1311 A' });
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s1311@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório 1311 B', email: 'owner.b.s1311@test.local', password, tenantName: 'Tenant 1311 B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s1311@test.local', password, tenant: b.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Staff 1311', email: 'staff.s1311@test.local', password, role: 'STAFF' }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', { email: 'staff.s1311@test.local', password, tenant: a.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Contador 1311', email: 'acc.s1311@test.local', password, role: 'ACCOUNTANT' }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', { email: 'acc.s1311@test.local', password, tenant: a.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa A 1311', cnpj: '38204469000115' }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', { name: 'Empresa A2 1311', cnpj: '11222333000181' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa B 1311', cnpj: '22333444000192' }, ownerB.token)).data;
  const u1 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'João', email: 'joao.s1311@test.local', profile: 'CLIENT_ADMIN' }, ownerA.token);
  const u2 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Maria', email: 'maria.s1311@test.local', profile: 'CLIENT_FINANCE' }, ownerA.token);
  const u3 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Pedro', email: 'pedro.s1311@test.local', profile: 'CLIENT_VIEWER' }, ownerA.token);
  const u4 = await req('POST', `/api/empresas/${companyB.id}/users`, { name: 'Ana', email: 'ana.s1311@test.local', profile: 'CLIENT_ADMIN' }, ownerB.token);
  joao = await accept(u1.data.invitation, 'João');
  maria = await accept(u2.data.invitation, 'Maria');
  pedro = await accept(u3.data.invitation, 'Pedro');
  ana = await accept(u4.data.invitation, 'Ana');
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('1 OFFICE cria documento OFFICE e ignora source/origin do payload', async () => {
  const up = await uploadOffice(ownerA.token, companyA.id, 'Balancete.pdf', pdf, 'application/pdf', { origin: 'PORTAL_CLIENTE', source: 'CLIENT', tenant_id: ownerB.user.tenant_id, company_id: companyB.id });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  officeDoc = up.data;
  assert.equal(officeDoc.source, 'OFFICE');
  assert.equal(row(officeDoc.id).source, 'OFFICE');
  assert.equal(row(officeDoc.id).origin, 'PORTAL_ESCRITORIO');
  assert.equal(row(officeDoc.id).tenant_id, ownerA.user.tenant_id);
  assert.equal(row(officeDoc.id).company_id, companyA.id);
});

test('4 CLIENT cria documento CLIENT', async () => {
  const up = await uploadClient(joao.token, 'Comprovante.pdf', pdf, 'application/pdf');
  assert.equal(up.status, 201, JSON.stringify(up.data));
  clientDoc = up.data;
  assert.equal(clientDoc.source, 'CLIENT');
  assert.equal(row(clientDoc.id).source, 'CLIENT');
  assert.equal(row(clientDoc.id).origin, 'PORTAL_CLIENTE');
  financeDoc = (await uploadClient(maria.token, 'Pix.png', png, 'image/png')).data;
  assert.equal(financeDoc.source, 'CLIENT');
});

test('2 OFFICE pode excluir documento OFFICE com permissão', async () => {
  const extra = await uploadOffice(ownerA.token, companyA.id, 'Oficio.pdf', pdf, 'application/pdf');
  const del = await req('DELETE', '/api/documentos/' + extra.data.id, undefined, ownerA.token, companyA.id);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.ok, true);
});

test('3 e 10 OFFICE/OWNER não pode excluir documento CLIENT', async () => {
  const del = await req('DELETE', '/api/documentos/' + clientDoc.id, { source: 'OFFICE' }, ownerA.token, companyA.id);
  assert.equal(del.status, 403);
  assert.equal(del.data.error, 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER');
  assert.match(del.data.message, /enviado pelo cliente/);
  assert.equal(row(clientDoc.id).deleted_at, null);
  const denied = audits('DOCUMENT_DELETE_DENIED', clientDoc.id);
  assert.ok(denied.length >= 1);
});

test('5 CLIENT_ADMIN pode excluir documento CLIENT', async () => {
  const extra = await uploadClient(joao.token, 'Temp.pdf', pdf, 'application/pdf');
  const del = await req('DELETE', '/api/client/documentos/' + extra.data.id, undefined, joao.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
});

test('6 e 11 CLIENT_ADMIN não pode excluir documento OFFICE', async () => {
  const del = await req('DELETE', '/api/client/documentos/' + officeDoc.id, { source: 'CLIENT' }, joao.token);
  assert.equal(del.status, 403);
  assert.equal(del.data.error, 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER');
  assert.match(del.data.message, /enviado pelo escritório/);
  assert.equal(row(officeDoc.id).deleted_at, null);
});

test('7 CLIENT_VIEWER não pode excluir documento CLIENT', async () => {
  const del = await req('DELETE', '/api/client/documentos/' + financeDoc.id, undefined, pedro.token);
  assert.equal(del.status, 403);
  assert.equal(del.data.error, 'CLIENT_PERMISSION_REQUIRED');
  assert.equal(row(financeDoc.id).deleted_at, null);
});

test('8 ACCOUNTANT respeita autorização: exclui OFFICE e não CLIENT', async () => {
  const extra = await uploadOffice(accountantA.token, companyA.id, 'Contador.pdf', pdf, 'application/pdf');
  const ok = await req('DELETE', '/api/documentos/' + extra.data.id, undefined, accountantA.token, companyA.id);
  assert.equal(ok.status, 200);
  const no = await req('DELETE', '/api/documentos/' + clientDoc.id, undefined, accountantA.token, companyA.id);
  assert.equal(no.status, 403);
  assert.equal(no.data.error, 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER');
});

test('9 STAFF respeita autorização: exclui OFFICE e não CLIENT', async () => {
  const extra = await uploadOffice(staffA.token, companyA.id, 'Staff.pdf', pdf, 'application/pdf');
  const ok = await req('DELETE', '/api/documentos/' + extra.data.id, undefined, staffA.token, companyA.id);
  assert.equal(ok.status, 200);
  const no = await req('DELETE', '/api/documentos/' + clientDoc.id, undefined, staffA.token, companyA.id);
  assert.equal(no.status, 403);
});

test('12-22 exclusão OFFICE preenche soft delete, some da listagem, permanece no banco e na auditoria', async () => {
  const extra = await uploadOffice(ownerA.token, companyA.id, 'Auditoria.pdf', pdf, 'application/pdf');
  const id = extra.data.id;
  const del = await req('DELETE', '/api/documentos/' + id, undefined, ownerA.token, companyA.id);
  assert.equal(del.status, 200);
  const stored = row(id);
  assert.ok(stored.deleted_at);
  assert.equal(stored.deleted_by, ownerA.user.id);
  assert.equal(stored.deleted_source, 'PORTAL_ESCRITORIO');
  const list = await req('GET', '/api/documentos?page=1&page_size=100', undefined, ownerA.token, companyA.id);
  assert.equal(list.status, 200);
  assert.ok(!list.data.items.some(x => x.id === id));
  const view = await fetch(base + '/api/documentos/' + id + '/view', { headers: { Authorization: 'Bearer ' + ownerA.token, 'X-Company-Id': companyA.id } });
  assert.equal(view.status, 404);
  const ev = audits('DOCUMENT_DELETED', id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].tenant_id, ownerA.user.tenant_id);
  assert.equal(ev[0].user_id, ownerA.user.id);
  const after = JSON.parse(ev[0].after_json);
  assert.equal(after.company_id, companyA.id);
  assert.equal(after.document_id, id);
  assert.equal(after.document_source, 'OFFICE');
  assert.equal(after.action_source, 'PORTAL_ESCRITORIO');
  assert.equal(after.original_filename, 'Auditoria.pdf');
  assert.equal(after.user_role, 'OWNER');
  assert.ok(after.timestamp);
});

test('12-22 exclusão CLIENT preenche auditoria PORTAL_CLIENTE', async () => {
  const extra = await uploadClient(maria.token, 'Financeiro.pdf', pdf, 'application/pdf');
  const id = extra.data.id;
  const del = await req('DELETE', '/api/client/documentos/' + id, undefined, maria.token);
  assert.equal(del.status, 200);
  const stored = row(id);
  assert.ok(stored.deleted_at);
  assert.equal(stored.deleted_by, maria.user.id);
  const list = await req('GET', '/api/client/documentos', undefined, maria.token);
  assert.ok(!list.data.some(x => x.id === id));
  const ev = audits('DOCUMENT_DELETED', id);
  assert.equal(ev.length, 1);
  const after = JSON.parse(ev[0].after_json);
  assert.equal(after.document_source, 'CLIENT');
  assert.equal(after.action_source, 'PORTAL_CLIENTE');
  assert.equal(after.user_role, 'CLIENT');
  assert.equal(ev[0].tenant_id, ownerA.user.tenant_id);
  assert.equal(after.company_id, companyA.id);
});

test('23 Tenant A não exclui documento do Tenant B', async () => {
  const other = await uploadOffice(ownerB.token, companyB.id, 'Outro.pdf', pdf, 'application/pdf');
  const del = await req('DELETE', '/api/documentos/' + other.data.id, { tenant_id: ownerB.user.tenant_id }, ownerA.token, companyA.id);
  assert.equal(del.status, 404);
  assert.equal(row(other.data.id).deleted_at, null);
});

test('24 Empresa A não exclui documento da Empresa B do mesmo tenant', async () => {
  const other = await uploadOffice(ownerA.token, companyA2.id, 'Empresa2.pdf', pdf, 'application/pdf');
  const del = await req('DELETE', '/api/documentos/' + other.data.id, { company_id: companyA2.id }, ownerA.token, companyA.id);
  assert.equal(del.status, 404);
  assert.equal(row(other.data.id).deleted_at, null);
});

test('25 documento inexistente retorna 404', async () => {
  const del = await req('DELETE', '/api/documentos/' + crypto.randomUUID(), undefined, ownerA.token, companyA.id);
  assert.equal(del.status, 404);
  const client = await req('DELETE', '/api/client/documentos/' + crypto.randomUUID(), undefined, joao.token);
  assert.equal(client.status, 404);
});

test('26 exclusão repetida é idempotente', async () => {
  const extra = await uploadOffice(ownerA.token, companyA.id, 'Idem.pdf', pdf, 'application/pdf');
  const first = await req('DELETE', '/api/documentos/' + extra.data.id, undefined, ownerA.token, companyA.id);
  const second = await req('DELETE', '/api/documentos/' + extra.data.id, undefined, ownerA.token, companyA.id);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.data.already_deleted, true);
  assert.equal(audits('DOCUMENT_DELETED', extra.data.id).length, 1);
});

test('27 documento IMPORT não pode ser excluído; origem insegura sem uploaded_by conhecido também não', async () => {
  const importId = crypto.randomUUID();
  db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status,origin,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(importId, ownerA.user.tenant_id, companyA.id, 'import.pdf', path.join(os.tmpdir(), 'missing.pdf'), 'application/pdf', 10, 'x', ownerA.user.id, 'ACTIVE', 'IMPORTACAO_CONTABIL', 'IMPORT');
  const unknownId = crypto.randomUUID();
  db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status,origin,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(unknownId, ownerA.user.tenant_id, companyA.id, 'legado.pdf', path.join(os.tmpdir(), 'missing2.pdf'), 'application/pdf', 10, 'y', 'user-inexistente', 'ACTIVE', 'PORTAL_CLIENTE', null);
  const imp = await req('DELETE', '/api/documentos/' + importId, undefined, ownerA.token, companyA.id);
  assert.equal(imp.status, 403);
  assert.equal(imp.data.error, 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER');
  const unk = await req('DELETE', '/api/documentos/' + unknownId, undefined, ownerA.token, companyA.id);
  assert.equal(unk.status, 403);
  assert.equal(row(importId).deleted_at, null);
  assert.equal(row(unknownId).deleted_at, null);
});

test('legado: uploaded_by do escritório libera exclusão OFFICE; uploaded_by CLIENT libera no portal', async () => {
  const officeLegacy = crypto.randomUUID();
  db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status,origin,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(officeLegacy, ownerA.user.tenant_id, companyA.id, 'legado-office.pdf', path.join(os.tmpdir(), 'lo.pdf'), 'application/pdf', 10, 'z', ownerA.user.id, 'ACTIVE', 'PORTAL_CLIENTE', null);
  const clientLegacy = crypto.randomUUID();
  db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status,origin,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(clientLegacy, ownerA.user.tenant_id, companyA.id, 'legado-cliente.pdf', path.join(os.tmpdir(), 'lc.pdf'), 'application/pdf', 10, 'w', joao.user.id, 'ACTIVE', 'PORTAL_CLIENTE', null);
  const officeList = await req('GET', '/api/documentos?page=1&page_size=100', undefined, ownerA.token, companyA.id);
  const oItem = officeList.data.items.find(x => x.id === officeLegacy);
  const cItem = officeList.data.items.find(x => x.id === clientLegacy);
  assert.equal(oItem.source, 'OFFICE');
  assert.equal(oItem.can_delete, true);
  assert.equal(cItem.source, 'CLIENT');
  assert.equal(cItem.can_delete, false);
  const clientList = await req('GET', '/api/client/documentos', undefined, joao.token);
  const cMine = clientList.data.find(x => x.id === clientLegacy);
  const cOffice = clientList.data.find(x => x.id === officeLegacy);
  assert.equal(cMine.can_delete, true);
  assert.equal(cOffice.can_delete, false);
  const delOffice = await req('DELETE', '/api/documentos/' + officeLegacy, undefined, ownerA.token, companyA.id);
  assert.equal(delOffice.status, 200);
  const delClient = await req('DELETE', '/api/client/documentos/' + clientLegacy, undefined, joao.token);
  assert.equal(delClient.status, 200);
});

test('28-30 frontend não burla source, company_id nem tenant_id', async () => {
  const spoof = await req('DELETE', '/api/documentos/' + clientDoc.id, {
    source: 'OFFICE',
    origin: 'PORTAL_ESCRITORIO',
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    user_id: ownerA.user.id,
    role: 'OWNER'
  }, ownerA.token, companyA.id);
  assert.equal(spoof.status, 403);
  assert.equal(spoof.data.error, 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER');
  const clientSpoof = await req('DELETE', '/api/client/documentos/' + officeDoc.id, {
    source: 'CLIENT',
    tenant_id: ownerB.user.tenant_id,
    company_id: companyB.id
  }, joao.token);
  assert.equal(clientSpoof.status, 403);
});

test('não existe caminho alternativo de exclusão e visualização de não excluídos continua', async () => {
  const alt = await req('POST', '/api/documentos/' + officeDoc.id + '/remover', {}, ownerA.token, companyA.id);
  assert.ok(alt.status === 404 || alt.status === 405);
  const view = await fetch(base + '/api/documentos/' + officeDoc.id + '/view', { headers: { Authorization: 'Bearer ' + ownerA.token, 'X-Company-Id': companyA.id } });
  assert.equal(view.status, 200);
  const clientView = await fetch(base + '/api/client/documentos/' + clientDoc.id + '/view', { headers: { Authorization: 'Bearer ' + joao.token } });
  assert.equal(clientView.status, 200);
  const serverSrc = read('backend/src/server.js');
  const deletes = [...serverSrc.matchAll(/app\.delete\('\/api\/(?:client\/)?documentos\/:id'/g)];
  assert.equal(deletes.length, 2);
  assert.match(serverSrc, /handleDocumentDelete/);
  assert.match(serverSrc, /function purgeCompanyData/);
  assert.equal((serverSrc.match(/DELETE FROM documents/g) || []).length, 1);
});

test('listagens do escritório e do cliente expõem can_delete pela propriedade', async () => {
  const office = await req('GET', '/api/documentos?page=1&page_size=100', undefined, ownerA.token, companyA.id);
  const ofOffice = office.data.items.find(x => x.id === officeDoc.id);
  const ofClient = office.data.items.find(x => x.id === clientDoc.id);
  assert.equal(ofOffice.can_delete, true);
  assert.equal(ofOffice.source_label, 'Enviado pelo escritório');
  assert.equal(ofClient.can_delete, false);
  assert.equal(ofClient.source_label, 'Enviado pelo cliente');
  const client = await req('GET', '/api/client/documentos', undefined, joao.token);
  const cOffice = client.data.find(x => x.id === officeDoc.id);
  const cClient = client.data.find(x => x.id === clientDoc.id);
  assert.equal(cOffice.can_delete, false);
  assert.equal(cOffice.source_label, 'Enviado pelo escritório');
  assert.equal(cClient.can_delete, true);
  assert.equal(cClient.source_label, 'Enviado por você');
  const viewer = await req('GET', '/api/client/documentos', undefined, pedro.token);
  const vClient = viewer.data.find(x => x.id === clientDoc.id);
  assert.equal(vClient.can_delete, false);
});

test('módulo de propriedade e UI em português', () => {
  assert.equal(documentOwnership.resolveSource({ source: 'OFFICE' }), 'OFFICE');
  assert.equal(documentOwnership.resolveSource({ origin: 'PORTAL_CLIENTE' }), null);
  assert.equal(documentOwnership.resolveSource({ origin: 'PORTAL_CLIENTE', uploaded_by_role: 'OWNER' }), 'OFFICE');
  assert.equal(documentOwnership.resolveSource({ origin: 'PORTAL_CLIENTE', uploaded_by_role: 'CLIENT' }), 'CLIENT');
  assert.equal(documentOwnership.canDelete({ user: { role: 'OWNER' }, document: { source: 'CLIENT' } }).code, 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER');
  const office = read('frontend/public/assets/app.js');
  const portal = read('frontend/public/portal/portal.js');
  assert.match(office, />Excluir</);
  assert.match(office, /Excluir documento\?/);
  assert.match(office, /histórico de auditoria/);
  assert.match(office, /x\.can_delete/);
  assert.match(portal, />Excluir</);
  assert.match(portal, /Excluir documento\?/);
  assert.match(portal, /registrada no histórico/);
  assert.match(portal, /x\.can_delete/);
  assert.doesNotMatch(office.slice(office.indexOf('async function documents'), office.indexOf('function viewOfficeDocument')), /Delete document/i);
});
