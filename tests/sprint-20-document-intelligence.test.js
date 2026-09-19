'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s20-'));
process.env.CDS_DB_PATH = path.join(tmp, 's20.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-20-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db, documentStorage, documentIntelligence } = require('../backend/src/server');
const normalization = require('../backend/src/document-intelligence/normalization');

const password = 'Senha@123';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');

let server, base, ownerA, ownerB, clientA, companyA, companyA2, companyB;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
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

async function upload(name, buffer, mime, token = ownerA.token, company = companyA) {
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

async function waitExtraction(documentId, token = ownerA.token) {
  await new Promise(resolve => setTimeout(resolve, 250));
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = await req('GET', `/api/documentos/${documentId}/extracao`, undefined, token);
    if (result.status === 200 && !['PENDING', 'PROCESSING'].includes(result.data.status)) {
      return result.data;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('timeout waiting extraction');
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
    name: 'Escritório 20 A', email: 'owner.a.s20@test.local', password, tenantName: 'Tenant 20 A'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.a.s20@test.local', password, tenant: tenantA.data.tenant_slug
  })).data;
  const tenantB = await req('POST', '/api/auth/register', {
    name: 'Escritório 20 B', email: 'owner.b.s20@test.local', password, tenantName: 'Tenant 20 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.b.s20@test.local', password, tenant: tenantB.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 20', cnpj: '38204469000115'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2 20', cnpj: '27865757000102'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 20', cnpj: '11222333000181'
  }, ownerB.token)).data;
  const invite = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente 20', email: 'client.a.s20@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token);
  clientA = await accept(invite.data.invitation, 'Cliente 20');
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('normalização monetária, data, documento fiscal e texto é determinística', () => {
  assert.equal(normalization.normalizeMoney('R$ 1.250,50'), '1250.50');
  assert.equal(normalization.normalizeMoney('350.00'), '350.00');
  assert.equal(normalization.normalizeDate('15/09/2026'), '2026-09-15');
  assert.equal(normalization.normalizeDate('31/02/2026'), null);
  assert.equal(normalization.normalizeTaxDocument('12.345.678/0001-90'), '12345678000190');
  assert.equal(normalization.normalizeText('  ABC \r\n\r\n Distribuidora\t Ltda.  '), 'ABC\nDistribuidora Ltda.');
});

test('PDF textual é extraído e interpretado sem alterar o original', async () => {
  const pdf = textPdf([
    'NF-e',
    'Numero: 12345',
    'Data: 15/09/2026',
    'Fornecedor: ABC Distribuidora',
    'CNPJ: 12.345.678/0001-90',
    'Valor Total: R$ 350,00',
    'Descricao: Material de limpeza',
    'Pagamento: PIX'
  ]);
  const document = await upload('cupom.pdf', pdf, 'application/pdf');
  const originalHash = crypto.createHash('sha256').update(pdf).digest('hex');
  const beforeExtraction = db.prepare('SELECT storage_path FROM documents WHERE id=?').get(document.id);
  assert.deepEqual(documentStorage.readPlain(beforeExtraction.storage_path), pdf);
  const requested = await req('POST', `/api/documentos/${document.id}/extracao`, {}, ownerA.token);
  assert.equal(requested.status, 202, JSON.stringify(requested.data));
  assert.equal(requested.data.extraction.status, 'PENDING');
  const extraction = await waitExtraction(document.id);
  assert.equal(extraction.status, 'EXTRACTED', JSON.stringify(extraction));
  assert.equal(extraction.extraction_method, 'PDF_TEXT');
  assert.match(extraction.extracted_text, /ABC Distribuidora/);
  assert.equal(extraction.fields.document_type.value, 'NF-e');
  assert.equal(extraction.fields.document_number.value, '12345');
  assert.equal(extraction.fields.issue_date.value, '2026-09-15');
  assert.equal(extraction.fields.supplier_name.value, 'ABC Distribuidora');
  assert.equal(extraction.fields.supplier_document.value, '12345678000190');
  assert.equal(extraction.fields.total_amount.value, '350.00');
  assert.equal(extraction.fields.description.value, 'Material de limpeza');
  assert.equal(extraction.fields.payment_method.value, 'PIX');
  assert.ok(extraction.fields.total_amount.confidence > 0.9);
  const stored = db.prepare('SELECT storage_path,sha256 FROM documents WHERE id=?').get(document.id);
  assert.equal(stored.sha256, originalHash);
  assert.deepEqual(documentStorage.readPlain(stored.storage_path), pdf);
});

test('PNG e JPG são suportados com falha OCR controlada', async () => {
  for (const [name, buffer, mime] of [
    ['imagem.png', png, 'image/png'],
    ['imagem.jpg', jpg, 'image/jpeg']
  ]) {
    const document = await upload(name, buffer, mime);
    const request = await req('POST', `/api/documentos/${document.id}/extracao`, {}, ownerA.token);
    assert.equal(request.status, 202);
    const extraction = await waitExtraction(document.id);
    assert.equal(extraction.status, 'FAILED');
    assert.equal(extraction.extraction_method, 'OCR_UNAVAILABLE');
    assert.equal(extraction.error_code, 'EXTRACTION_UNAVAILABLE');
  }
});

