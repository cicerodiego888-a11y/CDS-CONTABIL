'use strict';

const HEADER_RE = /c[oó]digo\s+classifica[cç][aã]o\s+descri[cç][aã]o/i;
const HEADER_COMPACT_RE = /c[oó]digoclassifica[cç][aã]odescri[cç][aã]o/i;
const PAGE_RE = /^\d+\s*\/\s*\d+$/;
const LEGACY_RE = /^\s*(\d+)\s+(\d{4,})\s+([SA])\s+(.+?)\s*$/i;
const CODE_CLASS_DESC_RE = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/;
/** Real Domínio/Audácia pdf-parse output: digits immediately followed by description. */
const GLUED_ACCOUNT_RE = /^(\d+)(\D.+)$/;

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

function compactHeaderKey(line) {
  return String(line || '').replace(/\s+/g, '');
}

function isChartHeaderLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (HEADER_RE.test(s)) return true;
  return HEADER_COMPACT_RE.test(compactHeaderKey(s));
}

function hasChartHeader(text) {
  const normalized = String(text || '');
  if (HEADER_RE.test(normalized)) return true;
  return HEADER_COMPACT_RE.test(compactHeaderKey(normalized));
}

function isStructuralLine(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (PAGE_RE.test(s)) return true;
  if (isChartHeaderLine(s)) return true;
  if (/^p[aá]gina\s*:/i.test(s)) return true;
  if (/^emiss[aã]o\s*:/i.test(s)) return true;
  if (/^hora\s*:/i.test(s)) return true;
  if (/^rela[cç][aã]o\s+de\s+contas$/i.test(s)) return true;
  if (/^empresa\s*:/i.test(s)) return true;
  if (/^c\.?\s*n\.?\s*p\.?\s*j\.?\s*:/i.test(s)) return true;
  if (/^cnpj\s*:/i.test(s)) return true;
  if (/c\.?\s*n\.?\s*p\.?\s*j\.?\s*:/i.test(s) && /[\d.\/\-]{14,}/.test(s)) return true;
  if (/^total de itens listados/i.test(s)) return true;
  if (!/^\d/.test(s) && /empreendimentos|ltda\b/i.test(s)) return true;
  return false;
}

