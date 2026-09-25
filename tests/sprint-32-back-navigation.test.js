'use strict';

/**
 * Sprint 32 — navegação de retorno central (CdsBackNav).
 */
const fs = require('fs');
const path = require('path');
const { test, beforeEach } = require('node:test');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
const navPath = path.join(root, 'frontend/public/assets/back-navigation.js');
const appJs = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
const portalJs = fs.readFileSync(path.join(root, 'frontend/public/portal/portal.js'), 'utf8');
const officeHtml = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');
const portalHtml = fs.readFileSync(path.join(root, 'frontend/public/portal/index.html'), 'utf8');
const themeCss = fs.readFileSync(path.join(root, 'frontend/public/assets/theme.css'), 'utf8');

function loadNav() {
  delete require.cache[require.resolve(navPath)];
  return require(navPath);
}

let CdsBackNav;

beforeEach(() => {
  CdsBackNav = loadNav();
  CdsBackNav._resetForTests();
});

function baseState(extra) {
  return Object.assign({
    page: 'documentos',
    selectedCompany: null,
    requestView: null,
    processView: null,
    companyView: null,
    companyUsers: null,
    fechamentoId: null,
    settingsSection: 'geral',
    listPage: { documentos: 2 },
    docFilters: { company_id: 'emp-a', status: 'PENDING', q: '', source: '', extraction: '', period: '', from: '', to: '' },
    token: 'tok-office',
    user: { id: 'u1', role: 'OWNER', tenant_id: 'ten-a' },
    tenant: { id: 'ten-a' }
  }, extra || {});
}

test('CdsBackNav é módulo central exportável', () => {
  assert.equal(typeof CdsBackNav.remember, 'function');
  assert.equal(typeof CdsBackNav.back, 'function');
  assert.equal(typeof CdsBackNav.clear, 'function');
  assert.equal(typeof CdsBackNav.buttonHtml, 'function');
  assert.match(CdsBackNav.buttonHtml('cdsBack'), /← Voltar/);
  assert.match(CdsBackNav.buttonHtml('cdsBack'), /data-cds-back="1"/);
});

test('retorno com histórico (stack) restaura página pai', () => {
  const state = baseState({ page: 'documentos' });
  CdsBackNav.remember(state, { fallbackPage: 'documentos', kind: 'docDetail', label: 'Documentos' });
  state.page = 'documento_detalhe';
  state.requestView = 'req-1';

  const result = CdsBackNav.back({ state, fallbackPage: 'documentos' });
  assert.equal(result.source, 'stack');
  assert.equal(result.ok, true);
  assert.equal(state.page, 'documentos');
  assert.equal(state.requestView, null);
  assert.equal(CdsBackNav.depth(), 0);
});

test('retorno sem histórico usa fallback do módulo', () => {
  const state = baseState({ page: 'solicitacoes', requestView: 'req-deep' });
  const result = CdsBackNav.back({ state, fallbackPage: 'solicitacoes' });
  assert.equal(result.source, 'fallback');
  assert.equal(result.fallbackPage, 'solicitacoes');
  assert.equal(state.page, 'solicitacoes');
  assert.equal(state.requestView, null);
});

test('deep link sem stack não deixa usuário preso (fallback pai)', () => {
  const state = baseState({
    page: 'processos',
    processView: 'proc-123',
    listPage: { processos: 1 }
  });
  assert.equal(CdsBackNav.depth(), 0);
  assert.equal(CdsBackNav.canBack(state), true);
  const result = CdsBackNav.back({ state });
  assert.equal(result.source, 'fallback');
  assert.equal(state.processView, null);
  assert.equal(state.page, 'processos');
});

test('fallback explícito tem prioridade sobre resolução automática', () => {
  const state = baseState({ page: 'fechamento', fechamentoId: 'fc-1' });
  const result = CdsBackNav.back({ state, fallbackPage: 'fechamento' });
  assert.equal(result.fallbackPage, 'fechamento');
  assert.equal(state.page, 'fechamento');
  assert.equal(state.fechamentoId, null);
});

test('retorno para rota pai (companyView → empresas)', () => {
  const state = baseState({ page: 'empresas', companyView: 'co-9' });
  CdsBackNav.remember(state, { fallbackPage: 'empresas', kind: 'companyView' });
  state.companyView = 'co-9';
  const result = CdsBackNav.back({
    state,
    fallbackPage: 'empresas',
    clear() { state.companyView = null; }
  });
  assert.equal(result.source, 'stack');
  assert.equal(state.companyView, null);
  assert.equal(state.page, 'empresas');
});

test('preserva contexto de filtros ao voltar', () => {
  const state = baseState({
    page: 'documentos',
    docFilters: { company_id: 'emp-a', status: 'PENDING', q: 'nota', source: '', extraction: '', period: '', from: '', to: '' },
    listPage: { documentos: 3 }
  });
  CdsBackNav.remember(state, { fallbackPage: 'documentos', kind: 'detail' });
  state.docFilters = { company_id: '', status: '', q: '', source: '', extraction: '', period: '', from: '', to: '' };
  state.listPage = { documentos: 1 };
  state.requestView = 'x';

  CdsBackNav.back({ state, fallbackPage: 'documentos' });
  assert.equal(state.docFilters.company_id, 'emp-a');
  assert.equal(state.docFilters.status, 'PENDING');
  assert.equal(state.docFilters.q, 'nota');
  assert.equal(state.listPage.documentos, 3);
});

