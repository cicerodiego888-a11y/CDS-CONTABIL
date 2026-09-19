'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s25-'));
process.env.CDS_DB_PATH = path.join(tmp, 's25.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-25-secret-ok';
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
const { normalizeAiVisualResult, isExtractionSufficient } = require('../backend/src/document-intelligence/visual');
const { createDocumentNormalizationService } = require('../backend/src/document-intelligence/normalization');

const password = 'Senha@123';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');

let server, base, ownerA, ownerB, companyA, companyB, expenseAccount, bankAccount;

class MockVisualProvider extends AccountingAIProvider {
  constructor() {
    super('mock-visual', 'gpt-5.6-terra');
    this.visual = null;
    this.classification = null;
    this.visualCalls = 0;
    this.classCalls = 0;
    this.lastVisual = null;
    this.logs = [];
  }
  isConfigured() { return true; }
  async interpretDocumentImage(input) {
    this.visualCalls += 1;
    this.lastVisual = {
      documentId: input.documentId,
      mimeType: input.mimeType,
      hasImage: !!input.imageBase64,
      textLen: input.textExcerpt ? String(input.textExcerpt).length : 0
    };
    if (this.visual instanceof Error) throw this.visual;
    const result = typeof this.visual === 'function' ? this.visual(input) : this.visual;
    Object.defineProperty(result, '__usage', {
      enumerable: false,
      value: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500, cached_input_tokens: 0 }
    });
    return result;
  }
  async suggestClassification(context) {
    this.classCalls += 1;
    if (this.classification instanceof Error) throw this.classification;
    return this.classification;
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

function taxiVisual() {
  return {
    document_type: 'recibo',
    supplier_name: null,
    issue_date: '2026-09-18',
    description: 'Taxi Aeroporto → Centro',
    total_amount: 45.00,
    payment_method: null,
    supplier_document: null,
    document_number: null,
    fields: {
      document_type: { value: 'recibo', confidence: 0.9 },
      supplier_name: { value: null, confidence: 0 },
      issue_date: { value: '18/09/2026', confidence: 0.95 },
      description: { value: 'Taxi Aeroporto → Centro', confidence: 0.9 },
      total_amount: { value: 45.00, confidence: 0.99 },
      payment_method: { value: null, confidence: 0 },
      supplier_document: { value: null, confidence: 0 },
      document_number: { value: null, confidence: 0 }
    }
  };
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 25 A', email: 'owner.a.s25@test.local', password, tenantName: 'Tenant 25 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s25@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 25 B', email: 'owner.b.s25@test.local', password, tenantName: 'Tenant 25 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s25@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 25', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 25', cnpj: '11222333000181'
  }, ownerB.token)).data;

  const planId = crypto.randomUUID();
  db.prepare(`INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,'ACTIVE')`)
    .run(planId, ownerA.user.tenant_id, 'Plano 25');
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
    crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, 'Limpeza 25', 10, 1,
    JSON.stringify({ description: 'Material de limpeza', source_type: 'EXPENSE' }),
    expenseAccount, bankAccount
  );

  setAccountingAIProvider(mock);
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 50 }, ownerA.token);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 PNG chama IA visual', async () => {
  mock.visualCalls = 0;
  mock.visual = taxiVisual();
  const doc = await uploadOffice('taxi.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.ok(mock.visualCalls >= 1);
  assert.equal(analysis.data.analysis.visual_ai_used, true);
  assert.equal(analysis.data.analysis.fields.amount.value, '45.00');
  assert.equal(analysis.data.analysis.fields.occurred_on.value, '2026-09-18');
  assert.equal(analysis.data.analysis.fields.description.origin, 'AI_VISUAL');
  assert.equal(analysis.data.analysis.fields.supplier_name.value, null);
  assert.match(analysis.data.analysis.banner, /Analisado pela IA|Documento analisado/);
});

test('2 JPG chama IA visual', async () => {
  mock.visualCalls = 0;
  mock.visual = taxiVisual();
  const doc = await uploadOffice('cupom.jpg', jpg, 'image/jpeg');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.ok(mock.visualCalls >= 1);
  assert.equal(analysis.data.analysis.visual_ai_used, true);
});

