'use strict';

/**
 * Sprint 40.2 — banco de produção limpo + onboarding em banco vazio.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s40-2-'));
const dbPath = path.join(tmp, 'production.db');
process.env.CDS_DB_PATH = dbPath;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-s40-2-strong-secret';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_APP_URL = 'http://app.test.local';
process.env.CDS_OFFICE_PUBLIC_URL = 'http://app.test.local';
process.env.NODE_ENV = 'development';

const {
  listMigrations,
  createFreshDatabase,
  runIntegrity,
  runForeignKeys,
  businessCounts,
  hasPilotResidue,
  missingEssentialTables,
  pilotDbPath,
  samePath
} = require('../scripts/lib/production-database');

const { createEmailProvider } = require('../backend/src/email/provider');
const { app, db, setEmailProvider } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let sentMails = [];
let ownerToken;
let tenantId;
let tenantSlug;

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
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

function tokenFromMail() {
  const last = sentMails[sentMails.length - 1];
  assert.ok(last, 'e-mail esperado');
  const blob = String((last && (last.text || last.html)) || '');
  const m = blob.match(/\/ativar-escritorio\/([a-f0-9]{64})/i);
  assert.ok(m, 'token no e-mail');
  return m[1];
}

before(async () => {
  assert.equal(samePath(dbPath, pilotDbPath()), false, 'teste não pode usar banco piloto');

  // Garante banco limpo criado pelas migrations (server já abriu via CDS_DB_PATH)
  const integrity = runIntegrity(db);
  assert.equal(integrity.ok, true, 'integrity');
  const fks = runForeignKeys(db);
  assert.equal(fks.ok, true, 'fk');
  assert.equal(missingEssentialTables(db).length, 0);
  assert.equal(hasPilotResidue(businessCounts(db)), null);

  setEmailProvider(createEmailProvider({
    send: async (mail) => {
      sentMails.push(mail);
      return { accepted: true, status: 'sent', email_sent: true };
    }
  }));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch {}
});

test('banco novo: migrations, integrity e sem dados piloto', () => {
  const migrations = listMigrations();
  assert.ok(migrations.includes('001_initial.sql'));
  assert.ok(migrations.includes('040_user_access_pin.sql'));
  assert.equal(migrations.length, 40);

  const counts = businessCounts(db);
  assert.equal(counts.tenants, 0);
  assert.equal(counts.users, 0);
  assert.equal(counts.companies, 0);
  assert.equal(counts.documents, 0);
  assert.equal(counts.entries, 0);
  assert.equal(counts.notifications, 0);
  assert.equal(counts.client_invitations, 0);
  assert.equal(counts.office_registrations, 0);
  assert.equal(hasPilotResidue(counts), null);

  const integrity = runIntegrity(db);
  assert.equal(integrity.ok, true);
  const fks = runForeignKeys(db);
  assert.equal(fks.ok, true);
});

test('scripts prepare/validate existem e protegem banco existente', () => {
  const prepare = fs.readFileSync(path.join(__dirname, '../scripts/prepare-production-database.js'), 'utf8');
  const validate = fs.readFileSync(path.join(__dirname, '../scripts/validate-production-database.js'), 'utf8');
  assert.match(prepare, /DATABASE_EXISTS|já existe/i);
  assert.match(prepare, /TARGET_IS_PILOT|piloto/i);
  assert.doesNotMatch(prepare, /DROP TABLE|DELETE FROM \*|TRUNCATE/i);
  assert.match(validate, /READY_FOR_FIRST_ONBOARDING/);
  assert.match(validate, /Development residue/);
});

test('onboarding: signup → token → confirm → TENANT + OWNER', async () => {
  sentMails = [];
  const signup = await req('POST', '/api/auth/signup', {
    office_name: 'Escritório Produção 40.2',
    cnpj: '11.222.333/0001-81',
    office_email: 'contato@s402.local',
    owner_name: 'Owner Prod 40.2',
    owner_email: 'owner.s402@test.local',
    password
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tenants').get().n, 0);
  assert.equal(db.prepare("SELECT status FROM office_registrations WHERE owner_email=?").get('owner.s402@test.local').status, 'PENDING');

  const tok = tokenFromMail();
  const peek = await req('GET', '/api/auth/signup/' + tok);
  assert.equal(peek.status, 200);
  assert.equal(peek.data.status, 'PENDING');

  const conf = await req('POST', '/api/auth/signup/' + tok + '/confirm', {});
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.role, 'OWNER');
  assert.ok(conf.data.tenant_id);
  assert.ok(conf.data.tenant_slug);
  tenantId = conf.data.tenant_id;
  tenantSlug = conf.data.tenant_slug;

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(conf.data.user_id);
  assert.equal(user.role, 'OWNER');
  assert.equal(user.tenant_id, tenantId);
  assert.equal(user.company_id, null);
});

test('login e dashboard após onboarding', async () => {
  const login = await req('POST', '/api/auth/login', {
    email: 'owner.s402@test.local',
    password,
    tenant: tenantSlug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.role, 'OWNER');
  ownerToken = login.data.token;

  const dash = await req('GET', '/api/dashboard', undefined, ownerToken);
  assert.equal(dash.status, 200, JSON.stringify(dash.data));
  assert.ok(dash.data);
});

test('isolamento: segundo tenant não vê dados do primeiro', async () => {
  sentMails = [];
  const signup = await req('POST', '/api/auth/signup', {
    office_name: 'Outro Escritório 40.2',
    cnpj: '00.000.000/0001-91',
    office_email: 'contato2@s402.local',
    owner_name: 'Owner B 40.2',
    owner_email: 'owner.b.s402@test.local',
    password
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const tok = tokenFromMail();
  const conf = await req('POST', '/api/auth/signup/' + tok + '/confirm', {});
  assert.equal(conf.status, 200);

  const loginB = await req('POST', '/api/auth/login', {
    email: 'owner.b.s402@test.local',
    password,
    tenant: conf.data.tenant_slug
  });
  assert.equal(loginB.status, 200);

  const companiesA = await req('GET', '/api/empresas?page=1&page_size=50', undefined, ownerToken);
  const companiesB = await req('GET', '/api/empresas?page=1&page_size=50', undefined, loginB.data.token);
  assert.equal(companiesA.status, 200);
  assert.equal(companiesB.status, 200);
  const idsA = new Set((companiesA.data.items || companiesA.data || []).map((x) => x.id));
  for (const c of (companiesB.data.items || companiesB.data || [])) {
    assert.equal(idsA.has(c.id), false);
  }

  const cross = await req('POST', '/api/auth/login', {
    email: 'owner.s402@test.local',
    password,
    tenant: conf.data.tenant_slug
  });
  assert.equal(cross.status, 401);
});

test('segurança: CLIENT não acessa endpoints administrativos', async () => {
  const company = await req('POST', '/api/empresas', {
    name: 'Empresa Cliente 40.2',
    trade_name: 'Emp402',
    cnpj: '33.000.167/0001-01',
    status: 'ACTIVE'
  }, ownerToken);
  assert.equal(company.status, 201, JSON.stringify(company.data));

  const invite = await req('POST', `/api/empresas/${company.data.id}/users`, {
    name: 'Cliente 40.2',
    email: 'cliente.s402@test.local',
    profile: 'CLIENT_VIEWER'
  }, ownerToken);
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const url = invite.data.invitation && invite.data.invitation.activation_url;
  assert.ok(url);
  const tok = url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    name: 'Cliente 40.2',
    password,
    confirmation: password
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  const clientToken = acc.data.token;

  const admin = await req('GET', '/api/empresas', undefined, clientToken);
  assert.equal(admin.status, 403);
  const dash = await req('GET', '/api/dashboard', undefined, clientToken);
  assert.equal(dash.status, 403);
});

test('createFreshDatabase recusa caminho existente', () => {
  assert.throws(() => createFreshDatabase(dbPath), /DATABASE_EXISTS/);
});

test('documentação e npm scripts de produção', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['prepare:production-db'], 'node scripts/prepare-production-database.js');
  assert.equal(pkg.scripts['validate:production-db'], 'node scripts/validate-production-database.js');
  assert.equal(fs.existsSync(path.join(__dirname, '../docs/PRODUCAO-BANCO.md')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../docs/PRODUCAO-SECRETS.md')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../docs/DEPLOY-PRODUCAO.md')), true);
});
