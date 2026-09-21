'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s2848-'));
process.env.CDS_DB_PATH = path.join(tmp, 's2848.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-28-4-8-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const parser = require('../backend/src/chart-of-accounts/parser');
const { extractPlanText } = require('../backend/src/chart-of-accounts/extract');
const { buildRelacaoAccounts, buildRelacaoText, buildRelacaoPdf, textPdf } = require('./helpers/relacao-contas');
const { app, db } = require('../backend/src/server');

const password = 'Senha@123';
let server, base, ownerA, ownerB, clientToken, companyA, companyB;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function uploadPreview(buffer, name, token, extra) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  if (extra && extra.company_id) form.append('company_id', extra.company_id);
  if (extra && extra.name) form.append('name', extra.name);
  const r = await fetch(base + '/api/plano-contas/preview', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  const data = await r.json();
  return { status: r.status, data };
}

async function uploadImport(buffer, name, token, planName, extra) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  form.append('name', planName || 'Plano teste');
  if (extra && extra.company_id) form.append('company_id', extra.company_id);
  const r = await fetch(base + '/api/plano-contas/import', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  const data = await r.json();
  return { status: r.status, data };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Escritório 2848 A', email: 'owner.a.s2848@test.local', password, tenantName: 'Tenant 2848 A' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s2848@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Escritório 2848 B', email: 'owner.b.s2848@test.local', password, tenantName: 'Tenant 2848 B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s2848@test.local', password, tenant: b.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa 2848 A', cnpj: '11222333000181' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa 2848 B', cnpj: '22333444000192' }, ownerB.token)).data;
  const u = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Cliente 2848', email: 'cliente.s2848@test.local', profile: 'CLIENT_FINANCE' }, ownerA.token);
  const token = u.data.invitation.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + token + '/accept', { name: 'Cliente 2848', password, confirmation: password });
  clientToken = acc.data.token;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
});

test('parser Código/Classificação/Descrição, níveis e metadados', () => {
  const text = buildRelacaoText();
  const parsed = parser.parseChartText(text);
  assert.equal(parsed.rows.length, 683);
  assert.equal(parsed.meta.company_name, 'SCOSY EMPREENDIMENTOS LTDA');
  assert.equal(parsed.meta.company_cnpj, '28.027.121/0001-46');
  assert.equal(parsed.header, true);
  const preview = parser.buildPreview(parsed);
  assert.equal(preview.valid, 683);
  assert.equal(preview.exact_duplicates, 0);
  assert.equal(preview.repeated_classifications, 37);
  const byCode = Object.fromEntries(preview.accounts.map((a) => [a.code, a]));
  assert.equal(byCode['1'].classification_code, '1');
  assert.equal(byCode['1'].description, 'ATIVO');
  assert.equal(byCode['1'].account_type, 'S');
  assert.equal(byCode['2'].classification_code, '11');
  assert.equal(byCode['2'].description, 'ATIVO CIRCULANTE');
  assert.equal(byCode['3'].classification_code, '111');
  assert.equal(byCode['3'].description, 'DISPONÍVEL');
  assert.equal(byCode['4'].classification_code, '11101');
  assert.equal(byCode['4'].description, 'CAIXA');
  assert.equal(byCode['5'].classification_code, '1110100001');
  assert.equal(byCode['5'].description, 'CAIXA GERAL');
  assert.equal(byCode['5'].account_type, 'A');
  for (const code of ['1000', '1001', '1002', '1003']) {
    assert.equal(byCode[code].classification_code, '1120100001');
    assert.equal(byCode[code].account_type, 'A');
  }
  assert.equal(byCode['1001'].description, 'JOÃO SILVA');
  assert.equal(byCode['1002'].description, 'SIMPLES IND COMERCIO E SERVIÇO');
  assert.equal(byCode['1003'].description, 'PRESUMIDO INDUSTRIA, COMERCIO, SERVIÇO');
  assert.equal(preview.accounts[0].code, '1');
  assert.ok(!parsed.rows.some((r) => /Página|Emissão|RELAÇÃO|Empresa|C\.N\.P\.J/i.test(r.descricao)));
});

