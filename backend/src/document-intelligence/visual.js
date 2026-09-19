'use strict';

const FIELD_NAMES = Object.freeze([
  'document_type',
  'document_number',
  'issue_date',
  'supplier_name',
  'supplier_document',
  'description',
  'total_amount',
  'payment_method'
]);

const VISUAL_MIME = Object.freeze({
  'image/png': true,
  'image/jpeg': true,
  'image/jpg': true
});

/** Limite simples para interpretação visual (abaixo do upload 25MB). */
const MAX_VISUAL_BYTES = 12 * 1024 * 1024;
/** Valor monetário máximo aceito da IA visual (~100 bilhões). */
const MAX_VISUAL_AMOUNT = 1e11;

function fieldValue(fields, name) {
  if (!fields || !fields[name]) return null;
  const item = fields[name];
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    if (item.normalized_value != null && String(item.normalized_value).trim() !== '') {
      return item.normalized_value;
    }
    if (item.value != null && String(item.value).trim() !== '') return item.value;
    if (item.raw_value != null && String(item.raw_value).trim() !== '') return item.raw_value;
    return null;
  }
  if (item == null || String(item).trim() === '') return null;
  return item;
}

function isExtractionSufficient(fields) {
  const amount = fieldValue(fields, 'total_amount');
  const date = fieldValue(fields, 'issue_date');
  const supplier = fieldValue(fields, 'supplier_name');
  const description = fieldValue(fields, 'description');
  return !!(amount && date && (supplier || description));
}

function isVisualMime(mime) {
  return !!VISUAL_MIME[String(mime || '').toLowerCase()];
}

function normalizeConfidence(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  // Fora de [0,1] → baixa confiança (nunca promover para alta).
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0;
  return n;
}

function coerceAiRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return null;
  if (typeof raw === 'boolean') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return raw;
  }
  const text = String(raw).trim();
  if (!text || text === '[object Object]' || text === '[object Array]') return null;
  return text;
}

function pickAiField(payload, name) {
  if (!payload || typeof payload !== 'object') return { raw: null, confidence: 0 };
  const nested = payload.fields && payload.fields[name];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return {
      raw: coerceAiRaw(nested.value),
      confidence: normalizeConfidence(nested.confidence)
    };
  }
  return {
    raw: coerceAiRaw(payload[name]),
    confidence: 0.7
  };
}

function normalizeAiVisualResult(payload, normalization) {
  const out = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { fields: out, document_type: null, origin: 'AI_VISUAL' };
  }
  for (const name of FIELD_NAMES) {
    const picked = pickAiField(payload, name);
    if (picked.raw == null) continue;
    let normalized = null;
    if (name === 'total_amount') {
      normalized = normalization.normalizeMoney(picked.raw);
      if (normalized != null) {
        const amount = Number(normalized);
        // Despesa: rejeitar zero/negativo/absurdo sem alterar normalizeMoney global.
        if (!Number.isFinite(amount) || !(amount > 0) || amount > MAX_VISUAL_AMOUNT) {
          normalized = null;
        }
      }
    } else if (name === 'issue_date') {
      normalized = normalization.normalizeDate(picked.raw);
    } else if (name === 'supplier_document') {
      normalized = normalization.normalizeTaxDocument(picked.raw);
    } else if (name === 'document_number') {
      normalized = normalization.normalizeDocumentNumber(picked.raw);
    } else {
      normalized = String(picked.raw).replace(/\s+/g, ' ').trim().slice(0, 500) || null;
    }
    if (normalized == null || String(normalized).trim() === '') continue;
    out[name] = {
      raw_value: String(picked.raw).slice(0, 500),
      normalized_value: normalized,
      confidence: picked.confidence
    };
  }
  return {
    fields: out,
    document_type: out.document_type ? out.document_type.normalized_value : null,
    origin: 'AI_VISUAL'
  };
}

const VISUAL_SYSTEM_PROMPT = [
  'Você interpreta documentos fiscais e recibos a partir da imagem ou texto fornecido.',
  'Retorne SOMENTE JSON estruturado com os campos: document_type, document_number,',
  'issue_date, supplier_name, supplier_document, description, total_amount, payment_method',
  'e um objeto fields onde cada campo tem { value, confidence } (confidence de 0 a 1).',
  'Regras obrigatórias:',
  '- Não inventar campos.',
  '- Não completar informação ausente.',
  '- Não criar CNPJ/CPF.',
  '- Não criar número de documento.',
  '- Não criar data.',
  '- Não criar valor.',
  '- Se não conseguir identificar, use null e confidence 0.',
  '- Confiança baixa deve permanecer baixa.',
  '- Não transformar inferência em fato.',
  '- Datas preferencialmente em YYYY-MM-DD ou DD/MM/YYYY.',
  '- Valores monetários numéricos positivos (ex.: 45.00), sem texto por extenso.',
  '- Não inventar fornecedores como Uber ou 99 quando o documento não traz o nome.'
].join(' ');

module.exports = {
  FIELD_NAMES,
  VISUAL_MIME,
  VISUAL_SYSTEM_PROMPT,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_AMOUNT,
  isExtractionSufficient,
  isVisualMime,
  normalizeAiVisualResult,
  normalizeConfidence,
  coerceAiRaw,
  fieldValue
};
