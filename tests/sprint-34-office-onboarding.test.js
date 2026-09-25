'use strict';

/**
 * Sprint 34 — Onboarding público de escritório (signup + e-mail + tenant/OWNER).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s34-'));
process.env.CDS_DB_PATH = path.join(tmp, 's34.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-s34-secret-ok';
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
const { app, db, setEmailProvider } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let sentMails = [];
let failNextSend = false;
let otherOwner, otherSlug;

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
  assert.doesNotMatch(raw, /password_hash/, label + ' password_hash');
  assert.doesNotMatch(raw, /token_hash/, label + ' token_hash');
  assert.doesNotMatch(raw, /"password"\s*:\s*"[^"]{4,}"/, label + ' password');
}

function tokenFromMail() {
  const last = sentMails[sentMails.length - 1];
  assert.ok(last, 'e-mail esperado');
  const blob = String((last && (last.text || last.html)) || '');
  const m = blob.match(/\/ativar-escritorio\/([a-f0-9]{64})/i);
  assert.ok(m, 'token no e-mail');
  return m[1];
}

function signupPayload(overrides) {
  return {
    office_name: 'Escritório Sprint 34',
    cnpj: '11.222.333/0001-81',
    office_email: 'contato@s34.local',
    owner_name: 'Admin S34',
    owner_email: 'admin.s34@test.local',
    password,
    ...overrides
  };
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

  const reg = await req('POST', '/api/auth/register', {
    name: 'Owner Outro', email: 'owner.other.s34@test.local', password, tenantName: 'Outro Escritório S34', cnpj: '00.000.000/0001-91'
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  otherSlug = reg.data.tenant_slug;
  otherOwner = (await req('POST', '/api/auth/login', {
    email: 'owner.other.s34@test.local', password, tenant: otherSlug
  })).data;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
});

test('1 cadastro de novo escritório envia e-mail sem criar tenant', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/signup', signupPayload());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(String(r.data.message || ''), /e-mail/i);
  assert.equal(sentMails.length, 1);
  assert.match(String(sentMails[0].subject || ''), /Confirme/i);
  assert.doesNotMatch(JSON.stringify(sentMails[0]), /Senha@123/);
  const pending = db.prepare("SELECT status,tenant_id FROM office_registrations WHERE owner_email=?").get('admin.s34@test.local');
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.tenant_id, null);
  const tenants = db.prepare("SELECT COUNT(*) n FROM tenants WHERE name=?").get('Escritório Sprint 34');
  assert.equal(tenants.n, 0);
});

test('2 confirmação cria tenant + OWNER e audits', async () => {
  const tok = tokenFromMail();
  const status = await req('GET', '/api/auth/signup/' + tok);
  assert.equal(status.status, 200);
  assert.equal(status.data.status, 'PENDING');
  assertNoSecrets(status.data, 'signup status');

  const conf = await req('POST', '/api/auth/signup/' + tok + '/confirm', {
    tenant_id: 'hack-tenant', company_id: 'hack-company', role: 'CLIENT'
  });
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.role, 'OWNER');
  assert.ok(conf.data.tenant_slug);

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(conf.data.user_id);
  assert.equal(user.role, 'OWNER');
  assert.equal(user.tenant_id, conf.data.tenant_id);
  assert.equal(user.company_id, null);
  assert.equal(user.active, 1);

  const actions = db.prepare('SELECT action FROM audit_logs WHERE tenant_id=? ORDER BY created_at, id')
    .all(conf.data.tenant_id).map(x => x.action);
  for (const a of ['ACCOUNT_REGISTRATION_REQUESTED', 'EMAIL_VERIFIED', 'TENANT_CREATED', 'OWNER_CREATED', 'ACCOUNT_ACTIVATED']) {
    assert.ok(actions.includes(a), 'audit ' + a);
  }

  const again = await req('POST', '/api/auth/signup/' + tok + '/confirm', {});
  assert.equal(again.status, 409);
});

test('3 login após ativação no dashboard do escritório', async () => {
  const tenant = db.prepare('SELECT slug FROM tenants WHERE name=?').get('Escritório Sprint 34');
  const login = await req('POST', '/api/auth/login', {
    email: 'admin.s34@test.local', password, tenant: tenant.slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.role, 'OWNER');
  assert.equal(login.data.redirect, '/');
  const me = await req('GET', '/api/auth/me', undefined, login.data.token);
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'OWNER');
  assert.equal(me.data.tenant_id, login.data.user.tenant_id);
});

test('4 CNPJ e e-mail duplicados', async () => {
  sentMails = [];
  const dupCnpj = await req('POST', '/api/auth/signup', signupPayload({
    office_name: 'Outro Nome',
    owner_email: 'novo.s34@test.local',
    office_email: 'outro@s34.local'
  }));
  assert.equal(dupCnpj.status, 409);
  assert.equal(dupCnpj.data.error, 'CNPJ_DUPLICATE');

  const dupEmail = await req('POST', '/api/auth/signup', signupPayload({
    office_name: 'Escritório Email Dup',
    cnpj: '22.333.444/0001-55',
    owner_email: 'admin.s34@test.local',
    office_email: 'dup@s34.local'
  }));
  assert.equal(dupEmail.status, 409);
  assert.equal(dupEmail.data.error, 'EMAIL_DUPLICATE');
});

test('5 tenant_id/company_id/role do body são ignorados no signup', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/signup', signupPayload({
    office_name: 'Escritório Isolado S34',
    cnpj: '33.444.555/0001-66',
    office_email: 'iso@s34.local',
    owner_name: 'Iso Admin',
    owner_email: 'iso.admin.s34@test.local',
    tenant_id: otherOwner.user.tenant_id,
    company_id: 'qualquer',
    role: 'CLIENT'
  }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const tok = tokenFromMail();
  const conf = await req('POST', '/api/auth/signup/' + tok + '/confirm', {
    tenant_id: otherOwner.user.tenant_id,
    company_id: 'x',
    role: 'CLIENT'
  });
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.role, 'OWNER');
  assert.notEqual(conf.data.tenant_id, otherOwner.user.tenant_id);
  const user = db.prepare('SELECT role,company_id,tenant_id FROM users WHERE id=?').get(conf.data.user_id);
  assert.equal(user.role, 'OWNER');
  assert.equal(user.company_id, null);
  assert.notEqual(user.tenant_id, otherOwner.user.tenant_id);
});

test('6 isolamento: OWNER só vê o próprio tenant', async () => {
  const tenant = db.prepare('SELECT slug FROM tenants WHERE name=?').get('Escritório Isolado S34');
  const login = await req('POST', '/api/auth/login', {
    email: 'iso.admin.s34@test.local', password, tenant: tenant.slug
  });
  assert.equal(login.status, 200);
  const t = await req('GET', '/api/tenant', undefined, login.data.token);
  assert.equal(t.status, 200);
  assert.equal(t.data.id, login.data.user.tenant_id);
  assert.notEqual(t.data.id, otherOwner.user.tenant_id);
  const empresas = await req('GET', '/api/empresas', undefined, login.data.token);
  assert.equal(empresas.status, 200);
  const items = empresas.data.items || empresas.data || [];
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 0);
});

test('7 falha de e-mail revoga sem criar tenant', async () => {
  failNextSend = true;
  const beforeTenants = db.prepare('SELECT COUNT(*) n FROM tenants').get().n;
  const r = await req('POST', '/api/auth/signup', signupPayload({
    office_name: 'Escritório Falha Mail',
    cnpj: '44.555.666/0001-77',
    office_email: 'fail@s34.local',
    owner_email: 'fail.admin.s34@test.local'
  }));
  assert.equal(r.status, 502);
  assert.ok(['SIGNUP_EMAIL_FAILED', 'SIGNUP_EMAIL_NOT_CONFIGURED'].includes(r.data.error), JSON.stringify(r.data));
  const row = db.prepare("SELECT status,tenant_id FROM office_registrations WHERE owner_email=?").get('fail.admin.s34@test.local');
  assert.equal(row.status, 'REVOKED');
  assert.equal(row.tenant_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tenants').get().n, beforeTenants);
});

test('8 concorrência básica: segundo confirm falha', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/signup', signupPayload({
    office_name: 'Escritório Concorrente',
    cnpj: '55.666.777/0001-88',
    office_email: 'conc@s34.local',
    owner_email: 'conc.admin.s34@test.local'
  }));
  assert.equal(r.status, 201);
  const tok = tokenFromMail();
  const [a, b] = await Promise.all([
    req('POST', '/api/auth/signup/' + tok + '/confirm', {}),
    req('POST', '/api/auth/signup/' + tok + '/confirm', {})
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const owners = db.prepare("SELECT COUNT(*) n FROM users WHERE lower(email)=? AND role='OWNER'").get('conc.admin.s34@test.local');
  assert.equal(owners.n, 1);
  const tenants = db.prepare('SELECT COUNT(*) n FROM tenants WHERE name=?').get('Escritório Concorrente');
  assert.equal(tenants.n, 1);
});

test('9 UX login: Criar minha conta + página ativar + cache', async () => {
  const index = await fetch(base + '/').then(r => r.text());
  assert.match(index, /app\.js\?v=s39-5/);
  const js = await fetch(base + '/assets/app.js?v=s39-5').then(r => r.text());
  assert.match(js, /Criar minha conta/);
  assert.match(js, /\/api\/auth\/signup/);
  assert.doesNotMatch(js, /Solicitar acesso/);
  const page = await fetch(base + '/ativar-escritorio/tokenteste').then(r => r.text());
  assert.match(page, /Ativar escritório|Confirmar e-mail/i);
});

test('10 register de testes e convite CLIENT continuam', async () => {
  const reg = await req('POST', '/api/auth/register', {
    name: 'Owner Convite', email: 'owner.invite.s34@test.local', password, tenantName: 'Tenant Convite S34'
  });
  assert.equal(reg.status, 201);
  const login = await req('POST', '/api/auth/login', {
    email: 'owner.invite.s34@test.local', password, tenant: reg.data.tenant_slug
  });
  const company = await req('POST', '/api/empresas', {
    name: 'Empresa Convite S34', cnpj: '66.777.888/0001-99'
  }, login.data.token);
  assert.equal(company.status, 201, JSON.stringify(company.data));
  const client = await req('POST', '/api/empresas/' + company.data.id + '/users', {
    name: 'Cliente S34', email: 'cliente.s34@test.local', profile: 'CLIENT_ADMIN'
  }, login.data.token);
  assert.equal(client.status, 201, JSON.stringify(client.data));
  assert.ok(client.data.invitation);
});

test('11 recuperação de senha continua respondendo', async () => {
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: otherSlug, email: 'owner.other.s34@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(String(r.data.message || ''), /instruções/i);
});
