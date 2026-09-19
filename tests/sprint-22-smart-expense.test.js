'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s22-'));
process.env.CDS_DB_PATH = path.join(tmp, 's22.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-22-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';

const {
  app, db, setAccountingAIProvider, smartExpenseService
} = require('../backend/src/server');
const { AccountingAIProvider } = require('../backend/src/accounting-ai/provider');

const password = 'Senha@123';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');

let server, base, ownerA, ownerB, clientA, clientViewer, companyA, companyA2, companyB;
let expenseAccount, bankAccount, categoryLimpeza, bankA, ruleId;

class MockAccountingProvider extends AccountingAIProvider {
  constructor() {
    super('mock-ai', 'mock-22');
    this.classification = null;
    this.calls = 0;
    this.visualCalls = 0;
    this.lastContext = null;
  }
  async interpretDocumentImage() {
    this.visualCalls += 1;
    const error = new Error('Interpretação visual não configurada neste teste.');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }
  async suggestClassification(context) {
    this.calls += 1;
    this.lastContext = context;
    if (this.classification instanceof Error) throw this.classification;
    return this.classification;
  }
  async suggestChart() {
    return { accounts: [] };
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

async function uploadClient(name, buffer, mime, token = clientA.token) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), name);
  const response = await fetch(base + '/api/client/documentos', {
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

function auditActions(tenantId, entityId) {
  return db.prepare(
    `SELECT action FROM audit_logs WHERE tenant_id=? AND entity_id=? ORDER BY created_at, rowid`
  ).all(tenantId, entityId).map(x => x.action);
}

function structuredPdf(supplier = 'ABC Distribuidora') {
  return textPdf([
    'NF-e',
    'Numero: 12345',
    'Data: 15/09/2026',
    `Fornecedor: ${supplier}`,
    'CNPJ: 12.345.678/0001-90',
    'Valor Total: R$ 350,00',
    'Descricao: Material de limpeza',
    'Pagamento: PIX'
  ]);
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenantA = await req('POST', '/api/auth/register', {
    name: 'Escritório 22 A', email: 'owner.a.s22@test.local', password, tenantName: 'Tenant 22 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s22@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 22 B', email: 'owner.b.s22@test.local', password, tenantName: 'Tenant 22 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s22@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 22', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2 22', cnpj: '27865757000102'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 22', cnpj: '11222333000181'
  }, ownerB.token)).data;

  const inviteAdmin = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente Admin 22', email: 'client.a.s22@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  clientA = await accept(inviteAdmin.data.invitation, 'Cliente Admin 22');
  const inviteViewer = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente Viewer 22', email: 'client.v.s22@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token);
  clientViewer = await accept(inviteViewer.data.invitation, 'Cliente Viewer 22');

  const planId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,'ACTIVE')`
  ).run(planId, ownerA.user.tenant_id, 'Plano 22');
  expenseAccount = crypto.randomUUID();
  bankAccount = crypto.randomUUID();
  db.prepare(
    `INSERT INTO accounts(
       id,tenant_id,plan_id,source_id,account_code,classification_code,
       account_type,description,level,is_postable,active
     ) VALUES(?,?,?,?,?,?,?,?,?,?,1)`
  ).run(
    expenseAccount, ownerA.user.tenant_id, planId, '4.1.01', '4.1.01', '4.1.01',
    'A', 'Material de Limpeza', 2, 1
  );
  db.prepare(
    `INSERT INTO accounts(
       id,tenant_id,plan_id,source_id,account_code,classification_code,
       account_type,description,level,is_postable,active
     ) VALUES(?,?,?,?,?,?,?,?,?,?,1)`
  ).run(
    bankAccount, ownerA.user.tenant_id, planId, '1.1.01', '1.1.01', '1.1.01',
    'A', 'Caixa / Bancos', 2, 1
  );

  categoryLimpeza = crypto.randomUUID();
  bankA = crypto.randomUUID();
  db.prepare(
    `INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active)
     VALUES(?,?,?,?,?,?,1)`
  ).run(categoryLimpeza, ownerA.user.tenant_id, null, 'Material de limpeza', 'EXPENSE', expenseAccount);
  db.prepare(
    `INSERT INTO banks(id,tenant_id,company_id,name,account_id,active)
     VALUES(?,?,?,?,?,1)`
  ).run(bankA, ownerA.user.tenant_id, companyA.id, 'Caixa Escritório', bankAccount);

  ruleId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO accounting_rules(
       id,tenant_id,company_id,name,priority,active,conditions_json,
       debit_account_id,credit_account_id
     ) VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(
    ruleId, ownerA.user.tenant_id, companyA.id, 'Limpeza automática', 10, 1,
    JSON.stringify({ description: 'Material de limpeza', source_type: 'EXPENSE' }),
    expenseAccount, bankAccount
  );

  assert.ok(smartExpenseService);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('CASO 1 PDF estruturado preenche campos sem afirmar IA', async () => {
  setAccountingAIProvider(mock);
  mock.calls = 0;
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, false, ownerA.user.id);
  const document = await uploadOffice('nfe.pdf', structuredPdf(), 'application/pdf');
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const analysis = result.data.analysis;
  assert.equal(analysis.ai_used, false);
  assert.match(analysis.banner, /Preenchido automaticamente|Documento analisado|Classificação sugerida pelo CDS/i);
  assert.ok(analysis.fields.supplier_name.value);
  assert.equal(analysis.fields.supplier_name.origin, 'EXTRACTION_ENGINE');
  assert.ok(analysis.fields.amount.value);
  assert.ok(analysis.fields.occurred_on.value);
  assert.ok(['READY', 'PARTIAL'].includes(analysis.status));
  assert.equal(mock.calls, 0);
  const actions = auditActions(ownerA.user.tenant_id, analysis.id);
  assert.ok(actions.includes('DOCUMENT_ANALYSIS_STARTED'));
  assert.ok(actions.includes('DOCUMENT_ANALYSIS_COMPLETED'));
});

test('CASO 2 comprovante PIX fotografado continua manualmente sem OCR', async () => {
  const document = await uploadOffice('pix.png', png, 'image/png');
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.analysis.ai_used, false);
  assert.equal(result.data.analysis.status, 'PARTIAL');
  assert.match(
    result.data.analysis.banner,
    /Não foi possível (concluir a análise inteligente|interpretar automaticamente este documento)|Preenchido automaticamente|Revise os dados manualmente/
  );
  const saved = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: '2026-09-15',
    description: 'PIX manual',
    amount: '80,00',
    payment_method: 'PIX',
    document_id: document.id,
    supplier_name: 'Fornecedor PIX'
  }, ownerA.token);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.notEqual(saved.data.status, 'POSTED');
  assert.equal(
    db.prepare('SELECT status FROM expense_document_analyses WHERE document_id=?')
      .get(document.id).status,
    'SAVED'
  );
});

test('CASO 3 cupom fiscal fotografado e CASO 4 recibo manuscrito aceitam imagem', async () => {
  for (const [name, buffer, mime] of [
    ['cupom.jpg', jpg, 'image/jpeg'],
    ['recibo-manuscrito.png', png, 'image/png']
  ]) {
    const document = await uploadOffice(name, buffer, mime);
    const result = await req(
      'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
    );
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.analysis.ai_used, false);
    assert.ok(['PARTIAL', 'FAILED', 'READY'].includes(result.data.analysis.status));
  }
});

test('CASO 5 documento ilegível não bloqueia salvamento manual', async () => {
  const document = await uploadOffice('ilegivel.pdf', textPdf(['@@@', '???']), 'application/pdf');
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201);
  const saved = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: '2026-09-16',
    description: 'Despesa ilegível revisada',
    amount: '25,50',
    payment_method: 'DINHEIRO',
    document_id: document.id
  }, ownerA.token);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.ok(saved.data.entry_id);
  assert.notEqual(saved.data.status, 'POSTED');
});

test('CASO 6 motor CDS classifica e IA não é chamada', async () => {
  setAccountingAIProvider(mock);
  mock.calls = 0;
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, true, ownerA.user.id);
  const document = await uploadOffice('cds.pdf', structuredPdf(), 'application/pdf');
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.analysis.classification_source, 'CLASSIFICATION_ENGINE');
  assert.equal(result.data.analysis.classification_status, 'CLASSIFIED');
  assert.equal(result.data.analysis.ai_used, false);
  assert.equal(mock.calls, 0);
  const actions = auditActions(ownerA.user.tenant_id, result.data.analysis.id);
  assert.ok(actions.includes('CLASSIFICATION_ENGINE_USED'));
  assert.equal(actions.includes('AI_CLASSIFICATION_USED'), false);
});

test('CASO 7 motor CDS falha e IA habilitada é chamada', async () => {
  setAccountingAIProvider(mock);
  mock.calls = 0;
  mock.classification = {
    operation_type: 'EXPENSE',
    history: 'Serviço avulso sugerido',
    category_id: categoryLimpeza,
    bank_id: bankA,
    reason: 'Documento genérico.',
    candidates: [
      { account_id: expenseAccount, confidence: 0.91, reason: 'Despesa operacional.' }
    ]
  };
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, true, ownerA.user.id);
  const document = await uploadOffice(
    'ai.pdf',
    textPdf([
      'Recibo',
      'Data: 10/09/2026',
      'Fornecedor: Central Moto Pecas Ltda',
      'Valor Total: R$ 199,90',
      'Descricao: Servico avulso sem regra',
      'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.ok(mock.calls >= 1);
  assert.equal(result.data.analysis.classification_source, 'AI');
  assert.equal(result.data.analysis.ai_used, true);
  assert.match(result.data.analysis.banner, /Analisado pela IA/);
  const actions = auditActions(ownerA.user.tenant_id, result.data.analysis.id);
  assert.ok(actions.includes('AI_CLASSIFICATION_USED'));
});

test('CASO 8 motor CDS falha e IA desligada permite continuar', async () => {
  setAccountingAIProvider(mock);
  mock.calls = 0;
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, false, ownerA.user.id);
  const document = await uploadOffice(
    'manual.pdf',
    textPdf([
      'Recibo',
      'Data: 11/09/2026',
      'Fornecedor: Sem Regra SA',
      'Valor Total: R$ 40,00',
      'Descricao: Item sem classificacao',
      'Pagamento: BOLETO'
    ]),
    'application/pdf'
  );
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(mock.calls, 0);
  assert.notEqual(result.data.analysis.classification_source, 'AI');
  assert.equal(result.data.analysis.ai_used, false);
  const saved = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: result.data.analysis.fields.occurred_on.value || '2026-09-11',
    description: result.data.analysis.fields.description.value || 'Item sem classificacao',
    amount: result.data.analysis.fields.amount.value || '40,00',
    payment_method: 'BOLETO',
    document_id: document.id,
    supplier_name: result.data.analysis.fields.supplier_name.value
  }, ownerA.token);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(saved.data.status, 'NEEDS_CLASSIFICATION');
});

test('CASO 9 falha da IA não bloqueia lançamento', async () => {
  setAccountingAIProvider(mock);
  mock.calls = 0;
  mock.classification = Object.assign(new Error('timeout'), {
    code: 'AI_TIMEOUT', http: 503
  });
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, true, ownerA.user.id);
  const document = await uploadOffice(
    'ai-fail.pdf',
    textPdf([
      'Recibo',
      'Data: 12/09/2026',
      'Fornecedor: Timeout Provider',
      'Valor Total: R$ 15,00',
      'Descricao: Falha de IA',
      'Pagamento: PIX'
    ]),
    'application/pdf'
  );
  const result = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.ok(mock.calls >= 1);
  assert.equal(result.data.analysis.ai_used, false);
  assert.match(
    result.data.analysis.banner,
    /Não foi possível (concluir a análise inteligente|interpretar automaticamente este documento)|Revise os dados manualmente/
  );
  const actions = auditActions(ownerA.user.tenant_id, result.data.analysis.id);
  assert.ok(actions.includes('AI_CLASSIFICATION_FAILED'));
  const saved = await req('POST', '/api/despesas', {
    company_id: companyA.id,
    occurred_on: '2026-09-12',
    description: 'Falha de IA revisada',
    amount: '15,00',
    payment_method: 'PIX',
    document_id: document.id
  }, ownerA.token);
  assert.equal(saved.status, 201);
});

test('CASO 10 isolamento por empresa e tenant', async () => {
  const document = await uploadOffice('iso.pdf', structuredPdf(), 'application/pdf');
  const otherCompany = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token, companyA2.id
  );
  assert.ok([403, 404].includes(otherCompany.status), JSON.stringify(otherCompany.data));
  const otherTenant = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerB.token
  );
  assert.equal(otherTenant.status, 404);
  const foreign = await uploadOffice(
    'iso-a2.pdf', structuredPdf(), 'application/pdf', ownerA.token, companyA2
  );
  const clientCross = await req(
    'POST', `/api/client/documentos/${foreign.id}/analise-despesa`, {}, clientA.token
  );
  assert.equal(clientCross.status, 404);
});

test('portal do cliente analisa e salva; viewer não cria despesa', async () => {
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, false, ownerA.user.id);
  const document = await uploadClient('cliente.pdf', structuredPdf(), 'application/pdf');
  const analyzed = await req(
    'POST', `/api/client/documentos/${document.id}/analise-despesa`, {}, clientA.token
  );
  assert.equal(analyzed.status, 201, JSON.stringify(analyzed.data));
  assert.equal(analyzed.data.analysis.ai_used, false);
  const saved = await req('POST', '/api/client/despesas', {
    occurred_on: analyzed.data.analysis.fields.occurred_on.value || '2026-09-15',
    description: analyzed.data.analysis.fields.description.value || 'Material de limpeza',
    amount: analyzed.data.analysis.fields.amount.value || '350,00',
    payment_method: 'PIX',
    document_id: document.id,
    supplier_name: analyzed.data.analysis.fields.supplier_name.value,
    category_id: categoryLimpeza
  }, clientA.token);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(saved.data.supplier_name || null, analyzed.data.analysis.fields.supplier_name.value);
  assert.notEqual(saved.data.status, 'POSTED');

  const viewerDenied = await req('POST', '/api/client/despesas', {
    occurred_on: '2026-09-15',
    description: 'Viewer não pode',
    amount: '10,00',
    payment_method: 'PIX'
  }, clientViewer.token);
  assert.ok([403, 401].includes(viewerDenied.status));
});

test('Ler novamente reprocessa sem duplicar documento nem lançamento', async () => {
  smartExpenseService.setTenantAiEnabled(ownerA.user.tenant_id, false, ownerA.user.id);
  const document = await uploadOffice('reler.pdf', structuredPdf(), 'application/pdf');
  const first = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa`, {}, ownerA.token
  );
  assert.equal(first.status, 201);
  const second = await req(
    'POST', `/api/documentos/${document.id}/analise-despesa/reler`, {}, ownerA.token
  );
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.analysis.id, first.data.analysis.id);
  assert.equal(second.data.analysis.attempt_count, 2);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM documents WHERE id=?').get(document.id).n, 1
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM expense_document_analyses WHERE document_id=?')
      .get(document.id).n,
    1
  );
  const actions = auditActions(ownerA.user.tenant_id, second.data.analysis.id);
  assert.ok(actions.includes('DOCUMENT_REANALYZED'));
});

test('UI compartilhada e assets da Nova Despesa estão presentes', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../frontend/public/assets/smart-expense.js'), 'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../frontend/public/assets/smart-expense.css'), 'utf8'
  );
  const office = fs.readFileSync(
    path.join(__dirname, '../frontend/public/index.html'), 'utf8'
  );
  const portal = fs.readFileSync(
    path.join(__dirname, '../frontend/public/portal/index.html'), 'utf8'
  );
  const appJs = fs.readFileSync(
    path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8'
  );
  const portalJs = fs.readFileSync(
    path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8'
  );
  assert.match(ui, /CdsSmartExpense/);
  assert.match(ui, /Ler novamente/);
  assert.match(ui, /Salvar despesa/);
  assert.match(ui, /Analisado pela IA/);
  assert.match(css, /se-shell|se-doc|se-form/);
  assert.match(office, /smart-expense\.js/);
  assert.match(portal, /smart-expense\.js/);
  assert.match(appJs, /CdsSmartExpense\.open/);
  assert.match(portalJs, /CdsSmartExpense\.open/);
});
