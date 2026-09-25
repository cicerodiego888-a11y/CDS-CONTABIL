'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s39-'));
process.env.CDS_DB_PATH = path.join(tmp, 's39.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-39-plan-glued-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';

const parser = require('../backend/src/chart-of-accounts/parser');
const { extractPlanText } = require('../backend/src/chart-of-accounts/extract');
const { textPdf } = require('./helpers/relacao-contas');
const { app, db } = require('../backend/src/server');

const FIXTURE_TXT = path.join(__dirname, 'fixtures', 'relacao-contas-real-extract.txt');
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'relacao-contas-real.pdf');

const password = 'Senha@123';
let server, base, ownerToken;

function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function uploadPreview(buffer, name, token) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  const r = await fetch(base + '/api/plano-contas/preview', {
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
  const reg = await req('POST', '/api/auth/register', {
    name: 'Escritório S39',
    email: 'owner.s39@test.local',
    password,
    tenantName: 'Tenant S39'
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  ownerToken = (await req('POST', '/api/auth/login', {
    email: 'owner.s39@test.local',
    password,
    tenant: reg.data.tenant_slug
  })).data.token;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
});

test('A: formato antigo com espaços continua válido', () => {
  const text = [
    'Código Classificação Descrição',
    '1 1 ATIVO',
    '2 11 ATIVO CIRCULANTE',
    '3 111 DISPONÍVEL',
    '5 1110100001 CAIXA GERAL'
  ].join('\n');
  const preview = parser.buildPreview(parser.parseChartText(text));
  assert.equal(preview.valid, 4);
  assert.equal(preview.accounts[0].code, '1');
  assert.equal(preview.accounts[0].classification_code, '1');
  assert.equal(preview.accounts[1].classification_code, '11');
  assert.equal(preview.accounts[3].description, 'CAIXA GERAL');
});

test('B: formato real colado interpreta código/classificação/descrição', () => {
  const text = [
    'CódigoClassificaçãoDescrição',
    '11ATIVO',
    '211ATIVO CIRCULANTE',
    '3111DISPONÍVEL',
    '51110100001CAIXA GERAL',
    '10271110200003CONTA AZUL'
  ].join('\n');
  const parsed = parser.parseChartText(text);
  const preview = parser.buildPreview(parsed);
  assert.equal(preview.valid, 5);
  assert.equal(parsed.header, true);
  const by = Object.fromEntries(preview.accounts.map((a) => [a.code, a]));
  assert.equal(by['1'].classification_code, '1');
  assert.equal(by['1'].description, 'ATIVO');
  assert.equal(by['2'].classification_code, '11');
  assert.equal(by['2'].description, 'ATIVO CIRCULANTE');
  assert.equal(by['3'].classification_code, '111');
  assert.equal(by['5'].classification_code, '1110100001');
  assert.equal(by['5'].description, 'CAIXA GERAL');
  assert.equal(by['1027'].classification_code, '1110200003');
  assert.equal(by['1027'].description, 'CONTA AZUL');
});

test('C: dump real pdf-parse → valid === 683', () => {
  assert.ok(fs.existsSync(FIXTURE_TXT), 'fixture de texto real ausente');
  const dump = fs.readFileSync(FIXTURE_TXT, 'utf8');
  const parsed = parser.parseChartText(dump);
  const preview = parser.buildPreview(parsed);
  assert.equal(parsed.rows.length, 683);
  assert.equal(preview.valid, 683);
  assert.equal(preview.rejected, 0);
  assert.equal(preview.source, 'PARSER');
  assert.equal(preview.structure_recognized, true);
});

test('C2: PDF real → extração + 683 contas', async () => {
  assert.ok(fs.existsSync(FIXTURE_PDF), 'fixture PDF real ausente');
  const buf = fs.readFileSync(FIXTURE_PDF);
  const extracted = await extractPlanText(buf, '.pdf');
  assert.ok(/ATIVO/.test(extracted.text));
  assert.ok(/CódigoClassificaçãoDescrição/.test(extracted.text.replace(/\s+/g, '')) || /11ATIVO/.test(extracted.text));
  const preview = parser.buildPreview(parser.parseChartText(extracted.text));
  assert.equal(preview.valid, 683);
  assert.equal(preview.source, 'PARSER');
});

test('D: primeiras contas conhecidas', () => {
  const dump = fs.readFileSync(FIXTURE_TXT, 'utf8');
  const by = Object.fromEntries(
    parser.buildPreview(parser.parseChartText(dump)).accounts.map((a) => [a.code, a])
  );
  assert.equal(by['1'].classification_code, '1');
  assert.equal(by['1'].description, 'ATIVO');
  assert.equal(by['2'].classification_code, '11');
  assert.equal(by['2'].description, 'ATIVO CIRCULANTE');
  assert.equal(by['3'].classification_code, '111');
  assert.equal(by['3'].description, 'DISPONÍVEL');
  assert.equal(by['4'].classification_code, '11101');
  assert.equal(by['4'].description, 'CAIXA');
  assert.equal(by['5'].classification_code, '1110100001');
  assert.equal(by['5'].description, 'CAIXA GERAL');
});

test('E: classificação repetida 1000–1003', () => {
  const dump = fs.readFileSync(FIXTURE_TXT, 'utf8');
  const by = Object.fromEntries(
    parser.buildPreview(parser.parseChartText(dump)).accounts.map((a) => [a.code, a])
  );
  for (const code of ['1000', '1001', '1002', '1003']) {
    assert.equal(by[code].classification_code, '1120100001');
  }
  assert.match(by['1000'].description, /CLIENTES DIVERSOS/i);
  assert.match(by['1001'].description, /JOÃO SILVA|JOAO SILVA/i);
});

test('F: header colado não vira conta', () => {
  const parsed = parser.parseChartText('CódigoClassificaçãoDescrição\n11ATIVO');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].descricao, 'ATIVO');
  assert.ok(!parsed.rows.some((r) => /classifica/i.test(r.descricao)));
});

