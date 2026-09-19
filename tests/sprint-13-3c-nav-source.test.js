'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('frontend/public/assets/app.js');
const portal = read('frontend/public/portal/portal.js');

function loadNav() {
  const start = js.indexOf('const menuGroups=');
  const end = js.indexOf('const officeOnly=');
  assert.ok(start >= 0 && end > start);
  return Function(js.slice(start, end) + ';return {menuGroups,contextMenuGroups,companyContextNav};')();
}

const { menuGroups, contextMenuGroups, companyContextNav } = loadNav();
const derivedChips = contextMenuGroups.flatMap((g) => g.items.map(([p, l]) => [p, l]));
const sidebarItems = contextMenuGroups.flatMap((g) => g.items.map(([page, label]) => ({
  group: g.title,
  page,
  label,
})));

test('1 fonte única contextual é contextMenuGroups', () => {
  assert.equal(js.split('const contextMenuGroups=').length, 2);
  assert.match(js, /function activeNavGroups\(\)\{return state\.selectedCompany\?contextMenuGroups:menuGroups\}/);
  assert.match(js, /function renderSidebar\(\)\{const groups=activeNavGroups\(\)/);
  assert.doesNotMatch(js, /const menuLabels=/);
});

test('2 companyContextNav é derivado de contextMenuGroups', () => {
  assert.match(js, /const companyContextNav=contextMenuGroups\.flatMap\(g=>g\.items\.map\(\(\[p,l\]\)=>\[p,l\]\)\)/);
  assert.doesNotMatch(js, /const companyContextNav=\[\[/);
  assert.deepEqual(companyContextNav, derivedChips);
});

test('3 sidebar usa a mesma estrutura contextual', () => {
  assert.match(js, /activeNavGroups\(\)/);
  assert.match(js, /groups\.map\(group=>`<section class="menu-group">/);
});

test('4 chips usam a mesma estrutura derivada', () => {
  assert.match(js, /companyContextNav\.map\(\(\[p,l\]\)=>`<button type="button" class="chip/);
});

test('5 Visão geral é o label e 6 dashboard continua a rota', () => {
  const dash = sidebarItems.find((x) => x.page === 'dashboard');
  assert.equal(dash.label, 'Visão geral');
  assert.equal(dash.group, 'OPERAÇÃO');
  assert.ok(!sidebarItems.some((x) => x.label === 'Dashboard'));
});

test('7 Receitas não aparece no contexto', () => {
  assert.ok(!sidebarItems.some((x) => x.label === 'Receitas' || x.page === 'receitas'));
});

test('8 Nova receita não aparece no contexto', () => {
  const ctx = js.slice(js.indexOf('const contextMenuGroups='), js.indexOf('const officeOnly='));
  assert.doesNotMatch(ctx, /Nova receita/);
});

test('9 MOVIMENTAÇÕES não aparece no contexto', () => {
  assert.ok(!contextMenuGroups.some((g) => g.title === 'MOVIMENTAÇÕES'));
});

test('10 Usuários aparece no grupo ACESSO', () => {
  const item = sidebarItems.find((x) => x.page === 'usuarios');
  assert.equal(item.label, 'Usuários');
  assert.equal(item.group, 'ACESSO');
});

test('11 Aprovação aparece em CONTÁBIL', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'aprovacao').group, 'CONTÁBIL');
});

test('12 Classificação aparece em CONTÁBIL', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'classificacao').group, 'CONTÁBIL');
});

test('13 Lançamentos aparece em CONTÁBIL', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'lancamentos').group, 'CONTÁBIL');
});

test('14 Importações aparece em IMPORTAÇÃO', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'importacoes').group, 'IMPORTAÇÃO');
});

test('15 Despesas aparece em OPERAÇÃO', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'despesas').group, 'OPERAÇÃO');
});

test('16 Documentos aparece em OPERAÇÃO', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'documentos').group, 'OPERAÇÃO');
});

