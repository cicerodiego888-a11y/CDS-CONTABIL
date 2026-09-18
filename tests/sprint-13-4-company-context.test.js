'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s134-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-13-4-secret-ok';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_COMMS_WORKER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
const { app, db, EVENT_TYPES } = require('../backend/src/server');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('frontend/public/assets/app.js');
const portal = read('frontend/public/portal/portal.js');
const password = 'Senha@123';

function loadNav() {
  const start = js.indexOf('const menuGroups=');
  const end = js.indexOf('const officeOnly=');
  return Function(js.slice(start, end) + ';return {menuGroups,contextMenuGroups,companyContextNav};')();
}
const { menuGroups, contextMenuGroups } = loadNav();
const globalItems = menuGroups.flatMap((g) => g.items);
const ctxItems = contextMenuGroups.flatMap((g) => g.items);
const ctxSrc = js.slice(js.indexOf('const contextMenuGroups='), js.indexOf('const officeOnly='));
const menuSrc = js.slice(js.indexOf('const menuGroups='), js.indexOf('const contextMenuGroups='));
const portalLinks = portal.slice(portal.indexOf('const links='), portal.indexOf('const allowed='));

let server, base, ownerA, ownerB, slugA, companyA, companyB, companyOther, clientToken;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}
function items(r) { return Array.isArray(r.data) ? r.data : (r.data && r.data.items) || []; }

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 134 A', email: 'owner.a.s134@test.local', password, tenantName: 'Tenant 134 A' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  slugA = a.data.tenant_slug;
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s134@test.local', password, tenant: slugA })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório 134 B', email: 'owner.b.s134@test.local', password, tenantName: 'Tenant 134 B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s134@test.local', password, tenant: b.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Pastelaria do Cheff', trade_name: 'PASTELARIA DO CHEFF', cnpj: '38204469000115' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa Beta 134', trade_name: 'Beta 134', cnpj: '22333444000172' }, ownerA.token)).data;
  companyOther = (await req('POST', '/api/empresas', { name: 'Outro Tenant 134', cnpj: '33444555000103' }, ownerB.token)).data;
  const cu = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Cliente 134', email: 'cliente.s134@test.local', profile: 'CLIENT_FINANCE' }, ownerA.token);
  assert.equal(cu.status, 201, JSON.stringify(cu.data));
  const tok = cu.data.invitation.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', { name: 'Cliente 134', password, confirmation: password });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  clientToken = acc.data.token;
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('1 menu global não possui Receitas', () => {
  assert.ok(!globalItems.some((x) => x[0] === 'receitas' || x[1] === 'Receitas'));
  assert.doesNotMatch(menuSrc, /\['receitas','Receitas'/);
});

test('2 menu global não possui Lançamentos', () => {
  assert.ok(!globalItems.some((x) => x[0] === 'lancamentos' || x[1] === 'Lançamentos'));
  assert.ok(menuGroups.some((g) => g.title === 'FILAS DE TRABALHO'));
  assert.ok(!menuGroups.some((g) => g.title === 'MOVIMENTAÇÕES'));
});

test('3 empresa possui Lançamentos', () => {
  assert.ok(ctxItems.some((x) => x[0] === 'lancamentos' && x[1] === 'Lançamentos'));
  assert.equal(contextMenuGroups.find((g) => g.items.some((i) => i[0] === 'lancamentos')).title, 'CONTÁBIL');
});

test('4 empresa possui Classificação', () => {
  assert.equal(contextMenuGroups.find((g) => g.items.some((i) => i[0] === 'classificacao')).title, 'CONTÁBIL');
});

test('5 empresa possui Aprovação', () => {
  assert.equal(contextMenuGroups.find((g) => g.items.some((i) => i[0] === 'aprovacao')).title, 'CONTÁBIL');
});

test('6 empresa possui Importações', () => {
  assert.equal(contextMenuGroups.find((g) => g.items.some((i) => i[0] === 'importacoes')).title, 'IMPORTAÇÃO');
});

test('7 empresa não possui Receitas', () => {
  assert.ok(!ctxItems.some((x) => x[0] === 'receitas' || x[1] === 'Receitas'));
  assert.doesNotMatch(ctxSrc, /Receitas/);
});

test('8 empresa não possui Nova receita', () => {
  assert.doesNotMatch(ctxSrc, /Nova receita/);
  assert.match(js, /\+ Nova despesa/);
  assert.match(js, /const newBtn=type==='despesas'\?/);
});

test('9 empresa não possui grupo MOVIMENTAÇÕES', () => {
  assert.ok(!contextMenuGroups.some((g) => g.title === 'MOVIMENTAÇÕES'));
  assert.doesNotMatch(ctxSrc, /MOVIMENTAÇÕES/);
});

test('10 Portal não possui Receitas', () => {
  assert.doesNotMatch(portalLinks, /Receitas/);
});

test('11 Portal não possui Nova receita', () => {
  assert.doesNotMatch(portalLinks, /Nova receita/);
  assert.doesNotMatch(portal, /Nova receita/);
});

test('12 REVENUE continua permitido como origem de importação', async () => {
  const imp = await req('POST', '/api/importacoes', {
    company_id: companyA.id,
    origin: 'IMPORTACAO_CONTABIL',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    movements: [{ type: 'REVENUE', occurred_on: '2026-09-15', description: 'Venda importada 134', amount: '250,00', receipt_method: 'PIX' }]
  }, ownerA.token);
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  assert.equal(imp.data.imported_rows, 1);
});

test('13 REVENUE continua gerando movimentação quando aplicável', async () => {
  const revs = await req('GET', '/api/receitas', undefined, ownerA.token, companyA.id);
  assert.equal(revs.status, 200);
  assert.ok(items(revs).some((x) => x.description === 'Venda importada 134' && x.company_id === companyA.id));
});

test('14 REVENUE_CREATED continua existente', () => {
  assert.equal(EVENT_TYPES.REVENUE_CREATED, 'REVENUE_CREATED');
  const ev = db.prepare('SELECT event_type FROM domain_events WHERE tenant_id=? AND company_id=? AND event_type=?').get(ownerA.user.tenant_id, companyA.id, 'REVENUE_CREATED');
  assert.ok(ev);
});

test('15 lançamento continua vinculado a company_id', async () => {
  const entries = await req('GET', '/api/lancamentos?status=ALL', undefined, ownerA.token, companyA.id);
  assert.equal(entries.status, 200);
  assert.ok(items(entries).length >= 1);
  assert.ok(items(entries).every((x) => x.company_id === companyA.id));
  assert.ok(items(entries).some((x) => x.source_type === 'REVENUE' && x.description === 'Venda importada 134'));
});

test('16 classificação global identifica corretamente a empresa', async () => {
  const queue = await req('GET', '/api/lancamentos?status=NEEDS_CLASSIFICATION&page=1&page_size=25', undefined, ownerA.token);
  assert.equal(queue.status, 200);
  const hit = items(queue).find((x) => x.description === 'Venda importada 134') || items(queue)[0];
  if (hit) {
    assert.ok(hit.company_id);
    assert.ok(hit.company_name);
    assert.match(js, /<th>Empresa<\/th><th>Movimentação<\/th>/);
  }
  const scoped = await req('GET', '/api/lancamentos?status=NEEDS_CLASSIFICATION', undefined, ownerA.token, companyA.id);
  assert.ok(items(scoped).every((x) => x.company_id === companyA.id && x.company_name));
});

test('17 aprovação global identifica corretamente a empresa', async () => {
  db.prepare('INSERT INTO entries(id,tenant_id,company_id,source_type,occurred_on,description,status,confidence,generated_by) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('e134-aprov-' + Date.now(), ownerA.user.tenant_id, companyA.id, 'MANUAL', '2026-09-15', 'Partida aprovação 134', 'PENDING', 1, ownerA.user.id);
  const queue = await req('GET', '/api/aprovacao/pendentes?page=1&page_size=25', undefined, ownerA.token);
  assert.equal(queue.status, 200);
  assert.ok(items(queue).some((x) => x.company_id === companyA.id && x.company_name));
  assert.ok(items(queue).every((x) => x.company_name));
  assert.match(js, /<th>Empresa<\/th><th>Movimentação<\/th><th>Valor<\/th>/);
});

test('18 selectedCompany continua funcionando', () => {
  assert.match(js, /state\.selectedCompany=\{id:x\.id,name:x\.name/);
  assert.match(js, /function enterCompany\(id,page\)/);
  assert.match(js, /history\.pushState\(\{company:x\.id\},'', '\/empresas\/'\+x\.id\)/);
  assert.match(js, /function restoreCompanyFromUrl\(\)/);
});

test('19 X-Company-Id continua funcionando', async () => {
  assert.match(js, /h\['X-Company-Id'\]=state\.selectedCompany\.id/);
  const scoped = await req('GET', '/api/despesas', undefined, ownerA.token, companyA.id);
  const other = await req('GET', '/api/despesas', undefined, ownerA.token, companyB.id);
  assert.ok(items(scoped).every((x) => x.company_id === companyA.id));
  assert.ok(items(other).every((x) => x.company_id === companyB.id));
});

test('20 isolamento multi-tenant continua funcionando', async () => {
  const cross = await req('GET', '/api/empresas/' + companyOther.id, undefined, ownerA.token);
  assert.equal(cross.status, 404);
  const entries = await req('GET', '/api/lancamentos', undefined, ownerB.token, companyA.id);
  assert.ok(!items(entries).some((x) => x.company_id === companyA.id));
});

test('21 card Despesas conta somente EXPENSE', async () => {
  await req('POST', '/api/despesas', { company_id: companyA.id, occurred_on: '2026-09-10', description: 'Despesa 134 A', amount: '10,00', payment_method: 'PIX' }, ownerA.token);
  await req('POST', '/api/despesas', { company_id: companyA.id, occurred_on: '2026-09-11', description: 'Despesa 134 B', amount: '20,00', payment_method: 'PIX' }, ownerA.token);
  const op = await req('GET', `/api/empresas/${companyA.id}/operacional`, undefined, ownerA.token);
  const dash = await req('GET', '/api/dashboard', undefined, ownerA.token, companyA.id);
  assert.equal(op.data.expenses, dash.data.expense_count);
  assert.equal(typeof op.data.expenses, 'number');
  assert.match(js, /label">Despesas<\/div><div class="value">\$\{op\.expenses\?\?d\.expense_count\?\?0\}/);
  assert.doesNotMatch(js, /label">Despesas<\/div><div class="value">\$\{d\.movements/);
});

test('22 receita não é somada ao card Despesas', async () => {
  const op = await req('GET', `/api/empresas/${companyA.id}/operacional`, undefined, ownerA.token);
  const dash = await req('GET', '/api/dashboard', undefined, ownerA.token, companyA.id);
  assert.equal(dash.data.expense_count, op.data.expenses);
  assert.ok(dash.data.revenue_count >= 1);
  assert.equal(dash.data.movements, dash.data.expense_count + dash.data.revenue_count);
  assert.notEqual(dash.data.expense_count, dash.data.movements);
});

test('23 client.revenues.create continua bloqueado para cliente', async () => {
  const r = await req('POST', '/api/client/receitas', { occurred_on: '2026-09-15', description: 'Tentativa portal', amount: '10,00', receipt_method: 'PIX' }, clientToken);
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'REVENUE_NOT_AVAILABLE_FOR_CLIENT');
});

test('24 fluxo de ativação de usuário continua funcionando', async () => {
  const cu = await req('POST', `/api/empresas/${companyB.id}/users`, { name: 'Novo Cliente 134', email: 'novo.s134@test.local', profile: 'CLIENT_VIEWER' }, ownerA.token);
  assert.equal(cu.status, 201, JSON.stringify(cu.data));
  const tok = cu.data.invitation.activation_url.split('/convite/')[1];
  const preview = await req('GET', '/api/invitations/' + tok);
  assert.equal(preview.status, 200);
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', { name: 'Novo Cliente 134', password, confirmation: password });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.redirect, '/portal/');
  assert.equal(acc.data.user.role, 'CLIENT');
});

test('25 selectedCompany, filas globais e domínio de receitas permanecem', () => {
  assert.match(js, /X-Company-Id/);
  assert.match(js, /state\.selectedCompany\?contextMenuGroups:menuGroups/);
  assert.ok(globalItems.some((x) => x[0] === 'classificacao'));
  assert.ok(globalItems.some((x) => x[0] === 'aprovacao'));
  assert.match(js, /state\.page==='despesas'\|\|state\.page==='receitas'/);
  assert.match(js, /function importModal/);
  assert.match(js, /Conferência/);
});
