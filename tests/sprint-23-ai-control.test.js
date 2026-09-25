'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s23-'));
process.env.CDS_DB_PATH = path.join(tmp, 's23.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-23-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';

const {
  app, db, setAccountingAIProvider, smartExpenseService, aiControlService
} = require('../backend/src/server');
const { AccountingAIProvider } = require('../backend/src/accounting-ai/provider');

const password = 'Senha@123';
let server, base, ownerA, ownerB, staffA, clientA, companyA, companyB;
let expenseAccount, bankAccount;

class MockAccountingProvider extends AccountingAIProvider {
  constructor() {
    super('mock-ai', 'gpt-4.1-mini');
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

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 23 A', email: 'owner.a.s23@test.local', password, tenantName: 'Tenant 23 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s23@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 23 B', email: 'owner.b.s23@test.local', password, tenantName: 'Tenant 23 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s23@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 23', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 23', cnpj: '11222333000181'
  }, ownerB.token)).data;

  const staffInvite = await req('POST', '/api/usuarios', {
    name: 'Staff 23', email: 'staff.a.s23@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.ok([200, 201].includes(staffInvite.status), JSON.stringify(staffInvite.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.a.s23@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;

  const invite = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente 23', email: 'client.a.s23@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  clientA = await accept(invite.data.invitation, 'Cliente 23');

  const planId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,'ACTIVE')`
  ).run(planId, ownerA.user.tenant_id, 'Plano 23');
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
  const catId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active)
     VALUES(?,?,?,?,?,?,1)`
  ).run(catId, ownerA.user.tenant_id, null, 'Material de limpeza', 'EXPENSE', expenseAccount);
  const bankId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO banks(id,tenant_id,company_id,name,account_id,active)
     VALUES(?,?,?,?,?,1)`
  ).run(bankId, ownerA.user.tenant_id, companyA.id, 'Caixa', bankAccount);
  db.prepare(
    `INSERT INTO accounting_rules(
       id,tenant_id,company_id,name,priority,active,conditions_json,
       debit_account_id,credit_account_id
     ) VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(
    crypto.randomUUID(), ownerA.user.tenant_id, companyA.id, 'Limpeza 23', 10, 1,
    JSON.stringify({ description: 'Material de limpeza', source_type: 'EXPENSE' }),
    expenseAccount, bankAccount
  );

  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Servico avulso',
    category_id: catId,
    bank_id: bankId,
    reason: 'Sugestão de teste',
    candidates: [{ account_id: expenseAccount, confidence: 0.9, reason: 'ok' }],
    __usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }
  };
  // OpenAI provider attaches __usage via defineProperty; mock returns plain object.
  Object.defineProperty(mock.classification, '__usage', {
    enumerable: false,
    value: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }
  });

  assert.ok(aiControlService);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1-2 IA ativada e desativada por tenant', async () => {
  const off = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assert.equal(off.status, 200);
  assert.equal(off.data.enabled, false);
  assert.equal(off.data.status, 'DESATIVADA');

  const on = await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 50
  }, ownerA.token);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.enabled, true);
  assert.equal(on.data.status, 'ATIVA');
  assert.equal(on.data.monthly_limit_cents, 5000);
  assert.match(on.data.model_display, /GPT-5\.6 Terra/);

  const disabled = await req('PATCH', '/api/ai/settings', { enabled: false }, ownerA.token);
  assert.equal(disabled.data.enabled, false);
});

test('3 isolamento: tenant A ativo e tenant B desativado', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: true }, ownerA.token);
  await req('PATCH', '/api/ai/settings', { enabled: false }, ownerB.token);
  const a = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  const b = await req('GET', '/api/ai/settings', undefined, ownerB.token);
  assert.equal(a.data.enabled, true);
  assert.equal(b.data.enabled, false);
});