test('parser: descrição com espaços, acentos, parênteses; classificação curta/longa', () => {
  const text = 'Código Classificação Descrição\n10 1 ATIVO (CIRCULANTE)\n11 1110100001 CAIXA-GERAL / MATRIZ';
  const preview = parser.buildPreview(parser.parseChartText(text));
  assert.equal(preview.accounts[0].description, 'ATIVO (CIRCULANTE)');
  assert.equal(preview.accounts[1].description, 'CAIXA-GERAL / MATRIZ');
  assert.equal(preview.accounts[0].classification_code, '1');
  assert.equal(preview.accounts[1].classification_code, '1110100001');
});

test('parser: classificação repetida não é duplicidade exata; código repetido e duplicidade exata', () => {
  const text = [
    'Código Classificação Descrição',
    '1000 1120100001 CLIENTES DIVERSOS',
    '1001 1120100001 JOÃO SILVA',
    '1001 999 OUTRO',
    '1000 1120100001 CLIENTES DIVERSOS'
  ].join('\n');
  const preview = parser.buildPreview(parser.parseChartText(text));
  assert.equal(preview.valid, 3);
  assert.equal(preview.exact_duplicates, 1);
  assert.ok(preview.issues.some((x) => x.code === 'CODIGO_REPETIDO'));
  assert.ok(preview.issues.some((x) => x.code === 'DUPLICIDADE_EXATA'));
  assert.equal(preview.repeated_classifications, 1);
});

test('parser: linha inválida, cabeçalho, rodapé e paginação ignorados', () => {
  const text = 'Página: 1\n1/8\nfoobar\nCódigo Classificação Descrição\n1 1 ATIVO\n2/8';
  const parsed = parser.parseChartText(text);
  assert.equal(parsed.rows.length, 1);
  const preview = parser.buildPreview(parsed);
  assert.equal(preview.valid, 1);
});

test('parser legado PDF com tipo S/A continua válido', () => {
  const rows = parser.parsePdfText('1 1110 S ATIVO\n2 1110100001 A CAIXA GERAL');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tipo, 'S');
  const preview = parser.buildPreview({ rows, format: 'CODE_CLASS_TYPE_DESC', header: false, meta: {} });
  assert.equal(preview.valid, 2);
  assert.equal(preview.accounts[0].account_type, 'S');
});

test('CSV e TXT delimitados', () => {
  const csv = 'codigo;classificacao;descricao;tipo\n1;1;ATIVO;S\n5;1110100001;CAIXA GERAL;A';
  const preview = parser.buildPreview(parser.parsePlanSource(csv, '.csv'));
  assert.equal(preview.valid, 2);
  const txt = 'codigo,descricao\n88,BANCO TESTE';
  const t = parser.buildPreview(parser.parsePlanSource(txt, '.txt'));
  assert.equal(t.valid, 1);
  assert.equal(t.accounts[0].classification_code, '88');
});

test('PDF RELAÇÃO DE CONTAS: extração e 683 contas', async () => {
  const buf = buildRelacaoPdf();
  const extracted = await extractPlanText(buf, '.pdf');
  assert.ok(extracted.text.includes('ATIVO'));
  const parsed = parser.parseChartText(extracted.text);
  assert.equal(parsed.rows.length, 683);
  const preview = parser.buildPreview(parsed);
  assert.equal(preview.valid, 683);
  assert.equal(preview.company_name, 'SCOSY EMPREENDIMENTOS LTDA');
  assert.match(preview.company_cnpj, /28\.027\.121\/0001-46/);
  const joao = preview.accounts.find((a) => a.code === '1001');
  assert.ok(joao);
  assert.match(joao.description, /SILVA/i);
});

test('POST preview 200 no PDF da Audácia', async () => {
  const r = await uploadPreview(buildRelacaoPdf(), 'RELAÇÃO DE CONTAS.pdf', ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.source, 'PARSER');
  assert.equal(r.data.valid, 683);
  assert.equal(r.data.exact_duplicates, 0);
  assert.ok(r.data.repeated_classifications >= 1);
  assert.ok(!/inteligente/i.test(JSON.stringify(r.data)));
  const sample = r.data.accounts.slice(0, 5);
  assert.equal(sample[0].description, 'ATIVO');
  assert.equal(sample[4].description, 'CAIXA GERAL');
});

test('POST preview 400 sem arquivo', async () => {
  const r = await fetch(base + '/api/plano-contas/preview', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ownerA.token }
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.equal(data.error, 'FILE_REQUIRED');
});

