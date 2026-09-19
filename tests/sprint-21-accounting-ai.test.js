'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s21-'));
process.env.CDS_DB_PATH = path.join(tmp, 's21.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-21-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';

const {
  app, db, setAccountingAIProvider, accountingAIService
} = require('../backend/src/server');
const { AccountingAIProvider } = require('../backend/src/accounting-ai/provider');
const { OpenAIAccountingProvider } = require('../backend/src/accounting-ai/openai-provider');

const password = 'Senha@123';
let server, base, ownerA, ownerB, companyA, companyA2, companyB;
let expenseAccount, alternativeAccount, bankAccount, inactiveAccount, syntheticAccount;
let crossTenantAccount, categoryA, bankA, categoryA2;

class MockAccountingProvider extends AccountingAIProvider {
  constructor() {
    super('mock-ai', 'mock-21');
    this.classification = null;
    this.chart = null;
    this.lastClassificationContext = null;
    this.lastChartContext = null;
  }
  async suggestClassification(context) {
    this.lastClassificationContext = context;
    if (this.classification instanceof Error) throw this.classification;
    return this.classification;
  }
  async suggestChart(context) {
    this.lastChartContext = context;
    if (this.chart instanceof Error) throw this.chart;
    return this.chart;
  }
}

const mock = new MockAccountingProvider();

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

function insertPlanAndAccounts(owner, prefix) {
  const planId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,'ACTIVE')`
  ).run(planId, owner.user.tenant_id, `Plano ${prefix}`);
  const add = (code, description, type = 'A', active = 1) => {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO accounts(
         id,tenant_id,plan_id,source_id,account_code,classification_code,
         account_type,description,level,is_postable,active
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, owner.user.tenant_id, planId, code, code, code, type,
      description, code.split('.').length - 1, type === 'A' ? 1 : 0, active
    );
    return id;
  };
  return { planId, add };
}

function reviewedDocument(owner = ownerA, company = companyA, suffix = '') {
  const documentId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO documents(
       id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,
       sha256,status,uploaded_by
     ) VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(
    documentId, owner.user.tenant_id, company.id, `documento-${suffix}.pdf`,
    `documents/${documentId}/file`, 'application/pdf', 100, '0'.repeat(64),
    'ACTIVE', owner.user.id
  );
  db.prepare(
    `INSERT INTO document_extractions(
       id,document_id,tenant_id,company_id,status,extraction_method,
       extracted_text,requested_by,reviewed_by,extracted_at,reviewed_at
     ) VALUES(?,?,?,?,?,'PDF_TEXT',?,?,?,?,CURRENT_TIMESTAMP)`
  ).run(
    extractionId, documentId, owner.user.tenant_id, company.id, 'REVIEWED',
    'ABC Distribuidora Material de limpeza PIX texto relevante '.repeat(60),
    owner.user.id, owner.user.id, new Date().toISOString()
  );
  const fields = {
    document_type: 'NFE',
    issue_date: '2026-09-15',
    supplier_name: 'ABC Distribuidora',
    supplier_document: '12345678000190',
    description: 'Material de limpeza',
    total_amount: '350.00',
    payment_method: 'PIX'
  };
  for (const [name, value] of Object.entries(fields)) {
    db.prepare(
      `INSERT INTO document_extracted_fields(
         id,extraction_id,field_name,normalized_value,reviewed_value,confidence
       ) VALUES(?,?,?,?,?,1)`
    ).run(crypto.randomUUID(), extractionId, name, value, value);
  }
  return { documentId, extractionId };
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const registeredA = await req('POST', '/api/auth/register', {
    name: 'Owner 21 A', email: 'owner.a.s21@test.local', password, tenantName: 'Tenant 21 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s21@test.local', password, tenant: registeredA.data.tenant_slug
  })).data;
  const registeredB = await req('POST', '/api/auth/register', {
    name: 'Owner 21 B', email: 'owner.b.s21@test.local', password, tenantName: 'Tenant 21 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s21@test.local', password, tenant: registeredB.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 21', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2 21', cnpj: '27865757000102'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 21', cnpj: '11222333000181'
  }, ownerB.token)).data;

  const planA = insertPlanAndAccounts(ownerA, 'A');
  expenseAccount = planA.add('4.1.01.002', 'Material de Limpeza');
  alternativeAccount = planA.add('4.1.01.003', 'Despesas Gerais');
  bankAccount = planA.add('1.1.01.002', 'Banco do Brasil');
  inactiveAccount = planA.add('4.1.01.004', 'Conta Inativa', 'A', 0);
  syntheticAccount = planA.add('4.1', 'Despesas', 'S', 1);
  const planB = insertPlanAndAccounts(ownerB, 'B');
  crossTenantAccount = planB.add('9.9.9', 'Conta exclusiva do tenant B');

  categoryA = crypto.randomUUID();
  categoryA2 = crypto.randomUUID();
  bankA = crypto.randomUUID();
  db.prepare(
    `INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active)
     VALUES(?,?,?,?,?,?,1)`
  ).run(categoryA, ownerA.user.tenant_id, companyA.id, 'Limpeza', 'EXPENSE', expenseAccount);
  db.prepare(
    `INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active)
     VALUES(?,?,?,?,?,?,1)`
  ).run(categoryA2, ownerA.user.tenant_id, companyA2.id, 'Outra empresa', 'EXPENSE', alternativeAccount);
  db.prepare(
    `INSERT INTO banks(id,tenant_id,company_id,name,account_id,active)
     VALUES(?,?,?,?,?,1)`
  ).run(bankA, ownerA.user.tenant_id, companyA.id, 'Banco do Brasil', bankAccount);

  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 1000
  }, ownerA.token);
  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 1000
  }, ownerB.token);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('provider não configurado retorna fallback sem bloquear classificação manual', async () => {
  const document = reviewedDocument(ownerA, companyA, 'off');
  const disabled = {
    name: 'off', model: null, isConfigured: () => false
  };
  setAccountingAIProvider(disabled);
  const result = await req(
    'POST', `/api/documentos/${document.documentId}/sugestao-contabil`, {}, ownerA.token
  );
  assert.equal(result.status, 201);
  assert.equal(result.data.fallback, true);
  assert.equal(result.data.suggestion.status, 'FAILED');
  assert.equal(result.data.suggestion.error_code, 'AI_NOT_CONFIGURED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entries').get().n, 0);
});

test('provider configurado recebe contexto mínimo e retorna candidatos validados', async () => {
  setAccountingAIProvider(mock);
  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Aquisição de material de limpeza',
    category_id: categoryA,
    bank_id: bankA,
    reason: 'Fornecedor e descrição compatíveis com limpeza.',
    candidates: [
      { account_id: expenseAccount, confidence: 0.94, reason: 'Correspondência direta.' },
      { account_id: alternativeAccount, confidence: 0.71, reason: 'Alternativa genérica.' }
    ]
  };
  const document = reviewedDocument(ownerA, companyA, 'valid');
  const result = await req(
    'POST', `/api/documentos/${document.documentId}/sugestao-contabil`, {}, ownerA.token
  );
  assert.equal(result.status, 201);
  assert.equal(result.data.suggestion.status, 'COMPLETED');
  assert.equal(result.data.suggestion.candidates.length, 2);
  assert.equal(result.data.suggestion.primary_account.id, expenseAccount);
  assert.equal(result.data.suggestion.confidence, 0.94);
  assert.equal(mock.lastClassificationContext.document.relevant_excerpt.length, 1500);
  assert.equal(
    mock.lastClassificationContext.accounts.some(account =>
      account.description.includes('tenant B')
    ), false
  );
  assert.equal(
    mock.lastClassificationContext.document.supplier_name, 'ABC Distribuidora'
  );
  assert.equal('api_key' in mock.lastClassificationContext, false);
});

test('conta inexistente, inativa, sintética ou de outro tenant é rejeitada pelo CDS', async () => {
  for (const accountId of [
    crypto.randomUUID(), inactiveAccount, syntheticAccount, crossTenantAccount
  ]) {
    mock.classification = {
      operation_type: 'EXPENSE',
      candidates: [{ account_id: accountId, confidence: 0.99, reason: 'Inválida' }]
    };
    const document = reviewedDocument(ownerA, companyA, accountId.slice(0, 5));
    const result = await req(
      'POST', `/api/documentos/${document.documentId}/sugestao-contabil`, {}, ownerA.token
    );
    assert.equal(result.status, 201);
    assert.equal(result.data.suggestion.status, 'FAILED');
    assert.equal(result.data.suggestion.error_code, 'AI_ACCOUNT_INVALID');
  }
});

test('categoria de outra empresa é rejeitada mesmo com conta válida', async () => {
  mock.classification = {
    operation_type: 'EXPENSE',
    category_id: categoryA2,
    candidates: [{ account_id: expenseAccount, confidence: 0.9, reason: 'Conta válida' }]
  };
  const document = reviewedDocument(ownerA, companyA, 'wrong-company');
  const result = await req(
    'POST', `/api/documentos/${document.documentId}/sugestao-contabil`, {}, ownerA.token
  );
  assert.equal(result.status, 201);
  assert.equal(result.data.suggestion.status, 'FAILED');
  assert.equal(result.data.suggestion.error_code, 'AI_CONFIG_INVALID');
});

test('aceitar sugestão registra decisão e apenas prepara lançamento', async () => {
  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Compra de limpeza',
    category_id: categoryA,
    bank_id: bankA,
    candidates: [{ account_id: expenseAccount, confidence: 0.92, reason: 'Compatível' }]
  };
  const document = reviewedDocument(ownerA, companyA, 'accept');
  await req('POST', `/api/documentos/${document.documentId}/sugestao-contabil`, {}, ownerA.token);
  const entriesBefore = db.prepare('SELECT COUNT(*) n FROM entries').get().n;
  const decision = await req(
    'POST', `/api/documentos/${document.documentId}/sugestao-contabil/decisao`,
    { decision: 'ACCEPTED' }, ownerA.token
  );
  assert.equal(decision.status, 200);
  assert.equal(decision.data.suggestion.status, 'ACCEPTED');
  assert.equal(decision.data.preparation.lines.length, 2);
  assert.equal(decision.data.preparation.lines[0].amount_cents, 35000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entries').get().n, entriesBefore);
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE action='AI_SUGGESTION_ACCEPTED'`).get().n,
    1
  );
});