test('4-6 consumo, tokens e custo estimado registrados', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: true, monthly_limit_usd: 50 }, ownerA.token);
  setAccountingAIProvider(mock);
  mock.calls = 0;
  const recorded = aiControlService.recordUsage({
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    user_id: ownerA.user.id,
    document_id: null,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    operation_type: 'ACCOUNT_CLASSIFICATION',
    status: 'SUCCESS',
    input_tokens: 1000000,
    output_tokens: 1000000,
    total_tokens: 2000000
  });
  assert.ok(recorded.id);
  // 1M * 0.40 + 1M * 1.60 = $2.00 => 200 cents
  assert.equal(recorded.estimated_cost_cents, 200);
  const summary = await req('GET', '/api/ai/usage/summary', undefined, ownerA.token);
  assert.equal(summary.status, 200);
  assert.ok(summary.data.usage.tokens >= 2000000);
  assert.ok(summary.data.usage.cost_cents >= 200);
  assert.ok(summary.data.by_operation.some(x => x.operation_type === 'ACCOUNT_CLASSIFICATION'));
  assert.ok(summary.data.by_client.some(x => x.company_id === companyA.id));
});

test('7-11 limite mensal, avisos 50/80 e bloqueio em 100%', async () => {
  // Usa tenant B para não herdar consumo do teste anterior.
  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 1
  }, ownerB.token);

  function bump(op, input, output) {
    aiControlService.recordUsage({
      tenant_id: ownerB.user.tenant_id,
      company_id: companyB.id,
      user_id: ownerB.user.id,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      operation_type: op,
      status: 'SUCCESS',
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output
    });
  }

  // 250k in * 0.40 + 125k out * 1.60 = 0.10 + 0.20 = US$ 0.30
  bump('DOCUMENT_INTERPRETATION', 250000, 125000);
  let settings = aiControlService.getSettings(ownerB.user.tenant_id);
  assert.ok(settings.usage.percent_used < 50, JSON.stringify(settings));

  // +100k/100k = US$ 0.20 → total US$ 0.50 → 50%
  bump('DOCUMENT_REANALYSIS', 100000, 100000);
  settings = aiControlService.getSettings(ownerB.user.tenant_id);
  assert.equal(settings.warning_level, 50, JSON.stringify(settings));
  assert.match(settings.warning_message, /50%/);

  // +150k/150k = US$ 0.30 → total US$ 0.80 → 80%
  bump('PLAN_ACCOUNT_IMPORT', 150000, 150000);
  settings = aiControlService.getSettings(ownerB.user.tenant_id);
  assert.equal(settings.warning_level, 80, JSON.stringify(settings));
  assert.match(settings.warning_message, /80%/);

  // +100k/100k = US$ 0.20 → total US$ 1.00 → 100%
  bump('ACCOUNT_CLASSIFICATION', 100000, 100000);
  settings = aiControlService.getSettings(ownerB.user.tenant_id);
  assert.equal(settings.limit_reached, true);
  assert.equal(settings.ai_available, false);
  assert.match(settings.warning_message, /limite mensal/i);

  const gate = aiControlService.availability(ownerB.user.tenant_id);
  assert.equal(gate.available, false);
  assert.equal(gate.reason, 'AI_LIMIT_REACHED');

  // Motor CDS / lançamento continua no tenant A (sem impacto do limite de B)
  const saved = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: '2026-09-18',
    description: 'Despesa após limite',
    amount: '10,00',
    payment_method: 'PIX'
  }, ownerA.token);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.notEqual(saved.data.status, 'POSTED');

  // E também no tenant B com limite atingido
  const savedB = await req('POST', '/api/despesas', {
    company_id: companyB.id,
    occurred_on: '2026-09-18',
    description: 'Despesa B após limite',
    amount: '12,00',
    payment_method: 'PIX'
  }, ownerB.token);
  assert.equal(savedB.status, 201, JSON.stringify(savedB.data));
});

test('12-13 falha/timeout da IA não bloqueia lançamento', async () => {
  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 1000
  }, ownerA.token);
  setAccountingAIProvider(mock);
  mock.classification = Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT', http: 503 });
  const document = await uploadOffice(
    'fail.pdf',
    textPdf(['Recibo', 'Data: 01/09/2026', 'Fornecedor: Timeout SA', 'Valor Total: R$ 9,00', 'Descricao: Falha']),
    'application/pdf'
  );
  const analyzed = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(analyzed.status, 201);
  assert.equal(analyzed.data.analysis.ai_used, false);
  const saved = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: '2026-09-01',
    description: 'Continua manual',
    amount: '9,00',
    payment_method: 'PIX',
    document_id: document.id
  }, ownerA.token);
  assert.equal(saved.status, 201);
});

