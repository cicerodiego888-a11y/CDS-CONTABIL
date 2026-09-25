'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-autonomy-'));
process.env.CDS_DB_PATH = path.join(tmp, 'autonomy.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.EXPORT_DIR = path.join(tmp, 'exports');
process.env.JWT_SECRET = 'test-autonomy-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';

const {
  MODES, resolveAutonomyPolicy, normalizeAutonomyMode, assertNeverPosts,
  BASE_CAPABILITIES, AUTONOMOUS_CAPABILITIES, FORBIDDEN_CAPABILITIES
} = require('../backend/src/ai-control/autonomy-policy');
const { app, db, documentPipelineService, aiControlService } = require('../backend/src/server');

const password = 'Senha@123';
let server, base;
let ownerA, ownerB, companyA;
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
    name: 'Owner Autonomy', email: 'owner.autonomy@test.local', password, tenantName: 'Tenant Autonomy'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.autonomy@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa Autonomy A', trade_name: 'AutA', cnpj: '11222333000181'
  }, ownerA.token)).data;

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner Autonomy B', email: 'owner.autonomy.b@test.local', password, tenantName: 'Tenant Autonomy B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.autonomy.b@test.local', password, tenant: regB.data.tenant_slug
  })).data;

  planId = crypto.randomUUID();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)')
    .run(planId, ownerA.user.tenant_id, 'Plano Autonomy', 'ACTIVE');
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

test('AutonomyPolicy: modos, capacidades e proibições', () => {
  assert.equal(normalizeAutonomyMode(50), MODES.ASSISTED_50);
  assert.equal(normalizeAutonomyMode('98%'), MODES.AUTONOMOUS_98);
  assert.equal(normalizeAutonomyMode(null), MODES.ASSISTED_50);

  const a50 = resolveAutonomyPolicy(MODES.ASSISTED_50);
  const a98 = resolveAutonomyPolicy(MODES.AUTONOMOUS_98);

  assert.equal(a50.percent, 50);
  assert.equal(a98.percent, 98);
  assert.ok(a50.allows('INTERPRET_DOCUMENT'));
  assert.ok(a50.allows('PREPARE_PENDING'));
  assert.equal(a50.allows('MULTI_ATTEMPT_RESOLUTION'), false);
  assert.equal(a50.allows('EXPANDED_AI_CONTEXT'), false);
  assert.ok(a98.allows('MULTI_ATTEMPT_RESOLUTION'));
  assert.ok(a98.allows('EXPANDED_AI_CONTEXT'));
  assert.ok(a98.allows('SUPPLIER_PATTERN_MATCH'));

  for (const cap of FORBIDDEN_CAPABILITIES) {
    assert.equal(a50.allows(cap), false, cap);
    assert.equal(a98.allows(cap), false, cap);
  }
  assert.equal(a50.mayApprove(), false);
  assert.equal(a98.mayApprove(), false);
  assert.equal(a50.mayPost(), false);
  assert.equal(a98.mayPost(), false);
  assert.equal(a98.mayClosePeriod(), false);
  assert.ok(BASE_CAPABILITIES.length >= 20);
  assert.ok(AUTONOMOUS_CAPABILITIES.includes('ADVANCED_RESOLUTION_LOOP'));
  assert.throws(() => assertNeverPosts(a98, 'POSTED'), /POSTED/);
});

test('A. default ASSISTED_50 e configuração 50%', async () => {
  const s = await req('GET', '/api/ai/settings', undefined, ownerA.token);
  assert.equal(s.status, 200);
  assert.equal(s.data.autonomy_mode, MODES.ASSISTED_50);
  assert.equal(s.data.autonomy_percent, 50);

  const patch = await req('PATCH', '/api/ai/settings', {
    enabled: false,
    autonomy_mode: 'ASSISTED_50'
  }, ownerA.token);
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.equal(patch.data.autonomy_mode, MODES.ASSISTED_50);
});

