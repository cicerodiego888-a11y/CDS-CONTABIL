'use strict';

/**
 * Sprint 35 — e-mail de onboarding via emailProvider/plataforma existente.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s35-'));
process.env.CDS_DB_PATH = path.join(tmp, 's35.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-s35-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_HOST = '';
process.env.CDS_EMAIL_USER = '';
process.env.CDS_EMAIL_PASSWORD = '';
process.env.CDS_EMAIL_FROM = '';
process.env.CDS_EMAIL_APP_URL = 'http://portal.test.local';
process.env.PORT = '3333';

const { createEmailProvider } = require('../backend/src/email/provider');
const { app, db, setEmailProvider } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let sentMails = [];
let failNextSend = false;
let lastLogged = [];

function req(method, url, body) {
  return fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

function payload(overrides) {
  return {
    office_name: 'Escritório S35',
    cnpj: '11.444.777/0001-61',
    office_email: 'contato@s35.local',
    owner_name: 'Owner S35',
    owner_email: 'owner.s35@test.local',
    password,
    ...overrides
  };
}

function tokenFromMail() {
  const last = sentMails[sentMails.length - 1];
  assert.ok(last, 'e-mail esperado');
  const blob = String((last && (last.text || last.html)) || '');
  assert.doesNotMatch(blob, /Senha@123/);
  const m = blob.match(/\/ativar-escritorio\/([a-f0-9]{64})/i);
  assert.ok(m, 'token no e-mail');
  assert.match(String(last.text || ''), /http:\/\/localhost:3333\/ativar-escritorio\//);
  return m[1];
}

before(async () => {
  const origError = console.error;
  console.error = (...args) => {
    lastLogged.push(args.map(String).join(' '));
    origError.apply(console, args);
  };
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
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
});

test('1 signup envia e-mail via provider e fica PENDING', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/signup', payload());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(sentMails.length, 1);
  assert.match(String(sentMails[0].subject || ''), /Confirme/i);
  const row = db.prepare("SELECT status,tenant_id FROM office_registrations WHERE owner_email=?").get('owner.s35@test.local');
  assert.equal(row.status, 'PENDING');
  assert.equal(row.tenant_id, null);
});

test('2 ativação cria tenant+OWNER e login funciona', async () => {
  const tok = tokenFromMail();
  const conf = await req('POST', '/api/auth/signup/' + tok + '/confirm', {});
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.role, 'OWNER');
  const login = await req('POST', '/api/auth/login', {
    email: 'owner.s35@test.local', password, tenant: conf.data.tenant_slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.role, 'OWNER');
});

test('3 falha de envio: log seguro, REVOKED, sem tenant, nova tentativa', async () => {
  failNextSend = true;
  lastLogged = [];
  const beforeTenants = db.prepare('SELECT COUNT(*) n FROM tenants').get().n;
  const fail = await req('POST', '/api/auth/signup', payload({
    office_name: 'Escritório S35 Fail',
    cnpj: '22.555.888/0001-72',
    office_email: 'fail@s35.local',
    owner_email: 'fail.s35@test.local'
  }));
  assert.equal(fail.status, 502);
  assert.ok(['SIGNUP_EMAIL_FAILED', 'SIGNUP_EMAIL_NOT_CONFIGURED'].includes(fail.data.error));
  const revoked = db.prepare("SELECT status,tenant_id FROM office_registrations WHERE owner_email=?").get('fail.s35@test.local');
  assert.equal(revoked.status, 'REVOKED');
  assert.equal(revoked.tenant_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tenants').get().n, beforeTenants);
  const logBlob = lastLogged.join('\n');
  assert.match(logBlob, /office_signup_email_failed/);
  assert.doesNotMatch(logBlob, /Senha@123/);
  assert.doesNotMatch(logBlob, /password/i);
  assert.doesNotMatch(logBlob, /ativar-escritorio\/[a-f0-9]{32}/i);
  assert.doesNotMatch(logBlob, /token_hash/);

  sentMails = [];
  const retry = await req('POST', '/api/auth/signup', payload({
    office_name: 'Escritório S35 Fail',
    cnpj: '22.555.888/0001-72',
    office_email: 'fail@s35.local',
    owner_email: 'fail.s35@test.local'
  }));
  assert.equal(retry.status, 201, JSON.stringify(retry.data));
  assert.equal(sentMails.length, 1);
  const pending = db.prepare("SELECT status FROM office_registrations WHERE owner_email=? AND status='PENDING'").get('fail.s35@test.local');
  assert.ok(pending);
});

test('4 provider sem config retorna SIGNUP_EMAIL_NOT_CONFIGURED e permite retry', async () => {
  setEmailProvider(createEmailProvider({ name: 'off' }));
  const r = await req('POST', '/api/auth/signup', payload({
    office_name: 'Escritório S35 Off',
    cnpj: '33.666.999/0001-83',
    office_email: 'off@s35.local',
    owner_email: 'off.s35@test.local'
  }));
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'SIGNUP_EMAIL_NOT_CONFIGURED');
  const row = db.prepare("SELECT status FROM office_registrations WHERE owner_email=?").get('off.s35@test.local');
  assert.equal(row.status, 'REVOKED');

  setEmailProvider(createEmailProvider({
    send: async mail => {
      sentMails.push(mail);
      return { status: 'accepted', accepted: true };
    }
  }));
  sentMails = [];
  const ok = await req('POST', '/api/auth/signup', payload({
    office_name: 'Escritório S35 Off',
    cnpj: '33.666.999/0001-83',
    office_email: 'off@s35.local',
    owner_email: 'off.s35@test.local'
  }));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(sentMails.length, 1);
});

test('5 template office-signup sem senha', () => {
  const templates = require('../backend/src/communications/email/templates');
  const tpl = templates.render('office-signup', {
    name: 'Ana', office_name: 'Contábil X', url: 'http://localhost:3333/ativar-escritorio/abc'
  });
  assert.match(tpl.subject, /Confirme/);
  assert.match(tpl.text, /ativar-escritorio/);
  assert.doesNotMatch(tpl.text + tpl.html, /Senha@123|password_hash/i);
});
