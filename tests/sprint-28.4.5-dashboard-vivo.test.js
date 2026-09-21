'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s2845-'));
process.env.CDS_DB_PATH = path.join(tmp, 's2845.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-28-4-5-dashboard';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db, emitEvent, EVENT_TYPES } = require('../backend/src/server');

const password = 'Senha@123';
let server, base, ownerA, ownerB, staffA, companyA, companyA2, companyB, clientA;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  return (await req('POST', '/api/invitations/' + token + '/accept', {
    name, password, confirmation: password
  })).data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório 2845 A', email: 'owner.a.s2845@test.local', password, tenantName: 'Tenant 2845 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s2845@test.local', password, tenant: a.data.tenant_slug
  })).data;
  const b = await req('POST', '/api/auth/register', {
    name: 'Escritório 2845 B', email: 'owner.b.s2845@test.local', password, tenantName: 'Tenant 2845 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s2845@test.local', password, tenant: b.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa Alfa 2845', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa Beta 2845', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 2845', cnpj: '22333444000192'
  }, ownerB.token)).data;
  const staff = await req('POST', '/api/usuarios', {
    name: 'Equipe 2845', email: 'staff.a.s2845@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.a.s2845@test.local', password, tenant: ownerA.user.tenant_slug
  })).data;
  const u = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente 2845', email: 'cliente.s2845@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  clientA = await accept(u.data.invitation, 'Cliente 2845');

  await req('POST', '/api/despesas', {
    company_id: companyA.id, occurred_on: '2026-09-10', description: 'Energia dash', amount: '100,00', payment_method: 'PIX'
  }, ownerA.token);
  await req('POST', '/api/receitas', {
    company_id: companyA.id, occurred_on: '2026-09-12', description: 'Honorarios dash', amount: '250,00', receipt_method: 'PIX'
  }, ownerA.token);

  const proc = (await req('POST', '/api/processos', {
    name: 'SPED Fiscal', company_id: companyA.id, responsible_user_id: ownerA.user.id
  }, ownerA.token)).data;
  await req('POST', `/api/processos/${proc.id}/etapas`, {
    name: 'Entrega do SPED Fiscal', due_offset_days: 0
  }, ownerA.token);
  const occ = await req('POST', '/api/processo-ocorrencias', {
    process_id: proc.id, competence: '01/2020'
  }, ownerA.token);
  assert.equal(occ.status, 201, JSON.stringify(occ.data));

  const procSoon = (await req('POST', '/api/processos', {
    name: 'DCTFWeb', company_id: companyA2.id, responsible_user_id: ownerA.user.id
  }, ownerA.token)).data;
  await req('POST', `/api/processos/${procSoon.id}/etapas`, {
    name: 'Transmitir DCTFWeb', due_offset_days: 1
  }, ownerA.token);
  const now = new Date();
  const competence = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  await req('POST', '/api/processo-ocorrencias', {
    process_id: procSoon.id, competence
  }, ownerA.token);

  emitEvent({
    tenantId: ownerA.user.tenant_id,
    companyId: companyA.id,
    eventType: EVENT_TYPES.DOCUMENT_UPLOADED,
    actorUserId: ownerA.user.id,
    entityType: 'document',
    entityId: 'doc-dash-1',
    payload: { original_name: 'nf.pdf' }
  });
  emitEvent({
    tenantId: ownerA.user.tenant_id,
    companyId: companyA.id,
    eventType: EVENT_TYPES.EXPENSE_CREATED,
    actorUserId: ownerA.user.id,
    entityType: 'expense',
    entityId: 'exp-dash-1',
    payload: { description: 'Energia dash' }
  });
});

after(() => {
  server.close();
  try { db.close(); } catch {}
});

test('dashboard office retorna resumo, kpis, série, saúde e período', async () => {
  const r = await req('GET', '/api/dashboard?preset=month', undefined, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.summary);
  assert.equal(typeof r.data.summary.documents_received, 'number');
  assert.equal(typeof r.data.summary.expenses_cents, 'number');
  assert.equal(typeof r.data.summary.revenue_cents, 'number');
  assert.ok(r.data.kpis && r.data.kpis.companies);
  assert.equal(r.data.kpis.companies.value, 2);
  assert.ok(Array.isArray(r.data.activity_series));
  assert.ok(r.data.health);
  assert.equal(typeof r.data.health.companies_ok, 'number');
  assert.ok(r.data.period && r.data.period.from && r.data.period.to);
  assert.ok('processing_rate' in r.data);
  if (r.data.summary.documents_received === 0) assert.equal(r.data.processing_rate, null);
  assert.ok(r.data.expenses_cents >= 10000);
  assert.ok(r.data.revenue_cents >= 25000);
});

test('dashboard filtra por período sem inventar percentual', async () => {
  const r = await req('GET', '/api/dashboard?preset=today', undefined, ownerA.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.period.preset, 'today');
  assert.equal(r.data.period.from, r.data.period.to);
  const empty = await req('GET', '/api/dashboard?preset=custom&from=2010-01-01&to=2010-01-02', undefined, ownerA.token);
  assert.equal(empty.status, 200);
  assert.equal(empty.data.summary.expenses_cents, 0);
  assert.equal(empty.data.summary.documents_received, 0);
  assert.equal(empty.data.processing_rate, null);
});