test('preserva filtros do portal (company isolation context)', () => {
  const state = {
    page: 'expenses',
    filters: { expenses: { from: '2026-01-01', status: 'PENDING', company_hint: 'emp-a' } },
    token: 'tok-client',
    user: { id: 'c1', role: 'CLIENT', company_id: 'emp-a' },
    requestView: null
  };
  CdsBackNav.remember(state, { fallbackPage: 'expenses', kind: 'detail' });
  state.filters = { expenses: {} };
  state.page = 'detail';
  CdsBackNav.back({ state, fallbackPage: 'expenses' });
  assert.equal(state.filters.expenses.from, '2026-01-01');
  assert.equal(state.filters.expenses.status, 'PENDING');
  assert.equal(state.page, 'expenses');
});

test('evita loop: remember duplicado não empilha o mesmo frame', () => {
  const state = baseState({ page: 'solicitacoes' });
  CdsBackNav.remember(state, { fallbackPage: 'solicitacoes', kind: 'requestView' });
  CdsBackNav.remember(state, { fallbackPage: 'solicitacoes', kind: 'requestView' });
  assert.equal(CdsBackNav.depth(), 1);
});

test('clear zera stack (sidebar / leave company)', () => {
  const state = baseState();
  CdsBackNav.remember(state, { fallbackPage: 'documentos' });
  CdsBackNav.remember(Object.assign({}, state, { page: 'solicitacoes' }), { fallbackPage: 'solicitacoes' });
  assert.ok(CdsBackNav.depth() >= 1);
  CdsBackNav.clear();
  assert.equal(CdsBackNav.depth(), 0);
  assert.equal(CdsBackNav.peek(), null);
});

test('não mostra Voltar em destino raiz sem stack', () => {
  const state = baseState({ page: 'dashboard', requestView: null, processView: null, companyView: null });
  assert.equal(CdsBackNav.shouldShow(state), false);
  assert.equal(CdsBackNav.isSecondary(state), false);
});

test('mostra Voltar em tela secundária mesmo sem stack (deep link)', () => {
  const state = baseState({ page: 'empresas', companyView: 'co-1' });
  assert.equal(CdsBackNav.shouldShow(state), true);
});

test('back não altera token / tenant / role (permissões e isolamento)', () => {
  const state = baseState({
    page: 'solicitacoes',
    requestView: 'r1',
    token: 'tok-secret',
    user: { id: 'u1', role: 'ACCOUNTANT', tenant_id: 'ten-a' },
    tenant: { id: 'ten-a', slug: 'tenant-a' },
    selectedCompany: { id: 'emp-a', name: 'Empresa A' }
  });
  const tokenBefore = state.token;
  const tenantBefore = state.tenant.id;
  const roleBefore = state.user.role;
  const companyBefore = state.selectedCompany.id;

  CdsBackNav.back({ state, fallbackPage: 'solicitacoes' });

  assert.equal(state.token, tokenBefore);
  assert.equal(state.tenant.id, tenantBefore);
  assert.equal(state.user.role, roleBefore);
  assert.equal(state.selectedCompany.id, companyBefore);
  assert.equal(state.requestView, null);
});

test('syncHistory é chamado no fallback (sem history.back cego)', () => {
  const state = baseState({ page: 'fechamento', fechamentoId: 'fc-1' });
  const urls = [];
  CdsBackNav.back({
    state,
    fallbackPage: 'fechamento',
    syncHistory(url) { urls.push(url); }
  });
  assert.equal(urls.length, 1);
  assert.equal(urls[0], '/');
});

test('office e portal carregam back-navigation.js e usam helpers centrais', () => {
  assert.match(officeHtml, /back-navigation\.js/);
  assert.match(portalHtml, /back-navigation\.js/);
  assert.match(appJs, /function cdsRemember/);
  assert.match(appJs, /function cdsGoBack/);
  assert.match(appJs, /function cdsBackBtn/);
  assert.match(appJs, /CdsBackNav\.clear/);
  assert.match(portalJs, /function portalRemember/);
  assert.match(portalJs, /function portalGoBack/);
  assert.match(portalJs, /portalBackBtn/);
  assert.match(themeCss, /\.cds-back-btn/);
});

test('telas secundárias do escritório usam CdsBackNav (sem Voltar ad-hoc no detalhe ativo)', () => {
  assert.match(appJs, /cdsRemember\(\{fallbackPage:'solicitacoes'/);
  assert.match(appJs, /cdsRemember\(\{fallbackPage:'processos'/);
  assert.match(appJs, /cdsRemember\(\{fallbackPage:'fechamento'/);
  assert.match(appJs, /cdsRemember\(\{fallbackPage:'empresas'/);
  assert.match(appJs, /cdsGoBack\(\{fallbackPage:'processos'/);
  assert.match(appJs, /cdsGoBack\(\{fallbackPage:'fechamento'/);
  assert.match(appJs, /cdsBindBack\('cdsBack',\{fallbackPage:'configuracoes'\}/);
  // portal detail + requests
  assert.match(portalJs, /portalRemember\(\{fallbackPage:'expenses'/);
  assert.match(portalJs, /portalRemember\(\{fallbackPage:'requests'/);
  assert.match(portalJs, /portalGoBack\(\{[\s\S]*fallbackPage:backPage/);
});

test('não usa history.back() cego na camada central', () => {
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const src = stripComments(fs.readFileSync(navPath, 'utf8'));
  assert.doesNotMatch(src, /history\.back\s*\(/);
  assert.doesNotMatch(stripComments(appJs), /history\.back\s*\(/);
  assert.doesNotMatch(stripComments(portalJs), /history\.back\s*\(/);
});