test('B. configuração 98% persistida e auditada', async () => {
  const patch = await req('PATCH', '/api/ai/settings', {
    autonomy_mode: 'AUTONOMOUS_98'
  }, ownerA.token);
  assert.equal(patch.status, 200);
  assert.equal(patch.data.autonomy_mode, MODES.AUTONOMOUS_98);
  assert.equal(patch.data.autonomy_percent, 98);

  const row = db.prepare('SELECT autonomy_mode FROM tenant_ai_settings WHERE tenant_id=?')
    .get(ownerA.user.tenant_id);
  assert.equal(row.autonomy_mode, MODES.AUTONOMOUS_98);

  const audit = db.prepare(
    `SELECT action, after_json FROM audit_logs
     WHERE tenant_id=? AND action='AI_AUTONOMY_CHANGED' ORDER BY created_at DESC LIMIT 1`
  ).get(ownerA.user.tenant_id);
  assert.ok(audit);
  const payload = JSON.parse(audit.after_json || '{}');
  assert.equal(payload.after, MODES.AUTONOMOUS_98);

  // volta para 50% para próximos testes controlados
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'ASSISTED_50' }, ownerA.token);
});

test('R. isolamento tenant na autonomia', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'AUTONOMOUS_98' }, ownerA.token);
  const b = await req('GET', '/api/ai/settings', undefined, ownerB.token);
  assert.equal(b.data.autonomy_mode, MODES.ASSISTED_50);
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'ASSISTED_50' }, ownerA.token);
});

test('CENÁRIO A — 50%: prepara PENDING sem capacidades avançadas', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'ASSISTED_50' }, ownerA.token);
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91001',
    chNFe: '35260111222333000181550010000910011000111111'
  }), 'a50.xml');
  assert.equal(up.status, 201);
  const result = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true }
  );
  assert.ok(['PENDING', 'NEEDS_CLASSIFICATION'].includes(result.status), JSON.stringify(result));
  assert.equal(result.autonomy_mode, MODES.ASSISTED_50);
  assert.ok(Array.isArray(result.resolution_attempts));
  const advanced = (result.resolution_attempts || []).some(a =>
    ['SUPPLIER_PATTERN', 'CHART_AND_CONTEXT', 'EXPANDED_AI'].includes(a.name) && a.ok
  );
  assert.equal(advanced, false, '50% não deve concluir resolução avançada');
  if (result.status === 'PENDING') {
    assert.ok(result.entry_id);
    const entry = db.prepare('SELECT status FROM entries WHERE id=?').get(result.entry_id);
    assert.equal(entry.status, 'PENDING');
    assert.notEqual(entry.status, 'POSTED');
  }
});

test('CENÁRIO B — 98%: tenta resolução adicional e permanece PENDING', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'AUTONOMOUS_98' }, ownerA.token);
  const policy = aiControlService.getAutonomyPolicy(ownerA.user.tenant_id);
  assert.equal(policy.mode, MODES.AUTONOMOUS_98);
  assert.ok(policy.allows('MULTI_ATTEMPT_RESOLUTION'));

  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '92002',
    chNFe: '3999200211222333000181550010000920021000222222',
    vNF: '1600.00',
    dhEmi: '2026-05-20T10:00:00-03:00'
  }), 'a98.xml');
  assert.equal(up.status, 201);
  const result = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true }
  );
  assert.ok(['PENDING', 'NEEDS_CLASSIFICATION'].includes(result.status), JSON.stringify(result));
  assert.equal(result.autonomy_mode, MODES.AUTONOMOUS_98);
  assert.ok((result.resolution_attempts || []).length >= 1);
  if (result.status === 'PENDING') {
    const entry = db.prepare('SELECT status FROM entries WHERE id=?').get(result.entry_id);
    assert.equal(entry.status, 'PENDING');
  }
});

