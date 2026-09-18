'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s138-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-13-8-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
const { app, db } = require('../backend/src/server');
const access = require('../backend/src/documents/access');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const password = 'Senha@123';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

let server, base, ownerA, ownerB, staffA, accountantA, companyA, companyA2, companyB;
let joao, maria, pedro, ana;
let pdfDoc, jpgDoc, jpegDoc, pngDoc, officePdf;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}
async function fileReq(url, token, companyId) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  const r = await fetch(base + url, { headers, cache: 'no-store' });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { json = JSON.parse(buf.toString('utf8')); } catch {} }
  return { status: r.status, buf, json, headers: r.headers, ct, disp: r.headers.get('content-disposition') || '', cache: r.headers.get('cache-control') || '' };
}
async function uploadOffice(token, companyId, filename, buf, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), filename);
  fd.append('company_id', companyId);
  const headers = { Authorization: 'Bearer ' + token };
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

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 138 A', email: 'owner.a.s138@test.local', password, tenantName: 'Tenant 138 A' });
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s138@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório 138 B', email: 'owner.b.s138@test.local', password, tenantName: 'Tenant 138 B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s138@test.local', password, tenant: b.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Staff 138', email: 'staff.s138@test.local', password, role: 'STAFF' }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', { email: 'staff.s138@test.local', password, tenant: a.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Contador 138', email: 'acc.s138@test.local', password, role: 'ACCOUNTANT' }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', { email: 'acc.s138@test.local', password, tenant: a.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa A 138', cnpj: '38204469000115' }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', { name: 'Empresa A2 138', cnpj: '11222333000181' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa B 138', cnpj: '22333444000192' }, ownerB.token)).data;
  const u1 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'João', email: 'joao.s138@test.local', profile: 'CLIENT_ADMIN' }, ownerA.token);
  const u2 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Maria', email: 'maria.s138@test.local', profile: 'CLIENT_FINANCE' }, ownerA.token);
  const u3 = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Pedro', email: 'pedro.s138@test.local', profile: 'CLIENT_VIEWER' }, ownerA.token);
  const u4 = await req('POST', `/api/empresas/${companyB.id}/users`, { name: 'Ana', email: 'ana.s138@test.local', profile: 'CLIENT_ADMIN' }, ownerB.token);
  joao = await accept(u1.data.invitation, 'João');
  maria = await accept(u2.data.invitation, 'Maria');
  pedro = await accept(u3.data.invitation, 'Pedro');
  ana = await accept(u4.data.invitation, 'Ana');
  pdfDoc = (await uploadClient(maria.token, 'LICENCIAMENTO.pdf', pdf, 'application/pdf')).data;
  jpgDoc = (await uploadClient(maria.token, 'foto.jpg', jpg, 'image/jpeg')).data;
  jpegDoc = (await uploadClient(maria.token, 'foto.jpeg', jpg, 'image/jpeg')).data;
  pngDoc = (await uploadClient(maria.token, 'foto.png', png, 'image/png')).data;
  officePdf = (await uploadOffice(ownerA.token, companyA.id, 'LICENCIAMENTO.pdf', pdf, 'application/pdf')).data;
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('detecta PDF JPG PNG pelo conteúdo', () => {
  assert.equal(access.detectContentType(pdf), 'application/pdf');
  assert.equal(access.detectContentType(jpg), 'image/jpeg');
  assert.equal(access.detectContentType(png), 'image/png');
  assert.equal(access.isLogicalDocumentId('../etc/passwd'), false);
  assert.equal(access.isLogicalDocumentId('..%2fsecret'), false);
});