test('17 Pendências não aparece no menu da empresa', () => {
  assert.ok(!sidebarItems.some((x) => x.page === 'pendencias' || x.label === 'Pendências'));
  const global = menuGroups.flatMap((g) => g.items);
  assert.ok(global.some((x) => x[0] === 'pendencias' && x[1] === 'Pendências'));
});

test('18 Solicitações aparece em OPERAÇÃO', () => {
  assert.equal(sidebarItems.find((x) => x.page === 'solicitacoes').group, 'OPERAÇÃO');
});

test('não duplicação: chips 100% iguais à sidebar contextual', () => {
  assert.deepEqual(
    companyContextNav.map(([page, label]) => ({ page, label })),
    sidebarItems.map(({ page, label }) => ({ page, label }))
  );
  assert.deepEqual(contextMenuGroups.map((g) => g.title), ['OPERAÇÃO', 'CONTÁBIL', 'IMPORTAÇÃO', 'ACESSO']);
  assert.deepEqual(
    contextMenuGroups.find((g) => g.title === 'OPERAÇÃO').items.map((x) => x[1]),
    ['Visão geral', 'Despesas', 'Documentos', 'Solicitações']
  );
  assert.deepEqual(
    contextMenuGroups.find((g) => g.title === 'CONTÁBIL').items.map((x) => x[1]),
    ['Classificação', 'Aprovação', 'Lançamentos', 'Integrações']
  );
  assert.deepEqual(
    contextMenuGroups.find((g) => g.title === 'IMPORTAÇÃO').items.map((x) => x[1]),
    ['Importações']
  );
  assert.deepEqual(
    contextMenuGroups.find((g) => g.title === 'ACESSO').items.map((x) => x[1]),
    ['Usuários']
  );
});

test('menu global do escritório permanece separado e funcional', () => {
  const titles = menuGroups.map((g) => g.title);
  assert.ok(!titles.includes('MOVIMENTAÇÕES'));
  assert.ok(titles.includes('FILAS DE TRABALHO'));
  assert.ok(titles.includes('GESTÃO'));
  const flat = menuGroups.flatMap((g) => g.items);
  assert.ok(!flat.some((x) => x[0] === 'receitas' || x[1] === 'Receitas'));
  assert.ok(!flat.some((x) => x[0] === 'lancamentos' || x[1] === 'Lançamentos'));
  assert.ok(flat.some((x) => x[0] === 'classificacao' && x[1] === 'Classificação'));
  assert.ok(flat.some((x) => x[0] === 'aprovacao' && x[1] === 'Aprovação'));
  assert.ok(flat.some((x) => x[0] === 'usuarios' && x[1] === 'Equipe e acessos'));
  assert.ok(!flat.some((x) => x[0] === 'usuarios' && x[1] === 'Usuários'));
});

test('Portal permanece independente e não consome contextMenuGroups', () => {
  assert.doesNotMatch(portal, /contextMenuGroups/);
  assert.doesNotMatch(portal, /companyContextNav/);
  assert.doesNotMatch(portal, /menuGroups/);
  const shell = portal.slice(portal.indexOf('const links='), portal.indexOf('const allowed='));
  assert.match(shell, /Início/);
  assert.match(shell, /Nova despesa/);
  assert.doesNotMatch(shell, /Receitas/);
  assert.doesNotMatch(shell, /Nova receita/);
});

test('badges, contexto de empresa e permissões de navegação permanecem', () => {
  assert.match(js, /function renderBadge\(page\)/);
  assert.match(js, /sidebarCounters\.classificacao=/);
  assert.match(js, /sidebarCounters\.aprovacao=/);
  assert.match(js, /sidebarCounters\.pendencias=/);
  assert.match(js, /sidebarCounters\.solicitacoes=/);
  assert.match(js, /X-Company-Id/);
  assert.match(js, /state\.selectedCompany\?companyUsersPage/);
  assert.match(js, /id="leaveCompany">← Empresas/);
});
