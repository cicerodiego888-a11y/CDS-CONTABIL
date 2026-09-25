'use strict';

/**
 * Sprint 36.1 — codigo_cliente (CLI-000001) por tenant.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s361-'));
process.env.CDS_DB_PATH = path.join(tmp, 's361.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-s361-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { formatClientCode, isValidClientCode, backfillClientCodes } = require('../backend/src/empresas/client-code');
const { app, db } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let ownerA, ownerB, slugA, slugB;

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await req('POST', '/api/auth/register', {
    name: 'Owner A', email: 'owner.a.s361@test.local', password, tenantName: 'Tenant A S361'
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  slugA = a.data.tenant_slug;
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s361@test.local', password, tenant: slugA
  })).data;

  const b = await req('POST', '/api/auth/register', {
    name: 'Owner B', email: 'owner.b.s361@test.local', password, tenantName: 'Tenant B S361'
  });
  slugB = b.data.tenant_slug;
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s361@test.local', password, tenant: slugB
  })).data;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
});

test('formato CLI-000001', () => {
  assert.equal(formatClientCode(1), 'CLI-000001');
  assert.equal(formatClientCode(12), 'CLI-000012');
  assert.ok(isValidClientCode('CLI-000001'));
  assert.ok(!isValidClientCode('CLI-1'));
  assert.ok(!isValidClientCode('000001'));
});

test('1-3 primeiro e segundo cliente na sequência', async () => {
  const c1 = await req('POST', '/api/empresas', {
    name: 'Empresa Um LTDA', cnpj: '11.222.333/0001-81'
  }, ownerA.token);
  assert.equal(c1.status, 201, JSON.stringify(c1.data));
  assert.equal(c1.data.codigo_cliente, 'CLI-000001');
  assert.ok(c1.data.id);
  assert.equal(c1.data.cnpj, '11.222.333/0001-81');

  const c2 = await req('POST', '/api/empresas', {
    name: 'Empresa Dois LTDA', cnpj: '22.333.444/0001-55'
  }, ownerA.token);
  assert.equal(c2.status, 201, JSON.stringify(c2.data));
  assert.equal(c2.data.codigo_cliente, 'CLI-000002');
  assert.notEqual(c2.data.id, c1.data.id);
});

test('4-5 sequência independente por tenant; mesmo código permitido', async () => {
  const c = await req('POST', '/api/empresas', {
    name: 'Empresa Tenant B', cnpj: '33.444.555/0001-66'
  }, ownerB.token);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.codigo_cliente, 'CLI-000001');
  assert.notEqual(c.data.tenant_id, ownerA.user.tenant_id);
});

test('7-8 geração automática; usuário não escolhe código', async () => {
  const c = await req('POST', '/api/empresas', {
    name: 'Empresa Forced Code',
    cnpj: '44.555.666/0001-77',
    codigo_cliente: 'CLI-999999',
    client_code: 'CLI-888888',
    company_id: 'hack-id',
    tenant_id: ownerB.user.tenant_id
  }, ownerA.token);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.codigo_cliente, 'CLI-000003');
  assert.notEqual(c.data.id, 'hack-id');
  assert.equal(c.data.tenant_id, ownerA.user.tenant_id);

  const patch = await req('PATCH', '/api/empresas/' + c.data.id, {
    codigo_cliente: 'CLI-111111',
    name: 'Empresa Forced Code Alt'
  }, ownerA.token);
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.equal(patch.data.codigo_cliente, 'CLI-000003');
  assert.equal(patch.data.name, 'Empresa Forced Code Alt');
});

test('9-10 CNPJ e company_id preservados', async () => {
  const list = await req('GET', '/api/empresas', undefined, ownerA.token);
  assert.equal(list.status, 200);
  const items = list.data.items || [];
  const one = items.find(x => x.codigo_cliente === 'CLI-000001');
  assert.ok(one);
  assert.equal(one.cnpj, '11.222.333/0001-81');
  assert.ok(one.id);
  const get = await req('GET', '/api/empresas/' + one.id, undefined, ownerA.token);
  assert.equal(get.status, 200);
  assert.equal(get.data.codigo_cliente, 'CLI-000001');
  assert.equal(get.data.id, one.id);
});

test('11 matriz/filial: CNPJs distintos geram códigos distintos sem alterar fiscal', async () => {
  const matriz = await req('POST', '/api/empresas', {
    name: 'ABC Matriz', cnpj: '10.111.222/0001-33'
  }, ownerA.token);
  const filial = await req('POST', '/api/empresas', {
    name: 'ABC Filial', cnpj: '10.111.222/0002-14'
  }, ownerA.token);
  assert.equal(matriz.status, 201, JSON.stringify(matriz.data));
  assert.equal(filial.status, 201, JSON.stringify(filial.data));
  assert.notEqual(matriz.data.codigo_cliente, filial.data.codigo_cliente);
  assert.equal(matriz.data.cnpj, '10.111.222/0001-33');
  assert.equal(filial.data.cnpj, '10.111.222/0002-14');
  assert.match(matriz.data.codigo_cliente, /^CLI-\d{6}$/);
  assert.match(filial.data.codigo_cliente, /^CLI-\d{6}$/);
});

test('12-13-19 backfill idempotente; já codificados não mudam', async () => {
  const orphanId = require('crypto').randomUUID();
  db.prepare(
    `INSERT INTO companies(id,tenant_id,name,cnpj,status,created_at)
     VALUES(?,?,?,?, 'ACTIVE', datetime('now','-1 day'))`
  ).run(orphanId, ownerA.user.tenant_id, 'Orphan Sem Código', '55.666.777/0001-88');

  const before = db.prepare('SELECT codigo_cliente FROM companies WHERE id=?').get(
    db.prepare("SELECT id FROM companies WHERE tenant_id=? AND codigo_cliente='CLI-000001'").get(ownerA.user.tenant_id).id
  ).codigo_cliente;

  const r1 = backfillClientCodes(db);
  assert.ok(r1.assigned >= 1);
  const orphan = db.prepare('SELECT codigo_cliente FROM companies WHERE id=?').get(orphanId);
  assert.ok(isValidClientCode(orphan.codigo_cliente));

  const r2 = backfillClientCodes(db);
  assert.equal(r2.assigned, 0);
  const after = db.prepare(
    "SELECT codigo_cliente FROM companies WHERE tenant_id=? AND name='Empresa Um LTDA'"
  ).get(ownerA.user.tenant_id);
  assert.equal(after.codigo_cliente, before);
});

test('14 concorrência básica: códigos distintos', async () => {
  const jobs = Array.from({ length: 5 }, (_, i) => req('POST', '/api/empresas', {
    name: 'Conc ' + i,
    cnpj: `66.777.88${i}/0001-9${i}`
  }, ownerB.token));
  const results = await Promise.all(jobs);
  const ok = results.filter(r => r.status === 201);
  assert.ok(ok.length >= 4, JSON.stringify(results.map(r => ({ s: r.status, e: r.data && r.data.error }))));
  const codes = ok.map(r => r.data.codigo_cliente);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^CLI-\d{6}$/);
});

test('15-17 isolamento tenant; sem permissão em outro tenant', async () => {
  const aList = await req('GET', '/api/empresas', undefined, ownerA.token);
  const bCompany = db.prepare(
    'SELECT id,codigo_cliente FROM companies WHERE tenant_id=? LIMIT 1'
  ).get(ownerB.user.tenant_id);
  assert.ok(bCompany);
  assert.ok(!(aList.data.items || []).some(x => x.id === bCompany.id));
  const cross = await req('GET', '/api/empresas/' + bCompany.id, undefined, ownerA.token);
  assert.equal(cross.status, 404);
});

test('16 API retorna codigo_cliente', async () => {
  const list = await req('GET', '/api/empresas', undefined, ownerA.token);
  assert.ok((list.data.items || []).every(x => isValidClientCode(x.codigo_cliente)));
});

test('6 duplicação proibida no mesmo tenant (índice único)', () => {
  const row = db.prepare(
    "SELECT id,tenant_id,codigo_cliente FROM companies WHERE tenant_id=? AND codigo_cliente='CLI-000001'"
  ).get(ownerA.user.tenant_id);
  assert.throws(() => {
    db.prepare(
      `INSERT INTO companies(id,tenant_id,name,status,codigo_cliente) VALUES(?,?,?,'ACTIVE',?)`
    ).run(require('crypto').randomUUID(), row.tenant_id, 'Dup', row.codigo_cliente);
  });
});

test('18 auditoria CLIENT_CODE_GENERATED', () => {
  const audits = db.prepare(
    "SELECT action, after_json FROM audit_logs WHERE tenant_id=? AND action='CLIENT_CODE_GENERATED' ORDER BY created_at"
  ).all(ownerA.user.tenant_id);
  assert.ok(audits.length >= 1);
  const payload = JSON.parse(audits[0].after_json || '{}');
  assert.ok(isValidClientCode(payload.codigo_cliente));
  assert.ok(payload.company_id || payload.company_id === undefined);
});

test('20 nenhum código inválido', () => {
  const bad = db.prepare(
    `SELECT id,codigo_cliente FROM companies
     WHERE codigo_cliente IS NOT NULL AND codigo_cliente <> ''
       AND codigo_cliente NOT GLOB 'CLI-[0-9][0-9][0-9][0-9][0-9][0-9]'`
  ).all();
  assert.equal(bad.length, 0, JSON.stringify(bad));
});