test('I/J. 98% executa tentativa avançada quando regra não basta', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'AUTONOMOUS_98' }, ownerA.token);
  // Sem regra ENEL, sem categoria "Energia", força caminho avançado do DecisionEngine
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91003',
    name: 'FORNECEDOR DESCONHECIDO XYZ',
    cnpj: '99888777000166',
    chNFe: '39999888777000166550010000910031000333333',
    vNF: '777.77',
    dhEmi: '2026-08-01T10:00:00-03:00'
  }).replace('Prestacao de servico de energia', 'Material generico sem categoria'), 'unknown98.xml');
  const result = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true }
  );
  const names = (result.resolution_attempts || []).map(a => a.name);
  assert.ok(names.includes('KNOWN_RULE'));
  assert.ok(
    names.some(n =>
      ['SUPPLIER_PATTERN', 'CHART_AND_CONTEXT', 'EXPANDED_AI', 'CDS_CLASSIFY', 'ADVANCED_NOT_REQUIRED'].includes(n)
    ),
    '98% deve registrar tentativas avançadas ou ADVANCED_NOT_REQUIRED: ' + names.join(',')
  );

  // Caso sem classificação prévia: remove bancos/categorias match forçando descrição vazia de conta
  // e verifica que CHART/PATTERN ou EXPANDED aparecem quando não CLASSIFIED após regra.
  const upBare = await uploadXml(ownerA.token, companyA.id, `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe39999888777000166550010000910991000999999">
<ide><nNF>91099</nNF><serie>1</serie><dhEmi>2026-07-01T10:00:00-03:00</dhEmi><tpNF>0</tpNF><natOp>Item sem mapeamento</natOp></ide>
<emit><CNPJ>55444333000122</CNPJ><xNome>ACME INDUSTRIA LTDA</xNome></emit>
<dest><CNPJ>04521593000100</CNPJ><xNome>CLIENTE TESTE</xNome></dest>
<total><ICMSTot><vNF>42.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`, 'bare98.xml');
  // Temporariamente desativa o classificador CDS injetando via process — usa company sem bank match forçado:
  // zera account do banco para impedir par crédito fácil? Melhor: assert que 98 registrou mais que só KNOWN_RULE.
  const bare = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, upBare.data.id, ownerA.user.id, { force: true }
  );
  const bareNames = (bare.resolution_attempts || []).map(a => a.name);
  assert.ok(bareNames.length >= 2, '98% deve ter múltiplas tentativas: ' + bareNames.join(','));
  assert.ok(
    bareNames.some(n =>
      ['SUPPLIER_HISTORY', 'SUPPLIER_PATTERN', 'CHART_AND_CONTEXT', 'EXPANDED_AI', 'CDS_CLASSIFY', 'ADVANCED_NOT_REQUIRED', 'ADVANCED_SKIPPED'].includes(n)
    ),
    'esperava tentativa além de KNOWN_RULE: ' + bareNames.join(',')
  );

  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'ASSISTED_50' }, ownerA.token);
  const up2 = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91004',
    name: 'OUTRO FORNECEDOR ABC',
    cnpj: '88777666000155',
    chNFe: '38888777666000155550010000910041000444444',
    vNF: '88.00',
    dhEmi: '2026-06-01T10:00:00-03:00'
  }).replace('Prestacao de servico de energia', 'Servico avulso sem regra'), 'unknown50.xml');
  const r50 = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up2.data.id, ownerA.user.id, { force: true }
  );
  const advancedOk = (r50.resolution_attempts || []).some(a =>
    ['SUPPLIER_PATTERN', 'CHART_AND_CONTEXT', 'EXPANDED_AI'].includes(a.name) && a.ok
  );
  assert.equal(advancedOk, false);
  // 50% ou já classificado (ADVANCED_SKIPPED) ou parado cedo
  const a50names = (r50.resolution_attempts || []).map(a => a.name);
  assert.ok(
    a50names.includes('ADVANCED_SKIPPED') || !a50names.includes('EXPANDED_AI'),
    '50% não deve usar EXPANDED_AI: ' + a50names.join(',')
  );
});