test('processamento transita por PROCESSING antes do resultado', async () => {
  const document = await upload(
    'status.pdf', textPdf(['Recibo', 'Valor: R$ 20,00']), 'application/pdf'
  );
  const extractionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO document_extractions(
       id,document_id,tenant_id,company_id,status,requested_by
     ) VALUES(?,?,?,?,?,?)`
  ).run(
    extractionId, document.id, ownerA.user.tenant_id, companyA.id, 'PENDING', ownerA.user.id
  );
  const processing = documentIntelligence.service.process(extractionId);
  assert.equal(
    db.prepare('SELECT status FROM document_extractions WHERE id=?').get(extractionId).status,
    'PROCESSING'
  );
  await processing;
  assert.equal(
    db.prepare('SELECT status FROM document_extractions WHERE id=?').get(extractionId).status,
    'EXTRACTED'
  );
});

test('MIME inválido e documento inexistente são bloqueados', async () => {
  const documentId = crypto.randomUUID();
  const saved = documentStorage.saveBuffer({
    documentId, originalName: 'dados.txt', buffer: Buffer.from('texto'), encrypt: true
  });
  db.prepare(
    `INSERT INTO documents(
       id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,
       uploaded_by,status,encrypted,encryption_kid
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    documentId, ownerA.user.tenant_id, companyA.id, 'dados.txt', saved.storage_path,
    'text/plain', saved.size_bytes, saved.sha256, ownerA.user.id, 'ACTIVE', 1, saved.encryption_kid
  );
  const invalid = await req('POST', `/api/documentos/${documentId}/extracao`, {}, ownerA.token);
  assert.equal(invalid.status, 415);
  assert.equal(invalid.data.error, 'UNSUPPORTED_DOCUMENT_TYPE');
  assert.equal((await req(
    'POST', '/api/documentos/inexistente/extracao', {}, ownerA.token
  )).status, 404);
});

test('idempotência não duplica e reprocessamento explícito reutiliza registro', async () => {
  const document = await upload('reprocessar.png', png, 'image/png');
  const first = await req('POST', `/api/documentos/${document.id}/extracao`, {}, ownerA.token);
  const extractionId = first.data.extraction.id;
  await waitExtraction(document.id);
  const duplicate = await req('POST', `/api/documentos/${document.id}/extracao`, {}, ownerA.token);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.already_exists, true);
  assert.equal(duplicate.data.extraction.id, extractionId);
  const reprocess = await req(
    'POST', `/api/documentos/${document.id}/extracao/reprocessar`, {}, ownerA.token
  );
  assert.equal(reprocess.status, 202);
  assert.equal(reprocess.data.extraction.id, extractionId);
  assert.equal(reprocess.data.extraction.attempt_count, 2);
  await waitExtraction(document.id);
  assert.equal(db.prepare(
    'SELECT COUNT(*) n FROM document_extractions WHERE document_id=?'
  ).get(document.id).n, 1);
});

test('contador corrige e confirma dados sem criar lançamento', async () => {
  const document = await upload('revisao.pdf', textPdf([
    'Recibo', 'Numero: 9', 'Data: 01/09/2026', 'Fornecedor: Fornecedor Original',
    'Valor: R$ 100,00', 'Descricao: Servico', 'Pagamento: Dinheiro'
  ]), 'application/pdf');
  await req('POST', `/api/documentos/${document.id}/extracao`, {}, ownerA.token);
  await waitExtraction(document.id);
  const entriesBefore = db.prepare('SELECT COUNT(*) n FROM entries').get().n;
  const reviewed = await req('PATCH', `/api/documentos/${document.id}/extracao`, {
    fields: {
      supplier_name: 'Fornecedor Corrigido',
      total_amount: 'R$ 125,50',
      issue_date: '02/09/2026'
    },
    confirm: true
  }, ownerA.token);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal(reviewed.data.status, 'REVIEWED');
  assert.equal(reviewed.data.fields.supplier_name.value, 'Fornecedor Corrigido');
  assert.equal(reviewed.data.fields.supplier_name.reviewed, true);
  assert.equal(reviewed.data.fields.total_amount.value, '125.50');
  assert.equal(reviewed.data.fields.issue_date.value, '2026-09-02');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entries').get().n, entriesBefore);
});

test('isolamento de tenant, empresa e perfil cliente protege a extração', async () => {
  const document = await upload('isolado.pdf', textPdf(['Recibo', 'Valor: R$ 10,00']), 'application/pdf');
  assert.equal((await req(
    'POST', `/api/documentos/${document.id}/extracao`, {}, ownerB.token
  )).status, 404);
  assert.equal((await req(
    'POST', `/api/documentos/${document.id}/extracao`, {}, ownerA.token, companyA2.id
  )).status, 404);
  assert.equal((await req(
    'POST', `/api/documentos/${document.id}/extracao`, {}, clientA.token
  )).status, 403);
});

test('auditoria cobre requested, completed, failed e reviewed sem conteúdo extraído', async () => {
  for (const action of [
    'DOCUMENT_EXTRACTION_REQUESTED',
    'DOCUMENT_EXTRACTION_COMPLETED',
    'DOCUMENT_EXTRACTION_FAILED',
    'DOCUMENT_EXTRACTION_REVIEWED'
  ]) {
    const row = db.prepare('SELECT * FROM audit_logs WHERE action=? LIMIT 1').get(action);
    assert.ok(row, action);
    assert.doesNotMatch(String(row.after_json || ''), /Material de limpeza|ABC Distribuidora/);
  }
});

test('interface oferece análise, confiança, correção e confirmação', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'public', 'assets', 'app.js'), 'utf8'
  );
  assert.match(source, /Analisar documento/);
  assert.match(source, /Inteligência Documental/);
  assert.match(source, /Confiança/);
  assert.match(source, /Confirmar dados/);
  assert.match(source, /não cria lançamento contábil/);
});
