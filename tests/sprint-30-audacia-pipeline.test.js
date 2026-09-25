'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-audacia-'));
process.env.CDS_DB_PATH = path.join(tmp, 'audacia.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-audacia-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { parseFiscalXml } = require('../backend/src/document-pipeline/xml-parser');
const { OPERATION_TYPES, OPERATION_TYPE_LIST, normalizeOperationType } = require('../backend/src/document-pipeline/operation-types');
const { mergeNormalized, field, fromExtractionFields } = require('../backend/src/document-pipeline/normalized-fields');
const { computeConfidence } = require('../backend/src/document-pipeline/confidence');
const { app, db, documentPipelineService, documentStorage } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let ownerA, ownerB, companyA, companyB;
let accDebit, accCredit, planId, categoryId, bankId;

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
    return { status: r.status, data };
  });
}

async function uploadXml(token, companyId, xml, name = 'nfe.xml') {
  const form = new FormData();
  form.append('company_id', companyId);
  form.append('file', new Blob([xml], { type: 'application/xml' }), name);
  const r = await fetch(base + '/api/documentos/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': companyId },
    body: form
  });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}

function sampleNfeXml(opts = {}) {
  const {
    nNF = '12345',
    serie = '1',
    vNF = '1500.00',
    cnpj = '11222333000181',
    name = 'ENEL DISTRIBUICAO',
    chNFe = '35260111222333000181550010000123451000123456',
    dhEmi = '2026-09-15T10:00:00-03:00'
  } = opts;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chNFe}">
      <ide><nNF>${nNF}</nNF><serie>${serie}</serie><dhEmi>${dhEmi}</dhEmi><tpNF>0</tpNF><natOp>Prestacao de servico de energia</natOp></ide>
      <emit><CNPJ>${cnpj}</CNPJ><xNome>${name}</xNome></emit>
      <dest><CNPJ>04521593000100</CNPJ><xNome>CLIENTE TESTE</xNome></dest>
      <total><ICMSTot><vNF>${vNF}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner Audacia', email: 'owner.audacia@test.local', password, tenantName: 'Tenant Audacia'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.audacia@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa Audacia A', trade_name: 'AudA', cnpj: '11222333000181'
  }, ownerA.token)).data;

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner Audacia B', email: 'owner.audacia.b@test.local', password, tenantName: 'Tenant Audacia B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.audacia.b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa Audacia B', cnpj: '04521593000100'
  }, ownerB.token)).data;

  planId = crypto.randomUUID();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, ownerA.user.tenant_id, 'Plano Audacia', 'ACTIVE');
  const ins = db.prepare(
    'INSERT INTO accounts(id,tenant_id,plan_id,account_code,classification_code,account_type,description,is_postable,active) VALUES(?,?,?,?,?,?,?,?,1)'
  );
  accDebit = crypto.randomUUID();
  accCredit = crypto.randomUUID();
  ins.run(accDebit, ownerA.user.tenant_id, planId, '3210100012', '321', 'A', 'ENERGIA ELETRICA', 1);
  ins.run(accCredit, ownerA.user.tenant_id, planId, '211010001', '211', 'A', 'FORNECEDORES', 1);

  categoryId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active) VALUES(?,?,?,?,?,?,1)'
  ).run(categoryId, ownerA.user.tenant_id, companyA.id, 'Energia Elétrica', 'EXPENSE', accDebit);

  bankId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO banks(id,tenant_id,company_id,name,account_id,active) VALUES(?,?,?,?,?,1)'
  ).run(bankId, ownerA.user.tenant_id, companyA.id, 'Caixa', accCredit);

  db.prepare(
    `INSERT INTO accounting_rules(id,tenant_id,company_id,name,priority,active,conditions_json,debit_account_id,credit_account_id)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(
    crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, 'ENEL energia', 10, 1,
    JSON.stringify({ description: 'ENEL' }), accDebit, accCredit
  );
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('categorias oficiais Audácia centralizadas', () => {
  assert.ok(OPERATION_TYPE_LIST.includes(OPERATION_TYPES.COMPRA));
  assert.ok(OPERATION_TYPE_LIST.includes(OPERATION_TYPES.SERVICO_TOMADO));
  assert.ok(OPERATION_TYPE_LIST.includes(OPERATION_TYPES.PRO_LABORE));
  assert.equal(normalizeOperationType('servico tomado'), OPERATION_TYPES.SERVICO_TOMADO);
  assert.equal(normalizeOperationType('EXPENSE'), OPERATION_TYPES.DESPESA);
});

test('XML válido extrai dados estruturados', () => {
  const parsed = parseFiscalXml(sampleNfeXml());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fields.amount.value, '1500.00');
  assert.equal(parsed.fields.amount.source, 'xml');
  assert.equal(parsed.fields.amount.confidence, 0.99);
  assert.equal(parsed.fields.number.value, '12345');
  assert.equal(parsed.fields.supplier_name.value, 'ENEL DISTRIBUICAO');
  assert.equal(parsed.fields.cnpj.value, '11222333000181');
  assert.equal(parsed.fields.document_date.value, '2026-09-15');
  assert.equal(parsed.fields.competence.value, '2026-09');
});

test('XML inválido / incompleto', () => {
  assert.equal(parseFiscalXml('<root>').ok, false);
  assert.equal(parseFiscalXml('not xml').ok, false);
  const incomplete = parseFiscalXml('<?xml version="1.0"?><NFe><infNFe><ide><nNF>1</nNF></ide></infNFe></NFe>');
  assert.equal(incomplete.ok, false);
});

test('XML tem prioridade sobre OCR/texto na mescla', () => {
  const xml = parseFiscalXml(sampleNfeXml({ vNF: '1500.00' }));
  const ocrPatch = fromExtractionFields({
    total_amount: { value: '999.00', confidence: 0.9 },
    supplier_name: { value: 'OCR ERRADO', confidence: 0.8 }
  }, 'AI_VISUAL');
  const merged = mergeNormalized(xml.fields, ocrPatch);
  assert.equal(merged.amount.value, '1500.00');
  assert.equal(merged.amount.source, 'xml');
  assert.equal(merged.supplier_name.value, 'ENEL DISTRIBUICAO');
  assert.equal(merged.supplier_name.source, 'xml');
});

test('confidence bands ALTA / MÉDIA / BAIXA', () => {
  const high = computeConfidence({
    fields: {
      amount: field('100', 0.99, 'xml'),
      document_date: field('2026-01-01', 0.99, 'xml'),
      supplier_name: field('ENEL', 0.99, 'xml'),
      tax_id: field('11222333000181', 0.99, 'xml')
    },
    ruleMatched: true,
    accountsFound: true,
    balanced: true,
    operationConsistent: true,
    documentQuality: 'high'
  });
  assert.equal(high.band, 'ALTA');
  assert.ok(high.percent >= 95);

  const mid = computeConfidence({
    fields: {
      amount: field('100', 0.8, 'pdf_text'),
      document_date: field('2026-01-01', 0.8, 'pdf_text'),
      supplier_name: field('X', 0.7, 'pdf_text'),
      tax_id: field('11222333000181', 0.7, 'pdf_text')
    },
    accountsFound: true,
    balanced: true,
    operationConsistent: true,
    documentQuality: 'medium'
  });
  assert.ok(mid.percent >= 80 && mid.percent < 95, 'mid percent=' + mid.percent);
  assert.equal(mid.band, 'MÉDIA');

  const low = computeConfidence({ fields: {}, documentQuality: 'low' });
  assert.equal(low.band, 'BAIXA');
  assert.ok(low.percent < 80);
});

test('E2E: upload XML → pipeline → PENDING → aprovar → POSTED', async () => {
  assert.ok(documentPipelineService, 'pipeline service mounted');
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({ nNF: '90001' }));
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const docId = up.data.id;

  // process synchronously for test determinism
  const result = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, docId, ownerA.user.id, { force: true }
  );
  assert.ok(['PENDING', 'NEEDS_CLASSIFICATION'].includes(result.status), JSON.stringify(result));
  assert.equal(result.fields.amount.source, 'xml');
  assert.ok(result.operation_type);

  if (result.status === 'PENDING') {
    assert.ok(result.entry_id);
    assert.ok(result.confidence >= 0.8);
    const entry = await req('GET', '/api/lancamentos/' + result.entry_id, undefined, ownerA.token);
    assert.equal(entry.status, 200);
    assert.equal(entry.data.status, 'PENDING');
    assert.ok(entry.data.pipeline);

    const ap = await req('POST', '/api/aprovacao/' + result.entry_id + '/aprovar', {}, ownerA.token);
    assert.equal(ap.status, 200, JSON.stringify(ap.data));
    assert.equal(ap.data.status, 'POSTED');

    const learn = db.prepare(
      'SELECT * FROM document_learning_decisions WHERE tenant_id=? AND entry_id=?'
    ).get(ownerA.user.tenant_id, result.entry_id);
    assert.ok(learn);
    assert.equal(learn.decision, 'ACCEPTED');
  }
});

test('idempotência: reprocessar não duplica lançamento', async () => {
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({ nNF: '90002', chNFe: '35260111222333000181550010000900021000111111' }), 'nfe2.xml');
  assert.equal(up.status, 201);
  const r1 = await documentPipelineService.processDocument(ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true });
  const r2 = await documentPipelineService.processDocument(ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: false });
  if (r1.entry_id) {
    assert.equal(r2.entry_id, r1.entry_id);
  }
  const expenses = db.prepare('SELECT COUNT(*) n FROM expenses WHERE document_id=?').get(up.data.id).n;
  assert.ok(expenses <= 1);
});

test('duplicidade por hash', async () => {
  const xml = sampleNfeXml({ nNF: '90003', chNFe: '35260111222333000181550010000900031000222222' });
  const a = await uploadXml(ownerA.token, companyA.id, xml, 'dup-a.xml');
  const b = await uploadXml(ownerA.token, companyA.id, xml, 'dup-b.xml');
  await documentPipelineService.processDocument(ownerA.user.tenant_id, a.data.id, ownerA.user.id, { force: true });
  const r2 = await documentPipelineService.processDocument(ownerA.user.tenant_id, b.data.id, ownerA.user.id, { force: true });
  assert.equal(r2.status, 'DUPLICATE');
  assert.equal(r2.error_code, 'DUPLICATE_DOCUMENT');
});

test('tenant isolation no pipeline', async () => {
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({ nNF: '90004', chNFe: '35260111222333000181550010000900041000333333' }), 'iso.xml');
  const cross = await req('GET', '/api/documentos/' + up.data.id + '/pipeline', undefined, ownerB.token);
  assert.equal(cross.status, 404);
});

test('IA não posta: status máximo PENDING', async () => {
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({ nNF: '90005', chNFe: '35260111222333000181550010000900051000444444' }), 'nopost.xml');
  const r = await documentPipelineService.processDocument(ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true });
  if (r.entry_id) {
    const st = db.prepare('SELECT status FROM entries WHERE id=?').get(r.entry_id).status;
    assert.notEqual(st, 'POSTED');
    assert.equal(st, 'PENDING');
  }
});

test('natureza COMPRA a partir de NF-e tpNF=0', () => {
  const parsed = parseFiscalXml(sampleNfeXml());
  assert.equal(parsed.fields.operation_type.value, OPERATION_TYPES.COMPRA);
});

test('campo normalizado exige value/confidence/source', () => {
  const f = field(10, 0.5, 'xml');
  assert.deepEqual(Object.keys(f).sort(), ['confidence', 'source', 'value']);
});
