'use strict';

const { normalizeMoney, normalizeDate, normalizeTaxDocument, normalizeDocumentNumber, normalizeText } = require('../document-intelligence/normalization');

/**
 * Campo normalizado Audácia: { value, confidence, source }
 * source: xml | pdf_text | ocr | ai | rule | history | manual
 */
function field(value, confidence, source) {
  if (value == null || value === '') {
    return { value: null, confidence: 0, source: source || null };
  }
  let conf = Number(confidence);
  if (!Number.isFinite(conf) || conf < 0) conf = 0;
  if (conf > 1) conf = 1;
  return { value, confidence: conf, source: source || 'unknown' };
}

function emptyNormalized() {
  return {
    document_type: field(null, 0, null),
    document_date: field(null, 0, null),
    number: field(null, 0, null),
    series: field(null, 0, null),
    document_key: field(null, 0, null),
    tax_id: field(null, 0, null),
    supplier_name: field(null, 0, null),
    customer_name: field(null, 0, null),
    amount: field(null, 0, null),
    description: field(null, 0, null),
    due_date: field(null, 0, null),
    payment_method: field(null, 0, null),
    operation_type: field(null, 0, null),
    fiscal_information: field(null, 0, null),
    competence: field(null, 0, null),
    cnpj: field(null, 0, null),
    cpf: field(null, 0, null),
    issuer: field(null, 0, null),
    recipient: field(null, 0, null),
    items: field(null, 0, null),
    taxes: field(null, 0, null),
    invoice_total: field(null, 0, null),
    payment_terms: field(null, 0, null)
  };
}

/** Prioridade de fonte: xml > pdf_text > ocr > ai */
const SOURCE_PRIORITY = Object.freeze({
  xml: 100,
  pdf_text: 80,
  ocr: 60,
  ai: 40,
  rule: 70,
  history: 65,
  EXTRACTION_ENGINE: 80,
  AI_VISUAL: 50,
  manual: 10
});

function sourceRank(source) {
  return SOURCE_PRIORITY[source] || 0;
}

/**
 * Mescla campos: nunca sobrescreve dado de fonte de maior prioridade
 * com fonte inferior (ex.: não substituir XML por OCR).
 */
function mergeField(current, incoming) {
  if (!incoming || incoming.value == null || incoming.value === '') return current;
  if (!current || current.value == null || current.value === '') return incoming;
  if (sourceRank(incoming.source) > sourceRank(current.source)) return incoming;
  if (sourceRank(incoming.source) === sourceRank(current.source) &&
      Number(incoming.confidence || 0) > Number(current.confidence || 0)) {
    return incoming;
  }
  return current;
}

function mergeNormalized(base, patch) {
  const out = { ...(base || emptyNormalized()) };
  for (const [key, val] of Object.entries(patch || {})) {
    out[key] = mergeField(out[key], val);
  }
  return out;
}

function competenceFromDate(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function fromExtractionFields(extractionFields, method) {
  const source = method === 'AI_VISUAL' ? 'ocr'
    : method === 'XML' ? 'xml'
      : method === 'PDF_TEXT' ? 'pdf_text'
        : 'pdf_text';
  const out = emptyNormalized();
  const get = (name) => {
    const f = extractionFields && extractionFields[name];
    if (!f || f.value == null || String(f.value).trim() === '') return null;
    return { value: f.value, confidence: Number(f.confidence || 0.7), source };
  };
  const docType = get('document_type');
  if (docType) out.document_type = field(docType.value, docType.confidence, source);
  const date = get('issue_date');
  if (date) {
    const d = normalizeDate(date.value) || date.value;
    out.document_date = field(d, date.confidence, source);
    out.competence = field(competenceFromDate(d), date.confidence, source);
  }
  const num = get('document_number');
  if (num) out.number = field(normalizeDocumentNumber(num.value) || num.value, num.confidence, source);
  const supplier = get('supplier_name');
  if (supplier) {
    out.supplier_name = field(normalizeText(supplier.value) || supplier.value, supplier.confidence, source);
    out.issuer = out.supplier_name;
  }
  const tax = get('supplier_document');
  if (tax) {
    const digits = normalizeTaxDocument(tax.value) || String(tax.value).replace(/\D/g, '');
    out.tax_id = field(digits, tax.confidence, source);
    if (digits && digits.length === 14) out.cnpj = field(digits, tax.confidence, source);
    if (digits && digits.length === 11) out.cpf = field(digits, tax.confidence, source);
  }
  const amount = get('total_amount');
  if (amount) {
    const money = normalizeMoney(amount.value) || amount.value;
    out.amount = field(money, amount.confidence, source);
    out.invoice_total = field(money, amount.confidence, source);
  }
  const desc = get('description');
  if (desc) out.description = field(normalizeText(desc.value) || desc.value, desc.confidence, source);
  const pay = get('payment_method');
  if (pay) out.payment_method = field(String(pay.value).toUpperCase(), pay.confidence, source);
  return out;
}

module.exports = {
  field,
  emptyNormalized,
  mergeNormalized,
  mergeField,
  sourceRank,
  SOURCE_PRIORITY,
  fromExtractionFields,
  competenceFromDate
};