test('14 tenant A não acessa consumo B', async () => {
  await req('PATCH', '/api/ai/settings', { enabled: false }, ownerB.token);
  aiControlService.recordUsage({
    tenant_id: ownerB.user.tenant_id,
    company_id: companyB.id,
    user_id: ownerB.user.id,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    operation_type: 'ACCOUNT_CLASSIFICATION',
    status: 'SUCCESS',
    input_tokens: 10,
    output_tokens: 10,
    total_tokens: 20,
    estimated_cost_cents: 1
  });
  const a = await req('GET', '/api/ai/usage/by-client', undefined, ownerA.token);
  assert.equal(a.status, 200);
  assert.equal(a.data.items.some(x => x.company_id === companyB.id), false);

  const beforeB = await req('GET', '/api/ai/settings', undefined, ownerB.token);
  await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 999
  }, ownerA.token);
  const afterB = await req('GET', '/api/ai/settings', undefined, ownerB.token);
  assert.equal(afterB.data.enabled, beforeB.data.enabled);
  assert.equal(afterB.data.monthly_limit_cents, beforeB.data.monthly_limit_cents);
});

test('15-16 cliente e staff sem permissão não alteram configuração/limite', async () => {
  const clientDenied = await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 99
  }, clientA.token);
  assert.equal(clientDenied.status, 403);

  const clientGet = await req('GET', '/api/ai/settings', undefined, clientA.token);
  assert.equal(clientGet.status, 403);

  const staffDenied = await req('PATCH', '/api/ai/settings', {
    enabled: true, monthly_limit_usd: 10
  }, staffA.token);
  assert.equal(staffDenied.status, 403);

  const staffGet = await req('GET', '/api/ai/settings', undefined, staffA.token);
  assert.equal(staffGet.status, 200);
});

