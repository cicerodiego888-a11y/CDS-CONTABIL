'use strict';

const { field, emptyNormalized, competenceFromDate } = require('./normalized-fields');
const { normalizeMoney, normalizeDate, normalizeTaxDocument, normalizeDocumentNumber, normalizeText } = require('../document-intelligence/normalization');
const { OPERATION_TYPES } = require('./operation-types');

function tagText(xml, tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const name of names) {
    const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]+)<\\/(?:\\w+:)?${name}>`, 'i');
    const m = String(xml || '').match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function tagAttr(xml, tagName, attr) {
  const re = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = String(xml || '').match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parser estruturado NF-e / NFS-e / CT-e simplificado.
 * Retorna null se não for XML fiscal reconhecível.
 */
function parseFiscalXml(bufferOrText) {
  const text = Buffer.isBuffer(bufferOrText)
    ? bufferOrText.toString('utf8')
    : String(bufferOrText || '');
  const trimmed = text.trim();
  if (!trimmed.startsWith('<') && !trimmed.includes('<?xml')) {
    return { ok: false, code: 'NOT_XML', message: 'Conteúdo não é XML.' };
  }
  // Invalid / truncated
  if (!/<\/[\w:]+>/.test(trimmed) && !/<[\w:]+[^>]*\/>/.test(trimmed)) {
    return { ok: false, code: 'INVALID_XML', message: 'XML inválido ou truncado.' };
  }

  const isNfe = /<(?:\w+:)?(NFe|nfeProc|infNFe)\b/i.test(trimmed);
  const isNfse = /<(?:\w+:)?(NFSe|CompNfse|InfNfse|nfse)\b/i.test(trimmed);
  const isCte = /<(?:\w+:)?(CTe|cteProc|infCte)\b/i.test(trimmed);

  if (!isNfe && !isNfse && !isCte) {
    // Generic XML with value-like tags still usable
    const hasFiscalHints = /<(?:\w+:)?(vNF|vServ|CNPJ|emit|dest)\b/i.test(trimmed);
    if (!hasFiscalHints) {
      return { ok: false, code: 'NOT_FISCAL_XML', message: 'XML sem estrutura fiscal reconhecida.' };
    }
  }

  const fields = emptyNormalized();
  const conf = 0.99;
  const src = 'xml';

  let docType = 'XML';
  if (isNfe) docType = 'NF-e';
  else if (isNfse) docType = 'NFS-e';
  else if (isCte) docType = 'CT-e';
  fields.document_type = field(docType, conf, src);

  const key = tagText(trimmed, ['chNFe', 'CodigoVerificacao']) ||
    tagAttr(trimmed, 'infNFe', 'Id') ||
    tagAttr(trimmed, 'InfNfse', 'Id');
  if (key) {
    const cleanKey = String(key).replace(/^NFe/, '');
    fields.document_key = field(cleanKey, conf, src);
  }

  const number = tagText(trimmed, ['nNF', 'Numero', 'nCT']);
  if (number) fields.number = field(normalizeDocumentNumber(number) || number, conf, src);

  const series = tagText(trimmed, ['serie', 'Serie']);
  if (series) fields.series = field(series, conf, src);

  const dhEmi = tagText(trimmed, ['dhEmi', 'dEmi', 'DataEmissao', 'dhEmi']);
  const issueDate = normalizeDate(dhEmi) || (dhEmi && /^\d{4}-\d{2}-\d{2}/.test(dhEmi) ? dhEmi.slice(0, 10) : null);
  if (issueDate) {
    fields.document_date = field(issueDate, conf, src);
    fields.competence = field(competenceFromDate(issueDate), conf, src);
  }

  // Emitente (fornecedor) — bloco emit
  const emitBlock = trimmed.match(/<(?:\w+:)?emit\b[\s\S]*?<\/(?:\w+:)?emit>/i);
  const emitXml = emitBlock ? emitBlock[0] : trimmed;
  const emitCnpj = normalizeTaxDocument(tagText(emitXml, ['CNPJ'])) || tagText(emitXml, ['CNPJ']);
  const emitCpf = normalizeTaxDocument(tagText(emitXml, ['CPF'])) || tagText(emitXml, ['CPF']);
  const emitName = tagText(emitXml, ['xNome', 'RazaoSocial']);
  if (emitName) {
    fields.supplier_name = field(normalizeText(emitName) || emitName, conf, src);
    fields.issuer = fields.supplier_name;
  }
  if (emitCnpj) {
    fields.cnpj = field(String(emitCnpj).replace(/\D/g, ''), conf, src);
    fields.tax_id = fields.cnpj;
  } else if (emitCpf) {
    fields.cpf = field(String(emitCpf).replace(/\D/g, ''), conf, src);
    fields.tax_id = fields.cpf;
  }

  // Destinatário
  const destBlock = trimmed.match(/<(?:\w+:)?dest\b[\s\S]*?<\/(?:\w+:)?dest>/i);
  if (destBlock) {
    const destName = tagText(destBlock[0], ['xNome']);
    if (destName) {
      fields.customer_name = field(normalizeText(destName) || destName, conf, src);
      fields.recipient = fields.customer_name;
    }
  }

  const amountRaw = tagText(trimmed, ['vNF', 'vServ', 'vTPrest', 'ValorServicos', 'vLiq']);
  const amount = normalizeMoney(amountRaw);
  if (amount) {
    fields.amount = field(amount, conf, src);
    fields.invoice_total = field(amount, conf, src);
  }

  const natOp = tagText(trimmed, ['natOp', 'Discriminacao', 'xProd']);
  if (natOp) {
    fields.description = field(normalizeText(natOp) || natOp, conf, src);
    fields.fiscal_information = field(natOp, conf, src);
  } else if (emitName) {
    fields.description = field(`Documento fiscal — ${emitName}`, 0.9, src);
  }

  const due = tagText(trimmed, ['dVenc', 'DataVencimento']);
  const dueDate = normalizeDate(due);
  if (dueDate) fields.due_date = field(dueDate, conf, src);

  // Inferência leve de natureza a partir do XML (não é IA)
  let operationType = OPERATION_TYPES.DESPESA;
  if (isNfse) operationType = OPERATION_TYPES.SERVICO_TOMADO;
  else if (isNfe) {
    const tpNF = tagText(trimmed, ['tpNF']);
    if (tpNF === '1') operationType = OPERATION_TYPES.VENDA;
    else operationType = OPERATION_TYPES.COMPRA;
  }
  fields.operation_type = field(operationType, 0.85, src);

  const hasCore = !!(fields.amount.value && (fields.document_date.value || fields.number.value));
  if (!hasCore) {
    return { ok: false, code: 'INCOMPLETE_XML', message: 'XML fiscal incompleto (faltam valor/data).', fields };
  }

  return {
    ok: true,
    code: 'OK',
    document_type: docType,
    fields,
    raw_excerpt: trimmed.slice(0, 4000)
  };
}

function isLikelyXml(buffer, mime, fileName) {
  const name = String(fileName || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (name.endsWith('.xml') || m.includes('xml')) return true;
  if (!buffer || buffer.length < 5) return false;
  const head = buffer.slice(0, 200).toString('utf8').trim();
  return head.startsWith('<?xml') || head.startsWith('<');
}

module.exports = {
  parseFiscalXml,
  isLikelyXml,
  tagText
};
