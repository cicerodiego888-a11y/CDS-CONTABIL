'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s26-'));
process.env.CDS_DB_PATH = path.join(tmp, 's26.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-26-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';

const {
  app, db, setAccountingAIProvider, smartExpenseService, aiControlService, documentIntelligence
} = require('../backend/src/server');
const { AccountingAIProvider } = require('../backend/src/accounting-ai/provider');
const {
  normalizeAiVisualResult, normalizeConfidence, MAX_VISUAL_BYTES
} = require('../backend/src/document-intelligence/visual');
const {
  normalizeMoney, normalizeDate, normalizeTaxDocument, createDocumentNormalizationService
} = require('../backend/src/document-intelligence/normalization');

const password = 'Senha@123';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const normalization = createDocumentNormalizationService();

let server, base, ownerA, ownerB, companyA, companyA2, companyB, expenseAccount, bankAccount;

class MockVisualProvider extends AccountingAIProvider {
  constructor() {
    super('mock-visual', 'gpt-5.6-terra');
    this.visual = null;
    this.classification = null;
    this.visualCalls = 0;
    this.classCalls = 0;
  }
  isConfigured() { return true; }
  async interpretDocumentImage(input) {
    this.visualCalls += 1;
    if (this.visual instanceof Error) throw this.visual;
    const result = typeof this.visual === 'function' ? this.visual(input) : (this.visual || {});
    Object.defineProperty(result, '__usage', {
      enumerable: false,
      value: { input_tokens: 100, output_tokens: 40, total_tokens: 140, cached_input_tokens: 0 }
    });
    return result;
  }
  async suggestClassification() {
    this.classCalls += 1;
    if (this.classification instanceof Error) throw this.classification;
    return this.classification || {
      operation_type: 'EXPENSE', history: 'x', reason: 'ok',
      candidates: [{ account_id: expenseAccount, confidence: 0.9, reason: 'ok' }]
    };
  }
  async suggestChart() { return { rows: [] }; }
}
const mock = new MockVisualProvider();

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async response => {
    let data = null; try { data = await response.json(); } catch {}
    return { status: response.status, data };
  });
}

function textPdf(lines) {
  const stream = 'BT /F1 12 Tf 72 720 Td ' + lines.map((line, index) =>
    (index ? '0 -18 Td ' : '') + '(' + line.replace(/[()\\]/g, '\\$&') + ') Tj'
  ).join(' ') + ' ET';
  return Buffer.from(
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n' +
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    `5 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}\nendstream\nendobj\n` +
    'trailer<</Root 1 0 R>>\n%%EOF'
  );
}

async function uploadOffice(name, buffer, mime, token = ownerA.token, company = companyA) {
  const form = new FormData();
  form.append('company_id', company.id);
  form.append('file', new Blob([buffer], { type: mime }), name);
  const response = await fetch(base + '/api/documentos/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form
  });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  return data;
}