test('17-19 Smart Expense respeita config, CDS e fallback IA', async () => {
  setAccountingAIProvider(mock);
  mock.calls = 0;
  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Servico avulso',
    reason: 'ok',
    candidates: [{ account_id: expenseAccount, confidence: 0.91, reason: 'ok' }]
  };
  Object.defineProperty(mock.classification, '__usage', {
    enumerable: false,
    value: { input_tokens: 50, output_tokens: 20, total_tokens: 70 }
  });

  await req('PATCH', '/api/ai/settings', {
    enabled: false, monthly_limit_usd: 100
  }, ownerA.token);
  const docOff = await uploadOffice(
    'off.pdf',
    textPdf(['Recibo', 'Data: 02/09/2026', 'Fornecedor: Sem IA', 'Valor Total: R$ 11,00', 'Descricao: Sem regra']),
    'application/pdf'
  );
  const off = await req('POST', `/api/documentos/${docOff.id}/analise-despesa`, {}, ownerA.token);
  assert.equal(off.status, 201);
  assert.equal(mock.calls, 0);
  assert.equal(off.data.analysis.ai_used, false);

  await req('PATCH', '/api/ai/settings', { enabled: true }, ownerA.token);
  mock.calls = 0;
  const docCds = await uploadOffice(
    'cds-limpeza.pdf',
    textPdf([
      'NF-e', 'Data: 03/09/2026', 'Fornecedor: ABC Distribuidora',
      'Valor Total: R$ 20,00', 'Descricao: Material de limpeza', 'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  assert.notEqual(docCds.id, docOff.id);

  // Semeia extração concluída para evitar corrida do pdf-parse entre documentos.
  const extractionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO document_extractions(
       id,document_id,tenant_id,company_id,status,extraction_method,extracted_text,requested_by,extracted_at
     ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).run(
    extractionId, docCds.id, ownerA.user.tenant_id, companyA.id, 'EXTRACTED', 'PDF_TEXT',
    'Descricao: Material de limpeza\nFornecedor: ABC Distribuidora\nValor Total: R$ 20,00\nData: 03/09/2026\nPagamento: PIX',
    ownerA.user.id
  );
  const seedFields = [
    ['supplier_name', 'ABC Distribuidora', 0.9],
    ['issue_date', '2026-09-03', 0.9],
    ['description', 'Material de limpeza', 0.9],
    ['total_amount', '20.00', 0.9],
    ['payment_method', 'PIX', 0.9]
  ];
  for (const [name, value, conf] of seedFields) {
    db.prepare(
      `INSERT INTO document_extracted_fields(
         id,extraction_id,field_name,raw_value,normalized_value,confidence
       ) VALUES(?,?,?,?,?,?)`
    ).run(crypto.randomUUID(), extractionId, name, value, value, conf);
  }

  const cds = await req(
    'POST', `/api/documentos/${docCds.id}/analise-despesa`, {}, ownerA.token
  );
  assert.ok([200, 201].includes(cds.status), JSON.stringify(cds.data));
  assert.equal(cds.data.analysis.document_id, docCds.id);
  assert.equal(cds.data.analysis.classification_source, 'CLASSIFICATION_ENGINE', JSON.stringify({
    source: cds.data.analysis.classification_source,
    fields: cds.data.analysis.fields,
    reason: cds.data.analysis.classification_reason
  }));
  assert.equal(mock.calls, 0);
  assert.match(cds.data.analysis.banner, /Classificação sugerida pelo CDS|Preenchido automaticamente/);

  mock.calls = 0;
  const docAi = await uploadOffice(
    'ai.pdf',
    textPdf([
      'Recibo', 'Data: 04/09/2026', 'Fornecedor: Central Sem Regra',
      'Valor Total: R$ 33,00', 'Descricao: Servico avulso unico', 'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  // Extração semeada sem regra CDS → força caminho da IA.
  const aiExtractionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO document_extractions(
       id,document_id,tenant_id,company_id,status,extraction_method,extracted_text,requested_by,extracted_at
     ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).run(
    aiExtractionId, docAi.id, ownerA.user.tenant_id, companyA.id, 'EXTRACTED', 'PDF_TEXT',
    'Descricao: Servico avulso unico\nFornecedor: Central Sem Regra\nValor Total: R$ 33,00',
    ownerA.user.id
  );
  for (const [name, value, conf] of [
    ['supplier_name', 'Central Sem Regra', 0.9],
    ['issue_date', '2026-09-04', 0.9],
    ['description', 'Servico avulso unico', 0.9],
    ['total_amount', '33.00', 0.9],
    ['payment_method', 'PIX', 0.9]
  ]) {
    db.prepare(
      `INSERT INTO document_extracted_fields(
         id,extraction_id,field_name,raw_value,normalized_value,confidence
       ) VALUES(?,?,?,?,?,?)`
    ).run(crypto.randomUUID(), aiExtractionId, name, value, value, conf);
  }
  const ai = await req('POST', `/api/documentos/${docAi.id}/analise-despesa`, {}, ownerA.token);
  assert.ok([200, 201].includes(ai.status), JSON.stringify(ai.data));
  assert.ok(mock.calls >= 1);
  assert.equal(ai.data.analysis.classification_source, 'AI');
});

test('20 auditoria de configuração e consumo', async () => {
  const actions = db.prepare(
    `SELECT action FROM audit_logs WHERE tenant_id=? AND action LIKE 'AI_%'
     ORDER BY created_at DESC LIMIT 50`
  ).all(ownerA.user.tenant_id).map(x => x.action);
  assert.ok(actions.includes('AI_SETTINGS_CHANGED'));
  assert.ok(actions.includes('AI_ENABLED') || actions.includes('AI_DISABLED'));
  assert.ok(actions.includes('AI_USAGE_RECORDED'));
  assert.ok(actions.includes('AI_LIMIT_CHANGED') || actions.includes('AI_LIMIT_REACHED') ||
    actions.includes('AI_LIMIT_WARNING'));
});

test('UI expõe página de Inteligência Artificial', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../frontend/public/index.html'), 'utf8');
  assert.match(js, /Inteligência Artificial/);
  assert.match(js, /aiSettingsPage/);
  assert.match(js, /\/ai\/settings/);
  assert.match(js, /Utilizar Inteligência Artificial/);
  assert.match(html, /app\.js\?v=s40-doc-preview/);
  assert.doesNotMatch(js, /OPENAI_API_KEY/);
});