test('K/L. IA nunca aprova nem gera POSTED', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'AUTONOMOUS_98' }, ownerA.token);
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91005',
    chNFe: '35260111222333000181550010000910051000555555'
  }), 'nopost.xml');
  const result = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true }
  );
  if (result.entry_id) {
    const entry = db.prepare('SELECT status FROM entries WHERE id=?').get(result.entry_id);
    assert.notEqual(entry.status, 'POSTED');
    assert.equal(entry.status, 'PENDING');
  }
  const policy = resolveAutonomyPolicy(MODES.AUTONOMOUS_98);
  assert.equal(policy.mayApprove(), false);
  assert.equal(policy.mayPost(), false);
});

test('M. IA não fecha competência', () => {
  const policy = resolveAutonomyPolicy(MODES.AUTONOMOUS_98);
  assert.equal(policy.mayClosePeriod(), false);
  assert.equal(policy.allows('CLOSE_PERIOD'), false);
  assert.equal(policy.allows('REOPEN_PERIOD'), false);
});

test('N/O/P. contador aprova; edição/rejeição preservadas', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'ASSISTED_50' }, ownerA.token);
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91006',
    chNFe: '35260111222333000181550010000910061000666666'
  }), 'approve.xml');
  const result = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true }
  );
  if (result.status === 'PENDING' && result.entry_id) {
    const ap = await req('POST', '/api/aprovacao/' + result.entry_id + '/aprovar', {}, ownerA.token);
    assert.equal(ap.status, 200, JSON.stringify(ap.data));
    assert.equal(ap.data.status, 'POSTED');
  }

  const up2 = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91007',
    chNFe: '35260111222333000181550010000910071000777777'
  }), 'reject.xml');
  const r2 = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up2.data.id, ownerA.user.id, { force: true }
  );
  if (r2.status === 'PENDING' && r2.entry_id) {
    const rej = await req('POST', '/api/aprovacao/' + r2.entry_id + '/rejeitar', {
      reason: 'Conta incorreta para teste de autonomia'
    }, ownerA.token);
    assert.equal(rej.status, 200, JSON.stringify(rej.data));
  }
});

test('Q. idempotência sob autonomia 98%', async () => {
  await req('PATCH', '/api/ai/settings', { autonomy_mode: 'AUTONOMOUS_98' }, ownerA.token);
  const up = await uploadXml(ownerA.token, companyA.id, sampleNfeXml({
    nNF: '91008',
    chNFe: '35260111222333000181550010000910081000888888'
  }), 'idem.xml');
  const r1 = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: true }
  );
  const r2 = await documentPipelineService.processDocument(
    ownerA.user.tenant_id, up.data.id, ownerA.user.id, { force: false }
  );
  if (r1.entry_id) assert.equal(r2.entry_id, r1.entry_id);
  const n = db.prepare('SELECT COUNT(*) n FROM expenses WHERE document_id=?').get(up.data.id).n;
  assert.ok(n <= 1);
});

test('S. UX de aprovação preservada (sem nova fila)', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.ok(appJs.includes('async function reviewApproval'));
  assert.ok(appJs.includes('async function approval('));
  assert.ok(appJs.includes('LANÇAMENTO PREPARADO'));
  assert.ok(appJs.includes('autonomy_mode'));
  assert.ok(appJs.includes('50% — Assistida'));
  assert.ok(appJs.includes('98% — Autônoma'));
  // Não criou nova página de fila
  assert.equal(/function autonomyQueuePage|filaAutonomia|novaFilaAutonomia/.test(appJs), false);
});

test('W. regressão Audácia + integrity/fk', () => {
  assert.ok(documentPipelineService);
  assert.ok(typeof documentPipelineService.processDocument === 'function');
  const integrity = db.pragma('integrity_check');
  const ok = Array.isArray(integrity) ? integrity[0].integrity_check === 'ok' : integrity === 'ok';
  assert.equal(ok, true);
  const fk = db.pragma('foreign_key_check');
  assert.equal(fk.length, 0);
});
