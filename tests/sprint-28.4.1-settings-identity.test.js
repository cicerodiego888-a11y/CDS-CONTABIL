'use strict';

/**
 * Sprint 28.4.1 — Centro de Configurações + identidade visual preto/vermelho.
 * Não altera APIs, NotificationService, IA, tenant branding ou isolamento.
 */
const path = require('path');
const fs = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const TEAL = [
  '#0f5f59', '#0c4d48', '#2a9d8f', '#0d3b38', '#144845',
  '#1a5c57', '#8fb3ae', '#7fd4c7', '#0f3d3a', '#164f4a', '#e7f4f2'
];

const runtimeFiles = [
  'frontend/public/assets/tokens.css',
  'frontend/public/assets/app.css',
  'frontend/public/assets/theme.css',
  'frontend/public/assets/admin.css',
  'frontend/public/portal/portal.css',
  'frontend/public/assets/password-toggle.css',
  'frontend/public/assets/request-chat.css',
  'frontend/public/assets/smart-expense.css',
  'frontend/public/assets/app.js',
  'frontend/public/portal/portal.js',
  'frontend/public/index.html',
  'frontend/public/portal/index.html',
  'frontend/public/manifest.webmanifest',
  'frontend/public/portal/manifest.webmanifest'
];

test('Centro de Configurações existe com seções internas', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /settings-hub/);
  assert.match(js, /Administre as configurações do escritório e do sistema/);
  for (const section of ['geral', 'identidade', 'equipe', 'notificacoes', 'comunicacoes', 'ia', 'sistema']) {
    assert.match(js, new RegExp(`\\['${section}'`));
  }
  assert.match(js, /data-settings-section=/);
  assert.match(js, /settingsNavHtml/);
  assert.match(js, /settingsSectionSelect/);
  assert.doesNotMatch(js, /Identidade do escritório e dados da conta/);
});

test('Geral, Identidade, Equipe, Comunicações, IA e Sistema não duplicam módulos', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /<h3>Conta<\/h3>/);
  assert.match(js, /Identidade do [Ee]scritório/);
  assert.match(js, /Gerenciar equipe/);
  assert.match(js, /openExistingPage\('usuarios'\)/);
  assert.match(js, /Configuração de e-mail/);
  assert.match(js, /Configuração de WhatsApp/);
  assert.match(js, /openExistingPage\('comunicacoes'/);
  assert.match(js, /Configurar Inteligência Artificial/);
  assert.match(js, /openExistingPage\('ia'\)/);
  assert.match(js, /openExistingPage\('auditoria'\)/);
  assert.match(js, /\/ai\/usage\/summary/);
  assert.doesNotMatch(js, /<h3>Avançadas<\/h3>/);
});

test('Notificações do hub usam o motor existente (/api/push/prefs)', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /\/push\/prefs/);
  assert.match(js, /visual_enabled/);
  assert.match(js, /push_enabled/);
  assert.match(js, /sound_enabled/);
  assert.match(js, /requests_enabled/);
  assert.match(js, /CdsPush\.subscribePush/);
  const svc = read('backend/src/notifications/service.js');
  assert.match(svc, /function createNotificationService|createNotificationService/);
  const server = read('backend/src/server.js');
  assert.match(server, /notificationService/);
});

test('Tenant Branding permanece nas APIs e permissões existentes', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /\/tenant\/branding\/logo/);
  assert.match(js, /method:'PATCH'/);
  assert.match(js, /OWNER','ACCOUNTANT'/);
  assert.match(js, /login-office-logo/);
  const portal = read('frontend/public/portal/portal.js');
  assert.match(portal, /\/client\/branding/);
  assert.doesNotMatch(portal, /pickLogo|brandForm/);
});

test('IA do hub resume GPT-5.6 Terra e abre tela existente', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /GPT-5\.6 Terra/);
  assert.match(js, /aiSettingsPage/);
  assert.match(js, /\/ai\/credentials/);
});

test('Design tokens centralizam preto/vermelho/branco/cinza', () => {
  const tokens = read('frontend/public/assets/tokens.css');
  assert.match(tokens, /--color-primary:#C8102E/i);
  assert.match(tokens, /--color-sidebar:#111111/i);
  assert.match(tokens, /--color-background:#F7F7F8/i);
  assert.match(tokens, /--color-surface:#FFFFFF/i);
  assert.doesNotMatch(tokens, /#0f5f59/i);
});

test('runtime frontend não usa teal como identidade', () => {
  for (const file of runtimeFiles) {
    const text = read(file);
    for (const hex of TEAL) {
      assert.equal(
        text.toLowerCase().includes(hex.toLowerCase()),
        false,
        `${file} ainda contém ${hex}`
      );
    }
  }
});

test('cache bust s28-4-2 nos assets alterados', () => {
  const office = read('frontend/public/index.html');
  const portal = read('frontend/public/portal/index.html');
  assert.match(office, /tokens\.css\?v=s28-4-2/);
  assert.match(office, /theme\.css\?v=s28-4-2/);
  assert.match(office, /app\.css\?v=s28-4-2/);
  assert.match(office, /app\.js\?v=s28-4-2/);
  assert.match(portal, /portal\.css\?v=s28-4-2/);
  assert.match(portal, /portal\.js\?v=s28-4-2/);
});
