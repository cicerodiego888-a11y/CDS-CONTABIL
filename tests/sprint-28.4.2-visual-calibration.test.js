'use strict';

/**
 * Sprint 28.4.2 — Calibração visual (preto + vinho + vermelho).
 * Sem alteração de APIs, migrations, motores ou Tenant Branding.
 */
const path = require('path');
const fs = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const TEAL = [
  '#0f5f59', '#0c4d48', '#2a9d8f', '#0d3b38', '#144845', '#1a5c57'
];

const runtimeFiles = [
  'frontend/public/assets/tokens.css',
  'frontend/public/assets/app.css',
  'frontend/public/assets/theme.css',
  'frontend/public/assets/admin.css',
  'frontend/public/portal/portal.css',
  'frontend/public/assets/document-viewer.css',
  'frontend/public/assets/app.js',
  'frontend/public/portal/portal.js',
  'frontend/public/index.html',
  'frontend/public/portal/index.html'
];

test('tokens descrevem sidebar em camadas preto/vinho/vermelho', () => {
  const tokens = read('frontend/public/assets/tokens.css');
  assert.match(tokens, /--color-primary:#C8102E/i);
  assert.match(tokens, /--color-primary-hover:#A00D25/i);
  assert.match(tokens, /--color-sidebar-gradient-start:#111111/i);
  assert.match(tokens, /--color-sidebar-gradient-end:#4A050D/i);
  assert.match(tokens, /--color-sidebar-active:#C8102E/i);
  assert.match(tokens, /--color-accent:#C8102E/i);
  assert.doesNotMatch(tokens, /#0f5f59/i);
});

test('sidebar usa gradiente e item ativo integrado, não bloco chapado', () => {
  const theme = read('frontend/public/assets/theme.css');
  assert.match(theme, /linear-gradient\(160deg,var\(--color-sidebar-gradient-start\)/);
  assert.match(theme, /radial-gradient\(120% 70% at 8% 118%,var\(--color-sidebar-glow\)/);
  assert.match(theme, /\.menu-item\.active\{background:linear-gradient\(90deg,var\(--color-sidebar-active\)/);
  assert.match(theme, /\.avatar\{background:linear-gradient\(160deg,var\(--color-avatar-from\)/);
  assert.match(theme, /\.profile-card\{background:var\(--color-sidebar-card\)/);
  assert.doesNotMatch(theme, /\.side\{background:var\(--color-sidebar\);color/);
});

test('portal e login compartilham a mesma linguagem visual', () => {
  const portal = read('frontend/public/portal/portal.css');
  assert.match(portal, /linear-gradient\(160deg,var\(--color-sidebar-gradient-start\)/);
  assert.match(portal, /\.nav-links button\.active\{background:linear-gradient\(90deg,var\(--color-sidebar-active\)/);
  const theme = read('frontend/public/assets/theme.css');
  assert.match(theme, /\.login-hero\{[^}]*linear-gradient\(160deg,var\(--color-sidebar-gradient-start\)/);
});

test('rotas e branding da sidebar permanecem', () => {
  const js = read('frontend/public/assets/app.js');
  for (const label of ['Início', 'Empresas', 'Processos', 'Documentos', 'Pendências', 'Solicitações', 'Recolher menu', 'Sair do sistema']) {
    assert.match(js, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(js, /\/tenant\/branding/);
  assert.match(js, /login-office-logo/);
});

test('runtime não usa teal como identidade', () => {
  for (const file of runtimeFiles) {
    const text = read(file);
    for (const hex of TEAL) {
      assert.equal(text.toLowerCase().includes(hex.toLowerCase()), false, `${file} contém ${hex}`);
    }
    assert.equal(text.includes('rgba(13,59,56'), false, `${file} contém overlay teal`);
  }
});

test('cache bust s36-2 login', () => {
  const office = read('frontend/public/index.html');
  const portal = read('frontend/public/portal/index.html');
  assert.match(office, /tokens\.css\?v=s40-modal/);
  assert.match(office, /theme\.css\?v=s40-doc-preview/);
  assert.match(office, /app\.css\?v=s36-2/);
  assert.match(office, /app\.js\?v=s40-doc-preview/);
  assert.match(portal, /portal\.css\?v=s40-login/);
  assert.match(portal, /portal\.js\?v=s40-login/);
});

test('nenhuma migration de negócio nesta sprint', () => {
  assert.equal(fs.existsSync(path.join(root, 'database/schema/035_visual_calibration.sql')), false);
});