test('G/H: empresa, CNPJ e paginação não viram conta', () => {
  const text = [
    'Página:',
    '1/8',
    'RELAÇÃO DE CONTAS',
    'SCOSY EMPREENDIMENTOS LTDA',
    'Empresa:',
    '28.027.121/0001-46C.N.P.J.:',
    'CódigoClassificaçãoDescrição',
    '11ATIVO'
  ].join('\n');
  const parsed = parser.parseChartText(text);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.meta.company_name, 'SCOSY EMPREENDIMENTOS LTDA');
  assert.equal(parsed.meta.company_cnpj, '28.027.121/0001-46');
});

test('I: linha inválida não inventa conta', () => {
  const text = 'CódigoClassificaçãoDescrição\nfoobar\n11ATIVO\n!!!';
  const parsed = parser.parseChartText(text);
  assert.equal(parsed.rows.length, 1);
  assert.ok(parsed.skipped.includes('foobar'));
  const unsafe = parser.parseGluedAccount('1', 'X', '', new Set());
  assert.equal(unsafe, null);
});

test('J: POST preview PDF real → 200 / 683; inválido → 422', async () => {
  const ok = await uploadPreview(fs.readFileSync(FIXTURE_PDF), 'RELAÇÃO DE CONTAS.pdf', ownerToken);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.source, 'PARSER');
  assert.equal(ok.data.structure_recognized, true);
  assert.equal(ok.data.valid, 683);
  assert.ok(Array.isArray(ok.data.accounts) && ok.data.accounts.length === 683);
  assert.ok(Array.isArray(ok.data.sample) && ok.data.sample.length > 0);
  assert.ok(!/inteligente/i.test(JSON.stringify(ok.data)));

  const bad = await uploadPreview(Buffer.from('texto sem estrutura de plano'), 'lixo.txt', ownerToken);
  assert.equal(bad.status, 422, JSON.stringify(bad.data));
  assert.equal(bad.data.error, 'PLAN_ACCOUNTS_PREVIEW_INVALID');
  assert.equal(bad.data.details.code, 'STRUCTURE_UNRECOGNIZED');

  const emptyPdf = await uploadPreview(textPdf([' ']), 'vazio.pdf', ownerToken);
  assert.equal(emptyPdf.status, 422);
  assert.ok(['EXTRACTION_UNAVAILABLE', 'STRUCTURE_UNRECOGNIZED', 'NO_ACCOUNTS', 'PDF_INVALID'].includes(emptyPdf.data.details.code));
});
