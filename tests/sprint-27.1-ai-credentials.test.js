'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s271-'));
process.env.CDS_DB_PATH = path.join(tmp, 's271.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-27-1-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.AI_MODEL = 'gpt-5.6-terra';
delete process.env.OPENAI_API_KEY;

const {
  app, db, config, aiCredentialService, aiControlService,
  setAiCredentialTestConnection, refreshAccountingAIProvider
} = require('../backend/src/server');
const { loadConfig, resolveAiCredentialKey, DEV_AI_CRED_KEY } = require('../backend/src/config');
const { encryptApiKey } = require('../backend/src/ai-credentials/crypto');

const password = 'Senha@123';
const VALID_KEY = 'sk-test-valid-key-aaaaaaaaaaaaaaaa';
const INVALID_KEY = 'sk-test-invalid-key-bbbbbbbbbbbbbbbb';
let server, base, ownerA, accountantA, staffA, clientA, companyA;
let testCalls = [];
let acceptKeys = new Set([VALID_KEY]);

before(async () => {
  setAiCredentialTestConnection(async ({ apiKey }) => {
    testCalls.push(apiKey);
    if (!acceptKeys.has(apiKey)) {
      const error = new Error('Credencial rejeitada pelo provedor.');
      error.code = 'AI_CREDENTIAL_INVALID';
      error.http = 401;
      throw error;
    }
    return { ok: true, provider: 'openai', model: 'gpt-5.6-terra' };
  });

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await req('POST', '/api/auth/register', {
    name: 'Escritório 27.1', email: 'owner271@test.local', password, tenantName: 'Tenant 27.1'
  });
  assert.ok([200, 201].includes(tenant.status), JSON.stringify(tenant.data));
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner271@test.local', password, tenant: tenant.data.tenant_slug
  })).data;

  const accInvite = await req('POST', '/api/usuarios', {
    name: 'Contador', email: 'acc271@test.local', role: 'ACCOUNTANT', password
  }, ownerA.token);
  assert.ok([200, 201].includes(accInvite.status), JSON.stringify(accInvite.data));
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc271@test.local', password, tenant: tenant.data.tenant_slug
  })).data;

  const staffInvite = await req('POST', '/api/usuarios', {
    name: 'Staff', email: 'staff271@test.local', role: 'STAFF', password
  }, ownerA.token);
  assert.ok([200, 201].includes(staffInvite.status), JSON.stringify(staffInvite.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff271@test.local', password, tenant: tenant.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa 27', cnpj: '38204469000115'
  }, ownerA.token)).data;
  assert.ok(companyA && companyA.id, JSON.stringify(companyA));

  const invite = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente', email: 'client271@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  assert.ok(invite.data && invite.data.invitation, JSON.stringify(invite.data));
  const token = invite.data.invitation.activation_url.split('/convite/')[1];
  clientA = (await req('POST', `/api/invitations/${token}/accept`, {
    name: 'Cliente', password, confirmation: password
  })).data;
});

after(async () => {
  setAiCredentialTestConnection(null);
  await new Promise(resolve => server.close(resolve));
});

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async response => {
    let data = null; try { data = await response.json(); } catch {}
    return { status: response.status, data };
  });
}

function clearVault() {
  db.prepare('DELETE FROM ai_provider_credentials').run();
  refreshAccountingAIProvider();
}

function vaultRow() {
  return db.prepare('SELECT * FROM ai_provider_credentials WHERE provider=?').get('openai');
}

function assertNoSecret(payload) {
  const blob = JSON.stringify(payload || {});
  assert.doesNotMatch(blob, /sk-test-/);
  assert.doesNotMatch(blob, /OPENAI_API_KEY/);
  assert.doesNotMatch(blob, /AI_CREDENTIAL_ENCRYPTION_KEY/);
  assert.doesNotMatch(blob, /Authorization/);
  assert.doesNotMatch(blob, /Bearer /);
}

