'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s275-'));
process.env.CDS_DB_PATH = path.join(tmp, 's275.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-27-5-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_APP_URL = 'http://app.test.local';

const { createEmailProvider } = require('../backend/src/email/provider');
const { app, db, EVENT_TYPES, setEmailProvider } = require('../backend/src/server');

const password = 'Senha@123';
const GENERIC = /Enviamos as instruções para o seu e-mail cadastrado/i;
let server, base;
let ownerA, accountantA, staffA, ownerB;
let companyA1, companyA2, companyB;
let clientA1, clientA2, clientB;
let slugA, slugB;

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

function noSecrets(obj, label) {
  const raw = JSON.stringify(obj || {});
  assert.doesNotMatch(raw, /password_hash/, label);
  assert.doesNotMatch(raw, /token_hash/, label);
  assert.doesNotMatch(raw, /"password"\s*:\s*"[^"]{4,}"/, label);
  assert.doesNotMatch(raw, /Bearer /, label);
}

async function activateClient(createRes) {
  const url = createRes.invitation && createRes.invitation.activation_url;
  assert.ok(url, 'activation_url expected');
  const tok = url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    name: createRes.user.name,
    password,
    confirmation: password
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  return { token: acc.data.token, user: createRes.user };
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner A', email: 'owner.s275a@test.local', password, tenantName: 'Tenant A 275'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s275a@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  slugA = regA.data.tenant_slug;

  await req('POST', '/api/usuarios', {
    name: 'Accountant A', email: 'acc.s275a@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.s275a@test.local', password, tenant: slugA
  })).data;

  await req('POST', '/api/usuarios', {
    name: 'Staff A', email: 'staff.s275a@test.local', password, role: 'STAFF'
  }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.s275a@test.local', password, tenant: slugA
  })).data;

  companyA1 = (await req('POST', '/api/empresas', {
    name: 'Empresa A1', trade_name: 'A1', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2', trade_name: 'A2', cnpj: '22333444000192'
  }, ownerA.token)).data;

  clientA1 = await activateClient((await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Cliente A1', email: 'client.a1.s275@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data);
  clientA2 = await activateClient((await req('POST', `/api/empresas/${companyA2.id}/users`, {
    name: 'Cliente A2', email: 'client.a2.s275@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token)).data);

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner B', email: 'owner.s275b@test.local', password, tenantName: 'Tenant B 275'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.s275b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  slugB = regB.data.tenant_slug;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B', trade_name: 'B', cnpj: '33444555000103'
  }, ownerB.token)).data;
  clientB = await activateClient((await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'client.b.s275@test.local', profile: 'CLIENT_ADMIN'
  }, ownerB.token)).data);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 forgot-password com falha de e-mail cria PASSWORD_RESET_FAILED', async () => {
  const before = db.prepare(
    'SELECT COUNT(*) n FROM domain_events WHERE tenant_id=? AND event_type=? AND entity_id=?'
  ).get(ownerA.user.tenant_id, EVENT_TYPES.PASSWORD_RESET_FAILED, clientA1.user.id).n;
  setEmailProvider(createEmailProvider({
    send: async () => { throw Object.assign(new Error('SMTP down'), { code: 'EMAIL_SEND_FAILED' }); }
  }));
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'client.a1.s275@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(r.data.message, GENERIC);
  noSecrets(r.data, 'forgot');
  const after = db.prepare(
    'SELECT COUNT(*) n FROM domain_events WHERE tenant_id=? AND event_type=? AND entity_id=?'
  ).get(ownerA.user.tenant_id, EVENT_TYPES.PASSWORD_RESET_FAILED, clientA1.user.id).n;
  assert.equal(after, before + 1);
});

test('2 evento cria notification', async () => {
  const ev = db.prepare(
    'SELECT id FROM domain_events WHERE tenant_id=? AND event_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 1'
  ).get(ownerA.user.tenant_id, EVENT_TYPES.PASSWORD_RESET_FAILED, clientA1.user.id);
  const rows = db.prepare('SELECT * FROM notifications WHERE event_id=?').all(ev.id);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(n => n.type === EVENT_TYPES.PASSWORD_RESET_FAILED));
  assert.ok(rows.every(n => n.read_at == null));
  assert.ok(rows.every(n => n.company_id === companyA1.id));
  assert.ok(rows.some(n => (n.recipient_user_id || n.user_id) === ownerA.user.id));
  assert.ok(rows.some(n => (n.recipient_user_id || n.user_id) === accountantA.user.id));
  assert.ok(!rows.some(n => (n.recipient_user_id || n.user_id) === clientA1.user.id));
  assert.ok(!rows.some(n => (n.recipient_user_id || n.user_id) === staffA.user.id));
  noSecrets(rows, 'notif-rows');
});

test('3 notification aparece no endpoint imediatamente', async () => {
  const n = await req('GET', '/api/notificacoes?page=1&page_size=25', undefined, ownerA.token);
  assert.equal(n.status, 200);
  const hit = (n.data.items || []).find(
    x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && x.entity_id === clientA1.user.id
  );
  assert.ok(hit);
  assert.match(hit.title, /Falha na redefinição/i);
  assert.ok(!hit.read_at);
  assert.equal(hit.target_user_id, clientA1.user.id);
  noSecrets(n.data, 'list');
});

