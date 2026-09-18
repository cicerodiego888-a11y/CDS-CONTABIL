'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function parseContextGroups(js) {
  const start = js.indexOf('const contextMenuGroups=');
  const end = js.indexOf('const companyContextNav=');
  assert.ok(start >= 0 && end > start, 'contextMenuGroups deve preceder companyContextNav');
  const src = js.slice(start, end);
  const groups = {};
  for (const part of src.split(/\{title:'/).slice(1)) {
    const title = part.slice(0, part.indexOf("'"));
    groups[title] = [...part.matchAll(/\['([^']+)','([^']+)'/g)].map((m) => ({ page: m[1], label: m[2] }));
  }
  return { src, groups };
}

function labelsOf(groups, title) {
  return (groups[title] || []).map((x) => x.label);
}

const js = read('frontend/public/assets/app.js');
const portal = read('frontend/public/portal/portal.js');
const { src: ctxSrc, groups } = parseContextGroups(js);
const menuSrc = js.slice(js.indexOf('const menuGroups='), js.indexOf('const contextMenuGroups='));

test('TEST 1 contexto da empresa possui itens oficiais', () => {
  const labels = Object.values(groups).flatMap((items) => items.map((x) => x.label));
  for (const label of ['Visão geral', 'Despesas', 'Documentos', 'Solicitações', 'Classificação', 'Lançamentos', 'Aprovação', 'Importações', 'Usuários']) {
    assert.ok(labels.includes(label), 'faltou ' + label);
  }
});

test('TEST 2 contexto da empresa não possui Receitas', () => {
  assert.doesNotMatch(ctxSrc, /Receitas/);
  const labels = Object.values(groups).flatMap((items) => items.map((x) => x.label));
  assert.ok(!labels.includes('Receitas'));
});

test('TEST 3 contexto da empresa não possui Nova receita', () => {
  assert.doesNotMatch(ctxSrc, /Nova receita/);
  assert.ok(!js.slice(js.indexOf('const contextMenuGroups='), js.indexOf('const officeOnly=')).includes('Nova receita'));
});

test('TEST 4 Aprovação pertence ao grupo CONTÁBIL', () => {
  assert.ok(labelsOf(groups, 'CONTÁBIL').includes('Aprovação'));
  assert.ok(!labelsOf(groups, 'OPERAÇÃO').includes('Aprovação'));
  assert.ok(!labelsOf(groups, 'MOVIMENTAÇÕES').length);
});

test('TEST 5 Classificação pertence ao grupo CONTÁBIL', () => {
  assert.ok(labelsOf(groups, 'CONTÁBIL').includes('Classificação'));
});

test('TEST 6 Lançamentos pertencem ao grupo CONTÁBIL', () => {
  assert.ok(labelsOf(groups, 'CONTÁBIL').includes('Lançamentos'));
});

test('TEST 7 Despesas pertencem ao grupo OPERAÇÃO', () => {
  assert.ok(labelsOf(groups, 'OPERAÇÃO').includes('Despesas'));
});

test('TEST 8 Documentos pertencem ao grupo OPERAÇÃO', () => {
  assert.ok(labelsOf(groups, 'OPERAÇÃO').includes('Documentos'));
});

test('TEST 9 Pendências não aparecem no menu da empresa; permanecem no menu global', () => {
  assert.ok(!labelsOf(groups, 'OPERAÇÃO').includes('Pendências'));
  assert.ok(!Object.values(groups).flatMap((items) => items.map((x) => x.page)).includes('pendencias'));
  assert.match(menuSrc, /\['pendencias','Pendências'/);
});

test('TEST 10 Solicitações pertencem ao grupo OPERAÇÃO', () => {
  assert.ok(labelsOf(groups, 'OPERAÇÃO').includes('Solicitações'));
});

test('TEST 11 Importações pertencem ao grupo IMPORTAÇÃO', () => {
  assert.ok(labelsOf(groups, 'IMPORTAÇÃO').includes('Importações'));
});

test('TEST 12 Usuários pertencem ao grupo ACESSO', () => {
  assert.ok(labelsOf(groups, 'ACESSO').includes('Usuários'));
  assert.match(menuSrc, /\['usuarios','Equipe e acessos'/);
});

test('TEST 13 Portal continua sem Receitas no menu', () => {
  const shell = portal.slice(portal.indexOf('const links='), portal.indexOf('const allowed='));
  assert.doesNotMatch(shell, /Receitas/);
  assert.match(shell, /Início/);
  assert.match(shell, /Despesas/);
  assert.match(shell, /Nova despesa/);
  assert.match(shell, /Documentos/);
  assert.match(shell, /Pendências/);
  assert.match(shell, /Solicitações/);
  assert.match(shell, /Meu perfil/);
});

test('TEST 14 Portal continua sem Nova receita', () => {
  const shell = portal.slice(portal.indexOf('const links='), portal.indexOf('const allowed='));
  assert.doesNotMatch(shell, /Nova receita/);
});

test('TEST 15 CLIENT não recebe acesso visual a áreas contábeis do escritório', () => {
  const shell = portal.slice(portal.indexOf('const links='), portal.indexOf('const allowed='));
  assert.doesNotMatch(shell, /Classificação/);
  assert.doesNotMatch(shell, /Lançamentos/);
  assert.doesNotMatch(shell, /Aprovação/);
  assert.doesNotMatch(shell, /Importações/);
  assert.doesNotMatch(shell, /Usuários/);
  assert.match(js, /if\(state\.user\.role==='CLIENT'\)\{window\.location\.href='\/portal\//);
});

test('TEST 16 contexto continua usando a empresa ativa', () => {
  assert.match(js, /X-Company-Id/);
  assert.match(js, /state\.selectedCompany/);
  assert.match(js, /enterCompany/);
  assert.match(js, /restoreCompanyFromUrl/);
  assert.match(js, /history\.pushState\(\{company:x\.id\},'', '\/empresas\/'\+x\.id\)/);
  assert.doesNotMatch(ctxSrc, /<select/);
});

test('TEST 17 botão ← Empresas continua funcionando', () => {
  assert.match(js, /id="leaveCompany">← Empresas/);
  assert.match(js, /function leaveCompany\(\)\{state\.selectedCompany=null;state\.page='empresas'/);
});

test('TEST 18 badges de classificação/aprovação/pendências continuam', () => {
  assert.match(js, /function renderBadge\(page\)/);
  assert.match(js, /sidebarCounters\.aprovacao=/);
  assert.match(js, /sidebarCounters\.classificacao=/);
  assert.match(js, /sidebarCounters\.pendencias=/);
  assert.match(js, /sidebarCounters\.solicitacoes=/);
});

test('organização oficial: grupos, Visão geral, chips alinhados e sem MOVIMENTAÇÕES no contexto', () => {
  assert.deepEqual(Object.keys(groups), ['OPERAÇÃO', 'CONTÁBIL', 'IMPORTAÇÃO', 'ACESSO']);
  assert.deepEqual(labelsOf(groups, 'OPERAÇÃO'), ['Visão geral', 'Despesas', 'Documentos', 'Solicitações']);
  assert.deepEqual(labelsOf(groups, 'CONTÁBIL'), ['Classificação', 'Aprovação', 'Lançamentos']);
  assert.deepEqual(labelsOf(groups, 'IMPORTAÇÃO'), ['Importações']);
  assert.deepEqual(labelsOf(groups, 'ACESSO'), ['Usuários']);
  assert.doesNotMatch(ctxSrc, /MOVIMENTAÇÕES/);
  assert.doesNotMatch(ctxSrc, /Dashboard/);
  assert.match(js, /companyContextNav=contextMenuGroups\.flatMap/);
  assert.match(js, /state\.selectedCompany\?contextMenuGroups:menuGroups/);
  assert.match(js, /state\.selectedCompany\?companyUsersPage/);
  assert.doesNotMatch(menuSrc, /\['receitas','Receitas'/);
});
