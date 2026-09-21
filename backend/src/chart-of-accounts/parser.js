'use strict';

const HEADER_RE = /c[oó]digo\s+classifica[cç][aã]o\s+descri[cç][aã]o/i;
const PAGE_RE = /^\d+\s*\/\s*\d+$/;
const LEGACY_RE = /^\s*(\d+)\s+(\d{4,})\s+([SA])\s+(.+?)\s*$/i;
const CODE_CLASS_DESC_RE = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/;

function PlanPreviewError(message, code, stage, fileType, http) {
  const err = new Error(message);
  err.name = 'PlanPreviewError';
  err.error = 'PLAN_ACCOUNTS_PREVIEW_INVALID';
  err.code = code;
  err.stage = stage;
  err.fileType = fileType || null;
  err.http = http || 422;
  return err;
}

function normalizeChartText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\u00a0\u2000-\u200b\ufeff]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}

function isStructuralLine(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (PAGE_RE.test(s)) return true;
  if (HEADER_RE.test(s)) return true;
  if (/^p[aá]gina\s*:/i.test(s)) return true;
  if (/^emiss[aã]o\s*:/i.test(s)) return true;
  if (/^hora\s*:/i.test(s)) return true;
  if (/^rela[cç][aã]o\s+de\s+contas$/i.test(s)) return true;
  if (/^empresa\s*:/i.test(s)) return true;
  if (/^c\.?\s*n\.?\s*p\.?\s*j\.?\s*:/i.test(s)) return true;
  if (/^cnpj\s*:/i.test(s)) return true;
  return false;
}

function extractReportMeta(text) {
  const raw = String(text || '');
  const company = raw.match(/empresa\s*:\s*(.+)/i);
  const cnpj = raw.match(/c\.?\s*n\.?\s*p\.?\s*j\.?\s*:\s*([\d.\-\/]+)/i) || raw.match(/cnpj\s*:\s*([\d.\-\/]+)/i);
  return {
    company_name: company ? company[1].replace(/\s+/g, ' ').trim() : null,
    company_cnpj: cnpj ? cnpj[1].trim() : null
  };
}