test('4 OWNER e ACCOUNTANT recebem; CLIENT/STAFF não', async () => {
  const owner = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const acc = await req('GET', '/api/notificacoes', undefined, accountantA.token);
  const staff = await req('GET', '/api/notificacoes', undefined, staffA.token);
  assert.ok((owner.data.items || []).some(x => x.entity_id === clientA1.user.id && x.type === EVENT_TYPES.PASSWORD_RESET_FAILED));
  assert.ok((acc.data.items || []).some(x => x.entity_id === clientA1.user.id && x.type === EVENT_TYPES.PASSWORD_RESET_FAILED));
  assert.equal(
    (staff.data.items || []).filter(x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED).length,
    0
  );
  const clientNotes = await req('GET', '/api/notificacoes', undefined, clientA1.token);
  assert.ok(clientNotes.status === 403 || clientNotes.status === 200);
  if (clientNotes.status === 200) {
    assert.equal(
      (clientNotes.data.items || []).filter(x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED).length,
      0
    );
  }
});

test('5 X-Company-Id de outra empresa não esconde a notification', async () => {
  const n = await req('GET', '/api/notificacoes?page=1&page_size=25', undefined, ownerA.token, companyA2.id);
  assert.equal(n.status, 200);
  const hit = (n.data.items || []).find(
    x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && x.entity_id === clientA1.user.id
  );
  assert.ok(hit, 'inbox pessoal não deve filtrar por X-Company-Id');
});

test('6 tenant isolation', async () => {
  setEmailProvider(createEmailProvider({
    send: async () => { throw Object.assign(new Error('SMTP down'), { code: 'EMAIL_SEND_FAILED' }); }
  }));
  await req('POST', '/api/auth/forgot-password', { tenant: slugB, email: 'client.b.s275@test.local' });
  const nA = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const nB = await req('GET', '/api/notificacoes', undefined, ownerB.token);
  assert.ok(!(nA.data.items || []).some(x => x.entity_id === clientB.user.id));
  assert.ok((nB.data.items || []).some(
    x => x.entity_id === clientB.user.id && x.type === EVENT_TYPES.PASSWORD_RESET_FAILED
  ));
});

test('7 company isolation no contexto da notification', async () => {
  await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'client.a2.s275@test.local' });
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x => x.entity_id === clientA2.user.id && x.type === EVENT_TYPES.PASSWORD_RESET_FAILED);
  assert.ok(hit);
  assert.equal(hit.company_id, companyA2.id);
  assert.notEqual(hit.company_id, companyA1.id);
});

test('8 resposta neutra em cliques repetidos', async () => {
  const a = await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'client.a1.s275@test.local' });
  const b = await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'client.a1.s275@test.local' });
  assert.equal(a.data.message, b.data.message);
  assert.match(a.data.message, GENERIC);
});

test('9 read/unread atualiza contagem', async () => {
  const before = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const unreadBefore = before.data.unread;
  const hit = (before.data.items || []).find(
    x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && x.entity_id === clientA1.user.id && !x.read_at
  );
  assert.ok(hit);
  assert.equal((await req('POST', `/api/notificacoes/${hit.id}/lida`, {}, ownerA.token)).status, 200);
  const after = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  assert.equal(after.data.unread, unreadBefore - 1);
});

test('10 duas falhas independentes', async () => {
  db.prepare(
    'UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND entity_id IN (?,?) AND type=? AND read_at IS NULL'
  ).run(
    ownerA.user.tenant_id,
    clientA1.user.id,
    clientA2.user.id,
    EVENT_TYPES.PASSWORD_RESET_FAILED
  );
  await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'client.a2.s275@test.local' });
  await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'client.a1.s275@test.local' });
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const unreadEntities = (n.data.items || [])
    .filter(x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && !x.read_at)
    .map(x => x.entity_id);
  assert.ok(unreadEntities.includes(clientA1.user.id));
  assert.ok(unreadEntities.includes(clientA2.user.id));
});

test('11 UI polling imediato, dedupe e path tenant-scoped', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /NOTIF_POLL_VISIBLE_MS\s*=\s*5000/);
  assert.match(appJs, /NOTIF_POLL_HIDDEN_MS\s*=\s*30000/);
  assert.match(appJs, /function dedupeNotifications/);
  assert.match(appJs, /visibilitychange/);
  assert.match(appJs, /auth\|notificacoes/);
  assert.match(appJs, /PASSWORD_RESET_FAILED/);
  assert.match(appJs, /PASSWORD_RESET_COMPLETED/);
  assert.match(appJs, /focusClientUserId/);
  assert.doesNotMatch(appJs, /setInterval\(\(\)=>refreshNotifBadge\(\),45000\)/);
});

test('12 erro no poll não derruba portal', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /refreshNotifBadge[\s\S]{0,400}catch\{\/\* inbox poll/);
});

test('13 anti-enumeração pública', async () => {
  const missing = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'nao.existe.s275@test.local'
  });
  const exists = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'client.a1.s275@test.local'
  });
  assert.equal(missing.data.message, exists.data.message);
});

test('14 deep-link UI preservado', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /Solicitação de redefinição de acesso/);
  assert.match(appJs, /focusResetBtn/);
  assert.match(appJs, /enterCompany\(n\.company_id,'usuarios'\)/);
});

test('15 integrity e foreign keys', () => {
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