test('1-3 cria credencial criptografada sem plaintext no banco', async () => {
  clearVault();
  testCalls = [];
  const save = await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal(save.data.credential_configured, true);
  assert.equal(save.data.credential_source, 'vault');
  assert.equal(save.data.provider, 'openai');
  assert.equal(save.data.provider_model || save.data.model || config.AI_MODEL, 'gpt-5.6-terra');
  assertNoSecret(save.data);

  const row = vaultRow();
  assert.ok(row);
  assert.ok(row.encrypted_api_key);
  assert.notEqual(row.encrypted_api_key, VALID_KEY);
  assert.equal(String(row.encrypted_api_key).includes(VALID_KEY), false);
  const dump = JSON.stringify(row);
  assert.doesNotMatch(dump, new RegExp(VALID_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(row.last4, VALID_KEY.slice(-4));
  assert.equal(testCalls.length, 1);
});

test('4-5 GET settings e test não retornam chave', async () => {
  const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assert.equal(settings.status, 200);
  assert.equal(settings.data.credential_configured, true);
  assert.equal(settings.data.credential_source, 'vault');
  assert.equal(settings.data.provider_configured, true);
  assertNoSecret(settings.data);

  const tested = await req('POST', '/api/ai/credentials/test', {}, ownerA.token);
  assert.equal(tested.status, 200);
  assert.equal(tested.data.status, 'connected');
  assert.equal(tested.data.model, 'gpt-5.6-terra');
  assertNoSecret(tested.data);
});

test('6-7-24 alteração: chave inválida não substitui válida', async () => {
  clearVault();
  acceptKeys = new Set([VALID_KEY]);
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  const before = vaultRow();
  const fail = await req('PUT', '/api/ai/credentials', { api_key: INVALID_KEY }, ownerA.token);
  assert.equal(fail.status, 422);
  assert.match(fail.data.message || '', /permanece inalterada|validar/i);
  assertNoSecret(fail.data);

  const after = vaultRow();
  assert.equal(after.encrypted_api_key, before.encrypted_api_key);
  assert.equal(after.last4, before.last4);
});

test('6 alteração de chave válida', async () => {
  clearVault();
  const nextKey = 'sk-test-valid-key-dddddddddddddddd';
  acceptKeys = new Set([VALID_KEY, nextKey]);
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  const before = vaultRow();
  const rotate = await req('PUT', '/api/ai/credentials', { api_key: nextKey }, ownerA.token);
  assert.equal(rotate.status, 200);
  const after = vaultRow();
  assert.notEqual(after.encrypted_api_key, before.encrypted_api_key);
  assert.equal(after.last4, 'dddd');
  assert.ok(Number(after.key_version) >= Number(before.key_version));
});

test('8-9-25 remoção e fallback para .env', async () => {
  clearVault();
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  const removed = await req('DELETE', '/api/ai/credentials', undefined, ownerA.token);
  assert.equal(removed.status, 200);
  assert.equal(vaultRow(), undefined);

  config.AI_PROVIDER = 'openai';
  config.OPENAI_API_KEY = 'sk-env-fallback-key-eeeeeeeeeeee';
  refreshAccountingAIProvider();
  const status = await req('GET', '/api/ai/credentials', undefined, ownerA.token);
  assert.equal(status.data.credential_configured, true);
  assert.equal(status.data.credential_source, 'env');
  assertNoSecret(status.data);

  config.OPENAI_API_KEY = '';
  config.AI_PROVIDER = 'off';
  refreshAccountingAIProvider();
  const empty = await req('GET', '/api/ai/credentials', undefined, ownerA.token);
  assert.equal(empty.data.credential_configured, false);
  assert.equal(empty.data.provider_configured, false);
});

test('10 Cofre tem prioridade sobre .env', async () => {
  clearVault();
  config.AI_PROVIDER = 'openai';
  config.OPENAI_API_KEY = 'sk-env-should-not-win-ffffffffffff';
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  const resolved = aiCredentialService.resolveApiKey();
  assert.equal(resolved.source, 'vault');
  assert.equal(resolved.apiKey, VALID_KEY);
  config.OPENAI_API_KEY = '';
  config.AI_PROVIDER = 'off';
});

test('11 AI disabled bloqueia uso do tenant', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: false }, ownerA.token);
  const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assert.equal(settings.data.enabled, false);
  assert.equal(aiControlService.availability(ownerA.user.tenant_id).available, false);
});

test('12-13 CLIENT e STAFF não alteram credencial', async () => {
  const clientTry = await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, clientA.token);
  assert.ok([401, 403].includes(clientTry.status));

  const staffTry = await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, staffA.token);
  assert.equal(staffTry.status, 403);

  const staffGet = await req('GET', '/api/ai/credentials', undefined, staffA.token);
  assert.equal(staffGet.status, 200);
  assertNoSecret(staffGet.data);
});