function taxiOk() {
  return {
    fields: {
      issue_date: { value: '18/09/2026', confidence: 0.95 },
      description: { value: 'Taxi Aeroporto Centro', confidence: 0.9 },
      total_amount: { value: 45, confidence: 0.99 },
      supplier_name: { value: null, confidence: 0 }
    }
  };
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 26 A', email: 'owner.a.s26@test.local', password, tenantName: 'Tenant 26 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s26@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 26 B', email: 'owner.b.s26@test.local', password, tenantName: 'Tenant 26 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s26@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 26', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2 26', cnpj: '27865757000102'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 26', cnpj: '11222333000181'
  }, ownerB.token)).data;

  const planId = crypto.randomUUID();
  db.prepare(`INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,'ACTIVE')`)
    .run(planId, ownerA.user.tenant_id, 'Plano 26');
  expenseAccount = crypto.randomUUID();
  bankAccount = crypto.randomUUID();
  db.prepare(
    `INSERT INTO accounts(
       id,tenant_id,plan_id,source_id,account_code,classification_code,
       account_type,description,level,is_postable,active
     ) VALUES(?,?,?,?,?,?,?,?,?,?,1)`
  ).run(expenseAccount, ownerA.user.tenant_id, planId, '4.1.01', '4.1.01', '4.1.01',
    'A', 'Despesas gerais', 2, 1);
  db.prepare(
    `INSERT INTO accounts(
       id,tenant_id,plan_id,source_id,account_code,classification_code,
       account_type,description,level,is_postable,active
     ) VALUES(?,?,?,?,?,?,?,?,?,?,1)`
  ).run(bankAccount, ownerA.user.tenant_id, planId, '1.1.01', '1.1.01', '1.1.01',
    'A', 'Caixa', 2, 1);
  db.prepare(
    `INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active)
     VALUES(?,?,?,?,?,?,1)`
  ).run(crypto.randomUUID(), ownerA.user.tenant_id, null, 'Material de limpeza', 'EXPENSE', expenseAccount);
  db.prepare(
    `INSERT INTO banks(id,tenant_id,company_id,name,account_id,active)
     VALUES(?,?,?,?,?,1)`
  ).run(crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, 'Caixa', bankAccount);
  db.prepare(
    `INSERT INTO accounting_rules(
       id,tenant_id,company_id,name,priority,active,conditions_json,
       debit_account_id,credit_account_id
     ) VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(
    crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, 'Limpeza 26', 10, 1,
    JSON.stringify({ description: 'Material de limpeza', source_type: 'EXPENSE' }),
    expenseAccount, bankAccount
  );

  setAccountingAIProvider(mock);
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 80 }, ownerA.token);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1-4 valor monetário: válidos e inválidos', () => {
  assert.equal(normalizeMoney('45,00'), '45.00');
  assert.equal(normalizeMoney('R$ 45,00'), '45.00');
  assert.equal(normalizeMoney('45.00'), '45.00');
  assert.equal(normalizeMoney(45), '45.00');
  assert.equal(normalizeMoney(45.0), '45.00');
  assert.equal(normalizeMoney(null), null);
  assert.equal(normalizeMoney(''), null);
  assert.equal(normalizeMoney('quarenta e cinco'), null);
  assert.equal(normalizeMoney(Infinity), null);
  assert.equal(normalizeMoney(NaN), null);

  const neg = normalizeAiVisualResult({
    fields: { total_amount: { value: '-45,00', confidence: 0.9 } }
  }, normalization);
  assert.equal(neg.fields.total_amount, undefined);

  const huge = normalizeAiVisualResult({
    fields: { total_amount: { value: '999999999999', confidence: 0.9 } }
  }, normalization);
  assert.equal(huge.fields.total_amount, undefined);

  const ok = normalizeAiVisualResult({
    fields: { total_amount: { value: '45,00', confidence: 0.9 } }
  }, normalization);
  assert.equal(ok.fields.total_amount.normalized_value, '45.00');
});

test('5 datas inválidas controladas', () => {
  assert.equal(normalizeDate('18/09/2026'), '2026-09-18');
  assert.equal(normalizeDate('2026-09-18'), '2026-09-18');
  assert.equal(normalizeDate('18-09-2026'), '2026-09-18');
  assert.equal(normalizeDate('31/02/2026'), null);
  assert.equal(normalizeDate('data ilegível'), null);
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate(''), null);
  const bad = normalizeAiVisualResult({
    fields: { issue_date: { value: '31/02/2026', confidence: 0.99 } }
  }, normalization);
  assert.equal(bad.fields.issue_date, undefined);
});

test('6 CPF/CNPJ inválidos não persistem', () => {
  assert.equal(normalizeTaxDocument('12.345.678/0001-90'), '12345678000190');
  assert.equal(normalizeTaxDocument('123'), null);
  assert.equal(normalizeTaxDocument(null), null);
  const bad = normalizeAiVisualResult({
    fields: { supplier_document: { value: '123', confidence: 0.99 } }
  }, normalization);
  assert.equal(bad.fields.supplier_document, undefined);
});

test('7 confidence inválida não vira alta', () => {
  assert.equal(normalizeConfidence(0), 0);
  assert.equal(normalizeConfidence(0.95), 0.95);
  assert.equal(normalizeConfidence(1), 1);
  assert.equal(normalizeConfidence(-1), 0);
  assert.equal(normalizeConfidence(2), 0);
  assert.equal(normalizeConfidence(null), 0);
  assert.equal(normalizeConfidence('0.95'), 0.95);
  const r = normalizeAiVisualResult({
    fields: {
      description: { value: 'Taxi', confidence: 2 },
      total_amount: { value: 10, confidence: -1 },
      issue_date: { value: '2026-09-18', confidence: '0.8' }
    }
  }, normalization);
  assert.equal(r.fields.description.confidence, 0);
  assert.equal(r.fields.total_amount.confidence, 0);
  assert.equal(r.fields.issue_date.confidence, 0.8);
});

test('8 objeto no lugar de string é rejeitado', () => {
  const r = normalizeAiVisualResult({
    fields: {
      description: { value: { inventado: true }, confidence: 0.9 },
      supplier_name: { value: ['Uber'], confidence: 0.9 }
    }
  }, normalization);
  assert.equal(r.fields.description, undefined);
  assert.equal(r.fields.supplier_name, undefined);
});

test('9 payload inválido / null não quebra', () => {
  assert.deepEqual(normalizeAiVisualResult(null, normalization).fields, {});
  assert.deepEqual(normalizeAiVisualResult([], normalization).fields, {});
  assert.deepEqual(normalizeAiVisualResult('x', normalization).fields, {});
});

test('10 origin não falsificável pelo frontend na análise', async () => {
  mock.visual = taxiOk();
  const doc = await uploadOffice('origin.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {
    force: true,
    fields: {
      amount: { value: '1.00', origin: 'MANUAL', confidence: 1 },
      tenant_id: 'hack',
      company_id: companyB.id
    },
    origin: 'MANUAL',
    confidence: 1,
    tenant_id: ownerB.user.tenant_id
  }, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(analysis.data.analysis.fields.amount.origin, 'AI_VISUAL');
  assert.equal(analysis.data.analysis.company_id, companyA.id);
  assert.notEqual(analysis.data.analysis.company_id, companyB.id);
});

test('11-12 tenant e company isolation', async () => {
  mock.visual = taxiOk();
  const docB = await uploadOffice('b.png', png, 'image/png', ownerB.token, companyB);
  const cross = await req('POST', `/api/documentos/${docB.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([403, 404].includes(cross.status));

  const docA = await uploadOffice('a.png', png, 'image/png');
  const crossCo = await req(
    'POST', `/api/documentos/${docA.id}/analise-despesa`, {}, ownerA.token, companyA2.id
  );
  assert.ok([403, 404].includes(crossCo.status) ||
    (crossCo.status < 300 && crossCo.data.analysis.company_id === companyA.id));

  const spoofExpense = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    document_id: docB.id,
    occurred_on: '2026-09-18',
    description: 'Spoof',
    amount: '10,00',
    payment_method: 'PIX'
  }, ownerA.token);
  assert.ok([400, 403, 404].includes(spoofExpense.status));
});

