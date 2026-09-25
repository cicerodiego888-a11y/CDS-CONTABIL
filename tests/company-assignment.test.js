'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-co-asg-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-company-assignment-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
const { app, db } = require('../backend/src/server');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const password = 'Senha@123';
let server, base, owner, accountant, staffJoao, staffMaria, coLivre, coJoao, accUser;

function req(method, url, body, token, extra) {
  const headers = { 'Content-Type': 'application/json', ...(extra || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório Asg', email: 'owner.asg@test.local', password, tenantName: 'Tenant Asg' });
  owner = (await req('POST', '/api/auth/login', { email: 'owner.asg@test.local', password, tenant: a.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Contador Asg', email: 'acc.asg@test.local', password, role: 'ACCOUNTANT' }, owner.token);
  accountant = (await req('POST', '/api/auth/login', { email: 'acc.asg@test.local', password, tenant: a.data.tenant_slug })).data;
  accUser = (await req('GET', '/api/usuarios?page=1&page_size=50', undefined, owner.token)).data.items.find(x => x.role === 'ACCOUNTANT');
  await req('POST', '/api/usuarios', { name: 'João Equipe', email: 'joao.asg@test.local', password, role: 'STAFF' }, owner.token);
  staffJoao = (await req('POST', '/api/auth/login', { email: 'joao.asg@test.local', password, tenant: a.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Maria Equipe', email: 'maria.asg@test.local', password, role: 'STAFF' }, owner.token);
  staffMaria = (await req('POST', '/api/auth/login', { email: 'maria.asg@test.local', password, tenant: a.data.tenant_slug })).data;
  coLivre = (await req('POST', '/api/empresas', { name: 'Empresa Livre Ltda', cnpj: '38204469000115' }, owner.token)).data;
  coJoao = (await req('POST', '/api/empresas', { name: 'Empresa do João Ltda', cnpj: '11222333000181' }, owner.token)).data;
});
after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('flag desligada: equipe vê todas as empresas', async () => {
  const t = await req('GET', '/api/tenant', undefined, owner.token);
  assert.equal(t.status, 200);
  assert.equal(Number(t.data.assign_staff_companies), 0);
  const joao = await req('GET', '/api/empresas?page=1&page_size=50', undefined, staffJoao.token);
  const ids = (joao.data.items || []).map(x => x.id);
  assert.ok(ids.includes(coLivre.id));
  assert.ok(ids.includes(coJoao.id));
});

test('OWNER liga a configuração; STAFF não altera o flag', async () => {
  const staffPatch = await req('PATCH', '/api/tenant', { assign_staff_companies: true }, staffJoao.token);
  assert.equal(staffPatch.status, 403);
  const on = await req('PATCH', '/api/tenant', { assign_staff_companies: true }, owner.token);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(Number(on.data.assign_staff_companies), 1);
  const still = await req('GET', '/api/empresas?page=1&page_size=50', undefined, staffMaria.token);
  const ids = (still.data.items || []).map(x => x.id);
  assert.ok(ids.includes(coLivre.id));
  assert.ok(ids.includes(coJoao.id));
});

test('empresa designada some para quem não é responsável; OWNER e ACCOUNTANT continuam vendo', async () => {
  const bad = await req('PUT', `/api/empresas/${coJoao.id}/responsaveis`, { user_ids: [accUser.id] }, owner.token);
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'INVALID_ASSIGNEE');
  const put = await req('PUT', `/api/empresas/${coJoao.id}/responsaveis`, { user_ids: [staffJoao.user.id] }, accountant.token);
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.assignees.length, 1);
  assert.equal(put.data.assignees[0].user_id, staffJoao.user.id);
  const staffPut = await req('PUT', `/api/empresas/${coJoao.id}/responsaveis`, { user_ids: [] }, staffJoao.token);
  assert.equal(staffPut.status, 403);
  const joao = await req('GET', '/api/empresas?page=1&page_size=50', undefined, staffJoao.token);
  const maria = await req('GET', '/api/empresas?page=1&page_size=50', undefined, staffMaria.token);
  const ownerList = await req('GET', '/api/empresas?page=1&page_size=50', undefined, owner.token);
  const accList = await req('GET', '/api/empresas?page=1&page_size=50', undefined, accountant.token);
  assert.ok((joao.data.items || []).some(x => x.id === coJoao.id));
  assert.ok((joao.data.items || []).some(x => x.id === coLivre.id));
  assert.equal((maria.data.items || []).some(x => x.id === coJoao.id), false);
  assert.ok((maria.data.items || []).some(x => x.id === coLivre.id));
  assert.ok((ownerList.data.items || []).some(x => x.id === coJoao.id));
  assert.ok((accList.data.items || []).some(x => x.id === coJoao.id));
  const hidden = await req('GET', '/api/empresas/' + coJoao.id, undefined, staffMaria.token);
  assert.equal(hidden.status, 404);
  const scoped = await req('GET', '/api/dashboard', undefined, staffMaria.token, { 'X-Company-Id': coJoao.id });
  assert.equal(scoped.status, 404);
  const dashMaria = await req('GET', '/api/dashboard', undefined, staffMaria.token);
  assert.equal(dashMaria.data.total_companies, 1);
  const dashJoao = await req('GET', '/api/dashboard', undefined, staffJoao.token);
  assert.equal(dashJoao.data.total_companies, 2);
});

test('desligar o flag volta a mostrar tudo e mantém a designação gravada', async () => {
  const off = await req('PATCH', '/api/tenant', { assign_staff_companies: false }, owner.token);
  assert.equal(Number(off.data.assign_staff_companies), 0);
  const maria = await req('GET', '/api/empresas?page=1&page_size=50', undefined, staffMaria.token);
  assert.ok((maria.data.items || []).some(x => x.id === coJoao.id));
  const still = db.prepare('SELECT user_id FROM company_assignees WHERE company_id=?').get(coJoao.id);
  assert.equal(still.user_id, staffJoao.user.id);
});

test('UI e cache expõem o fluxo de designação', () => {
  const js = read('frontend/public/assets/app.js');
  const html = read('frontend/public/index.html');
  assert.match(js, /Contabilidade designa cliente para a equipe/);
  assert.match(js, /Designar equipe/);
  assert.match(js, /\/empresas\/'\+id\+'\/responsaveis'/);
  assert.match(html, /app\.js\?v=s39-5/);
});