test('POST preview 422 estrutura e extração', async () => {
  const empty = await uploadPreview(Buffer.from('apenas texto sem contas'), 'vazio.txt', ownerA.token);
  assert.equal(empty.status, 422, JSON.stringify(empty.data));
  assert.equal(empty.data.error, 'PLAN_ACCOUNTS_PREVIEW_INVALID');
  assert.ok(empty.data.details);
  assert.ok(empty.data.details.code);
  assert.ok(!/inteligente/i.test(empty.data.message || ''));

  const noText = await uploadPreview(textPdf([' ']), 'imagem.pdf', ownerA.token);
  assert.equal(noText.status, 422, JSON.stringify(noText.data));
  assert.ok(['EXTRACTION_UNAVAILABLE', 'STRUCTURE_UNRECOGNIZED', 'NO_ACCOUNTS', 'PDF_INVALID'].includes(noText.data.details.code));

  const bad = await uploadPreview(Buffer.from('not-a-pdf'), 'quebrado.pdf', ownerA.token);
  assert.equal(bad.status, 422, JSON.stringify(bad.data));
  assert.equal(bad.data.details.code, 'PDF_INVALID');
  assert.equal(bad.data.details.fileType, 'pdf');
});

test('500 controlado está no contrato de preview', () => {
  const js = fs.readFileSync(path.join(__dirname, '../backend/src/server.js'), 'utf8');
  assert.match(js, /plan_accounts_preview/);
  assert.match(js, /status\(500\)\.json\(\{error:'PLAN_ACCOUNTS_PREVIEW_INVALID'/);
});

test('importação definitiva após prévia, idempotência de código e isolamento', async () => {
  const pdf = buildRelacaoPdf();
  const preview = await uploadPreview(pdf, 'RELAÇÃO DE CONTAS.pdf', ownerA.token);
  assert.equal(preview.status, 200);
  const first = await uploadImport(pdf, 'RELAÇÃO DE CONTAS.pdf', ownerA.token, 'Plano SCOSY');
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.imported, 683);
  const plan = db.prepare('SELECT * FROM account_plans WHERE id=?').get(first.data.planId);
  assert.equal(plan.tenant_id, ownerA.user.tenant_id);
  assert.equal(plan.status, 'ACTIVE');
  const joao = db.prepare("SELECT * FROM accounts WHERE plan_id=? AND description LIKE '%SILVA%'").get(first.data.planId);
  assert.ok(joao);
  const sameClass = db.prepare('SELECT COUNT(*) n FROM accounts WHERE plan_id=? AND classification_code=?').get(first.data.planId, '1120100001').n;
  assert.equal(sameClass, 4);
  const auditRow = db.prepare("SELECT * FROM audit_logs WHERE action='ACCOUNT_PLAN_IMPORTED' AND entity_id=?").get(first.data.planId);
  assert.ok(auditRow);

  const second = await uploadImport(pdf, 'RELAÇÃO DE CONTAS.pdf', ownerA.token, 'Plano SCOSY 2');
  assert.equal(second.status, 201);
  assert.equal(second.data.imported, 683);
  assert.notEqual(second.data.planId, first.data.planId);

  const other = await req('GET', '/api/plano-contas/' + first.data.planId + '/accounts', undefined, ownerB.token);
  assert.ok(other.status === 200);
  assert.equal((other.data || []).length, 0);

  const client = await uploadPreview(pdf, 'RELAÇÃO DE CONTAS.pdf', clientToken);
  assert.equal(client.status, 403);

  const hijack = await uploadPreview(pdf, 'RELAÇÃO DE CONTAS.pdf', ownerA.token, { company_id: companyB.id });
  assert.equal(hijack.status, 403);
});

test('reprocessamento CSV legado', async () => {
  const csv = Buffer.from('codigo;classificacao;descricao;tipo\n1;1110;ATIVO;S\n2;1110100001;CAIXA GERAL;A');
  const preview = await uploadPreview(csv, 'plano.csv', ownerA.token);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.valid, 2);
  const imp = await uploadImport(csv, 'plano.csv', ownerA.token, 'CSV legado');
  assert.equal(imp.status, 201);
  assert.equal(imp.data.imported, 2);
});

test('frontend não trata 422 de parser como falha de IA', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /planPreviewError/);
  assert.match(js, /Não foi possível interpretar o plano de contas/);
  assert.match(js, /classificações repetidas/);
  assert.match(js, /Analisando arquivo/);
  assert.doesNotMatch(js.slice(js.indexOf('function planImport'), js.indexOf('async function simple')), /Nenhuma conta válida pode ser importada/);
});
