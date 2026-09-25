'use strict';

/**
 * Recuperação automática por e-mail (ajuste pós-27.4).
 * Esqueci minha senha → token + e-mail imediato → nova senha → notifica escritório.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-forgot-auto-'));
process.env.CDS_DB_PATH = path.join(tmp, 'forgot-auto.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-forgot-auto-secret-ok';
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
    name: 'Owner Auto', email: 'owner.forgot.auto@test.local', password, tenantName: 'Tenant Forgot Auto'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.forgot.auto@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  slugA = regA.data.tenant_slug;

  await req('POST', '/api/usuarios', {
    name: 'Accountant Auto', email: 'acc.forgot.auto@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.forgot.auto@test.local', password, tenant: slugA
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa Auto A', trade_name: 'Auto A', cnpj: '11222333000181'
  }, ownerA.token)).data;

  clientA = await activateClient((await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente Auto', email: 'cliente.forgot.auto@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data);

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner B Auto', email: 'owner.b.forgot.auto@test.local', password, tenantName: 'Tenant B Forgot Auto'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.forgot.auto@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  slugB = regB.data.tenant_slug;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa Auto B', trade_name: 'Auto B', cnpj: '11444777000161'
  }, ownerB.token)).data;
  clientB = await activateClient((await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B Auto', email: 'cliente.b.forgot.auto@test.local', profile: 'CLIENT_ADMIN'
  }, ownerB.token)).data);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 clique inicia recuperação e envia e-mail automaticamente', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'cliente.forgot.auto@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(r.data.message, GENERIC);
  assert.equal(sentMails.length, 1);
  assert.match(String(sentMails[0].html || sentMails[0].text || ''), /\/convite\//);
  const invite = db.prepare(
    "SELECT purpose,status FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).get(clientA.user.id);
  assert.equal(invite.purpose, 'PASSWORD_RESET');
  assert.equal(invite.status, 'PENDING');
});

test('2 resposta neutra (anti-enumeração)', async () => {
  const missing = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'naoexiste.forgot.auto@test.local'
  });
  const exists = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'cliente.forgot.auto@test.local'
  });
  assert.equal(missing.status, 200);
  assert.equal(exists.status, 200);
  assert.equal(missing.data.message, exists.data.message);
  assert.match(missing.data.message, GENERIC);
});

test('3 falha de envio notifica o escritório (PASSWORD_RESET_FAILED)', async () => {
  failNextSend = true;
  sentMails = [];
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'cliente.forgot.auto@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(r.data.message, GENERIC);
  assert.equal(sentMails.length, 0);
  const n = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x =>
    x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && x.entity_id === clientA.user.id
  );
  assert.ok(hit, 'PASSWORD_RESET_FAILED missing');
  assert.match(hit.title, /Falha na redefinição/i);
  const nAcc = await req('GET', '/api/notificacoes', undefined, accountantA.token);
  assert.ok((nAcc.data.items || []).some(x => x.type === EVENT_TYPES.PASSWORD_RESET_FAILED && x.entity_id === clientA.user.id));
});

test('4 conclusão notifica o escritório (PASSWORD_RESET_COMPLETED)', async () => {
  sentMails = [];
  const forgot = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'cliente.forgot.auto@test.local'
  });
  assert.equal(forgot.status, 200);
  assert.equal(sentMails.length, 1);
  const html = String(sentMails[0].html || '');
  const m = html.match(/\/convite\/([a-f0-9]{64})/i) || String(sentMails[0].text || '').match(/\/convite\/([a-f0-9]{64})/i);
  assert.ok(m, 'token no e-mail');
  const acc = await req('POST', '/api/invitations/' + m[1] + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  const n = await req('GET', '/api/notificacoes?page=1&page_size=50', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x =>
    x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED && x.entity_id === clientA.user.id
  );
  assert.ok(hit, 'PASSWORD_RESET_COMPLETED missing');
  assert.match(hit.message, /concluiu a redefinição/i);
  const login = await req('POST', '/api/auth/login', {
    email: 'cliente.forgot.auto@test.local', password: newPassword, tenant: slugA
  });
  assert.equal(login.status, 200);
});

test('5 isolamento tenant — A não vê evento de B', async () => {
  sentMails = [];
  await req('POST', '/api/auth/forgot-password', {
    tenant: slugB, email: 'cliente.b.forgot.auto@test.local'
  });
  assert.equal(sentMails.length, 1);
  const nA = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  assert.equal((nA.data.items || []).filter(x => x.entity_id === clientB.user.id).length, 0);
});

test('6 UI: Esqueci minha senha dispara imediatamente (sem segunda confirmação)', () => {
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  assert.match(portal, /Esqueci minha senha/);
  assert.match(portal, /\/api\/auth\/forgot-password/);
  assert.match(portal, /Enviamos as instruções para o seu e-mail cadastrado/);
  assert.doesNotMatch(portal, /Solicitar redefinição/);
  assert.doesNotMatch(portal, /forgotBox/);
  assert.doesNotMatch(portal, /Solicite a redefinição de acesso ao seu escritório/);
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /PASSWORD_RESET_COMPLETED/);
  assert.match(appJs, /PASSWORD_RESET_FAILED/);
  assert.match(appJs, /Enviamos as instruções para o seu e-mail cadastrado/);
});

test('7 resposta não vaza segredos', async () => {
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'cliente.forgot.auto@test.local'
  });
  assertNoSecrets(r.data, 'forgot');
});

test('8 integrity e foreign keys', () => {
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
