'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const root = path.resolve(__dirname, '..');
const {
  loadConfig,
  resolveClientPort,
  isLocalhostUrl,
  assertProductionPublicUrl,
  assertProductionCors
} = require('../backend/src/config');

const prodBase = {
  NODE_ENV: 'production',
  JWT_SECRET: 'strong-production-secret-40',
  DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  DEMO_MODE: 'false',
  CDS_DB_PATH: path.join(os.tmpdir(), 'cds-s40-prod.db'),
  CDS_OFFICE_PUBLIC_URL: 'https://contabil.example.com',
  CDS_CORS_ORIGIN: 'https://contabil.example.com',
  CLIENT_PORT: '0',
  CDS_AUTH_COOKIE: 'true'
};

test('produção exige JWT_SECRET forte', () => {
  assert.throws(() => loadConfig({ ...prodBase, JWT_SECRET: '' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ ...prodBase, JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ ...prodBase, JWT_SECRET: 'troque-esta-chave-em-producao' }), /JWT_SECRET/);
});

test('produção exige DOCUMENT_ENCRYPTION_KEY', () => {
  assert.throws(() => loadConfig({ ...prodBase, DOCUMENT_ENCRYPTION_KEY: '' }), /DOCUMENT_ENCRYPTION_KEY/);
  assert.throws(() => loadConfig({ ...prodBase, DOCUMENT_ENCRYPTION_KEY: 'curta' }), /DOCUMENT_ENCRYPTION_KEY/);
});

test('DEMO_MODE não pode estar ativo em produção', () => {
  assert.throws(() => loadConfig({ ...prodBase, DEMO_MODE: 'true' }), /DEMO_MODE/);
});

test('CLIENT_PORT=0 é aceito', () => {
  const cfg = loadConfig({ ...prodBase, CLIENT_PORT: '0' });
  assert.equal(cfg.CLIENT_PORT, 0);
  assert.equal(resolveClientPort({ CLIENT_PORT: '0', PORT: '3333' }), 0);
  assert.equal(resolveClientPort({ CLIENT_PORT: '', PORT: '3333' }), 0);
});

test('localhost é rejeitado como URL pública de produção', () => {
  assert.equal(isLocalhostUrl('http://localhost:3333'), true);
  assert.equal(isLocalhostUrl('https://contabil.example.com'), false);
  assert.throws(() => assertProductionPublicUrl({ CDS_OFFICE_PUBLIC_URL: 'http://localhost:3333' }), /localhost/);
  assert.throws(() => loadConfig({ ...prodBase, CDS_OFFICE_PUBLIC_URL: 'http://127.0.0.1:3333' }), /localhost/);
});

test('CORS de produção não aceita wildcard', () => {
  assert.throws(() => assertProductionCors({ CDS_CORS_ORIGIN: '*' }), /wildcard|\*/);
  assert.throws(() => loadConfig({ ...prodBase, CDS_CORS_ORIGIN: '*' }), /wildcard|\*/);
  const ok = assertProductionCors({ CDS_CORS_ORIGIN: 'https://contabil.example.com' });
  assert.deepEqual(ok, ['https://contabil.example.com']);
});

test('DB_FILE não é utilizado', () => {
  const cfgSrc = fs.readFileSync(path.join(root, 'backend/src/config.js'), 'utf8');
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const prodExample = fs.readFileSync(path.join(root, '.env.production.example'), 'utf8');
  assert.doesNotMatch(cfgSrc, /DB_FILE/);
  assert.doesNotMatch(example, /DB_FILE=/);
  assert.doesNotMatch(prodExample, /DB_FILE=/);
});

test('AUTH_COOKIE pode ser ativado', () => {
  const cfg = loadConfig({ ...prodBase, CDS_AUTH_COOKIE: 'true' });
  assert.equal(cfg.AUTH_COOKIE, true);
  const off = loadConfig({ ...prodBase, CDS_AUTH_COOKIE: 'false' });
  assert.equal(off.AUTH_COOKIE, false);
});

test('preflight não imprime segredos', () => {
  const secret = 's40-secret-value-do-not-print-ABCDEF';
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: secret,
    DOCUMENT_ENCRYPTION_KEY: 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    CDS_OFFICE_PUBLIC_URL: 'https://contabil.example.com',
    CDS_CORS_ORIGIN: 'https://contabil.example.com',
    CDS_AUTH_COOKIE: 'true',
    CLIENT_PORT: '0',
    DEMO_MODE: 'false',
    CDS_EMAIL_PASSWORD: 'smtp-pass-should-not-appear'
  };
  const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts/preflight-production.js')], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  assert.match(out, /PASS|WARN|FAIL/);
  assert.doesNotMatch(out, /s40-secret-value-do-not-print-ABCDEF/);
  assert.doesNotMatch(out, /smtp-pass-should-not-appear/);
  assert.doesNotMatch(out, /yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy/);
});

test('desenvolvimento continua funcionando', () => {
  const cfg = loadConfig({
    NODE_ENV: 'development',
    JWT_SECRET: '',
    DOCUMENT_ENCRYPTION_KEY: '',
    CDS_DB_PATH: path.join(os.tmpdir(), 'cds-s40-dev.db'),
    CLIENT_PORT: '3334'
  });
  assert.equal(cfg.IS_PROD, false);
  assert.equal(cfg.CLIENT_PORT, 3334);
  assert.ok(cfg.JWT_SECRET);
  assert.ok(cfg.DOCUMENT_ENCRYPTION_KEY.length >= 32);
});

test('artefatos de produção existem', () => {
  assert.equal(fs.existsSync(path.join(root, '.env.production.example')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts/preflight-production.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts/build-production-package.js')), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['preflight:production'], 'node scripts/preflight-production.js');
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gi, /\.env\.\*/);
  assert.match(gi, /!\.env\.example/);
  assert.match(gi, /!\.env\.production\.example/);
  assert.match(gi, /database\/\*\*\/\*\.db|database\/\*\.db/);
});

test('health em produção não usa localhost como URL pública', () => {
  const src = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  assert.match(src, /function publicFrontUrls/);
  assert.match(src, /IS_PROD/);
  assert.match(src, /OFFICE_PUBLIC_URL|CDS_OFFICE_PUBLIC_URL/);
  assert.match(src, /\/api\/health/);
});