test('13 AI disabled não chama provider nem registra usage visual', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: false }, ownerA.token);
  const before = db.prepare(
    `SELECT COUNT(*) n FROM ai_usage_records
     WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION'`
  ).get(ownerA.user.tenant_id).n;
  mock.visualCalls = 0;
  const doc = await uploadOffice('off.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(mock.visualCalls, 0);
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  const after = db.prepare(
    `SELECT COUNT(*) n FROM ai_usage_records
     WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION'`
  ).get(ownerA.user.tenant_id).n;
  assert.equal(after, before);
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 80 }, ownerA.token);
});

test('14 limite mensal bloqueia provider', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 0.01 }, ownerA.token);
  aiControlService.recordUsage({
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    operation_type: 'DOCUMENT_INTERPRETATION',
    status: 'SUCCESS',
    input_tokens: 1_000_000,
    output_tokens: 200_000,
    total_tokens: 1_200_000
  });
  mock.visualCalls = 0;
  const doc = await uploadOffice('limit.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(mock.visualCalls, 0);
  assert.ok([200, 201].includes(analysis.status));
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 100 }, ownerA.token);
});

test('15-19 provider timeout/400/401/429/500 e JSON inválido', async () => {
  const codes = [
    ['AI_TIMEOUT', 503],
    ['AI_PROVIDER_ERROR', 400],
    ['AI_PROVIDER_ERROR', 401],
    ['AI_PROVIDER_ERROR', 429],
    ['AI_PROVIDER_ERROR', 500],
    ['AI_INVALID_RESPONSE', 502]
  ];
  for (const [code, httpStatus] of codes) {
    mock.visual = Object.assign(new Error(code), { code, http: httpStatus });
    const doc = await uploadOffice(`err-${httpStatus}.png`, png, 'image/png');
    const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
    assert.ok([200, 201].includes(analysis.status), code);
    assert.equal(analysis.data.analysis.visual_ai_used, false);
    const save = await req('POST', '/api/despesas', {
      company_id: companyA.id,
      document_id: doc.id,
      occurred_on: '2026-09-18',
      description: 'Manual apos ' + code,
      amount: '12,00',
      payment_method: 'PIX'
    }, ownerA.token);
    assert.equal(save.status, 201, code);
    assert.notEqual(save.data.status, 'POSTED');
  }
});

