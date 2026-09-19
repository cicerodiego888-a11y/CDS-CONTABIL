'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s241-'));
process.env.CDS_DB_PATH = path.join(tmp, 's241.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-24-1-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
delete process.env.AI_MODEL;
delete process.env.OPENAI_API_KEY;

const { loadConfig } = require('../backend/src/config');
const { OpenAIAccountingProvider } = require('../backend/src/accounting-ai/openai-provider');
const { AccountingAIProvider } = require('../backend/src/accounting-ai/provider');
const {
  app, db, config, setAccountingAIProvider, aiControlService
} = require('../backend/src/server');

const password = 'Senha@123';
let server, base, ownerA, accountantA, clientA, companyA, expenseAccount;

class MockAccountingProvider extends AccountingAIProvider {
  constructor() {
    super('mock-ai', 'gpt-5.6-terra');
    this.classification = null;
    this.calls = 0;
  }
  async suggestClassification() {
    this.calls += 1;
    if (this.classification instanceof Error) throw this.classification;
    return this.classification;
  }
  async suggestChart() {
    return { rows: [] };
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

async function accept(invitation, name) {
  const token = invitation.activation_url.split('/convite/')[1];
  return (await req('POST', '/api/invitations/' + token + '/accept', {
    name, password, confirmation: password
  })).data;
}

function seedExtraction(docId, text, fields) {
  const extractionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO document_extractions(
       id,document_id,tenant_id,company_id,status,extraction_method,extracted_text,requested_by,extracted_at
     ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).run(
    extractionId, docId, ownerA.user.tenant_id, companyA.id, 'EXTRACTED', 'PDF_TEXT',
    text, ownerA.user.id
  );
  for (const [name, value] of fields) {
    db.prepare(
      `INSERT INTO document_extracted_fields(
         id,extraction_id,field_name,raw_value,normalized_value,confidence
       ) VALUES(?,?,?,?,?,?)`
    ).run(crypto.randomUUID(), extractionId, name, value, value, 0.9);
  }
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 24.1', email: 'owner.s241@test.local', password, tenantName: 'Tenant 24.1'
  });
  assert.ok([200, 201].includes(tenantA.status), JSON.stringify(tenantA.data));
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s241@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa 24.1', cnpj: '38204469000115'
  }, ownerA.token)).data;

  const accInvite = await req('POST', '/api/usuarios', {
    name: 'Contador 24.1', email: 'acc.s241@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  assert.ok([200, 201].includes(accInvite.status), JSON.stringify(accInvite.data));
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.s241@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;

  const invite = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente 24.1', email: 'client.s241@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  assert.ok([200, 201].includes(invite.status), JSON.stringify(invite.data));
  clientA = await accept(invite.data.invitation, 'Cliente 24.1');

  const planId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,'ACTIVE')`
  ).run(planId, ownerA.user.tenant_id, 'Plano 24.1');
  expenseAccount = crypto.randomUUID();
  const bankAccount = crypto.randomUUID();
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
    crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, 'Limpeza 24.1', 10, 1,
    JSON.stringify({ description: 'Material de limpeza', source_type: 'EXPENSE' }),
    expenseAccount, bankAccount
  );
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 sem AI_PROVIDER=openai: IA permanece indisponível', async () => {
  assert.equal(config.AI_PROVIDER, 'off');
  const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assert.equal(settings.status, 200);
  assert.equal(settings.data.enabled, false);
  assert.equal(settings.data.provider_configured, false);
  assert.equal(settings.data.ai_available, false);
  assert.equal(aiControlService.availability(ownerA.user.tenant_id).available, false);
});

test('2 AI_PROVIDER=openai + AI_ENABLED sem API Key: provider_configured=false', async () => {
  const prev = {
    AI_PROVIDER: config.AI_PROVIDER,
    AI_ENABLED: config.AI_ENABLED,
    OPENAI_API_KEY: config.OPENAI_API_KEY
  };
  config.AI_PROVIDER = 'openai';
  config.AI_ENABLED = true;
  config.OPENAI_API_KEY = '';
  try {
    const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
    assert.equal(settings.data.provider, 'openai');
    assert.equal(settings.data.provider_configured, false);
    assert.equal(settings.data.enabled, false);
    const provider = new OpenAIAccountingProvider({
      apiKey: '',
      model: 'gpt-5.6-terra',
      fetchImpl: async () => { throw new Error('não deve chamar rede'); }
    });
    await assert.rejects(
      () => provider.suggestClassification({}),
      err => err.code === 'AI_NOT_CONFIGURED'
    );
  } finally {
    Object.assign(config, prev);
  }
});

test('3 AI_MODEL ausente: padrão gpt-5.6-terra', () => {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-sprint-24-1-secret-ok',
    DOCUMENT_ENCRYPTION_KEY: 'test-document-encryption-key-32b!!'
  });
  assert.equal(cfg.AI_MODEL, 'gpt-5.6-terra');
  assert.equal(cfg.AI_TIMEOUT_MS, 30000);
  assert.equal(cfg.AI_PROVIDER, 'off');
  assert.equal(cfg.AI_ENABLED, false);

  const provider = new OpenAIAccountingProvider({ apiKey: 'sk-test-placeholder' });
  assert.equal(provider.model, 'gpt-5.6-terra');
});

test('4 AI_MODEL=gpt-5.6-terra: provider_model coerente', async () => {
  config.AI_MODEL = 'gpt-5.6-terra';
  const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assert.equal(settings.data.provider_model, 'gpt-5.6-terra');
  assert.equal(settings.data.display_model, 'GPT-5.6 Terra');
  assert.match(settings.data.model_display, /GPT-5\.6 Terra/);
});

test('5 nenhum default oculto para gpt-4.1-mini', () => {
  const cfg = loadConfig({
    JWT_SECRET: 'test-sprint-24-1-secret-ok',
    DOCUMENT_ENCRYPTION_KEY: 'test-document-encryption-key-32b!!'
  });
  assert.equal(cfg.AI_MODEL, 'gpt-5.6-terra');
  assert.notEqual(cfg.AI_MODEL, 'gpt-4.1-mini');
  assert.notEqual(cfg.AI_MODEL, 'gpt-4o-mini');

  const provider = new OpenAIAccountingProvider({});
  assert.equal(provider.model, 'gpt-5.6-terra');

  const sources = [
    path.join(__dirname, '../backend/src/config.js'),
    path.join(__dirname, '../backend/src/accounting-ai/openai-provider.js'),
    path.join(__dirname, '../backend/src/ai-control/service.js'),
    path.join(__dirname, '../.env.example')
  ];
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /(?:\|\|\s*['"]gpt-4\.1-mini['"]|AI_MODEL=gpt-4\.1-mini|DEFAULT_MODEL.*=.*gpt-4\.1-mini)/
    );
  }
});

test('6 preço vigente gpt-5.6-terra = 2.00 / 0.20 / 12.00', () => {
  const row = db.prepare(
    `SELECT * FROM ai_model_pricing
     WHERE provider='openai' AND model='gpt-5.6-terra' AND active=1
     ORDER BY effective_from DESC LIMIT 1`
  ).get();
  assert.ok(row);
  assert.equal(Number(row.input_price_usd_per_1m), 2);
  assert.equal(Number(row.cached_input_price_usd_per_1m), 0.2);
  assert.equal(Number(row.output_price_usd_per_1m), 12);

  const cost = aiControlService.estimateCostCents('openai', 'gpt-5.6-terra', {
    input_tokens: 1_000_000,
    cached_input_tokens: 500_000,
    output_tokens: 1_000_000
  });
  // (0.5M * 2.00) + (0.5M * 0.20) + (1M * 12.00) = 13.10 USD => 1310 cents
  assert.equal(cost, 1310);
});

test('7 preços históricos de modelos antigos não são apagados', () => {
  const mini = db.prepare(
    `SELECT * FROM ai_model_pricing WHERE provider='openai' AND model='gpt-4.1-mini'`
  ).get();
  const mini4o = db.prepare(
    `SELECT * FROM ai_model_pricing WHERE provider='openai' AND model='gpt-4o-mini'`
  ).get();
  assert.ok(mini);
  assert.ok(mini4o);
  assert.equal(Number(mini.input_price_usd_per_1m), 0.4);
  assert.equal(Number(mini4o.input_price_usd_per_1m), 0.15);
});

test('8 tenant desativado permanece desativado com API configurada na instalação', async () => {
  const prev = {
    AI_PROVIDER: config.AI_PROVIDER,
    AI_ENABLED: config.AI_ENABLED,
    OPENAI_API_KEY: config.OPENAI_API_KEY
  };
  config.AI_PROVIDER = 'openai';
  config.AI_ENABLED = true;
  config.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  try {
    await req('PATCH', '/api/ai/settings', { enabled: false }, ownerA.token);
    const settings = await req('GET', '/api/ai/settings', undefined, ownerA.token);
    assert.equal(settings.data.provider_configured, true);
    assert.equal(settings.data.enabled, false);
    assert.equal(settings.data.ai_available, false);
    assert.equal(aiControlService.availability(ownerA.user.tenant_id).available, false);
  } finally {
    Object.assign(config, prev);
  }
});

test('9 OWNER e ACCOUNTANT podem alterar configuração', async () => {
  const byOwner = await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 25
  }, ownerA.token);
  assert.equal(byOwner.status, 200, JSON.stringify(byOwner.data));
  assert.equal(byOwner.data.enabled, true);
  assert.equal(byOwner.data.monthly_limit_cents, 2500);

  const byAcc = await req('PATCH', '/api/ai/settings', {
    enabled: false, monthly_limit_usd: 10
  }, accountantA.token);
  assert.equal(byAcc.status, 200, JSON.stringify(byAcc.data));
  assert.equal(byAcc.data.enabled, false);
  assert.equal(byAcc.data.monthly_limit_cents, 1000);
});

test('10 CLIENT não pode alterar configuração', async () => {
  const getDenied = await req('GET', '/api/ai/settings', undefined, clientA.token);
  assert.ok([401, 403].includes(getDenied.status), JSON.stringify(getDenied));
  const patchDenied = await req('PATCH', '/api/ai/settings', {
    enabled: true
  }, clientA.token);
  assert.ok([401, 403].includes(patchDenied.status), JSON.stringify(patchDenied));
});

test('11-12 limite mensal bloqueia IA e CDS continua', async () => {
  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 0.01
  }, ownerA.token);
  aiControlService.recordUsage({
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    user_id: ownerA.user.id,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    operation_type: 'ACCOUNT_CLASSIFICATION',
    status: 'SUCCESS',
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    total_tokens: 1_100_000
  });
  const settings = aiControlService.getSettings(ownerA.user.tenant_id);
  assert.equal(settings.limit_reached, true);
  assert.equal(aiControlService.availability(ownerA.user.tenant_id).available, false);

  setAccountingAIProvider(mock);
  mock.calls = 0;
  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Servico',
    reason: 'ok',
    candidates: [{ account_id: expenseAccount, confidence: 0.9, reason: 'ok' }]
  };

  const doc = await uploadOffice(
    'limite.pdf',
    textPdf([
      'NF-e', 'Data: 10/09/2026', 'Fornecedor: ABC Distribuidora',
      'Valor Total: R$ 20,00', 'Descricao: Material de limpeza', 'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  seedExtraction(
    doc.id,
    'Descricao: Material de limpeza\nFornecedor: ABC Distribuidora\nValor Total: R$ 20,00',
    [
      ['supplier_name', 'ABC Distribuidora'],
      ['issue_date', '2026-09-10'],
      ['description', 'Material de limpeza'],
      ['total_amount', '20.00'],
      ['payment_method', 'PIX']
    ]
  );

  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.equal(mock.calls, 0, 'IA não deve executar com limite atingido');
  assert.equal(analysis.data.analysis.ai_used, false);
  assert.ok(analysis.data.analysis.classification_source);
});

test('13 falha da IA não bloqueia análise', async () => {
  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 500
  }, ownerA.token);
  setAccountingAIProvider(mock);
  mock.calls = 0;
  mock.classification = Object.assign(new Error('provider down'), {
    code: 'AI_PROVIDER_ERROR', http: 503
  });

  const doc = await uploadOffice(
    'fail-ai.pdf',
    textPdf([
      'Recibo', 'Data: 11/09/2026', 'Fornecedor: Sem Regra XYZ',
      'Valor Total: R$ 44,00', 'Descricao: Servico avulso unico', 'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  seedExtraction(
    doc.id,
    'Descricao: Servico avulso unico\nFornecedor: Sem Regra XYZ\nValor Total: R$ 44,00',
    [
      ['supplier_name', 'Sem Regra XYZ'],
      ['issue_date', '2026-09-11'],
      ['description', 'Servico avulso unico'],
      ['total_amount', '44.00'],
      ['payment_method', 'PIX']
    ]
  );

  const analysis = await req('POST', `/api/documentos/${doc.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(analysis.status), JSON.stringify(analysis.data));
  assert.equal(analysis.data.analysis.ai_used, false);
  assert.ok(analysis.data.analysis);
});