function normHeader(h) {
  return String(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseDelimited(text) {
  const lines = String(text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return [];
  const d = lines[0].includes(';') ? ';' : ',';
  const split = (l) => {
    const out = [];
    let cur = '', quote = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (quote && l[i + 1] === '"') { cur += '"'; i++; }
        else quote = !quote;
      } else if (ch === d && !quote) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines.shift()).map(normHeader);
  return lines.map((l) => {
    const v = split(l), o = {};
    headers.forEach((h, i) => { o[h] = v[i] ?? ''; });
    return o;
  });
}

function looksDelimited(text) {
  const first = String(text || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
  if (!first) return false;
  if (HEADER_RE.test(first)) return false;
  const h = normHeader(first);
  if (h.includes('codigo') && (h.includes('classificacao') || h.includes('descricao'))) return first.includes(';') || first.includes(',');
  return /[;,]/.test(first) && !/^empresa\s*:/i.test(first);
}

function firstKey(r, keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(r, k)) return k;
  }
  return null;
}

function normalizeAccount(r, index) {
  const code = String(r.codigo ?? r.codigo_conta ?? r.code ?? r.conta ?? r.id ?? '').trim();
  const clsKey = firstKey(r, ['classificacao', 'classification', 'classificacaocontabil', 'codigocontabil', 'cls']);
  let cls = clsKey ? String(r[clsKey] ?? '').trim() : '';
  if (!cls && !clsKey) cls = code;
  let type = String(r.tipo ?? r.type ?? '').trim().toUpperCase();
  const desc = String(r.descricao ?? r.description ?? r.nome ?? r.desc ?? '').trim();
  if (type && !/^[SA]$/.test(type)) type = '';
  return {
    code,
    cls,
    type,
    desc,
    parent: null,
    level: 0,
    postable: type === 'A',
    order: index == null ? 0 : index,
    raw: r
  };
}

function inferHierarchy(accounts) {
  const classes = [...new Set(accounts.map((a) => a.cls).filter(Boolean))];
  for (const a of accounts) {
    if (!a.cls) continue;
    const synthetic = classes.some((c) => c !== a.cls && c.length > a.cls.length && c.startsWith(a.cls));
    if (!/^[SA]$/.test(a.type)) a.type = synthetic ? 'S' : 'A';
    a.postable = a.type === 'A';
    let parent = null;
    for (const c of classes) {
      if (c !== a.cls && a.cls.startsWith(c) && c.length < a.cls.length) {
        if (!parent || c.length > parent.length) parent = c;
      }
    }
    a.parent = parent;
    a.level = parent ? (accounts.find((x) => x.cls === parent)?.level || 0) + 1 : 0;
  }
  let guard = 0;
  while (guard < 20) {
    let changed = false;
    for (const a of accounts) {
      if (!a.parent) continue;
      const p = accounts.find((x) => x.cls === a.parent);
      const next = p ? p.level + 1 : 0;
      if (next !== a.level) { a.level = next; changed = true; }
    }
    if (!changed) break;
    guard++;
  }
  return accounts;
}

function validateChartAccounts(rows) {
  const issues = [];
  const alerts = [];
  const codes = new Map();
  const exact = new Map();
  const classCounts = new Map();
  const valid = [];
  rows.forEach((raw, i) => {
    const row = i + 1;
    const r = normalizeAccount(raw, i);
    if (!r.code && !r.cls && !r.desc) {
      issues.push({ row, code: 'LINHA_INVALIDA', reason: 'Linha inválida' });
      return;
    }
    if (!r.code) { issues.push({ row, code: 'CODIGO_AUSENTE', reason: 'Código ausente' }); return; }
    if (!r.cls) { issues.push({ row, code: 'CLASSIFICACAO_AUSENTE', reason: 'Classificação ausente' }); return; }
    if (!r.desc) { issues.push({ row, code: 'DESCRICAO_AUSENTE', reason: 'Descrição ausente' }); return; }
    const key = `${r.code}|${r.cls}|${r.desc}`;
    if (exact.has(key)) {
      issues.push({ row, code: 'DUPLICIDADE_EXATA', reason: `Duplicidade exata da linha ${exact.get(key)}` });
      return;
    }
    exact.set(key, row);
    if (codes.has(r.code)) {
      issues.push({ row, code: 'CODIGO_REPETIDO', reason: `Código repetido: ${r.code}` });
    } else codes.set(r.code, row);
    classCounts.set(r.cls, (classCounts.get(r.cls) || 0) + 1);
    r.status = codes.get(r.code) === row ? 'OK' : 'ALERTA';
    valid.push(r);
  });
  inferHierarchy(valid);
  const repeated = [...classCounts.entries()].filter(([, n]) => n > 1);
  if (repeated.length) {
    alerts.push({
      code: 'CLASSIFICACAO_REPETIDA',
      message: `${repeated.length} classificações repetidas`,
      count: repeated.length,
      extra: 'Classificação não é chave única. Contas distintas com a mesma classificação são preservadas.'
    });
    const repeatedSet = new Set(repeated.map(([c]) => c));
    for (const a of valid) {
      if (repeatedSet.has(a.cls) && a.status === 'OK') a.status = 'ALERTA';
    }
  }
  return {
    valid,
    issues,
    alerts,
    exact_duplicates: issues.filter((x) => x.code === 'DUPLICIDADE_EXATA').length,
    repeated_classifications: repeated.length
  };
}

function parseLegacyLine(line) {
  const m = String(line).match(LEGACY_RE);
  if (!m) return null;
  return { codigo: m[1], classificacao: m[2], tipo: m[3].toUpperCase(), descricao: m[4] };
}

function parseCodeClassDescLine(line) {
  const m = String(line).match(CODE_CLASS_DESC_RE);
  if (!m) return null;
  return { codigo: m[1], classificacao: m[2], descricao: m[3] };
}

function parseChartText(text) {
  const normalized = normalizeChartText(text);
  const meta = extractReportMeta(normalized);
  const header = HEADER_RE.test(normalized);
  const rows = [];
  const skipped = [];
  let format = header ? 'CODE_CLASS_DESC' : null;
  let legacyHits = 0;
  let relacaoHits = 0;
  for (const line of normalized.split('\n')) {
    if (isStructuralLine(line)) continue;
    const legacy = parseLegacyLine(line);
    if (legacy) {
      rows.push(legacy);
      legacyHits++;
      continue;
    }
    const rel = parseCodeClassDescLine(line);
    if (rel) {
      rows.push(rel);
      relacaoHits++;
      continue;
    }
    skipped.push(line);
  }
  if (!format) format = legacyHits >= relacaoHits && legacyHits ? 'CODE_CLASS_TYPE_DESC' : 'CODE_CLASS_DESC';
  return { rows, skipped, format, header, meta, text: normalized };
}

function parsePlanSource(text, ext) {
  const e = String(ext || '').toLowerCase();
  const normalized = normalizeChartText(text);
  if (e === '.csv' || (e === '.txt' && looksDelimited(normalized))) {
    return { rows: parseDelimited(normalized), format: 'CSV', header: true, meta: extractReportMeta(normalized), skipped: [], text: normalized };
  }
  return parseChartText(normalized);
}

function publicAccount(a) {
  return {
    code: a.code,
    account_code: a.code,
    classification_code: a.cls,
    classificacao: a.cls,
    description: a.desc,
    descricao: a.desc,
    account_type: a.type,
    type: a.type,
    level: a.level,
    parent_code: a.parent,
    is_postable: a.postable,
    status: a.status || 'OK'
  };
}

function buildPreview(parsed) {
  const v = validateChartAccounts(parsed.rows);
  const synthetic = v.valid.filter((x) => x.type === 'S').length;
  const analytic = v.valid.filter((x) => x.type === 'A').length;
  return {
    source: 'PARSER',
    format: parsed.format,
    structure_recognized: parsed.header || v.valid.length > 0,
    company_name: parsed.meta.company_name,
    company_cnpj: parsed.meta.company_cnpj,
    total: parsed.rows.length,
    valid: v.valid.length,
    rejected: v.issues.length,
    synthetic,
    analytic,
    exact_duplicates: v.exact_duplicates,
    repeated_classifications: v.repeated_classifications,
    alerts: v.alerts,
    issues: v.issues.slice(0, 500),
    accounts: v.valid.map(publicAccount),
    sample: v.valid.slice(0, 100).map(publicAccount)
  };
}

function parsePdfText(text) {
  return parseChartText(text).rows;
}

module.exports = {
  PlanPreviewError,
  normalizeChartText,
  isStructuralLine,
  extractReportMeta,
  parseDelimited,
  parseChartText,
  parsePlanSource,
  parsePdfText,
  normalizeAccount,
  inferHierarchy,
  validateChartAccounts,
  buildPreview,
  publicAccount,
  HEADER_RE
};
