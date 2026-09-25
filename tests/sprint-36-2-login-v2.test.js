'use strict';

/**
 * Sprint 36.2 — Login V2 (e-mail + senha, tenant automático, seleção pós-auth).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s362-'));
process.env.CDS_DB_PATH = path.join(tmp, 's362.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-s362-secret-ok';
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
const root = path.join(__dirname, '..');
let server, base;
let ownerA, ownerB, slugA, slugB, companyA, companyB;
let accountantA, staffA, clientA;
let sharedEmail = 'shared.s362@test.local';
let sentMails = [];

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

function assertNoInternalIds(obj, label) {
  const raw = JSON.stringify(obj || {});
  assert.doesNotMatch(raw, /"tenant_id"\s*:/, label + ' tenant_id');
  assert.doesNotMatch(raw, /codigo_cliente|codigo_escritorio|client_code/i, label + ' códigos internos');
  assert.doesNotMatch(raw, /"company_id"\s*:/, label + ' company_id');
  assert.doesNotMatch(raw, /"slug"\s*:/, label + ' slug');
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function uploadLogo(token) {
  const form = new FormData();
  form.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'logo.png');
  const r = await fetch(base + '/api/tenant/branding/logo', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function activateClient(created) {
  const token = created.invitation.activation_url.split('/convite/')[1];
  const r = await req('POST', '/api/invitations/' + token + '/accept', {
    name: created.user.name, password, confirmation: password
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

before(async () => {
  setEmailProvider(createEmailProvider({
    send: async mail => { sentMails.push(mail); return { ok: true, id: 's362-' + sentMails.length }; }
  }));

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await req('POST', '/api/auth/register', {
    name: 'Owner A', email: 'owner.a.s362@test.local', password,
    tenantName: 'Sua Contabilidade LTDA', cnpj: '11.222.333/0001-81'
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  slugA = a.data.tenant_slug;
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s362@test.local', password
  })).data;
  assert.ok(ownerA.token);

  const b = await req('POST', '/api/auth/register', {
    name: 'Owner B', email: 'owner.b.s362@test.local', password,
    tenantName: 'Outra Contabilidade', cnpj: '22.333.444/0001-55'
  });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  slugB = b.data.tenant_slug;
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s362@test.local', password, tenant: slugB
  })).data;

  db.prepare("UPDATE tenants SET cnpj=? WHERE id=?").run('11.222.333/0001-81', ownerA.user.tenant_id);
  db.prepare("UPDATE tenants SET cnpj=? WHERE id=?").run('22.333.444/0001-55', ownerB.user.tenant_id);
  await req('PATCH', '/api/tenant/branding', { office_name: 'Sua Contabilidade LTDA' }, ownerA.token);
  await req('PATCH', '/api/tenant/branding', { office_name: 'Outra Contabilidade' }, ownerB.token);
  assert.equal((await uploadLogo(ownerA.token)).status, 200);

  const company = await req('POST', '/api/empresas', {
    name: 'Empresa Cliente A', cnpj: '33.444.555/0001-66'
  }, ownerA.token);
  assert.equal(company.status, 201, JSON.stringify(company.data));
  companyA = company.data;

  const company2 = await req('POST', '/api/empresas', {
    name: 'Empresa Cliente B', cnpj: '44.555.666/0001-77'
  }, ownerB.token);
  companyB = company2.data;

  const acc = await req('POST', '/api/usuarios', {
    name: 'Contador A', email: 'acc.s362@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.s362@test.local', password
  })).data;

  const st = await req('POST', '/api/usuarios', {
    name: 'Staff A', email: 'staff.s362@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(st.status, 201, JSON.stringify(st.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.s362@test.local', password
  })).data;

  const cli = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente A', email: 'client.s362@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  assert.equal(cli.status, 201, JSON.stringify(cli.data));
  clientA = await activateClient(cli.data);

  // mesmo e-mail em dois tenants (OWNER A + OWNER B clones)
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  db.prepare(
    'INSERT INTO users(id,tenant_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?,1)'
  ).run(
    crypto.randomUUID(),
    ownerB.user.tenant_id,
    'Shared B',
    sharedEmail,
    bcrypt.hashSync(password, 4),
    'OWNER'
  );
  db.prepare(
    'INSERT INTO users(id,tenant_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?,1)'
  ).run(
    crypto.randomUUID(),
    ownerA.user.tenant_id,
    'Shared A',
    sharedEmail,
    bcrypt.hashSync(password, 4),
    'OWNER'
  );
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
});

test('1 login sem código do escritório', async () => {
  const r = await req('POST', '/api/auth/login', {
    email: 'owner.a.s362@test.local', password
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.token);
  assert.equal(r.data.user.role, 'OWNER');
  assert.ok(!('needs_environment_choice' in r.data) || !r.data.needs_environment_choice);
});

test('2-5 OWNER ACCOUNTANT STAFF CLIENT entram', async () => {
  for (const [label, email, role] of [
    ['OWNER', 'owner.a.s362@test.local', 'OWNER'],
    ['ACCOUNTANT', 'acc.s362@test.local', 'ACCOUNTANT'],
    ['STAFF', 'staff.s362@test.local', 'STAFF'],
    ['CLIENT', 'client.s362@test.local', 'CLIENT']
  ]) {
    const r = await req('POST', '/api/auth/login', { email, password });
    assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data));
    assert.equal(r.data.user.role, role);
    assert.ok(r.data.token);
  }
});

test('6 senha incorreta rejeitada', async () => {
  const r = await req('POST', '/api/auth/login', {
    email: 'owner.a.s362@test.local', password: 'errada999'
  });
  assert.equal(r.status, 401);
  assert.ok(!r.data.environments);
  assert.ok(!r.data.choice_token);
});

test('7 e-mail inexistente rejeitado', async () => {
  const r = await req('POST', '/api/auth/login', {
    email: 'naoexiste.s362@test.local', password
  });
  assert.equal(r.status, 401);
  assert.ok(!r.data.environments);
});

test('8 usuário inativo rejeitado', async () => {
  db.prepare("UPDATE users SET active=0 WHERE lower(email)='staff.s362@test.local'").run();
  const r = await req('POST', '/api/auth/login', {
    email: 'staff.s362@test.local', password
  });
  assert.equal(r.status, 401);
  db.prepare("UPDATE users SET active=1 WHERE lower(email)='staff.s362@test.local'").run();
});

test('9-10 tenant e company corretos', async () => {
  const r = await req('POST', '/api/auth/login', {
    email: 'client.s362@test.local', password
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.tenant_id, ownerA.user.tenant_id);
  assert.equal(r.data.user.company_id, companyA.id);
  assert.equal(r.data.redirect, '/portal/');
});

test('11 tenant A não acessa tenant B', async () => {
  const list = await req('GET', '/api/empresas', undefined, ownerA.token);
  assert.equal(list.status, 200);
  const ids = (list.data.items || list.data || []).map(x => x.id);
  assert.ok(ids.includes(companyA.id));
  assert.ok(!ids.includes(companyB.id));
  const cross = await req('GET', '/api/empresas/' + companyB.id, undefined, ownerA.token);
  assert.ok(cross.status === 404 || cross.status === 403);
});

test('12-15 mesmo e-mail: seleção somente após auth válida', async () => {
  const bad = await req('POST', '/api/auth/login', {
    email: sharedEmail, password: 'errada999'
  });
  assert.equal(bad.status, 401);
  assert.ok(!bad.data.environments);

  const multi = await req('POST', '/api/auth/login', {
    email: sharedEmail, password
  });
  assert.equal(multi.status, 200, JSON.stringify(multi.data));
  assert.equal(multi.data.needs_environment_choice, true);
  assert.ok(multi.data.choice_token);
  assert.ok(Array.isArray(multi.data.environments));
  assert.equal(multi.data.environments.length, 2);
  assert.ok(!multi.data.token);

  for (const env of multi.data.environments) {
    assert.ok(env.name);
    assert.ok(env.cnpj);
    assert.ok(env.key);
    assertNoInternalIds(env, 'env');
  }

  const names = multi.data.environments.map(e => e.name).sort();
  assert.deepEqual(names, ['Outra Contabilidade', 'Sua Contabilidade LTDA'].sort());

  const pick = multi.data.environments.find(e => e.name === 'Sua Contabilidade LTDA');
  const chosen = await req('POST', '/api/auth/login/choose', {
    choice_token: multi.data.choice_token,
    key: pick.key
  });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
  assert.ok(chosen.data.token);
  assert.equal(chosen.data.user.tenant_id, ownerA.user.tenant_id);
});

test('16-18 nome CNPJ logo corretos no login', async () => {
  const r = await req('POST', '/api/auth/login', {
    email: 'owner.a.s362@test.local', password
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.office);
  assert.equal(r.data.office.name, 'Sua Contabilidade LTDA');
  assert.match(String(r.data.office.cnpj), /11\.222\.333\/0001-81|11222333000181/);
  assert.ok(r.data.office.logo_url);
  assert.match(r.data.office.logo_url, /\/api\/public\/branding\/logo\?tenant=/);
  assert.doesNotMatch(JSON.stringify(r.data.office), /tenant_id|codigo_cliente|company_id/);
});

test('19 codigo_cliente não é credencial', async () => {
  const code = companyA.codigo_cliente;
  assert.ok(code);
  const r1 = await req('POST', '/api/auth/login', { email: code, password });
  assert.equal(r1.status, 401);
  const r2 = await req('POST', '/api/auth/login', {
    email: 'owner.a.s362@test.local', password: code
  });
  assert.equal(r2.status, 401);
});

test('20 código do escritório não aparece na tela', () => {
  const js = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
  const loginFn = js.slice(js.indexOf('function login(){'), js.indexOf('const originLabel='));
  assert.doesNotMatch(loginFn, /Código do escritório/);
  assert.doesNotMatch(loginFn, /name=\"tenant\"|id=\"tenant\"/);
  assert.match(loginFn, /Acesse sua conta/);
  assert.match(loginFn, /Criar minha conta/);
  assert.match(loginFn, /Esqueci minha senha/);
  assert.match(loginFn, /Lembrar-me/);
  assert.match(loginFn, /login-hero-cds/);
  assert.match(loginFn, /login-hero-office/);
  assert.match(loginFn, /Escolha seu ambiente/);

  const portal = fs.readFileSync(path.join(root, 'frontend/public/portal/portal.js'), 'utf8');
  const portalLogin = portal.slice(portal.indexOf('function login(){'), portal.indexOf('async function render()'));
  assert.doesNotMatch(portalLogin, /Código do escritório/);
  assert.doesNotMatch(portalLogin, /name=\"tenant\"/);
  assert.doesNotMatch(portalLogin, /login-cds-fallback|cds-pwa-192/);
  assert.match(portalLogin, /Portal do cliente/);
  assert.match(portalLogin, /Esqueci minha senha/);
  assert.match(portalLogin, /Lembrar-me/);
  assert.match(portalLogin, /needs_environment_choice/);
  assert.match(portalLogin, /\/api\/public\/branding\?tenant=/);
  assert.match(portalLogin, /login-office-logo|loginOfficeBrandHtml/);
});

test('21 recuperação de senha continua funcionando', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/forgot-password', {
    email: 'client.s362@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(String(r.data.message || ''), /e-mail|instruções/i);
  assert.ok(sentMails.length >= 1);
});

test('22 Criar minha conta continua funcionando', async () => {
  const r = await req('POST', '/api/auth/signup', {
    office_name: 'Novo Escritório S362',
    cnpj: '55.666.777/0001-88',
    office_email: 'contato.s362novo@test.local',
    owner_name: 'Novo Owner',
    owner_email: 'novo.owner.s362@test.local',
    password
  });
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
  assert.match(String(r.data.message || ''), /e-mail|cadastro|verifique/i);
  const js = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /id=\"requestAccess\"|Criar minha conta/);
  assert.match(js, /\/api\/auth\/signup/);
});

test('23 Lembrar-me continua funcionando', () => {
  const js = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /ccc_last_email/);
  assert.match(js, /function rememberLogin/);
  assert.match(js, /Lembrar-me/);
  assert.doesNotMatch(js, /localStorage\.setItem\(['\"]ccc_.*password/);
});

test('24-26 desktop mobile overflow', () => {
  const css = fs.readFileSync(path.join(root, 'frontend/public/assets/theme.css'), 'utf8');
  assert.match(css, /\.login-shell\{[^}]*grid-template-columns/);
  assert.match(css, /login-hero-cds/);
  assert.match(css, /login-hero-office-logo/);
  assert.match(css, /@media \(max-width:860px\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /\.login-env-card/);
  assert.doesNotMatch(css, /#0d3b38|#14b8a6|#0f766e/i);
});

test('docs LOGIN-V2 presentes', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/LOGIN-V2.md'), 'utf8');
  assert.match(doc, /Login V2/i);
  assert.match(doc, /seleção de ambiente/i);
  assert.match(doc, /código do escritório/i);
  assert.match(doc, /tenant_id/);
});

test('integrity_check e foreign_key_check', () => {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  assert.equal(integrity.integrity_check, 'ok');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(fk.length, 0);
});