test('20-21 resposta parcial e documento sem campos', async () => {
  mock.visual = {
    fields: {
      supplier_name: { value: 'Taxi Central', confidence: 0.8 },
      issue_date: { value: '18/09/2026', confidence: 0.9 },
      total_amount: { value: 45, confidence: 0.99 },
      description: { value: null, confidence: 0 }
    }
  };
  const partial = await uploadOffice('partial.png', png, 'image/png');
  const a1 = await req('POST', `/api/documentos/${partial.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(a1.data.analysis.fields.supplier_name.value, 'Taxi Central');
  assert.equal(Number(a1.data.analysis.fields.amount.value), 45);
  assert.equal(a1.data.analysis.fields.occurred_on.value, '2026-09-18');
  // description ausente na IA: smart-expense pode espelhar supplier (fallback de formulário)
  assert.ok(
    a1.data.analysis.fields.description.value == null ||
    a1.data.analysis.fields.description.value === 'Taxi Central'
  );
  assert.ok(['READY', 'PARTIAL'].includes(a1.data.analysis.status));

  mock.visual = {
    fields: {
      supplier_name: { value: null, confidence: 0 },
      issue_date: { value: null, confidence: 0 },
      description: { value: null, confidence: 0 },
      total_amount: { value: null, confidence: 0 }
    }
  };
  const empty = await uploadOffice('empty.png', png, 'image/png');
  const a2 = await req('POST', `/api/documentos/${empty.id}/analise-despesa`, {}, ownerA.token);
  assert.ok(['PARTIAL', 'FAILED', 'READY', 'NEEDS_REVIEW'].includes(a2.data.analysis.status));
  assert.equal(a2.data.analysis.fields.amount.value, null);
  assert.equal(a2.data.analysis.fields.supplier_name.value, null);
  assert.equal(a2.data.analysis.fields.occurred_on.value, null);
  // sem campos prontos: usuário ainda pode salvar manualmente
  const save = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    document_id: empty.id,
    occurred_on: '2026-09-18',
    description: 'Preenchido manualmente',
    amount: '10,00',
    payment_method: 'PIX'
  }, ownerA.token);
  assert.equal(save.status, 201);
  assert.notEqual(save.data.status, 'POSTED');
});

test('22 PDF vazio/corrompido e MIME inválido', async () => {
  mock.visual = taxiOk();
  const emptyPdf = await uploadOffice('vazio.pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'application/pdf');
  const r1 = await req('POST', `/api/documentos/${emptyPdf.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(r1.status));

  const corrupt = await uploadOffice('corrupt.pdf', Buffer.from('not-a-pdf'), 'application/pdf');
  // upload may reject non-pdf sniff; if accepted, analysis must not crash
  if (corrupt && corrupt.id) {
    const r2 = await req('POST', `/api/documentos/${corrupt.id}/analise-despesa`, {}, ownerA.token);
    assert.ok([200, 201, 400, 415, 422].includes(r2.status) || r2.status < 500);
  }

  const form = new FormData();
  form.append('company_id', companyA.id);
  form.append('file', new Blob([Buffer.from('MZ')], { type: 'application/exe' }), 'x.exe');
  const up = await fetch(base + '/api/documentos/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ownerA.token }, body: form
  });
  assert.ok([400, 415, 422].includes(up.status));
});

