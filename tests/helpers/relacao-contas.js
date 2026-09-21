'use strict';

const WIN = Object.freeze({
  Á: '\xC1', É: '\xC9', Í: '\xCD', Ó: '\xD3', Ú: '\xDA', Â: '\xC2', Ê: '\xCA', Ô: '\xD4',
  Ã: '\xC3', Õ: '\xD5', Ç: '\xC7', á: '\xE1', é: '\xE9', í: '\xED', ó: '\xF3', ú: '\xFA',
  ã: '\xE3', õ: '\xF5', ç: '\xE7', à: '\xE0'
});

function pdfEscape(s) {
  return String(s)
    .replace(/[^\x00-\x7F]/g, (ch) => WIN[ch] || '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildRelacaoAccounts() {
  const rows = [
    { code: '1', cls: '1', desc: 'ATIVO' },
    { code: '2', cls: '11', desc: 'ATIVO CIRCULANTE' },
    { code: '3', cls: '111', desc: 'DISPONÍVEL' },
    { code: '4', cls: '11101', desc: 'CAIXA' },
    { code: '5', cls: '1110100001', desc: 'CAIXA GERAL' },
    { code: '1000', cls: '1120100001', desc: 'CLIENTES DIVERSOS' },
    { code: '1001', cls: '1120100001', desc: 'JOÃO SILVA' },
    { code: '1002', cls: '1120100001', desc: 'SIMPLES IND COMERCIO E SERVIÇO' },
    { code: '1003', cls: '1120100001', desc: 'PRESUMIDO INDUSTRIA, COMERCIO, SERVIÇO' }
  ];
  for (let i = 0; i < 36; i++) {
    const cls = String(2110100001 + i);
    rows.push({ code: String(2000 + i * 2), cls, desc: `CLIENTE GRUPO ${i} A` });
    rows.push({ code: String(2000 + i * 2 + 1), cls, desc: `CLIENTE GRUPO ${i} B` });
  }
  const used = new Set(rows.map((r) => r.code));
  let code = 6;
  while (rows.length < 683) {
    const c = String(code);
    if (!used.has(c)) {
      used.add(c);
      rows.push({ code: c, cls: '3' + String(100000000 + rows.length).slice(-9), desc: `CONTA AUXILIAR ${c}` });
    }
    code += 1;
    if (code === 1000) code = 1004;
  }
  rows.sort((a, b) => Number(a.code) - Number(b.code));
  return rows;
}

function buildRelacaoText(accounts) {
  const rows = accounts || buildRelacaoAccounts();
  const perPage = Math.ceil(rows.length / 8);
  const chunks = [];
  for (let p = 0; p < 8; p++) {
    const slice = rows.slice(p * perPage, (p + 1) * perPage);
    chunks.push(
      `Página: ${p + 1}`,
      'Emissão: 18/09/2026',
      'Hora: 09:00',
      'RELAÇÃO DE CONTAS',
      'Empresa: SCOSY EMPREENDIMENTOS LTDA',
      'C.N.P.J.: 28.027.121/0001-46',
      'Código Classificação Descrição',
      ...slice.map((r) => `${r.code} ${r.cls} ${r.desc}`),
      `${p + 1}/8`
    );
  }
  return chunks.join('\n');
}

function textPdf(lines) {
  const stream = 'BT /F1 10 Tf 36 780 Td ' + lines.map((line, index) =>
    (index ? '0 -11 Td ' : '') + '(' + pdfEscape(line) + ') Tj'
  ).join(' ') + ' ET';
  const body =
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n' +
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    `5 0 obj<</Length ${Buffer.byteLength(stream, 'latin1')}>>stream\n${stream}\nendstream\nendobj\n` +
    'trailer<</Root 1 0 R>>\n%%EOF';
  return Buffer.from(body, 'latin1');
}

function buildRelacaoPdf() {
  return textPdf(buildRelacaoText().split('\n'));
}

module.exports = {
  buildRelacaoAccounts,
  buildRelacaoText,
  buildRelacaoPdf,
  textPdf
};