test('série temporal contém categorias reais e ignora lixo', async () => {
  const r = await req('GET', '/api/dashboard?activity=7d', undefined, ownerA.token);
  assert.equal(r.status, 200);
  assert.ok(r.data.activity_series.length >= 7);
  const totals = r.data.activity_series.reduce((a, p) => ({
    documents: a.documents + Number(p.documents || 0),
    expenses: a.expenses + Number(p.expenses || 0)
  }), { documents: 0, expenses: 0 });
  assert.ok(totals.documents >= 1);
  assert.ok(totals.expenses >= 1);
  r.data.activity_series.forEach((p) => {
    assert.ok('documents' in p && 'expenses' in p && 'revenues' in p && 'requests' in p && 'classifications' in p);
  });
});

test('saúde e processos atrasados/vencendo usam motor existente', async () => {
  const dash = await req('GET', '/api/dashboard', undefined, ownerA.token);
  const proc = await req('GET', '/api/processos/dashboard', undefined, ownerA.token);
  assert.equal(dash.status, 200);
  assert.equal(proc.status, 200);
  assert.ok(dash.data.health.processes_overdue >= 1);
  assert.equal(dash.data.processes.atrasadas, proc.data.atrasadas);
  assert.equal(dash.data.processes.vencendo, proc.data.vencendo);
});

test('próximos prazos: ordem, limite, empresa e isolamento', async () => {
  const r = await req('GET', '/api/processos/dashboard/proximos-prazos?limit=8', undefined, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.items));
  assert.ok(r.data.items.length >= 1);
  assert.ok(r.data.items.length <= 8);
  const first = r.data.items[0];
  assert.equal(first.status, 'ATRASADA');
  assert.ok(first.company_id === companyA.id);
  const scoped = await req('GET', '/api/processos/dashboard/proximos-prazos?limit=8', undefined, ownerA.token, companyA2.id);
  assert.equal(scoped.status, 200);
  assert.ok(scoped.data.items.every((x) => x.company_id === companyA2.id));
  const other = await req('GET', '/api/processos/dashboard/proximos-prazos', undefined, ownerB.token);
  assert.equal(other.status, 200);
  assert.ok(other.data.items.every((x) => x.company_id === companyB.id));
  const spoof = await req('GET', '/api/processos/dashboard/proximos-prazos', undefined, ownerA.token, companyB.id);
  assert.equal(spoof.status, 404);
});

test('OWNER ACCOUNTANT STAFF acessam; CLIENT bloqueado', async () => {
  const acc = await req('POST', '/api/usuarios', {
    name: 'Contador 2845', email: 'acc.s2845@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  const accLogin = (await req('POST', '/api/auth/login', {
    email: 'acc.s2845@test.local', password, tenant: ownerA.user.tenant_slug
  })).data;
  for (const token of [ownerA.token, accLogin.token, staffA.token]) {
    const r = await req('GET', '/api/dashboard', undefined, token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const clientDash = await req('GET', '/api/dashboard', undefined, clientA.token);
  assert.equal(clientDash.status, 403);
  const clientPrazos = await req('GET', '/api/processos/dashboard/proximos-prazos', undefined, clientA.token);
  assert.equal(clientPrazos.status, 403);
});

test('isolamento tenant e company no dashboard', async () => {
  const a = await req('GET', '/api/dashboard', undefined, ownerA.token);
  const b = await req('GET', '/api/dashboard', undefined, ownerB.token);
  assert.equal(a.data.kpis.companies.value, 2);
  assert.equal(b.data.kpis.companies.value, 1);
  const scoped = await req('GET', '/api/dashboard', undefined, ownerA.token, companyA.id);
  assert.equal(scoped.data.company_id, companyA.id);
  assert.equal(scoped.data.companies, 1);
  const cross = await req('GET', '/api/dashboard', undefined, ownerA.token, companyB.id);
  assert.equal(cross.status, 404);
});

test('frontend dashboard operacional sem busca global na home', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  const theme = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/theme.css'), 'utf8');
  assert.match(js, /Veja o resumo da operação do seu escritório/);
  assert.match(js, /Resumo Contábil do Período/);
  assert.match(js, /Atividade do Escritório/);
  assert.match(js, /Saúde Contábil/);
  assert.match(js, /Próximos Prazos/);
  assert.match(js, /Últimas Atividades/);
  assert.match(js, /dashSkeleton/);
  assert.match(js, /ops-retry/);
  assert.match(js, /scheduleDashRefresh/);
  assert.match(js, /const isDash=state\.page==='dashboard'/);
  assert.match(js, /searchHtml=isDash\?''/);
  assert.match(js, /id="globalSearch"/);
  assert.match(js, /\/processos\/dashboard\/proximos-prazos/);
  assert.match(theme, /\.ops-kpis/);
  assert.doesNotMatch(theme, /#0f5f59/i);
});