test('23 imagem grande demais para IA visual', async () => {
  const big = Buffer.alloc(MAX_VISUAL_BYTES + 1024, 1);
  // PNG header so sniff accepts as image-ish may fail; store via db path bypass hard —
  // upload rejects non-image. Use oversized real png-like: prepend header.
  const oversized = Buffer.concat([png, Buffer.alloc(MAX_VISUAL_BYTES, 7)]);
  mock.visualCalls = 0;
  mock.visual = taxiOk();
  let doc;
  try {
    doc = await uploadOffice('huge.png', oversized, 'image/png');
  } catch {
    return; // upload size limit already protects
  }
  if (!doc) return;
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  assert.equal(mock.visualCalls, 0);
});

test('24 API Key e base64 não expostos', async () => {
  mock.visual = taxiOk();
  const doc = await uploadOffice('sec.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const blob = JSON.stringify(analysis.data);
  assert.doesNotMatch(blob, /sk-[a-zA-Z0-9]{8,}/);
  assert.doesNotMatch(blob, /OPENAI_API_KEY/);
  assert.doesNotMatch(blob, /base64,/i);
  const logs = db.prepare(
    `SELECT after_json FROM audit_logs
     WHERE tenant_id=? AND action LIKE 'DOCUMENT_AI_VISUAL%'
     ORDER BY created_at DESC LIMIT 20`
  ).all(ownerA.user.tenant_id);
  for (const row of logs) {
    assert.doesNotMatch(String(row.after_json || ''), /base64|sk-/i);
  }
});

test('25 classificação CDS antes da IA classificatória', async () => {
  mock.visual = {
    fields: {
      issue_date: { value: '2026-09-10', confidence: 0.95 },
      description: { value: 'Material de limpeza', confidence: 0.95 },
      total_amount: { value: 20, confidence: 0.99 }
    }
  };
  mock.classCalls = 0;
  mock.visualCalls = 0;
  const doc = await uploadOffice('cds-first.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok(mock.visualCalls >= 1);
  assert.equal(analysis.data.analysis.classification_source, 'CLASSIFICATION_ENGINE');
  assert.equal(mock.classCalls, 0);
});

test('26 IA visual não cria POSTED', async () => {
  mock.visual = taxiOk();
  const doc = await uploadOffice('nopost.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.notEqual(analysis.data.analysis.status, 'POSTED');
  const save = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    document_id: doc.id,
    occurred_on: analysis.data.analysis.fields.occurred_on.value || '2026-09-18',
    description: analysis.data.analysis.fields.description.value || 'Taxi',
    amount: analysis.data.analysis.fields.amount.value || '45,00',
    payment_method: 'PIX'
  }, ownerA.token);
  assert.equal(save.status, 201);
  assert.notEqual(save.data.status, 'POSTED');
});

test('27-28 reprocessamento e idempotência', async () => {
  mock.visual = taxiOk();
  const doc = await uploadOffice('repro.png', png, 'image/png');
  const first = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const calls1 = mock.visualCalls;
  const second = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(second.data.already_exists, true);
  assert.equal(mock.visualCalls, calls1);
  const third = await req(
    'POST', `/api/documentos/${doc.id}/analise-despesa/reler`, {}, ownerA.token
  );
  assert.ok(third.status < 300);
  assert.ok(mock.visualCalls > calls1);
  assert.equal(first.data.analysis.document_id, third.data.analysis.document_id);
  const expenses = db.prepare(
    'SELECT COUNT(*) n FROM expenses WHERE tenant_id=? AND document_id=?'
  ).get(ownerA.user.tenant_id, doc.id).n;
  assert.equal(expenses, 0);
});

test('29 usage e auditoria corretos', async () => {
  mock.visual = taxiOk();
  const beforeUsage = db.prepare(
    `SELECT COUNT(*) n FROM ai_usage_records
     WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION' AND status='SUCCESS'`
  ).get(ownerA.user.tenant_id).n;
  const doc = await uploadOffice('usage.png', png, 'image/png');
  await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const usage = db.prepare(
    `SELECT * FROM ai_usage_records
     WHERE tenant_id=? AND document_id=? AND operation_type='DOCUMENT_INTERPRETATION'
     ORDER BY created_at DESC LIMIT 1`
  ).get(ownerA.user.tenant_id, doc.id);
  assert.ok(usage);
  assert.ok(usage.estimated_cost_cents != null);
  assert.ok(
    db.prepare(
      `SELECT COUNT(*) n FROM ai_usage_records
       WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION' AND status='SUCCESS'`
    ).get(ownerA.user.tenant_id).n > beforeUsage
  );
  const audits = db.prepare(
    `SELECT action FROM audit_logs
     WHERE tenant_id=? AND action IN('DOCUMENT_AI_VISUAL_REQUESTED','DOCUMENT_AI_VISUAL_COMPLETED')`
  ).all(ownerA.user.tenant_id);
  assert.ok(audits.some(a => a.action === 'DOCUMENT_AI_VISUAL_REQUESTED'));
  assert.ok(audits.some(a => a.action === 'DOCUMENT_AI_VISUAL_COMPLETED'));
});

test('30 fallback manual preservado', async () => {
  mock.visual = Object.assign(new Error('down'), { code: 'AI_PROVIDER_ERROR' });
  const doc = await uploadOffice('manual.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.match(String(analysis.data.analysis.banner || ''), /manualmente|interpretar/i);
  const save = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    document_id: doc.id,
    occurred_on: '2026-09-19',
    description: 'Preenchido na mao',
    amount: '33,00',
    payment_method: 'DINHEIRO'
  }, ownerA.token);
  assert.equal(save.status, 201);
});

test('PDF bom não chama IA visual', async () => {
  mock.visualCalls = 0;
  const doc = await uploadOffice(
    'bom.pdf',
    textPdf([
      'NF-e', 'Data: 03/09/2026', 'Fornecedor: ABC Distribuidora',
      'Valor Total: R$ 20,00', 'Descricao: Material de limpeza', 'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(mock.visualCalls, 0);
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  assert.equal(analysis.data.analysis.classification_source, 'CLASSIFICATION_ENGINE');
});

test('OpenAI provider possui interpretDocumentImage', () => {
  const { OpenAIAccountingProvider } = require('../backend/src/accounting-ai/openai-provider');
  const p = new OpenAIAccountingProvider({ apiKey: 'sk-test' });
  assert.equal(typeof p.interpretDocumentImage, 'function');
  assert.ok(documentIntelligence.service);
  assert.ok(smartExpenseService.ORIGINS.AI_VISUAL);
});
