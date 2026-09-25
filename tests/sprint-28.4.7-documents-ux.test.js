'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s2847-'));
process.env.CDS_DB_PATH = path.join(tmp, 's2847.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-28-4-7-docs';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db } = require('../backend/src/server');

const password = 'Senha@123';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');
let server, base, ownerA, ownerB, staffA, companyA, companyA2, companyB, clientA, officeDoc, clientDoc;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function uploadOffice(token, companyId, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
  fd.append('company_id', companyId);
  const r = await fetch(base + '/api/documentos/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  return (await req('POST', '/api/invitations/' + token + '/accept', {
    name, password, confirmation: password
  })).data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório 2847 A', email: 'owner.a.s2847@test.local', password, tenantName: 'Tenant 2847 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s2847@test.local', password, tenant: a.data.tenant_slug
  })).data;
  const b = await req('POST', '/api/auth/register', {
    name: 'Escritório 2847 B', email: 'owner.b.s2847@test.local', password, tenantName: 'Tenant 2847 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s2847@test.local', password, tenant: b.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa Alfa 2847', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa Beta 2847', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 2847', cnpj: '22333444000192'
  }, ownerB.token)).data;
  const staff = await req('POST', '/api/usuarios', {
    name: 'Equipe 2847', email: 'staff.a.s2847@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.a.s2847@test.local', password, tenant: ownerA.user.tenant_slug
  })).data;
  const u = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente 2847', email: 'cliente.s2847@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  clientA = await accept(u.data.invitation, 'Cliente 2847');
  officeDoc = (await uploadOffice(ownerA.token, companyA.id, 'recibo-escritorio.pdf')).data;
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'recibo-cliente.pdf');
  const cr = await fetch(base + '/api/client/documentos', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + clientA.token },
    body: fd
  });
  clientDoc = await cr.json();
  await uploadOffice(ownerA.token, companyA2.id, 'nota-beta.pdf');
  await uploadOffice(ownerB.token, companyB.id, 'nota-tenant-b.pdf');
  db.prepare(
    `INSERT INTO document_extractions(id,document_id,tenant_id,company_id,status,requested_by)
     VALUES(?,?,?,?,?,?)`
  ).run(crypto.randomUUID(), officeDoc.id, ownerA.user.tenant_id, companyA.id, 'EXTRACTED', ownerA.user.id);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
});

test('listagem pagina e filtra por q, empresa, origem e extração', async () => {
  const all = await req('GET', '/api/documentos?page=1&page_size=25', undefined, ownerA.token);
  assert.equal(all.status, 200);
  assert.ok(all.data.total >= 3);
  assert.ok(Array.isArray(all.data.items));
  const q = await req('GET', '/api/documentos?q=escritorio', undefined, ownerA.token);
  assert.ok(q.data.items.every((x) => /escritorio/i.test(x.original_name)));
  const scoped = await req('GET', `/api/documentos?company_id=${companyA2.id}`, undefined, ownerA.token);
  assert.equal(scoped.status, 200);
  assert.ok(scoped.data.items.every((x) => x.company_id === companyA2.id));
  const office = await req('GET', '/api/documentos?source=OFFICE', undefined, ownerA.token);
  assert.ok(office.data.items.every((x) => x.source === 'OFFICE'));
  const client = await req('GET', '/api/documentos?source=CLIENT', undefined, ownerA.token);
  assert.ok(client.data.items.some((x) => x.id === clientDoc.id));
  const extracted = await req('GET', '/api/documentos?extraction_status=EXTRACTED', undefined, ownerA.token);
  assert.ok(extracted.data.items.some((x) => x.id === officeDoc.id));
  assert.ok(extracted.data.items.every((x) => x.extraction_status === 'EXTRACTED'));
});

test('isolamento tenant/company e CLIENT bloqueado', async () => {
  const spoof = await req('GET', `/api/documentos?company_id=${companyB.id}`, undefined, ownerA.token);
  assert.equal(spoof.status, 404);
  const other = await req('GET', '/api/documentos', undefined, ownerB.token);
  assert.ok(other.data.items.every((x) => x.company_id === companyB.id));
  const headerScope = await req('GET', '/api/documentos', undefined, ownerA.token, companyA.id);
  assert.ok(headerScope.data.items.every((x) => x.company_id === companyA.id));
  const clientList = await req('GET', '/api/documentos', undefined, clientA.token);
  assert.equal(clientList.status, 403);
  const staff = await req('GET', '/api/documentos', undefined, staffA.token);
  assert.equal(staff.status, 200);
});

test('frontend da central de documentos é responsivo e preserva ações', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  const theme = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/theme.css'), 'utf8');
  const dash = js.slice(js.indexOf('async function documents'), js.indexOf('function viewOfficeDocument'));
  assert.match(js, /Comprovantes e anexos vinculados às empresas/);
  assert.match(js, /\+ Enviar documento/);
  assert.match(js, /Analisar/);
  assert.doesNotMatch(js, /Analisar documento/);
  assert.match(js, /Ver análise/);
  assert.match(js, /extractionFailureHelp/);
  assert.match(js, /SEM IA/);
  assert.match(js, /O que fazer/);
  assert.match(js, /Limpar filtros/);
  assert.match(js, /docs-table/);
  assert.match(js, /docs-card/);
  assert.match(js, /docs-primary-action/);
  assert.match(js, /more-btn/);
  assert.match(js, /overlay-menu-open|CdsOverlayMenu/);
  assert.match(js, /Não foi possível carregar os documentos/);
  assert.match(theme, /overlay-menu-open/);
  assert.match(theme, /table-layout:fixed/);
  assert.match(theme, /\.docs-cards\{display:grid/);
  assert.doesNotMatch(theme, /#0f5f59/i);
  assert.doesNotMatch(dash, /\/download/);
});
