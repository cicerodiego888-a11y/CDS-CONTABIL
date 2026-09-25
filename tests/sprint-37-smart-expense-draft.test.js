'use strict';

/**
 * Sprint — Smart Expense draft lifecycle
 * IMPORTAR ≠ ENVIAR: draft até Salvar; Cancelar descarta; sem Contador/notificação/pipeline.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-se-draft-'));
process.env.CDS_DB_PATH = path.join(tmp, 'draft.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-se-draft-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.CDS_DOCUMENT_PIPELINE = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { app, db } = require('../backend/src/server');

const password = 'Senha@123';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

let server, base;
let ownerA, ownerB, companyA, companyB, companyA2;
let clientA, clientB;
let category, bank;

function req(method, url, body, token, companyHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyHeader) headers['X-Company-Id'] = companyHeader;
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

async function uploadClient(token, filename, buf, type, extra = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), filename);
  if (extra.draft) fd.append('draft', String(extra.draft));
  if (extra.notes) fd.append('notes', extra.notes);
  const r = await fetch(base + '/api/client/documentos', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function uploadOffice(token, companyId, filename, buf, type, extra = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), filename);
  fd.append('company_id', companyId);
  if (extra.draft) fd.append('draft', String(extra.draft));
  const r = await fetch(base + '/api/documentos/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function registerOffice(name, email) {
  const created = await req('POST', '/api/auth/register', {
    name, email, password, tenantName: name, cnpj: '00000000000191'
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const login = await req('POST', '/api/auth/login', {
    email, password, tenant: created.data.tenant_slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return login.data;
}

async function activateClient(created) {
  const token = created.data.invitation.activation_url.split('/convite/')[1];
  const r = await req('POST', '/api/invitations/' + token + '/accept', {
    name: created.data.name || 'Cliente',
    password,
    confirmation: password
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

function notifCount(tenantId, type) {
  return db.prepare(
    "SELECT COUNT(*) n FROM notifications WHERE tenant_id=? AND type=?"
  ).get(tenantId, type).n;
}

function domainEventCount(tenantId, eventType, entityId) {
  const rows = db.prepare(
    'SELECT payload_json, entity_id, event_type FROM domain_events WHERE tenant_id=? AND event_type=?'
  ).all(tenantId, eventType);
  if (entityId) return rows.filter(r => r.entity_id === entityId).length;
  return rows.length;
}

function docRow(id) {
  return db.prepare('SELECT * FROM documents WHERE id=?').get(id);
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  ownerA = await registerOffice('Escritório Draft A', 'owner.draft.a@test.local');
  ownerB = await registerOffice('Escritório Draft B', 'owner.draft.b@test.local');

  const ca = await req('POST', '/api/empresas', {
    name: 'Empresa Draft A Ltda', trade_name: 'DraftA', cnpj: '11222333000181'
  }, ownerA.token);
  assert.equal(ca.status, 201);
  companyA = ca.data;

  const ca2 = await req('POST', '/api/empresas', {
    name: 'Empresa Draft A2 Ltda', trade_name: 'DraftA2', cnpj: '22333444000192'
  }, ownerA.token);
  assert.equal(ca2.status, 201);
  companyA2 = ca2.data;

  const cb = await req('POST', '/api/empresas', {
    name: 'Empresa Draft B Ltda', trade_name: 'DraftB', cnpj: '33444555000103'
  }, ownerB.token);
  assert.equal(cb.status, 201);
  companyB = cb.data;

  const uA = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente A', email: 'cliente.draft.a@test.local', profile: 'Administrador'
  }, ownerA.token);
  clientA = await activateClient(uA);

  const uB = await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'cliente.draft.b@test.local', profile: 'Administrador'
  }, ownerB.token);
  clientB = await activateClient(uB);

  const planId = crypto.randomUUID();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, ownerA.user.tenant_id, 'Plano Draft', 'ACTIVE');
  const accDesp = crypto.randomUUID();
  const accBank = crypto.randomUUID();
  db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)'
  ).run(accDesp, ownerA.user.tenant_id, planId, '3210400001', '3210400001', '3210400001', 'A', 'DESP', null, 1, 1);
  db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)'
  ).run(accBank, ownerA.user.tenant_id, planId, '1110200001', '1110200001', '1110200001', 'A', 'BANCO', null, 1, 1);
  const cat = await req('POST', '/api/categorias', {
    name: 'Geral', kind: 'EXPENSE', company_id: companyA.id, account_id: accDesp
  }, ownerA.token);
  const bk = await req('POST', '/api/bancos', {
    name: 'Caixa', company_id: companyA.id, account_id: accBank
  }, ownerA.token);
  category = cat.data;
  bank = bk.data;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('A) ANEXAR draft + CANCELAR (DELETE) — sem operação no Contador', async () => {
  const beforeEvents = domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED');
  const beforeNotif = notifCount(ownerA.user.tenant_id, 'DOCUMENT_RECEIVED');

  const up = await uploadClient(clientA.token, 'comp.png', png, 'image/png', { draft: '1' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.status, 'DRAFT');
  const id = up.data.id;

  const row = docRow(id);
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.company_id, companyA.id);
  assert.equal(row.tenant_id, ownerA.user.tenant_id);
  assert.equal(row.deleted_at, null);

  const officeList = await req('GET', '/api/documentos', undefined, ownerA.token);
  assert.equal(officeList.status, 200);
  const officeItems = officeList.data.items || officeList.data;
  assert.ok(!officeItems.find(x => x.id === id), 'draft não deve aparecer no Contador');

  const clientList = await req('GET', '/api/client/documentos', undefined, clientA.token);
  assert.equal(clientList.status, 200);
  assert.ok(!clientList.data.find(x => x.id === id), 'draft não deve aparecer na lista do cliente');

  assert.equal(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED'), beforeEvents);
  assert.equal(notifCount(ownerA.user.tenant_id, 'DOCUMENT_RECEIVED'), beforeNotif);

  const del = await req('DELETE', '/api/client/documentos/' + id, undefined, clientA.token);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const after = docRow(id);
  assert.ok(after.deleted_at);

  const officeAfter = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = officeAfter.data.items || officeAfter.data;
  assert.ok(!items.find(x => x.id === id));

  const exp = db.prepare('SELECT COUNT(*) n FROM expenses WHERE document_id=?').get(id).n;
  assert.equal(exp, 0);
  assert.equal(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED'), beforeEvents);
  assert.equal(notifCount(ownerA.user.tenant_id, 'DOCUMENT_RECEIVED'), beforeNotif);
});

test('B) ANEXAR + CANCELAR + reabrir — sem duplicidade operacional', async () => {
  const up1 = await uploadClient(clientA.token, 'a.png', png, 'image/png', { draft: '1' });
  assert.equal(up1.status, 201);
  await req('DELETE', '/api/client/documentos/' + up1.data.id, undefined, clientA.token);

  const up2 = await uploadClient(clientA.token, 'b.png', png, 'image/png', { draft: '1' });
  assert.equal(up2.status, 201);
  assert.notEqual(up2.data.id, up1.data.id);
  assert.equal(up2.data.status, 'DRAFT');

  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(!items.find(x => x.id === up1.data.id || x.id === up2.data.id));

  await req('DELETE', '/api/client/documentos/' + up2.data.id, undefined, clientA.token);
});

test('C) ANEXAR draft + SALVAR — promove, Contador vê, eventos', async () => {
  const beforeEvents = domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED');

  const up = await uploadClient(clientA.token, 'save.png', png, 'image/png', { draft: '1' });
  assert.equal(up.status, 201);
  assert.equal(up.data.status, 'DRAFT');

  const save = await req('POST', '/api/client/despesas', {
    occurred_on: '2026-09-20',
    description: 'Despesa com draft',
    amount: '55,00',
    payment_method: 'PIX',
    bank_id: bank.id,
    category_id: category.id,
    document_id: up.data.id
  }, clientA.token);
  assert.equal(save.status, 201, JSON.stringify(save.data));
  assert.equal(save.data.document_id, up.data.id);

  const row = docRow(up.data.id);
  assert.equal(row.status, 'ACTIVE');
  assert.equal(row.deleted_at, null);

  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(items.find(x => x.id === up.data.id), 'Contador deve ver documento confirmado');

  assert.ok(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED') > beforeEvents);
  assert.equal(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED', up.data.id), 1);
});

test('D) CANCELAR durante upload (callback tardio) — DELETE do draft órfão', async () => {
  // Simula race: upload termina, UI já cancelou → DELETE do id retornado
  const up = await uploadClient(clientA.token, 'race.png', png, 'image/png', { draft: '1' });
  assert.equal(up.status, 201);
  const id = up.data.id;
  // "cancel" after await
  const del = await req('DELETE', '/api/client/documentos/' + id, undefined, clientA.token);
  assert.equal(del.status, 200);
  assert.ok(docRow(id).deleted_at);

  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(!items.find(x => x.id === id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses WHERE document_id=?').get(id).n, 0);
});

test('E) Análise em draft + cancelar — sem publicação', async () => {
  const beforeEvents = domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED');
  const up = await uploadClient(clientA.token, 'analise.png', png, 'image/png', { draft: '1' });
  assert.equal(up.status, 201);

  const analysis = await req(
    'POST',
    '/api/client/documentos/' + up.data.id + '/analise-despesa',
    { force: false },
    clientA.token
  );
  // análise pode falhar em PNG mínimo, mas não deve publicar
  assert.ok([200, 201, 422, 500].includes(analysis.status), JSON.stringify(analysis.data));

  assert.equal(docRow(up.data.id).status, 'DRAFT');
  assert.equal(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED'), beforeEvents);

  await req('DELETE', '/api/client/documentos/' + up.data.id, undefined, clientA.token);
  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(!items.find(x => x.id === up.data.id));
});

test('F) Refresh após cancelar — nada operacional', async () => {
  const up = await uploadClient(clientA.token, 'refresh.png', png, 'image/png', { draft: '1' });
  await req('DELETE', '/api/client/documentos/' + up.data.id, undefined, clientA.token);

  const clientDocs = await req('GET', '/api/client/documentos', undefined, clientA.token);
  assert.ok(!clientDocs.data.find(x => x.id === up.data.id));

  const dash = await req('GET', '/api/client/dashboard', undefined, clientA.token);
  assert.equal(dash.status, 200);

  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(!items.find(x => x.id === up.data.id));
});

test('G) Isolamento tenant/company — draft de A não aparece em B nem A2', async () => {
  const up = await uploadClient(clientA.token, 'iso.png', png, 'image/png', { draft: '1' });
  assert.equal(up.status, 201);

  const listB = await req('GET', '/api/documentos', undefined, ownerB.token);
  const itemsB = listB.data.items || listB.data;
  assert.ok(!itemsB.find(x => x.id === up.data.id));

  const listA2 = await req('GET', '/api/documentos?company_id=' + companyA2.id, undefined, ownerA.token);
  const itemsA2 = listA2.data.items || listA2.data;
  assert.ok(!itemsA2.find(x => x.id === up.data.id));

  const cross = await req('DELETE', '/api/client/documentos/' + up.data.id, undefined, clientB.token);
  assert.ok(cross.status === 404 || cross.status === 403, JSON.stringify(cross.data));

  // ainda existe para o dono
  assert.equal(docRow(up.data.id).deleted_at, null);
  await req('DELETE', '/api/client/documentos/' + up.data.id, undefined, clientA.token);
});

test('H) Enviar documento (sem draft) continua operacional', async () => {
  const beforeEvents = domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED');
  const up = await uploadClient(clientA.token, 'oficial.pdf', pdf, 'application/pdf', {
    notes: 'Envio direto'
  });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.notEqual(up.data.status, 'DRAFT');
  assert.ok(['PENDING_REVIEW', 'ACTIVE'].includes(up.data.status));

  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(items.find(x => x.id === up.data.id));

  assert.ok(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED') > beforeEvents);

  const clientDocs = await req('GET', '/api/client/documentos', undefined, clientA.token);
  assert.ok(clientDocs.data.find(x => x.id === up.data.id));
});

test('UI: smart-expense usa draft=1 e descarta no close', () => {
  const se = fs.readFileSync(
    path.join(__dirname, '../frontend/public/assets/smart-expense.js'),
    'utf8'
  );
  const portal = fs.readFileSync(
    path.join(__dirname, '../frontend/public/portal/portal.js'),
    'utf8'
  );
  assert.match(se, /fd\.append\('draft',\s*'1'\)/);
  assert.match(se, /discardDraft|DELETE/);
  assert.match(se, /opGen|isActive|AbortController|closed/);
  assert.match(se, /confirmed/);
  // Cancel must not abort upload before id is known (orphan race).
  assert.match(se, /Do not abort upload|ingestFile discards/);
  assert.match(portal, /deleteUrl:id=>'\/api\/client\/documentos\/'\+id/);
  assert.doesNotMatch(
    portal.slice(portal.indexOf('function documentModal'), portal.indexOf('async function pending')),
    /draft/
  );
});

test('Office upload draft também fica oculto até Salvar', async () => {
  const beforeEvents = domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED');
  const up = await uploadOffice(ownerA.token, companyA.id, 'office-draft.png', png, 'image/png', {
    draft: '1'
  });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.status, 'DRAFT');

  const office = await req('GET', '/api/documentos', undefined, ownerA.token);
  const items = office.data.items || office.data;
  assert.ok(!items.find(x => x.id === up.data.id));
  assert.equal(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED'), beforeEvents);

  const save = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: '2026-09-21',
    description: 'Office draft save',
    amount: '10,00',
    payment_method: 'PIX',
    document_id: up.data.id
  }, ownerA.token);
  assert.equal(save.status, 201, JSON.stringify(save.data));
  assert.equal(docRow(up.data.id).status, 'ACTIVE');
  assert.ok(domainEventCount(ownerA.user.tenant_id, 'DOCUMENT_UPLOADED', up.data.id) >= 1);
});