test('3 PDF textual suficiente NÃO chama IA visual', async () => {
  mock.visualCalls = 0;
  const doc = await uploadOffice(
    'ok.pdf',
    textPdf([
      'NF-e', 'Data: 03/09/2026', 'Fornecedor: ABC Distribuidora',
      'Valor Total: R$ 20,00', 'Descricao: Material de limpeza', 'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.equal(mock.visualCalls, 0);
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  assert.equal(analysis.data.analysis.classification_source, 'CLASSIFICATION_ENGINE');
});

test('4 PDF insuficiente pode chamar IA visual', async () => {
  mock.visualCalls = 0;
  mock.visual = taxiVisual();
  const doc = await uploadOffice(
    'weak.pdf',
    textPdf(['Documento', 'Sem padrao util']),
    'application/pdf'
  );
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.ok(mock.visualCalls >= 1, 'IA visual deveria ser chamada para PDF insuficiente');
  assert.equal(analysis.data.analysis.fields.amount.origin, 'AI_VISUAL');
});

test('5 AI desabilitada não chama provider', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: false }, ownerA.token);
  mock.visualCalls = 0;
  const doc = await uploadOffice('off.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(mock.visualCalls, 0);
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 50 }, ownerA.token);
});

test('6 limite mensal atingido não chama provider', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 0.01 }, ownerA.token);
  aiControlService.recordUsage({
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    user_id: ownerA.user.id,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    operation_type: 'DOCUMENT_INTERPRETATION',
    status: 'SUCCESS',
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    total_tokens: 1_100_000
  });
  mock.visualCalls = 0;
  const doc = await uploadOffice('limit.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(mock.visualCalls, 0);
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 100 }, ownerA.token);
});