test('14-15 auditoria criada sem segredo', async () => {
  clearVault();
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, accountantA.token);
  await req('POST', '/api/ai/credentials/test', {}, accountantA.token);
  await req('DELETE', '/api/ai/credentials', undefined, accountantA.token);

  const logs = db.prepare(
    `SELECT action, after_json FROM audit_logs
     WHERE tenant_id=? AND entity_type='AI_CREDENTIAL'
     ORDER BY created_at`
  ).all(ownerA.user.tenant_id);
  const actions = logs.map(x => x.action);
  assert.ok(actions.includes('AI_CREDENTIAL_CREATED'));
  assert.ok(actions.includes('AI_CREDENTIAL_TESTED'));
  assert.ok(actions.includes('AI_CREDENTIAL_REMOVED'));
  for (const log of logs) assertNoSecret(log.after_json);
});

test('16 master key ausente em production com cofre falha', () => {
  clearVault();
  const enc = encryptApiKey(VALID_KEY, config.AI_CREDENTIAL_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO ai_provider_credentials(
       id,provider,encrypted_api_key,key_iv,key_tag,key_salt,key_version,last4,status
     ) VALUES(?,?,?,?,?,?,1,?,'configured')`
  ).run('cred-prod', 'openai', enc.encrypted_api_key, enc.key_iv, enc.key_tag, enc.key_salt, 'aaaa');

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'strong-production-secret',
      DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      AI_CREDENTIAL_ENCRYPTION_KEY: 'short',
      DEMO_MODE: 'false',
      CDS_DB_PATH: path.join(tmp, 'prod.db'),
      CDS_OFFICE_PUBLIC_URL: 'https://app.example.com',
      CDS_CORS_ORIGIN: 'https://app.example.com',
      CLIENT_PORT: '0'
    }),
    /AI_CREDENTIAL_ENCRYPTION_KEY/
  );

  const prev = config.AI_CREDENTIAL_ENCRYPTION_KEY;
  const prevProd = config.IS_PROD;
  config.AI_CREDENTIAL_ENCRYPTION_KEY = '';
  config.IS_PROD = true;
  assert.throws(() => aiCredentialService.resolveApiKey(), /AI_CREDENTIAL/);
  config.AI_CREDENTIAL_ENCRYPTION_KEY = prev;
  config.IS_PROD = prevProd;
  clearVault();
});

test('17-18 master key e API Key não aparecem em response/logs UI', async () => {
  clearVault();
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assertNoSecret(settings.data);
  assert.doesNotMatch(JSON.stringify(settings.data), new RegExp(DEV_AI_CRED_KEY));
  assert.doesNotMatch(JSON.stringify(settings.data), /test-ai-credential-encryption/);

  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /Configurar chave|Alterar chave/);
  assert.match(js, /Testar conexão/);
  assert.doesNotMatch(js, /Ver chave|Mostrar chave/);
  assert.doesNotMatch(js, /OPENAI_API_KEY\s*=/);
  assert.match(js, /Avançadas/);
  assert.match(js, /openAiAdvanced|Inteligência Artificial/);
});

test('19-21 provider OpenAI, modelo terra, resolução só no backend', async () => {
  clearVault();
  await req('PUT', '/api/ai/credentials', { api_key: VALID_KEY }, ownerA.token);
  const resolved = aiCredentialService.resolveApiKey();
  assert.equal(resolved.apiKey, VALID_KEY);
  assert.equal(resolved.source, 'vault');
  assert.equal(config.AI_MODEL, 'gpt-5.6-terra');
  const status = aiCredentialService.publicStatus();
  assert.equal(status.provider, 'openai');
  assert.equal(status.provider_model, 'gpt-5.6-terra');
});

test('22-23 conexão bem-sucedida e inválida', async () => {
  clearVault();
  const ok = await req('POST', '/api/ai/credentials/test', { api_key: VALID_KEY }, ownerA.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'connected');

  const bad = await req('POST', '/api/ai/credentials/test', { api_key: INVALID_KEY }, ownerA.token);
  assert.equal(bad.status, 422);
  assertNoSecret(bad.data);
});

test('resolveAiCredentialKey usa fallback de desenvolvimento', () => {
  const key = resolveAiCredentialKey({ NODE_ENV: 'development' }, false);
  assert.equal(key, DEV_AI_CRED_KEY);
});