test('OWNER visualiza PDF inline e baixa com attachment', async () => {
  const view = await fileReq('/api/documentos/' + officePdf.id + '/view', ownerA.token);
  assert.equal(view.status, 200);
  assert.equal(view.ct.split(';')[0].trim(), 'application/pdf');
  assert.match(view.disp, /^inline/i);
  assert.doesNotMatch(view.disp, /attachment/i);
  assert.match(view.cache, /private/i);
  assert.match(view.cache, /no-store/i);
  assert.equal(view.buf.slice(0, 5).toString(), '%PDF-');
  assert.doesNotMatch(view.buf.toString('utf8'), /uploads[\\/]/i);
  const dl = await fileReq('/api/documentos/' + officePdf.id + '/download', ownerA.token);
  assert.equal(dl.status, 200);
  assert.match(dl.disp, /^attachment/i);
  assert.equal(dl.ct.split(';')[0].trim(), 'application/pdf');
});

test('JPG JPEG PNG inline no escritório e no cliente', async () => {
  for (const [doc, mime, token, prefix] of [
    [jpgDoc, 'image/jpeg', maria.token, '/api/client/documentos/'],
    [jpegDoc, 'image/jpeg', maria.token, '/api/client/documentos/'],
    [pngDoc, 'image/png', maria.token, '/api/client/documentos/'],
    [jpgDoc, 'image/jpeg', ownerA.token, '/api/documentos/'],
    [pngDoc, 'image/png', ownerA.token, '/api/documentos/']
  ]) {
    const view = await fileReq(prefix + doc.id + '/view', token);
    assert.equal(view.status, 200, mime + ' ' + prefix);
    assert.equal(view.ct.split(';')[0].trim(), mime);
    assert.match(view.disp, /^inline/i);
  }
});

test('autenticação obrigatória e ID inválido', async () => {
  const noAuth = await fileReq('/api/documentos/' + officePdf.id + '/view');
  assert.equal(noAuth.status, 401);
  const clientNoAuth = await fileReq('/api/client/documentos/' + pdfDoc.id + '/view');
  assert.equal(clientNoAuth.status, 401);
  const bad = await fileReq('/api/documentos/../etc/passwd/view', ownerA.token);
  assert.ok(bad.status === 404 || bad.status === 400);
  const missing = await fileReq('/api/documentos/' + crypto.randomUUID() + '/view', ownerA.token);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.message, 'Documento não encontrado.');
  assert.doesNotMatch(JSON.stringify(missing.json), /storage_path|uploads[\\/]|stack/i);
});

test('tenant isolation e company isolation', async () => {
  const otherTenant = await fileReq('/api/documentos/' + officePdf.id + '/view', ownerB.token);
  assert.equal(otherTenant.status, 404);
  const otherCompany = await fileReq('/api/documentos/' + officePdf.id + '/view', ownerA.token, companyA2.id);
  assert.equal(otherCompany.status, 404);
  const clientCross = await fileReq('/api/client/documentos/' + pdfDoc.id + '/view', ana.token);
  assert.equal(clientCross.status, 404);
  const officeCrossClient = await fileReq('/api/client/documentos/' + pdfDoc.id + '/view', ownerA.token);
  assert.equal(officeCrossClient.status, 403);
});

test('CLIENT_ADMIN FINANCE VIEWER autorizados; permissão revogada nega', async () => {
  for (const token of [joao.token, maria.token, pedro.token]) {
    const view = await fileReq('/api/client/documentos/' + pdfDoc.id + '/view', token);
    assert.equal(view.status, 200);
    assert.match(view.disp, /^inline/i);
  }
  db.prepare('INSERT INTO client_user_permissions(user_id,permission_key,allowed) VALUES(?,?,0)').run(pedro.user.id, 'client.documents.view');
  const denied = await fileReq('/api/client/documentos/' + pdfDoc.id + '/view', pedro.token);
  assert.equal(denied.status, 403);
  db.prepare('DELETE FROM client_user_permissions WHERE user_id=? AND permission_key=?').run(pedro.user.id, 'client.documents.view');
});

