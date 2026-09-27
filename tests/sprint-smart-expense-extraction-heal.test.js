'use strict';
/**
 * Regressão: Nova Despesa não pode gravar análise vazia quando a extração visual
 * conclui depois do poll (antes: timeout 8s → EXTRACTION_NOT_REVIEWED + campos vazios).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-se-heal-'));
process.env.CDS_DB_PATH = path.join(tmp, 'heal.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-se-heal-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.CDS_DOCUMENT_PIPELINE = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const { app, db, smartExpenseService } = require('../backend/src/server');
const src = fs.readFileSync(path.join(__dirname, '../backend/src/smart-expense/service.js'), 'utf8');

const password = 'Senha@123';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let server, base, owner, company;

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

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await req('POST', '/api/auth/register', {
    name: 'Owner Heal', email: 'owner.heal@test.local', password, tenantName: 'Tenant Heal'
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  owner = (await req('POST', '/api/auth/login', {
    email: 'owner.heal@test.local', password, tenant: reg.data.tenant_slug
  })).data;
  company = (await req('POST', '/api/empresas', {
    name: 'Empresa Heal', trade_name: 'HealCo', cnpj: '11222333000181'
  }, owner.token)).data;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('timeout de espera da extração cobre visão IA (>8s)', () => {
  assert.match(src, /EXTRACTION_WAIT_MS\s*=\s*45000/);
  assert.match(src, /healed:\s*true/);
  assert.match(src, /analysisFieldsEmpty/);
  assert.match(src, /EXTRACTION_TIMEOUT/);
});

test('análise PARTIAL vazia é curada quando extração já está EXTRACTED', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'recibo.png');
  fd.append('company_id', company.id);
  fd.append('draft', '1');
  const up = await fetch(base + '/api/documentos/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + owner.token },
    body: fd
  }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const documentId = up.data.id;
  const tenantId = owner.user.tenant_id;

  const extractionId = crypto.randomUUID();
  db.prepare(`INSERT INTO document_extractions(
    id,document_id,tenant_id,company_id,status,extraction_method,requested_by,requested_at,extracted_at
  ) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
    extractionId, documentId, tenantId, company.id, 'EXTRACTED', 'AI_VISUAL', owner.user.id
  );
  const fields = [
    ['supplier_name', 'RECEITA FEDERAL', 0.99],
    ['issue_date', '2026-09-17', 0.99],
    ['total_amount', '2158.81', 0.99],
    ['payment_method', 'Pix', 0.99],
    ['description', 'Pagamento Pix', 0.98]
  ];
  for (const [name, value, conf] of fields) {
    db.prepare(`INSERT INTO document_extracted_fields(
      id,extraction_id,field_name,normalized_value,confidence
    ) VALUES(?,?,?,?,?)`).run(crypto.randomUUID(), extractionId, name, value, conf);
  }

  const analysisId = crypto.randomUUID();
  const emptyFields = JSON.stringify({
    supplier_name: { value: null, confidence: 0, origin: 'MANUAL', needs_review: false, status: 'empty' },
    occurred_on: { value: null, confidence: 0, origin: 'MANUAL', needs_review: false, status: 'empty' },
    description: { value: null, confidence: 0, origin: 'MANUAL', needs_review: false, status: 'empty' },
    amount: { value: null, confidence: 0, origin: 'MANUAL', needs_review: false, status: 'empty' },
    category_id: { value: null, confidence: 0, origin: 'MANUAL', needs_review: false, status: 'empty' },
    payment_method: { value: null, confidence: 0, origin: 'MANUAL', needs_review: false, status: 'empty' }
  });
  db.prepare(`INSERT INTO expense_document_analyses(
    id,document_id,tenant_id,company_id,status,error_code,fields_json,requested_by,requested_at,completed_at
  ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
    analysisId, documentId, tenantId, company.id, 'PARTIAL', 'EXTRACTION_NOT_REVIEWED',
    emptyFields, owner.user.id
  );

  assert.ok(smartExpenseService, 'smartExpenseService exportado');
  const result = await smartExpenseService.analyze(tenantId, documentId, owner.user.id, {});
  assert.equal(result.healed, true);
  const analysis = result.analysis;
  assert.ok(analysis.visual_ai_used || analysis.fields.amount.value, JSON.stringify(analysis.fields));
  assert.equal(String(analysis.fields.amount.value), '2158.81');
  assert.equal(analysis.fields.supplier_name.value, 'RECEITA FEDERAL');
  assert.equal(analysis.fields.occurred_on.value, '2026-09-17');
  assert.notEqual(analysis.error_code, 'EXTRACTION_NOT_REVIEWED');
});