test('7 provider não configurado não quebra fluxo', async () => {
  setAccountingAIProvider(null);
  // Disabled provider via empty mock replacement
  const { DisabledAccountingAIProvider } = require('../backend/src/accounting-ai/provider');
  setAccountingAIProvider(new DisabledAccountingAIProvider());
  const doc = await uploadOffice('noconfig.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  setAccountingAIProvider(mock);
});

test('8 timeout da IA não quebra fluxo', async () => {
  mock.visual = Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT', http: 503 });
  const doc = await uploadOffice('timeout.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(analysis.data.analysis.visual_ai_used, false);
  assert.match(String(analysis.data.analysis.banner || ''), /manualmente|interpretar/i);
});

test('9 resposta inválida não quebra fluxo', async () => {
  mock.visual = Object.assign(new Error('bad'), { code: 'AI_INVALID_RESPONSE', http: 502 });
  const doc = await uploadOffice('invalid.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  assert.equal(analysis.data.analysis.visual_ai_used, false);
});

test('10-13 null e não inventar CNPJ/valor/data', () => {
  const normalization = createDocumentNormalizationService();
  const normalized = normalizeAiVisualResult({
    fields: {
      supplier_name: { value: null, confidence: 0 },
      supplier_document: { value: '123', confidence: 0.9 },
      total_amount: { value: 'R$ quarenta', confidence: 0.9 },
      issue_date: { value: 'ontem', confidence: 0.9 },
      description: { value: 'Taxi - Centro', confidence: 0.8 }
    }
  }, normalization);
  assert.equal(normalized.fields.supplier_name, undefined);
  assert.equal(normalized.fields.supplier_document, undefined);
  assert.equal(normalized.fields.total_amount, undefined);
  assert.equal(normalized.fields.issue_date, undefined);
  assert.equal(normalized.fields.description.normalized_value, 'Taxi - Centro');
});

test('14 campos retornados recebem origin AI_VISUAL', async () => {
  mock.visual = taxiVisual();
  const doc = await uploadOffice('origin.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(analysis.data.analysis.fields.amount.origin, 'AI_VISUAL');
  assert.equal(analysis.data.analysis.fields.description.origin, 'AI_VISUAL');
});

test('15-16 classificação CDS depois da visual; IA classificatória só se necessário', async () => {
  mock.visual = {
    ...taxiVisual(),
    description: 'Material de limpeza',
    fields: {
      ...taxiVisual().fields,
      description: { value: 'Material de limpeza', confidence: 0.95 },
      total_amount: { value: 20, confidence: 0.99 },
      issue_date: { value: '2026-09-10', confidence: 0.95 }
    }
  };
  mock.classCalls = 0;
  mock.visualCalls = 0;
  const doc = await uploadOffice('cds-after.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok(mock.visualCalls >= 1);
  assert.equal(analysis.data.analysis.classification_source, 'CLASSIFICATION_ENGINE');
  assert.equal(mock.classCalls, 0);
});

test('17 usuário pode salvar manualmente após falha visual', async () => {
  mock.visual = Object.assign(new Error('down'), { code: 'AI_PROVIDER_ERROR' });
  const doc = await uploadOffice('manual.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status));
  const save = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    document_id: doc.id,
    occurred_on: '2026-09-18',
    description: 'Taxi manual',
    amount: '45,00',
    payment_method: 'PIX'
  }, ownerA.token);
  assert.equal(save.status, 201, JSON.stringify(save.data));
});

test('18-19 isolamento tenant/company', async () => {
  mock.visual = taxiVisual();
  const docB = await uploadOffice('b.png', png, 'image/png', ownerB.token, companyB);
  const cross = await req('POST', `/api/documentos/${docB.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([403, 404].includes(cross.status), JSON.stringify(cross.data));

  const docA = await uploadOffice('a2.png', png, 'image/png');
  const crossCompany = await req(
    'POST', `/api/documentos/${docA.id}/analise-despesa`, {}, ownerA.token, companyB.id
  );
  assert.ok([403, 404].includes(crossCompany.status) || crossCompany.status === 200);
  if (crossCompany.status === 200) {
    // X-Company-Id de outro tenant é rejeitado pelo scope; se passou, company deve ser A
    assert.equal(crossCompany.data.analysis.company_id, companyA.id);
  }
});

test('20 API Key nunca aparece na resposta', async () => {
  mock.visual = taxiVisual();
  const doc = await uploadOffice('nokey.png', png, 'image/png');
  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const blob = JSON.stringify(analysis.data);
  assert.doesNotMatch(blob, /sk-[a-zA-Z0-9]{10,}/);
  assert.doesNotMatch(blob, /OPENAI_API_KEY/);
  assert.doesNotMatch(blob, /imageBase64|base64,/i);
});

test('21 payload visual não aparece em logs sensíveis da auditoria', async () => {
  mock.visual = taxiVisual();
  const doc = await uploadOffice('audit.png', png, 'image/png');
  await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const logs = db.prepare(
    `SELECT action,after_json FROM audit_logs
     WHERE tenant_id=? AND action LIKE 'DOCUMENT_AI_VISUAL%'
     ORDER BY created_at DESC LIMIT 10`
  ).all(ownerA.user.tenant_id);
  assert.ok(logs.length >= 1);
  for (const row of logs) {
    assert.doesNotMatch(String(row.after_json || ''), /base64|sk-/i);
  }
});

test('22-23 consumo e custo registrados', async () => {
  const before = db.prepare(
    `SELECT COUNT(*) n FROM ai_usage_records
     WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION'`
  ).get(ownerA.user.tenant_id).n;
  mock.visual = taxiVisual();
  const doc = await uploadOffice('usage.png', png, 'image/png');
  await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const after = db.prepare(
    `SELECT * FROM ai_usage_records
     WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION'
     ORDER BY created_at DESC LIMIT 1`
  ).get(ownerA.user.tenant_id);
  assert.ok(after);
  assert.ok(after.estimated_cost_cents != null);
  assert.ok(
    db.prepare(
      `SELECT COUNT(*) n FROM ai_usage_records
       WHERE tenant_id=? AND operation_type='DOCUMENT_INTERPRETATION'`
    ).get(ownerA.user.tenant_id).n > before
  );
});

test('24 auditoria registrada', async () => {
  const n = db.prepare(
    `SELECT COUNT(*) n FROM audit_logs
     WHERE tenant_id=? AND action IN('DOCUMENT_AI_VISUAL_REQUESTED','DOCUMENT_AI_VISUAL_COMPLETED')`
  ).get(ownerA.user.tenant_id).n;
  assert.ok(n >= 1);
});

test('25 idempotência: reanálise sem force reutiliza análise existente', async () => {
  mock.visual = taxiVisual();
  mock.visualCalls = 0;
  const doc = await uploadOffice('idem.png', png, 'image/png');
  const first = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  const callsAfterFirst = mock.visualCalls;
  const second = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(second.data.already_exists, true);
  assert.equal(mock.visualCalls, callsAfterFirst);
  assert.equal(first.data.analysis.document_id, second.data.analysis.document_id);
});

test('suficiência determinística e fixtures manuscritas', () => {
  assert.equal(isExtractionSufficient({
    total_amount: { normalized_value: '45.00' },
    issue_date: { normalized_value: '2026-09-18' },
    description: { normalized_value: 'Taxi' }
  }), true);
  assert.equal(isExtractionSufficient({
    total_amount: { normalized_value: '45.00' }
  }), false);
  assert.ok(documentIntelligence.service);
  assert.ok(smartExpenseService.ORIGINS.AI_VISUAL);
});