test('escritório STAFF e ACCOUNTANT autorizados; CLIENT no endpoint do escritório negado', async () => {
  const staff = await fileReq('/api/documentos/' + officePdf.id + '/view', staffA.token);
  assert.equal(staff.status, 200);
  const acc = await fileReq('/api/documentos/' + officePdf.id + '/view', accountantA.token);
  assert.equal(acc.status, 200);
  const clientOffice = await fileReq('/api/documentos/' + officePdf.id + '/view', maria.token);
  assert.equal(clientOffice.status, 403);
});

test('path traversal no storage_path não entrega arquivo', async () => {
  const id = crypto.randomUUID();
  const outside = path.resolve(root, 'package.json');
  db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, ownerA.user.tenant_id, companyA.id, 'secret.pdf', outside, 'application/pdf', 10, 'x', ownerA.user.id, 'ACTIVE');
  const view = await fileReq('/api/documentos/' + id + '/view', ownerA.token);
  assert.equal(view.status, 404);
  assert.equal(view.json.message, 'Documento não encontrado.');
  assert.doesNotMatch(JSON.stringify(view.json || {}), /package\.json|storage_path/i);
});

test('visualizar não cria evento de recebimento', async () => {
  const before = db.prepare("SELECT COUNT(*) n FROM domain_events WHERE tenant_id=? AND event_type LIKE '%DOCUMENT%'").get(ownerA.user.tenant_id).n;
  await fileReq('/api/documentos/' + officePdf.id + '/view', ownerA.token);
  await fileReq('/api/client/documentos/' + pdfDoc.id + '/view', maria.token);
  const after = db.prepare("SELECT COUNT(*) n FROM domain_events WHERE tenant_id=? AND event_type LIKE '%DOCUMENT%'").get(ownerA.user.tenant_id).n;
  assert.equal(after, before);
});

test('visualizador compartilhado: modal, tipos, loading, erro, ESC, baixar, sem download automático', () => {
  const viewer = read('frontend/public/assets/document-viewer.js');
  const css = read('frontend/public/assets/document-viewer.css');
  const office = read('frontend/public/assets/app.js');
  const portal = read('frontend/public/portal/portal.js');
  const adminHtml = read('frontend/public/index.html');
  const portalHtml = read('frontend/public/portal/index.html');
  assert.match(adminHtml, /document-viewer\.js/);
  assert.match(portalHtml, /document-viewer\.js/);
  assert.match(office, /CdsDocumentViewer\.open/);
  assert.match(office, /viewOfficeDocument/);
  assert.match(office, />Visualizar</);
  assert.match(portal, /viewClientDocument/);
  assert.match(portal, />Visualizar</);
  assert.match(portal, /\/api\/client\/documentos\/'\+id\+'\/view'/);
  assert.doesNotMatch(office.slice(office.indexOf('async function documents'), office.indexOf('function viewOfficeDocument')), /\/download/);
  assert.doesNotMatch(portal, /window\.open\(u\)/);
  assert.match(viewer, /Carregando documento\.\.\./);
  assert.match(viewer, /Não foi possível carregar o documento\./);
  assert.match(viewer, /Documento não encontrado\./);
  assert.match(viewer, /Este tipo de documento não possui visualização interna\./);
  assert.match(viewer, /Não foi possível visualizar este documento neste navegador\./);
  assert.match(viewer, /Baixar documento/);
  assert.match(viewer, /role="dialog"/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /Escape/);
  assert.match(viewer, /docViewerClose/);
  assert.match(viewer, /application\/pdf/);
  assert.match(viewer, /image\/jpeg/);
  assert.match(viewer, /image\/png/);
  assert.match(viewer, /object-fit: contain|doc-viewer-image/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /90vw/);
  assert.match(css, /90vh/);
  assert.match(css, /100dvh/);
  assert.match(viewer, /a\.download/);
  assert.match(viewer, /downloadUrl/);
  assert.doesNotMatch(viewer, /viewUrl[\s\S]{0,80}a\.download/);
});