test('contador pode rejeitar ou substituir a conta e a escolha fica registrada', async () => {
  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Compra',
    candidates: [{ account_id: expenseAccount, confidence: 0.8, reason: 'Possível' }]
  };
  const rejected = reviewedDocument(ownerA, companyA, 'reject');
  await req('POST', `/api/documentos/${rejected.documentId}/sugestao-contabil`, {}, ownerA.token);
  const rejection = await req(
    'POST', `/api/documentos/${rejected.documentId}/sugestao-contabil/decisao`,
    { decision: 'REJECTED', reason: 'Não corresponde' }, ownerA.token
  );
  assert.equal(rejection.data.suggestion.status, 'REJECTED');
  assert.equal(rejection.data.preparation, null);

  const overridden = reviewedDocument(ownerA, companyA, 'override');
  await req('POST', `/api/documentos/${overridden.documentId}/sugestao-contabil`, {}, ownerA.token);
  const override = await req(
    'POST', `/api/documentos/${overridden.documentId}/sugestao-contabil/decisao`,
    { decision: 'OVERRIDDEN', account_id: alternativeAccount, history: 'Despesa geral' },
    ownerA.token
  );
  assert.equal(override.data.suggestion.status, 'OVERRIDDEN');
  const saved = db.prepare(
    `SELECT * FROM ai_classification_decisions
     WHERE suggestion_id=? ORDER BY created_at DESC LIMIT 1`
  ).get(override.data.suggestion.id);
  assert.equal(saved.suggested_account_id, expenseAccount);
  assert.equal(saved.selected_account_id, alternativeAccount);
});

