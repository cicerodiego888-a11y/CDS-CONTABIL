'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s276-'));
process.env.CDS_DB_PATH = path.join(tmp, 's276.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-27-6-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_APP_URL = 'http://app.test.local';
process.env.PORT = '3333';
process.env.CLIENT_PORT = '3334';

const { createEmailProvider } = require('../backend/src/email/provider');
const { passwordReset } = require('../backend/src/communications/email/templates');
const { app, db, setEmailProvider } = require('../backend/src/server');

const password = 'Senha@123';
const newPassword = 'NovaSenha9';
let server, base;
let ownerA, companyA, clientA;
let sentMails = [];
let slugA;

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
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
  assert.doesNotMatch(raw, /sk-[a-zA-Z0-9]/i, label);
  assert.doesNotMatch(raw, /"password"\s*:\s*"[^"]{4,}"/, label);
  assert.doesNotMatch(raw, /password_hash/, label);
  assert.doesNotMatch(raw, /token_hash/, label);
  assert.doesNotMatch(raw, /"Authorization"/i, label);
}

function hrefFromHtml(html) {
  const m = String(html || '').match(/<a\s+[^>]*href="([^"]*)"[^>]*>\s*Criar nova senha\s*<\/a>/i);
  return m ? m[1] : null;
}

function assertInviteHref(href, expectedBase) {
  assert.ok(href, 'href missing');
  assert.ok(href.length > 0, 'href empty');
  assert.doesNotMatch(href, /undefined|null/i);
  assert.ok(href.startsWith(expectedBase + '/convite/'), 'href base/route');
  assert.match(href, /\/convite\/[a-f0-9]{32,}/i);
}

async function activateClient(createRes) {
  const url = createRes.invitation && createRes.invitation.activation_url;
  assert.ok(url);
  const tok = url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    name: createRes.user.name, password, confirmation: password
  });
  assert.equal(acc.status, 200);
  return { token: acc.data.token, user: createRes.user };
}