function extractReportMeta(text) {
  const raw = String(text || '');
  // Only horizontal whitespace after ':' — do not let \s eat the next line.
  const companyInline = raw.match(/empresa[ \t]*:[ \t]*([^\n\r]+)/i);
  let company_name = companyInline ? companyInline[1].replace(/\s+/g, ' ').trim() : null;
  if (company_name && (/^c\.?\s*n\.?\s*p\.?\s*j/i.test(company_name) || company_name.length < 3 || /^[\d.\-\/]+$/.test(company_name))) {
    company_name = null;
  }
  if (!company_name) {
    const beforeEmpresa = raw.match(/^([A-ZÀ-Ú][^\n]{2,100})\r?\nEmpresa[ \t]*:/im);
    if (beforeEmpresa) company_name = beforeEmpresa[1].replace(/\s+/g, ' ').trim();
  }
  const cnpj =
    raw.match(/c\.?\s*n\.?\s*p\.?\s*j\.?\s*:[ \t]*([\d.\-\/]+)/i) ||
    raw.match(/([\d.\-\/]{14,})[ \t]*c\.?\s*n\.?\s*p\.?\s*j\.?\s*:/i) ||
    raw.match(/cnpj[ \t]*:[ \t]*([\d.\-\/]+)/i);
  return {
    company_name: company_name || null,
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
  if (isChartHeaderLine(first)) return false;
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

/**
 * Score a code|classification split for Domínio glued lines.
 * Relatório is ordered by classification; prefer child extensions of prevCls.
 */
function scoreGluedSplit(code, cls, prevCls, usedCodes) {
  if (!code || !cls) return -Infinity;
  if (code[0] === '0' || cls[0] === '0') return -Infinity;
  if (usedCodes.has(code)) return -Infinity;

  let s = 0;
  if (prevCls) {
    let i = 0;
    while (i < cls.length && i < prevCls.length && cls[i] === prevCls[i]) i++;
    s += i * 4;

    const isChild = cls.startsWith(prevCls) && cls.length > prevCls.length;
    const isSame = cls === prevCls;
    if (isChild) s += 80;
    else if (isSame) s += 30;
    else if (prevCls.startsWith(cls)) s += 8;
    else s += i * 2;

    if (!isSame && cls.length === prevCls.length && i === cls.length - 1 && i > 0) {
      s += 25;
    }
  } else {
    s += (5 - Math.min(code.length, 5)) + (5 - Math.min(cls.length, 5));
  }

  if (cls.length >= code.length) s += 2;
  if (code.length <= 4) s += 1;
  s += Math.min(cls.length, 12) * 0.01;
  s -= code.length * 0.001;
  return s;
}

/**
 * Split glued digit prefix into código + classificação using previous
 * classification context (report order). Returns null if unsafe.
 */
function parseGluedAccount(digits, descricao, prevCls, usedCodes) {
  const desc = String(descricao || '').trim();
  const d = String(digits || '');
  if (!d || !desc || d.length < 2) return null;

  const candidates = [];
  for (let i = 1; i < d.length; i++) {
    const code = d.slice(0, i);
    const cls = d.slice(i);
    const score = scoreGluedSplit(code, cls, prevCls, usedCodes);
    if (Number.isFinite(score)) {
      candidates.push({ codigo: code, classificacao: cls, descricao: desc, score });
    }
  }

  if (prevCls) {
    const hasChild = candidates.some(
      (c) => c.classificacao.startsWith(prevCls) && c.classificacao.length > prevCls.length
    );
    if (hasChild) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].classificacao === prevCls) candidates.splice(i, 1);
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  return { codigo: best.codigo, classificacao: best.classificacao, descricao: best.descricao };
}

function parseChartText(text) {
  const normalized = normalizeChartText(text);
  const meta = extractReportMeta(normalized);
  const header = hasChartHeader(normalized);
  const rows = [];
  const skipped = [];
  let format = header ? 'CODE_CLASS_DESC' : null;
  let legacyHits = 0;
  let relacaoHits = 0;
  const usedCodes = new Set();
  let prevCls = '';

  for (const line of normalized.split('\n')) {
    if (isStructuralLine(line)) continue;

    const legacy = parseLegacyLine(line);
    if (legacy) {
      rows.push(legacy);
      legacyHits++;
      if (legacy.codigo) usedCodes.add(String(legacy.codigo));
      if (legacy.classificacao) prevCls = String(legacy.classificacao);
      continue;
    }

    const spaced = parseCodeClassDescLine(line);
    if (spaced) {
      rows.push(spaced);
      relacaoHits++;
      if (spaced.codigo) usedCodes.add(String(spaced.codigo));
      if (spaced.classificacao) prevCls = String(spaced.classificacao);
      continue;
    }

    const gluedMatch = line.match(GLUED_ACCOUNT_RE);
    if (gluedMatch) {
      const glued = parseGluedAccount(gluedMatch[1], gluedMatch[2], prevCls, usedCodes);
      if (glued) {
        rows.push(glued);
        relacaoHits++;
        usedCodes.add(String(glued.codigo));
        prevCls = String(glued.classificacao);
        continue;
      }
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
  isChartHeaderLine,
  hasChartHeader,
  extractReportMeta,
  parseDelimited,
  parseChartText,
  parsePlanSource,
  parsePdfText,
  parseGluedAccount,
  normalizeAccount,
  inferHierarchy,
  validateChartAccounts,
  buildPreview,
  publicAccount,
  HEADER_RE,
  HEADER_COMPACT_RE,
  GLUED_ACCOUNT_RE
};
