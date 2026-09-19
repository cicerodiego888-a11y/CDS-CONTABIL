'use strict';

function cleanControls(value) {
  return String(value == null ? '' : value)
    .normalize('NFC')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function normalizeText(value) {
  return cleanControls(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t\u00A0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeMoney(value) {
  let raw = cleanControls(value).replace(/[^\d,.\-]/g, '');
  if (!raw) return null;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma >= 0 && comma > dot) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (dot >= 0) raw = raw.replace(/,/g, '');
  else raw = raw.replace(/,/g, '.');
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  return number.toFixed(2);
}

function normalizeDate(value) {
  const raw = cleanControls(value).trim();
  let year, month, day;
  let match = raw.match(/\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})\b/);
  if (match) {
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  } else {
    match = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (!match) return null;
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeTaxDocument(value) {
  const digits = cleanControls(value).replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : null;
}

function normalizeDocumentNumber(value) {
  const normalized = cleanControls(value).replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 80) : null;
}

function createDocumentNormalizationService() {
  return {
    normalizeText,
    normalizeMoney,
    normalizeDate,
    normalizeTaxDocument,
    normalizeDocumentNumber
  };
}

module.exports = {
  createDocumentNormalizationService,
  normalizeText,
  normalizeMoney,
  normalizeDate,
  normalizeTaxDocument,
  normalizeDocumentNumber
};