test('tenant e empresa não acessam sugestão fora do escopo', async () => {
  mock.classification = {
    operation_type: 'OTHER',
    candidates: [{ account_id: expenseAccount, confidence: 0.7, reason: 'Teste' }]
  };
  const document = reviewedDocument(ownerA, companyA, 'scope');
  assert.equal((await req(
    'POST', `/api/documentos/${document.documentId}/sugestao-contabil`, {}, ownerB.token
  )).status, 404);
  assert.equal((await req(
    'POST', `/api/documentos/${document.documentId}/sugestao-contabil`,
    {}, ownerA.token, companyA2.id
  )).status, 404);
});

test('prévia inteligente valida hierarquia e só importa após confirmação', async () => {
  mock.chart = {
    rows: [
      { code: '1', classification_code: '1', description: 'ATIVO', account_type: 'S' },
      { code: '1.1', classification_code: '1.1', description: 'ATIVO CIRCULANTE', account_type: 'S' },
      { code: '1.1.01', classification_code: '1.1.01', description: 'DISPONIBILIDADES', account_type: 'S' },
      { code: '1.1.01.001', classification_code: '1.1.01.001', description: 'CAIXA', account_type: 'A' }
    ]
  };
  const preview = await req('POST', '/api/plano-contas/preview-ia', {
    text: 'conteúdo não reconhecido pelo parser',
    file_name: 'plano.pdf'
  }, ownerA.token);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.status, 'READY');
  assert.equal(preview.data.valid, 4);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM account_plans WHERE tenant_id=?').get(ownerA.user.tenant_id).n,
    1
  );
  const imported = await req(
    'POST', `/api/plano-contas/preview-ia/${preview.data.id}/importar`,
    { name: 'Plano IA confirmado' }, ownerA.token
  );
  assert.equal(imported.status, 201);
  assert.equal(imported.data.imported, 4);
  assert.equal(
    db.prepare('SELECT status FROM ai_chart_previews WHERE id=?').get(preview.data.id).status,
    'IMPORTED'
  );
});