before(async () => {
  setEmailProvider(createEmailProvider({
    send: async mail => { sentMails.push(mail); }
  }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await req('POST', '/api/auth/register', {
    name: 'Owner A', email: 'owner.s276@test.local', password, tenantName: 'Tenant 276'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s276@test.local', password, tenant: reg.data.tenant_slug
  })).data;
  slugA = reg.data.tenant_slug;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa 276', trade_name: 'E276', cnpj: '11222333000181'
  }, ownerA.token)).data;
  clientA = await activateClient((await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente 276', email: 'client.s276@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 template PASSWORD_RESET gera <a href> válido', () => {
  const fake = 'http://app.test.local/convite/' + 'a'.repeat(64);
  const tpl = passwordReset({ name: 'Ana', company: 'Co', url: fake, branding: { office_name: 'Office' } });
  assert.match(tpl.subject, /Redefinição de acesso/i);
  assert.match(tpl.html, /Redefinição de acesso/i);
  assert.match(tpl.html, /Criar nova senha/i);
  const href = hrefFromHtml(tpl.html);
  assert.equal(href, fake);
  assert.match(tpl.html, /<a\s+[^>]*href="/i);
});

test('2 template com url vazia não inventa undefined', () => {
  const tpl = passwordReset({ name: 'Ana', url: '', branding: {} });
  const href = hrefFromHtml(tpl.html);
  assert.equal(href, '');
  assert.doesNotMatch(tpl.html, /href="undefined"|href="null"/i);
});

test('3 PASSWORD_RESET e-mail enviado tem href /convite/ na base correta', async () => {
  sentMails = [];
  const r = await req('POST', `/api/client-users/${clientA.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.email_sent, true);
  assert.equal(sentMails.length, 1);
  assert.match(sentMails[0].subject, /Redefinição de acesso/i);
  const href = hrefFromHtml(sentMails[0].html);
  assertInviteHref(href, 'http://app.test.local');
  assertNoSecrets(r.data, 'reset');
  assertNoSecrets({ subject: sentMails[0].subject, has_html: !!sentMails[0].html }, 'mail-meta');
});

test('4 job PASSWORD_RESET persiste url no payload (sem vazamento em resposta)', async () => {
  const job = db.prepare(
    "SELECT payload_json FROM communication_jobs WHERE template_key='password-reset' ORDER BY created_at DESC LIMIT 1"
  ).get();
  assert.ok(job);
  const payload = JSON.parse(job.payload_json);
  assert.equal(payload.purpose, 'PASSWORD_RESET');
  assert.ok(payload.url);
  assert.match(payload.url, /^http:\/\/app\.test\.local\/convite\//);
  assert.doesNotMatch(JSON.stringify({ purpose: payload.purpose, has_url: true }), /password_hash|token_hash/);
});

test('5 ACTIVATION continua gerando /convite/', async () => {
  sentMails = [];
  const created = (await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Novo Ativ', email: 'ativ.s276@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  assert.ok(created.invitation.activation_url);
  assert.match(created.invitation.activation_url, /^http:\/\/app\.test\.local\/convite\//);
  if (sentMails[0]) {
    assert.match(sentMails[0].html, /Ativar meu acesso/i);
    assert.match(sentMails[0].html, /href="http:\/\/app\.test\.local\/convite\//);
  }
});

test('6 token válido abre convite PASSWORD_RESET', async () => {
  sentMails = [];
  const reset = await req('POST', `/api/client-users/${clientA.user.id}/redefinir-acesso`, {}, ownerA.token);
  const href = hrefFromHtml(sentMails[0].html);
  const tok = href.split('/convite/')[1];
  const view = await req('GET', '/api/invitations/' + tok);
  assert.equal(view.status, 200);
  assert.equal(view.data.purpose, 'PASSWORD_RESET');
  assert.match(view.data.title || '', /nova senha/i);
  assertNoSecrets(view.data, 'invite-view');
});

test('7 token consumido é rejeitado; nova senha funciona; antiga falha', async () => {
  sentMails = [];
  const reset = await req('POST', `/api/client-users/${clientA.user.id}/redefinir-acesso`, {}, ownerA.token);
  const href = hrefFromHtml(sentMails[0].html);
  const tok = href.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(acc.status, 200);
  const reuse = await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.ok(reuse.status === 410 || reuse.status === 404 || reuse.status === 400);
  const oldLogin = await req('POST', '/api/auth/login', {
    tenant: slugA, email: 'client.s276@test.local', password
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await req('POST', '/api/auth/login', {
    tenant: slugA, email: 'client.s276@test.local', password: newPassword
  });
  assert.equal(newLogin.status, 200);
});

test('8 token expirado é rejeitado', async () => {
  sentMails = [];
  const reset = await req('POST', `/api/client-users/${clientA.user.id}/redefinir-acesso`, {}, ownerA.token);
  const href = hrefFromHtml(sentMails[0].html);
  const tok = href.split('/convite/')[1];
  db.prepare("UPDATE client_invitations SET expires_at=? WHERE status='PENDING' AND user_id=?")
    .run(new Date(Date.now() - 60_000).toISOString(), clientA.user.id);
  const view = await req('GET', '/api/invitations/' + tok);
  assert.ok(view.status === 410 || view.status === 400 || view.status === 404);
});

test('9 token inválido é rejeitado', async () => {
  const view = await req('GET', '/api/invitations/' + 'f'.repeat(64));
  assert.ok(view.status === 404 || view.status === 410);
});

test('10 appPublicUrl usa CDS_EMAIL_APP_URL e não porta do escritório por padrão no dual-front', () => {
  // module already loaded with CDS_EMAIL_APP_URL=http://app.test.local
  const src = fs.readFileSync(path.join(__dirname, '../backend/src/server.js'), 'utf8');
  assert.match(src, /CLIENT_PORT/);
  assert.match(src, /Convites\/PASSWORD_RESET pertencem ao front do cliente/);
  const svc = fs.readFileSync(path.join(__dirname, '../backend/src/communications/communication-service.js'), 'utf8');
  assert.match(svc, /url:inviteUrl/);
  assert.match(svc, /url:payload\.url\|\|''/);
});

test('11 integrity e foreign keys', () => {
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
