'use strict';

/**
 * Sprint 40.3 — artefatos de infraestrutura de deploy (sem VPS real).
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('documentação de deploy/backup/secrets existe', () => {
  for (const f of [
    'docs/DEPLOY-PRODUCAO.md',
    'docs/BACKUP-PRODUCAO.md',
    'docs/PRODUCAO-SECRETS.md',
    'docs/PRODUCAO-BANCO.md'
  ]) {
    assert.equal(fs.existsSync(path.join(root, f)), true, f);
  }
  const deploy = fs.readFileSync(path.join(root, 'docs/DEPLOY-PRODUCAO.md'), 'utf8');
  assert.match(deploy, /CLIENT_PORT=0/);
  assert.match(deploy, /CDS_AUTH_COOKIE=true/);
  assert.match(deploy, /CONFIGURAÇÃO DEPENDENTE DO PROVEDOR/);
  assert.match(deploy, /Node\.js.*20/i);
  assert.doesNotMatch(deploy, /Hostinger|DigitalOcean|AWS|Contabo|Hetzner/i);
});

test('templates nginx e systemd existem e não expõem segredos', () => {
  const nginx = fs.readFileSync(path.join(root, 'deploy/nginx/cds-contabil.conf.example'), 'utf8');
  const unit = fs.readFileSync(path.join(root, 'deploy/systemd/cds-contabil.service.example'), 'utf8');
  assert.match(nginx, /X-Forwarded-Proto/);
  assert.match(nginx, /return 301 https/);
  assert.match(nginx, /proxy_pass/);
  assert.match(unit, /EnvironmentFile=/);
  assert.match(unit, /Restart=on-failure/);
  assert.doesNotMatch(nginx + unit, /JWT_SECRET=|DOCUMENT_ENCRYPTION_KEY=|PASSWORD=/);
});

test('npm scripts de smoke e package check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['smoke:production'], 'node scripts/smoke-production.js');
  assert.equal(pkg.scripts['check:production-package'], 'node scripts/check-production-package.js');
});

test('smoke sem URL pública falha de forma controlada', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts/smoke-production.js')], {
    cwd: root,
    env: { ...process.env, PRODUCTION_BASE_URL: '' },
    encoding: 'utf8'
  });
  assert.notEqual(r.status, 0);
  const out = String(r.stdout || '') + String(r.stderr || '');
  assert.match(out, /FAIL|BLOCKED/);
  assert.doesNotMatch(out, /JWT_SECRET|DOCUMENT_ENCRYPTION_KEY|dbrx/);
});

test('README exige Node 20+', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /Node\.js 20\+/);
});
