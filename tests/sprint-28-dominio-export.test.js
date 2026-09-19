'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s28-'));
process.env.CDS_DB_PATH = path.join(tmp, 's28.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-sprint-28-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { createDominioAdapter } = require('../backend/src/export/dominio-adapter');
const { app, db, exportService } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let ownerA, ownerB, companyA, companyB;
let accA, accB, accC, accD, accBank;
let planId;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data, headers: r.headers };
  });
}

function assertNoSecrets(obj, label) {
  const raw = JSON.stringify(obj || {});
  assert.doesNotMatch(raw, /sk-[a-zA-Z0-9]/i, label);
  assert.doesNotMatch(raw, /password_hash/, label);
  assert.doesNotMatch(raw, /token_hash/, label);
  assert.doesNotMatch(raw, /"Authorization"/i, label);
}

async function mapAccount(accountId, code) {
  const r = await req('PUT', `/api/empresas/${companyA.id}/integracoes/dominio/mapeamentos`, {
    account_id: accountId, external_code: code
  }, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

async function createPosted(desc, lines, date = '2026-01-15') {
  const e = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: date, description: desc, lines
  }, ownerA.token);
  assert.equal(e.status, 201, JSON.stringify(e.data));
  const ap = await req('POST', '/api/aprovacao/' + e.data.id + '/aprovar', {}, ownerA.token);
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.equal(ap.data.status, 'POSTED');
  return e.data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner S28A', email: 'owner.s28a@test.local', password, tenantName: 'Tenant S28A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s28a@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa S28 A', trade_name: 'S28A', cnpj: '11222333000181'
  }, ownerA.token)).data;

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner S28B', email: 'owner.s28b@test.local', password, tenantName: 'Tenant S28B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.s28b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa S28 B', cnpj: '04521593000100'
  }, ownerB.token)).data;

  planId = crypto.randomUUID();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, ownerA.user.tenant_id, 'Plano S28', 'ACTIVE');
  const ins = db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,account_code,classification_code,account_type,description,is_postable,active) VALUES(?,?,?,?,?,?,?,?,1)'
  );
  accA = crypto.randomUUID();
  accB = crypto.randomUUID();
  accC = crypto.randomUUID();
  accD = crypto.randomUUID();
  accBank = crypto.randomUUID();
  // Contas inspiradas no modelo Domínio (capital / múltiplos débitos / depósito)
  ins.run(accA, ownerA.user.tenant_id, planId, '3210100012', '321', 'A', 'COMBUSTIVEL', 1);
  ins.run(accB, ownerA.user.tenant_id, planId, '111010001', '111', 'A', 'CAIXA GERAL', 1);
  ins.run(accC, ownerA.user.tenant_id, planId, '211010001', '211', 'A', 'CAPITAL SOCIAL', 1);
  ins.run(accD, ownerA.user.tenant_id, planId, '112010001', '112', 'A', 'BANCO C/C', 1);
  ins.run(accBank, ownerA.user.tenant_id, planId, '112020001', '112', 'A', 'APLICACOES', 1);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 adapter Domínio é selecionado', () => {
  const adapter = exportService.registry.get('dominio');
  assert.ok(adapter);
  assert.equal(adapter.metadata().system_key, 'dominio');
  assert.equal(adapter.metadata().layout.code, '11758');
});

test('2-5 somente POSTED; NC/PENDING/REJECTED fora', async () => {
  await mapAccount(accA, '5');
  await mapAccount(accB, '10');
  const posted = await createPosted('POSTED ok', [
    { account_id: accA, side: 'D', amount_cents: 1000 },
    { account_id: accB, side: 'C', amount_cents: 1000 }
  ], '2026-01-10');
  const nc = await req('POST', '/api/despesas', {
    company_id: companyA.id, occurred_on: '2026-01-10', description: 'NC', amount: '10,00', payment_method: 'PIX'
  }, ownerA.token);
  const pend = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2026-01-10', description: 'PEND',
    lines: [{ account_id: accA, side: 'D', amount_cents: 500 }, { account_id: accB, side: 'C', amount_cents: 500 }]
  }, ownerA.token);
  const rej = await req('POST', '/api/lancamentos', {
    company_id: companyA.id, occurred_on: '2026-01-10', description: 'REJ',
    lines: [{ account_id: accA, side: 'D', amount_cents: 700 }, { account_id: accB, side: 'C', amount_cents: 700 }]
  }, ownerA.token);
  await req('POST', '/api/aprovacao/' + rej.data.id + '/rejeitar', { reason: 'x' }, ownerA.token);

  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-10', period_end: '2026-01-10'
  }, ownerA.token);
  assert.equal(exp.status, 201, JSON.stringify(exp.data));
  const ids = db.prepare('SELECT entry_id FROM export_items WHERE export_id=?').all(exp.data.id).map(x => x.entry_id);
  assert.ok(ids.includes(posted.id));
  assert.ok(!ids.includes(nc.data.entry_id));
  assert.ok(!ids.includes(pend.data.id));
  assert.ok(!ids.includes(rej.data.id));
});

