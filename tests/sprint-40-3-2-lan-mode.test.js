'use strict';

/**
 * Sprint 40.3.2 — CDS_NETWORK_MODE local|lan (teste LAN controlado).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const {
  resolveNetworkMode,
  listenHost,
  listPrivateIPv4,
  isPrivateIPv4,
  isProductionDatabasePath,
  assertLanAllowed,
  formatLanBanner
} = require('../backend/src/network-mode');
const { loadConfig } = require('../backend/src/config');

const prodBase = {
  NODE_ENV: 'production',
  JWT_SECRET: 'strong-production-secret-40x',
  DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  DEMO_MODE: 'false',
  CDS_DB_PATH: path.join(os.tmpdir(), 'cds-s4032-prod.db'),
  CDS_OFFICE_PUBLIC_URL: 'https://contabil.example.com',
  CDS_CORS_ORIGIN: 'https://contabil.example.com',
  CLIENT_PORT: '0',
  CDS_AUTH_COOKIE: 'true',
  CDS_NETWORK_MODE: 'local'
};

test('default continua local', () => {
  assert.equal(resolveNetworkMode({}), 'local');
  assert.equal(resolveNetworkMode({ CDS_NETWORK_MODE: '' }), 'local');
  assert.equal(listenHost('local'), undefined);
  const cfg = loadConfig({
    NODE_ENV: 'development',
    CDS_DB_PATH: path.join(os.tmpdir(), 'cds-s4032-def.db'),
    JWT_SECRET: 'x'
  });
  assert.equal(cfg.NETWORK_MODE, 'local');
});

test('CDS_NETWORK_MODE=local mantém comportamento atual', () => {
  assert.equal(resolveNetworkMode({ CDS_NETWORK_MODE: 'local' }), 'local');
  assert.equal(listenHost('local'), undefined);
  const src = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  assert.match(src, /listenHost\(NETWORK_MODE\)/);
  assert.match(src, /else app\.listen\(PORT,startErr\)/);
});

test('CDS_NETWORK_MODE=lan habilita bind LAN', () => {
  assert.equal(resolveNetworkMode({ CDS_NETWORK_MODE: 'lan' }), 'lan');
  assert.equal(listenHost('lan'), '0.0.0.0');
  const cfg = loadConfig({
    NODE_ENV: 'development',
    CDS_NETWORK_MODE: 'lan',
    CDS_DB_PATH: path.join(os.tmpdir(), 'cds-s4032-lan.db'),
    JWT_SECRET: 'x'
  });
  assert.equal(cfg.NETWORK_MODE, 'lan');
});

test('LAN não pode iniciar com NODE_ENV=production', () => {
  assert.throws(
    () => assertLanAllowed({
      networkMode: 'lan',
      isProd: true,
      dbPath: path.join(os.tmpdir(), 'x.db'),
      root
    }),
    /LAN MODE IS NOT ALLOWED IN PRODUCTION/
  );
  assert.throws(
    () => loadConfig({ ...prodBase, CDS_NETWORK_MODE: 'lan' }),
    /LAN MODE IS NOT ALLOWED IN PRODUCTION/
  );
});

test('LAN não pode utilizar banco de produção', () => {
  const prodDb = path.join(root, 'database', 'production', 'cds-contabil-connect.db');
  assert.equal(isProductionDatabasePath(prodDb, root), true);
  assert.equal(isProductionDatabasePath(path.join(root, 'database', 'cds-contabil-connect.db'), root), false);
  assert.throws(
    () => assertLanAllowed({
      networkMode: 'lan',
      isProd: false,
      dbPath: prodDb,
      root
    }),
    /LAN MODE CANNOT USE PRODUCTION DATABASE/
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      CDS_NETWORK_MODE: 'lan',
      CDS_DB_PATH: prodDb,
      JWT_SECRET: 'x'
    }),
    /LAN MODE CANNOT USE PRODUCTION DATABASE/
  );
});

test('produção continua aceitando somente configuração local', () => {
  const cfg = loadConfig(prodBase);
  assert.equal(cfg.IS_PROD, true);
  assert.equal(cfg.NETWORK_MODE, 'local');
  assert.equal(listenHost(cfg.NETWORK_MODE), undefined);
});

test('descoberta do IPv4 privado funciona', () => {
  assert.equal(isPrivateIPv4('192.168.1.10'), true);
  assert.equal(isPrivateIPv4('10.0.0.5'), true);
  assert.equal(isPrivateIPv4('172.16.0.2'), true);
  assert.equal(isPrivateIPv4('127.0.0.1'), false);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  const fake = {
    eth0: [
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: '192.168.0.42', family: 'IPv4', internal: false },
      { address: '8.8.8.8', family: 'IPv4', internal: false }
    ],
    wifi: [
      { address: '10.1.2.3', family: 4, internal: false }
    ]
  };
  assert.deepEqual(listPrivateIPv4(fake), ['192.168.0.42', '10.1.2.3']);
  assert.ok(Array.isArray(listPrivateIPv4()));
});

test('banner LAN é exibido', () => {
  const banner = formatLanBanner({
    port: 3333,
    clientPort: 0,
    ips: ['192.168.1.50']
  });
  assert.match(banner, /TESTE LAN/);
  assert.match(banner, /MODO: LAN \/ TESTE/);
  assert.match(banner, /BANCO: PILOTO\/LOCAL/);
  assert.match(banner, /http:\/\/localhost:3333/);
  assert.match(banner, /http:\/\/192\.168\.1\.50:3333/);
  const src = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  assert.match(src, /formatLanBanner/);
  assert.match(src, /NETWORK_MODE==='lan'/);
});

test('artefatos e docs LAN sem CORS aberto', () => {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(example, /CDS_NETWORK_MODE=local/);
  assert.match(example, /lan = permite teste/);
  const prodEx = fs.readFileSync(path.join(root, '.env.production.example'), 'utf8');
  assert.match(prodEx, /CDS_NETWORK_MODE=local/);
  assert.doesNotMatch(prodEx, /CDS_NETWORK_MODE=lan/);
  assert.equal(fs.existsSync(path.join(root, 'docs/LAN-TESTE.md')), true);
  const docs = fs.readFileSync(path.join(root, 'docs/LAN-TESTE.md'), 'utf8');
  assert.match(docs, /Firewall/i);
  assert.match(docs, /rede privada/i);
  assert.doesNotMatch(docs, /CORS \*|CORS="\*"/);
  const nm = fs.readFileSync(path.join(root, 'backend/src/network-mode.js'), 'utf8');
  assert.doesNotMatch(nm, /CORS/);
});

test('modo inválido é rejeitado', () => {
  assert.throws(() => resolveNetworkMode({ CDS_NETWORK_MODE: 'public' }), /CDS_NETWORK_MODE/);
});
