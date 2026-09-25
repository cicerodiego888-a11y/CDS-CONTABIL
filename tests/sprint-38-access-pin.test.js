'use strict';

/**
 * Sprint 38 — PIN de acesso 4 dígitos (Cliente + Escritório)
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s38-'));
process.env.CDS_DB_PATH = path.join(tmp, 's38.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-s38-pin-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.CDS_DOCUMENT_PIPELINE = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_APP_URL = 'http://app.test.local';

const { app, db, setEmailProvider } = require('../backend/src/server');
const pinAuth = require('../backend/src/auth/pin');

const password = 'Senha@123';
let server, base;
let ownerA, ownerB, companyA, companyB;
let clientA, clientB;
let inviteTokenA;

function mockEmailOk() {
  setEmailProvider({
    name: 'mock-s38',
    async send() {
      return { accepted: true, email_sent: true, status: 'sent', messageId: 's38-mock' };
    }
  });
}

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
  return token;
}

function userRow(id) {
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

function assertNoPinLeak(obj, label) {
  const raw = JSON.stringify(obj || {});
  assert.doesNotMatch(raw, /"pin_hash"\s*:/, label + ' pin_hash');
  assert.doesNotMatch(raw, /"pin"\s*:\s*"\d{4}"/, label + ' pin plaintext');
  assert.doesNotMatch(raw, /PIN=\d{4}/, label + ' PIN=');
}

before(async () => {
  mockEmailOk();
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  ownerA = await registerOffice('Escritório PIN A', 'owner.pin.a@test.local');
  ownerB = await registerOffice('Escritório PIN B', 'owner.pin.b@test.local');

  const ca = await req('POST', '/api/empresas', {
    name: 'Empresa PIN A', trade_name: 'PinA', cnpj: '11222333000181'
  }, ownerA.token);
  assert.equal(ca.status, 201);
  companyA = ca.data;

  const cb = await req('POST', '/api/empresas', {
    name: 'Empresa PIN B', trade_name: 'PinB', cnpj: '22333444000192'
  }, ownerB.token);
  assert.equal(cb.status, 201);
  companyB = cb.data;

  const uA = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente PIN A', email: 'cliente.pin.a@test.local', profile: 'Administrador'
  }, ownerA.token);
  assert.equal(uA.status, 201, JSON.stringify(uA.data));
  inviteTokenA = await activateClient(uA);

  const uB = await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente PIN B', email: 'cliente.pin.b@test.local', profile: 'Administrador'
  }, ownerB.token);
  assert.equal(uB.status, 201);
  const tokenB = await activateClient(uB);
  const acceptB = await req('POST', '/api/invitations/' + tokenB + '/accept', {
    name: 'Cliente PIN B', password, confirmation: password
  });
  assert.equal(acceptB.status, 200, JSON.stringify(acceptB.data));
  clientB = acceptB.data;
  // set PIN for B so isolation tests can use a configured user
  const pinB = await req('POST', '/api/auth/pin', { pin: '5555', confirmation: '5555' }, clientB.token);
  assert.equal(pinB.status, 201, JSON.stringify(pinB.data));
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('C/D unit: validação de PIN', () => {
  assert.equal(pinAuth.isValidPin('1234'), true);
  assert.equal(pinAuth.isValidPin('0000'), true);
  assert.equal(pinAuth.isValidPin('0482'), true);
  assert.equal(pinAuth.isValidPin('123'), false);
  assert.equal(pinAuth.isValidPin('12345'), false);
  assert.equal(pinAuth.isValidPin('12A4'), false);
  assert.equal(pinAuth.isValidPin('12-4'), false);
  assert.equal(pinAuth.isValidPin('12 4'), false);
  assert.ok(pinAuth.pinValidationError('123', '123'));
  assert.ok(pinAuth.pinValidationError('1234', '9999'));
  assert.equal(pinAuth.pinValidationError('0482', '0482'), null);
});

test('A) Primeiro acesso Cliente: senha → requires_pin → PIN', async () => {
  const accept = await req('POST', '/api/invitations/' + inviteTokenA + '/accept', {
    name: 'Cliente PIN A', password, confirmation: password
  });
  assert.equal(accept.status, 200, JSON.stringify(accept.data));
  assert.equal(accept.data.requires_pin_setup, true);
  assert.equal(accept.data.pin_configured, false);
  assertNoPinLeak(accept.data, 'accept');
  clientA = accept.data;

  const row = userRow(clientA.user.id);
  assert.equal(Number(row.pin_setup_required), 1);
  assert.equal(row.pin_hash, null);

  // K) sem PIN ainda exige setup
  const me = await req('GET', '/api/auth/me', undefined, clientA.token);
  assert.equal(me.status, 200);
  assert.equal(me.data.requires_pin_setup, true);
  assert.equal(me.data.pin_configured, false);
  assertNoPinLeak(me.data, 'me before pin');

  // E) confirmação diferente
  const badConfirm = await req('POST', '/api/auth/pin', {
    pin: '1234', confirmation: '4321'
  }, clientA.token);
  assert.equal(badConfirm.status, 400);

  // D) inválidos
  for (const pin of ['123', '12345', '12A4', '12-4', '12 4']) {
    const r = await req('POST', '/api/auth/pin', { pin, confirmation: pin }, clientA.token);
    assert.equal(r.status, 400, pin);
  }

  // F/G) 0000 e 0482 (zeros)
  const pinCreate = await req('POST', '/api/auth/pin', {
    pin: '0482', confirmation: '0482'
  }, clientA.token);
  assert.equal(pinCreate.status, 201, JSON.stringify(pinCreate.data));
  assert.equal(pinCreate.data.pin_configured, true);
  assert.equal(pinCreate.data.requires_pin_setup, false);
  assertNoPinLeak(pinCreate.data, 'pin create');

  const after = userRow(clientA.user.id);
  assert.ok(after.pin_hash);
  assert.ok(after.pin_hash.startsWith('$2'));
  assert.ok(bcrypt.compareSync('0482', after.pin_hash));
  assert.equal(Number(after.pin_setup_required), 0);
  assert.ok(after.pin_configured_at);

  const audits = db.prepare(
    "SELECT action, after_json FROM audit_logs WHERE tenant_id=? AND entity_id=? AND action='PIN_CREATED'"
  ).all(ownerA.user.tenant_id, clientA.user.id);
  assert.ok(audits.length >= 1);
  assert.doesNotMatch(JSON.stringify(audits), /0482/);

  const me2 = await req('GET', '/api/auth/me', undefined, clientA.token);
  assert.equal(me2.data.pin_configured, true);
  assert.equal(me2.data.requires_pin_setup, false);
});

test('B) Escritório: usuário criado exige PIN no primeiro login', async () => {
  const staff = await req('POST', '/api/usuarios', {
    name: 'Staff PIN', email: 'staff.pin@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  const row = userRow(staff.data.id);
  assert.equal(Number(row.pin_setup_required), 1);

  const login = await req('POST', '/api/auth/login', {
    email: 'staff.pin@test.local', password, tenant: ownerA.user.tenant_slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.requires_pin_setup, true);
  assertNoPinLeak(login.data, 'staff login');

  const pin = await req('POST', '/api/auth/pin', {
    pin: '9071', confirmation: '9071'
  }, login.data.token);
  assert.equal(pin.status, 201, JSON.stringify(pin.data));

  const login2 = await req('POST', '/api/auth/login', {
    email: 'staff.pin@test.local', password, tenant: ownerA.user.tenant_slug
  });
  assert.equal(login2.status, 200);
  assert.equal(login2.data.requires_pin_setup, false);
  assert.equal(login2.data.pin_configured, true);
});

test('H/J) PIN nunca retornado; só hash no banco', async () => {
  const me = await req('GET', '/api/auth/me', undefined, clientA.token);
  assertNoPinLeak(me.data, 'me');
  const row = userRow(clientA.user.id);
  assert.ok(row.pin_hash);
  assert.notEqual(row.pin_hash, '0482');
});

test('M) Alteração de PIN', async () => {
  const wrong = await req('POST', '/api/auth/pin', {
    current_pin: '0000', pin: '1111', confirmation: '1111'
  }, clientA.token);
  assert.equal(wrong.status, 401);

  const ok = await req('POST', '/api/auth/pin', {
    current_pin: '0482', pin: '1111', confirmation: '1111'
  }, clientA.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(bcrypt.compareSync('1111', userRow(clientA.user.id).pin_hash));
  assert.ok(!bcrypt.compareSync('0482', userRow(clientA.user.id).pin_hash));

  const audits = db.prepare(
    "SELECT after_json FROM audit_logs WHERE action='PIN_CHANGED' AND entity_id=?"
  ).all(clientA.user.id);
  assert.ok(audits.length >= 1);
  assert.doesNotMatch(JSON.stringify(audits), /1111|0482/);
});

test('L) Esqueci PIN via reset de senha invalida PIN antigo', async () => {
  const beforeHash = userRow(clientA.user.id).pin_hash;
  assert.ok(beforeHash);

  const reset = await req('POST', `/api/client-users/${clientA.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  const afterReset = userRow(clientA.user.id);
  assert.equal(afterReset.pin_hash, null);
  assert.equal(Number(afterReset.pin_setup_required), 1);

  const invite = db.prepare(
    "SELECT * FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' AND status='PENDING' ORDER BY created_at DESC LIMIT 1"
  ).get(clientA.user.id);
  assert.ok(invite);
  // token raw only in activation_url when not prod — fetch from API response
  const url = reset.data.activation_url;
  assert.ok(url);
  const token = url.split('/convite/')[1];
  const accept = await req('POST', '/api/invitations/' + token + '/accept', {
    password, confirmation: password
  });
  assert.equal(accept.status, 200, JSON.stringify(accept.data));
  assert.equal(accept.data.requires_pin_setup, true);
  clientA.token = accept.data.token;

  const pin = await req('POST', '/api/auth/pin', {
    pin: '2222', confirmation: '2222'
  }, clientA.token);
  assert.equal(pin.status, 201);

  assert.ok(!bcrypt.compareSync('1111', userRow(clientA.user.id).pin_hash));
  assert.ok(bcrypt.compareSync('2222', userRow(clientA.user.id).pin_hash));

  const pinResetAudits = db.prepare(
    "SELECT action FROM audit_logs WHERE entity_id=? AND action='PIN_RESET'"
  ).all(clientA.user.id);
  assert.ok(pinResetAudits.length >= 1);
});

test('N/O/P) Isolamento entre usuários e tenants', async () => {
  // Cliente B não altera PIN de A
  const cross = await req('POST', '/api/auth/pin', {
    current_pin: '2222', pin: '3333', confirmation: '3333'
  }, clientB.token);
  // B has 5555; using A's pin as current should fail for B
  assert.equal(cross.status, 401);

  const meB = await req('GET', '/api/auth/me', undefined, clientB.token);
  assert.equal(meB.data.pin_configured, true);
  assertNoPinLeak(meB.data, 'meB');

  // Owner A não vê pin_hash em me
  const meOwner = await req('GET', '/api/auth/me', undefined, ownerA.token);
  assertNoPinLeak(meOwner.data, 'owner me');
});

test('Q) Escritório não recupera PIN do cliente', async () => {
  const row = await req('POST', `/api/client-users/${clientA.user.id}/password`, {}, ownerA.token);
  // endpoint denies password recovery; similarly no PIN endpoint for office on client
  assert.ok(row.status === 403 || row.status === 404);
});

test('R) Login e-mail+senha continua funcionando', async () => {
  const login = await req('POST', '/api/auth/login', {
    email: 'cliente.pin.a@test.local',
    password,
    tenant: ownerA.user.tenant_slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.ok(login.data.token);
  assert.equal(login.data.user.role, 'CLIENT');
  assert.equal(login.data.pin_configured, true);
  assertNoPinLeak(login.data, 'login');
});

test('I) UI não embute PIN em texto e tem etapa dedicada', () => {
  const convite = fs.readFileSync(path.join(__dirname, '../frontend/public/convite.html'), 'utf8');
  const pinJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/access-pin.js'), 'utf8');
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(convite, /access-pin\.js/);
  assert.match(convite, /Salvar senha/);
  assert.match(convite, /showPinStep|CdsAccessPin/);
  assert.match(pinJs, /Crie seu PIN de acesso/);
  assert.match(pinJs, /O PIN deve ter exatamente 4 números/);
  assert.match(pinJs, /Cadastrar PIN/);
  assert.doesNotMatch(pinJs, /Pular por enquanto/);
  assert.match(portal, /showClientPinGate|requires_pin_setup/);
  assert.match(appJs, /showOfficePinGate|requires_pin_setup/);
  assert.match(portal, /Esqueci meu PIN/);
});

test('pin/reset-request orienta recuperação sem revelar PIN', async () => {
  const r = await req('POST', '/api/auth/pin/reset-request', {}, clientA.token);
  assert.equal(r.status, 200);
  assert.match(r.data.message || '', /senha|PIN/i);
  assertNoPinLeak(r.data, 'reset-request');
});