test('6 lançamento 1x1 gera uma linha Domínio', async () => {
  await mapAccount(accA, '5');
  await mapAccount(accB, '10');
  await createPosted('Combustivel PIX', [
    { account_id: accA, side: 'D', amount_cents: 5000 },
    { account_id: accB, side: 'C', amount_cents: 5000 }
  ], '2026-01-11');
  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-11', period_end: '2026-01-11'
  }, ownerA.token);
  assert.equal(exp.status, 201);
  const row = db.prepare('SELECT file_path FROM exports WHERE id=?').get(exp.data.id);
  const text = fs.readFileSync(row.file_path, 'latin1');
  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const cols = lines[0].split(';');
  assert.equal(cols.length, 10);
  assert.equal(cols[0], '11/01/2026');
  assert.equal(cols[1], '5');
  assert.equal(cols[2], '10');
  assert.equal(cols[3], '50,00');
  assert.equal(cols[4], '');
  assert.match(cols[5], /Combustivel/);
  assert.equal(cols[6], '1');
  assert.equal(cols[7], '');
  assert.equal(cols[8], '');
  assert.equal(cols[9], '');
  assert.doesNotMatch(text, /\|/);
  assert.doesNotMatch(text, /3210100012/);
});

test('7-9 N x N gera várias linhas sem |', async () => {
  // Integração capital social (modelo planilha): D 10.000 + D 90.000 / C 100.000
  await mapAccount(accA, '1');
  await mapAccount(accB, '2');
  await mapAccount(accC, '3');
  await createPosted('Integracao de Capital Social', [
    { account_id: accA, side: 'D', amount_cents: 1000000 },
    { account_id: accB, side: 'D', amount_cents: 9000000 },
    { account_id: accC, side: 'C', amount_cents: 10000000 }
  ], '2026-01-12');
  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-12', period_end: '2026-01-12'
  }, ownerA.token);
  assert.equal(exp.status, 201);
  assert.equal(exp.data.line_count, 3);
  const text = fs.readFileSync(db.prepare('SELECT file_path FROM exports WHERE id=?').get(exp.data.id).file_path, 'latin1');
  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  lines.forEach(l => assert.equal(l.split(';').length, 10));
  assert.equal(lines[0].split(';')[6], '1');
  assert.equal(lines[1].split(';')[6], '');
  assert.equal(lines[2].split(';')[6], '');
  const debitLines = lines.filter(l => l.split(';')[1] && !l.split(';')[2]);
  const creditLines = lines.filter(l => !l.split(';')[1] && l.split(';')[2]);
  assert.equal(debitLines.length, 2);
  assert.equal(creditLines.length, 1);
  const debitCodes = debitLines.map(l => l.split(';')[1]).sort();
  const debitAmts = debitLines.map(l => l.split(';')[3]).sort();
  assert.deepEqual(debitCodes, ['1', '2']);
  assert.deepEqual(debitAmts, ['10000,00', '90000,00']);
  assert.equal(creditLines[0].split(';')[2], '3');
  assert.equal(creditLines[0].split(';')[3], '100000,00');
  assert.doesNotMatch(text, /\|/);
  assert.doesNotMatch(text, /\d\.\d{3},\d{2}/); // sem milhar
});

test('10 lançamento não balanceado é bloqueado na geração Domínio', () => {
  const adapter = createDominioAdapter();
  const v = adapter.validate({
    unbalanced_entries: [{ id: 'x' }],
    unmapped_accounts: [],
    invalid_entries: []
  });
  assert.equal(v.ok, false);
  assert.match(v.errors[0].message, /não balanceado/i);
});

test('11 conta sem mapeamento bloqueia geração', async () => {
  db.prepare("DELETE FROM account_external_mappings WHERE company_id=?").run(companyA.id);
  await createPosted('Sem map', [
    { account_id: accA, side: 'D', amount_cents: 100 },
    { account_id: accB, side: 'C', amount_cents: 100 }
  ], '2026-01-13');
  const prev = await req('POST', '/api/exportacoes/previa', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-13', period_end: '2026-01-13'
  }, ownerA.token);
  assert.equal(prev.status, 200);
  assert.equal(prev.data.can_generate, false);
  assert.match(prev.data.message, /sem mapeamento/i);
  assert.ok(prev.data.unmapped_count >= 2);
  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-13', period_end: '2026-01-13'
  }, ownerA.token);
  assert.equal(exp.status, 422);
  assert.equal(exp.data.error, 'UNMAPPED_ACCOUNTS');
});

test('12-13 tenant e company isolation', async () => {
  const cross = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyB.id, system_key: 'dominio', period_start: '2026-01-01', period_end: '2026-01-31'
  }, ownerA.token);
  assert.ok([400, 403, 404].includes(cross.status));
  const mapCross = await req('PUT', `/api/empresas/${companyB.id}/integracoes/dominio/mapeamentos`, {
    account_id: accA, external_code: '99'
  }, ownerA.token);
  assert.ok([403, 404].includes(mapCross.status));
});

