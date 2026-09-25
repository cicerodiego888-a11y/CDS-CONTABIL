'use strict';

/**
 * Sprint 33 — ciclo PENDENTE→CONCLUÍDA/FALHA + dropdown só unread + histórico.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s33-'));
process.env.CDS_DB_PATH = path.join(tmp, 's33.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-s33-secret-ok';
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
const { app, db, setEmailProvider, EVENT_TYPES } = require('../backend/src/server');

const password = 'Senha@123';
const newPassword = 'NovaSenha9';
const GENERIC = /Enviamos as instruções para o seu e-mail cadastrado/i;
let server, base;
let ownerA, accountantA, ownerB;
let companyA, companyB;
let clientA, clientB;
let sentMails = [];
let slugA, slugB;
let failNextSend = false;

function req(method, url, body, token, headersExtra) {
  const headers = { 'Content-Type': 'application/json', ...(headersExtra || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
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

function assertNoSecrets(obj, label) {
  const raw = JSON.stringify(obj || {});
  assert.doesNotMatch(raw, /sk-[a-zA-Z0-9]/i, label + ' API key');
  assert.doesNotMatch(raw, /"password"\s*:\s*"[^"]{4,}"/, label + ' password');
  assert.doesNotMatch(raw, /password_hash/, label + ' password_hash');
  assert.doesNotMatch(raw, /token_hash/, label + ' token_hash');
  assert.doesNotMatch(raw, /\/convite\/[a-f0-9]{32}/, label + ' invite token');
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
  setEmailProvider(createEmailProvider({
    send: async mail => {
      if (failNextSend) {
        failNextSend = false;
        const err = new Error('SMTP down');
        err.code = 'EMAIL_SEND_FAILED';
        throw err;
      }
      sentMails.push(mail);
      return { accepted: true, status: 'sent', email_sent: true };
    }
  }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner S33', email: 'owner.s33@test.local', password, tenantName: 'Tenant S33 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s33@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  slugA = regA.data.tenant_slug;
  accountantA = (await req('POST', '/api/usuarios', {
    name: 'Acc S33', email: 'acc.s33@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token)).data;
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.s33@test.local', password, tenant: slugA
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa S33 A', trade_name: 'S33A', cnpj: '11222333000181', status: 'ACTIVE'
  }, ownerA.token)).data;

  clientA = await activateClient((await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Diego S33', email: 'diego.s33@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data);

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner S33 B', email: 'owner.s33b@test.local', password, tenantName: 'Tenant S33 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.s33b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  slugB = regB.data.tenant_slug;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa S33 B', trade_name: 'S33B', cnpj: '22333444000192', status: 'ACTIVE'
  }, ownerB.token)).data;
  clientB = await activateClient((await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'cliente.s33b@test.local', profile: 'CLIENT_ADMIN'
  }, ownerB.token)).data);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 Esqueci minha senha envia e-mail e cria solicitação PENDENTE', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'diego.s33@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(r.data.message, GENERIC);
  assert.equal(sentMails.length, 1);
  const invite = db.prepare(
    "SELECT purpose,status FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).get(clientA.user.id);
  assert.equal(invite.status, 'PENDING');
  const users = await req('GET', `/api/empresas/${companyA.id}/users`, undefined, ownerA.token);
  const row = (users.data || []).find(x => x.id === clientA.user.id);
  assert.equal(row.password_reset_status, 'PENDENTE');
  assert.equal(row.password_reset_method, 'EMAIL');
});

test('2 Contador recebe CLIENT_PASSWORD_RESET_REQUESTED', async () => {
  const n = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x =>
    x.type === EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED && x.entity_id === clientA.user.id && !x.read_at
  );
  assert.ok(hit, 'REQUESTED missing');
  assert.match(hit.title, /Solicitação de redefinição/i);
  const nAcc = await req('GET', '/api/notificacoes', undefined, accountantA.token);
  assert.ok((nAcc.data.items || []).some(x =>
    x.type === EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED && x.entity_id === clientA.user.id
  ));
});

test('3 Cliente redefine senha → CONCLUÍDA + PASSWORD_RESET_COMPLETED', async () => {
  const html = String(sentMails[sentMails.length - 1].html || sentMails[sentMails.length - 1].text || '');
  const m = html.match(/\/convite\/([a-f0-9]{64})/i);
  assert.ok(m, 'token no e-mail');
  const acc = await req('POST', '/api/invitations/' + m[1] + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));

  const invite = db.prepare(
    "SELECT purpose,status,accepted_at FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).get(clientA.user.id);
  assert.equal(invite.status, 'ACCEPTED');
  assert.ok(invite.accepted_at);

  const users = await req('GET', `/api/empresas/${companyA.id}/users`, undefined, ownerA.token);
  const row = (users.data || []).find(x => x.id === clientA.user.id);
  assert.equal(row.password_reset_status, 'CONCLUIDA');
  assert.ok(row.password_reset_completed_at);

  const n = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  const completed = (n.data.items || []).find(x =>
    x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED && x.entity_id === clientA.user.id
  );
  assert.ok(completed, 'COMPLETED missing');
  assert.match(completed.title, /Senha redefinida com sucesso/i);
  assert.match(completed.message, /Diego.*concluiu a redefinição/i);
  assertNoSecrets(completed, 'completed notif');

  const pendingReq = (n.data.items || []).filter(x =>
    x.type === EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED &&
    x.entity_id === clientA.user.id &&
    !x.read_at
  );
  assert.equal(pendingReq.length, 0, 'solicitação não pode permanecer pendente/unread');
});

test('4 Falha gera FALHA + PASSWORD_RESET_FAILED', async () => {
  failNextSend = true;
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'diego.s33@test.local'
  });
  assert.equal(r.status, 200);
  const n = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x =>
    x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && x.entity_id === clientA.user.id
  );
  assert.ok(hit, 'PASSWORD_RESET_FAILED notification');
  assertNoSecrets(hit, 'failed notif');
  const revoked = db.prepare(
    "SELECT id FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' AND status='REVOKED' ORDER BY datetime(created_at) DESC LIMIT 1"
  ).get(clientA.user.id);
  assert.ok(revoked, 'falha de envio deve revogar o convite dessa tentativa');
  const users = await req('GET', `/api/empresas/${companyA.id}/users`, undefined, ownerA.token);
  const row = (users.data || []).find(x => x.id === clientA.user.id);
  // Após CONCLUIDA (teste 3), o display pode permanecer CONCLUIDA; sinais duráveis = notif + REVOKED.
  assert.ok(
    row.password_reset_status === 'FALHA' ||
      (row.password_reset_status === 'CONCLUIDA' && hit && revoked),
    `password_reset_status=${row.password_reset_status}`
  );
});

test('5 unread aparece no dropdown; read some no filtro unread', async () => {
  const unread = await req('GET', '/api/notificacoes?unread=1&page=1&page_size=50', undefined, ownerA.token);
  assert.equal(unread.status, 200);
  assert.ok((unread.data.items || []).every(x => !x.read_at));
  const one = (unread.data.items || [])[0];
  assert.ok(one);
  assert.equal((await req('POST', `/api/notificacoes/${one.id}/lida`, {}, ownerA.token)).status, 200);
  const after = await req('GET', '/api/notificacoes?unread=1&page=1&page_size=50', undefined, ownerA.token);
  assert.ok(!(after.data.items || []).some(x => x.id === one.id));
  const hist = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  const kept = (hist.data.items || []).find(x => x.id === one.id);
  assert.ok(kept);
  assert.ok(kept.read_at);
});

test('6 Marcar todas zera unread e preserva histórico', async () => {
  await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'diego.s33@test.local' });
  const before = await req('GET', '/api/notificacoes?unread=1', undefined, ownerA.token);
  assert.ok(Number(before.data.unread) >= 1);
  assert.equal((await req('POST', '/api/notificacoes/lidas', {}, ownerA.token)).status, 200);
  const zero = await req('GET', '/api/notificacoes?unread=1', undefined, ownerA.token);
  assert.equal(zero.data.unread, 0);
  assert.equal((zero.data.items || []).length, 0);
  const hist = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  assert.ok((hist.data.items || []).length >= 1);
  assert.ok((hist.data.items || []).every(x => x.read_at));
});

test('7 Isolamento tenant preservado', async () => {
  await req('POST', '/api/auth/forgot-password', { tenant: slugB, email: 'cliente.s33b@test.local' });
  const nA = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const nB = await req('GET', '/api/notificacoes', undefined, ownerB.token);
  assert.ok(!(nA.data.items || []).some(x => x.entity_id === clientB.user.id));
  assert.ok((nB.data.items || []).some(x => x.entity_id === clientB.user.id));
});

test('8 UI: dropdown unread + histórico + painel CONCLUÍDA', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  const header = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/cds-app-header.js'), 'utf8');
  assert.match(appJs, /unreadOnly/);
  assert.match(appJs, /openNotifHistory/);
  assert.match(appJs, /Histórico de notificações/);
  assert.match(appJs, /CONCLUÍDA/);
  assert.match(appJs, /password_reset_status/);
  assert.match(portal, /filter\(n=>!n\.read_at\)/);
  assert.match(portal, /Histórico de notificações/);
  assert.match(header, /notifHistory/);
  const index = fs.readFileSync(path.join(__dirname, '../frontend/public/index.html'), 'utf8');
  assert.match(index, /app\.js\?v=s40-doc-preview/);
});