test('prévia com zero contas, duplicidade ou pai ausente bloqueia importação', async () => {
  const cases = [
    [],
    [
      { code: '1', classification_code: '1', description: 'A', account_type: 'S' },
      { code: '1', classification_code: '1.1', description: 'B', account_type: 'A' }
    ],
    [
      { code: '1.1', classification_code: '1.1', description: 'Órfã', account_type: 'A' }
    ]
  ];
  for (const chartRows of cases) {
    mock.chart = { rows: chartRows };
    const preview = await req('POST', '/api/plano-contas/preview-ia', {
      text: 'plano inválido', file_name: 'invalido.pdf'
    }, ownerA.token);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.status, 'INVALID');
    const imported = await req(
      'POST', `/api/plano-contas/preview-ia/${preview.data.id}/importar`,
      { name: 'Não importar' }, ownerA.token
    );
    assert.equal(imported.status, 409);
  }
});

test('OpenAIProvider trata resposta válida, inválida, erro e timeout', async () => {
  const validProvider = new OpenAIAccountingProvider({
    apiKey: 'test', model: 'test-model',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"candidates":[]}' } }] })
    })
  });
  assert.deepEqual(await validProvider.suggestClassification({}), { candidates: [] });

  const invalidProvider = new OpenAIAccountingProvider({
    apiKey: 'test',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'não-json' } }] })
    })
  });
  await assert.rejects(
    () => invalidProvider.suggestClassification({}),
    error => error.code === 'AI_INVALID_RESPONSE'
  );

  const errorProvider = new OpenAIAccountingProvider({
    apiKey: 'test',
    fetchImpl: async () => ({ ok: false, status: 500 })
  });
  await assert.rejects(
    () => errorProvider.suggestClassification({}),
    error => error.code === 'AI_PROVIDER_ERROR'
  );

  const timeoutProvider = new OpenAIAccountingProvider({
    apiKey: 'test', timeoutMs: 1000,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
      });
    })
  });
  await assert.rejects(
    () => timeoutProvider.suggestClassification({}),
    error => error.code === 'AI_TIMEOUT'
  );
});

test('auditoria de IA não persiste chave nem texto integral do documento', () => {
  const logs = db.prepare(
    `SELECT action,after_json FROM audit_logs
     WHERE action LIKE 'AI_%' ORDER BY created_at`
  ).all();
  assert.ok(logs.some(log => log.action === 'AI_CLASSIFICATION_REQUESTED'));
  assert.ok(logs.some(log => log.action === 'AI_CLASSIFICATION_COMPLETED'));
  assert.ok(logs.some(log => log.action === 'AI_CLASSIFICATION_FAILED'));
  assert.ok(logs.some(log => log.action === 'AI_CHART_IMPORT_REQUESTED'));
  assert.ok(logs.some(log => log.action === 'AI_CHART_IMPORT_COMPLETED'));
  for (const log of logs) {
    assert.equal(String(log.after_json).includes('OPENAI_API_KEY'), false);
    assert.equal(String(log.after_json).includes('ABC Distribuidora Material'), false);
  }
});

test('serviço expõe provider e validação de plano sem segredos', () => {
  assert.deepEqual(accountingAIService.providerInfo(), {
    configured: true, provider: 'mock-ai', model: 'mock-21'
  });
  const validation = accountingAIService.validateChartRows([
    { code: '1', classification_code: '1', description: 'ATIVO', account_type: 'S' }
  ]);
  assert.equal(validation.issues.length, 0);
});