test('14-15 código externo usado; account_code interno não vaza sem mapeamento', async () => {
  await mapAccount(accA, '854');
  await mapAccount(accD, '99');
  await createPosted('Deposito C/C', [
    { account_id: accA, side: 'D', amount_cents: 25000 },
    { account_id: accD, side: 'C', amount_cents: 25000 }
  ], '2026-01-14');
  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-14', period_end: '2026-01-14'
  }, ownerA.token);
  const text = fs.readFileSync(db.prepare('SELECT file_path FROM exports WHERE id=?').get(exp.data.id).file_path, 'latin1');
  assert.match(text, /;854;/);
  assert.match(text, /;99;/);
  assert.doesNotMatch(text, /3210100012|112010001/);
});

test('16-23 formatação layout 11758', () => {
  const adapter = createDominioAdapter();
  const out = adapter.generate([{
    id: 'e1',
    occurred_on: '2026-01-01',
    description: 'Historico teste',
    lines: [
      { side: 'D', external_code: '5', amount_cents: 123456 },
      { side: 'C', external_code: '8', amount_cents: 123456 }
    ]
  }], { period_start: '2026-01-01', period_end: '2026-01-31', company_name: 'Demo' });
  assert.equal(out.lineCount, 1);
  const cols = out.text.trim().split(';');
  assert.equal(cols.length, 10);
  assert.equal(cols[0], '01/01/2026');
  assert.equal(cols[3], '1234,56');
  assert.equal(cols[4], '');
  assert.equal(cols[5], 'Historico teste');
  assert.equal(cols[6], '1');
  assert.equal(cols[7], '');
  assert.equal(cols[8], '');
  assert.equal(cols[9], '');
  assert.match(out.fileName, /^dominio-demo-2026-01-01-2026-01-31\.txt$/);
});

test('24-27 checksum, export_items, download, auditoria', async () => {
  await mapAccount(accA, '5');
  await mapAccount(accB, '10');
  const posted = await createPosted('Audit export', [
    { account_id: accA, side: 'D', amount_cents: 2000 },
    { account_id: accB, side: 'C', amount_cents: 2000 }
  ], '2026-01-16');
  const exp = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'dominio', period_start: '2026-01-16', period_end: '2026-01-16'
  }, ownerA.token);
  assert.equal(exp.status, 201);
  assert.match(exp.data.checksum, /^[a-f0-9]{64}$/);
  const items = db.prepare('SELECT entry_id FROM export_items WHERE export_id=?').all(exp.data.id);
  assert.ok(items.some(x => x.entry_id === posted.id));
  const audit = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='EXPORT_CREATED' AND entity_id=?").get(exp.data.id).n;
  assert.ok(audit >= 1);
  const dl = await fetch(base + '/api/exportacoes/' + exp.data.id + '/download', {
    headers: { Authorization: 'Bearer ' + ownerA.token }
  });
  assert.equal(dl.status, 200);
  const body = await dl.text();
  assert.match(body, /;/);
  assert.equal(body.trim().split(/\r?\n/)[0].split(';').length, 10);
  assertNoSecrets(exp.data, 'export');
});

test('28-29 CSV canônico e outros system_key continuam', async () => {
  await createPosted('Canonical', [
    { account_id: accA, side: 'D', amount_cents: 3000 },
    { account_id: accB, side: 'C', amount_cents: 3000 }
  ], '2026-01-17');
  const canon = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'contaazul', period_start: '2026-01-17', period_end: '2026-01-17'
  }, ownerA.token);
  assert.equal(canon.status, 201);
  assert.match(canon.data.format || '', /canônico|canonico/i);
  const text = fs.readFileSync(db.prepare('SELECT file_path FROM exports WHERE id=?').get(canon.data.id).file_path, 'utf8');
  assert.match(text, /contas_debito/);
  assert.match(text, /3210100012/); // canônico usa account_code CDS
  assert.match(text, /Canonical/);
  const other = await req('POST', '/api/exportacoes/gerar', {
    company_id: companyA.id, system_key: 'alterdata', period_start: '2026-01-17', period_end: '2026-01-17'
  }, ownerA.token);
  assert.equal(other.status, 201);
});

test('30 integrity e foreign keys', () => {
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('31 nota Inicia Lote: XML usa 1 (não 99/854 do exemplo XLSX)', () => {
  const meta = createDominioAdapter().metadata();
  assert.equal(meta.layout.code, '11758');
  // Documented behavior: lote indicator is always "1" on first row of the batch
  const out = createDominioAdapter().generate([{
    occurred_on: '2026-01-01',
    description: 'lote',
    lines: [
      { side: 'D', external_code: '1', amount_cents: 100 },
      { side: 'D', external_code: '2', amount_cents: 100 },
      { side: 'C', external_code: '3', amount_cents: 200 }
    ]
  }], { company_name: 'x', period_start: 'a', period_end: 'b' });
  const starts = out.text.trim().split(/\r?\n/).map(l => l.split(';')[6]);
  assert.deepEqual(starts, ['1', '', '']);
});
