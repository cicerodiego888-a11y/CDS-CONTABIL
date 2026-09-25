'use strict';

/**
 * AutonomyPolicy — autonomia operacional da IA (não é autoridade).
 *
 * ASSISTED_50  → prepara lançamento completo e entrega em PENDING.
 * AUTONOMOUS_98 → prepara + tenta resolver exceções antes de PENDING.
 *
 * Nenhum modo autoriza APPROVE / POST / CLOSE / EXPORT.
 */

const MODES = Object.freeze({
  ASSISTED_50: 'ASSISTED_50',
  AUTONOMOUS_98: 'AUTONOMOUS_98'
});

const LABELS = Object.freeze({
  ASSISTED_50: '50% — Assistida',
  AUTONOMOUS_98: '98% — Autônoma'
});

const PERCENT = Object.freeze({
  ASSISTED_50: 50,
  AUTONOMOUS_98: 98
});

/** Capacidades comuns (preparação). Presentes nos dois modos. */
const BASE_CAPABILITIES = Object.freeze([
  'INTERPRET_DOCUMENT',
  'INTERPRET_IMAGE',
  'INTERPRET_PDF',
  'OCR_VISION',
  'EXTRACT_FIELDS',
  'NORMALIZE_FIELDS',
  'IDENTIFY_PARTIES',
  'IDENTIFY_AMOUNTS',
  'IDENTIFY_DATES',
  'IDENTIFY_NUMBER_SERIES',
  'IDENTIFY_NATURE',
  'CLASSIFY_OPERATION',
  'CONSULT_CHART',
  'CONSULT_RULES',
  'CONSULT_HISTORY',
  'SUGGEST_DEBIT',
  'SUGGEST_CREDIT',
  'SUGGEST_HISTORY',
  'SUGGEST_COMPETENCE',
  'SUGGEST_COST_CENTER',
  'BUILD_ENTRY',
  'VALIDATE_MOTOR',
  'COMPUTE_CONFIDENCE',
  'RECORD_JUSTIFICATION',
  'PREPARE_PENDING',
  'NOTIFY_PENDING'
]);

/** Capacidades exclusivas do modo 98% (resolução avançada). */
const AUTONOMOUS_CAPABILITIES = Object.freeze([
  'ADVANCED_RESOLUTION_LOOP',
  'ALTERNATIVE_ACCOUNT_SEARCH',
  'EXPANDED_AI_CONTEXT',
  'REINTERPRET_ON_FAILURE',
  'SUPPLIER_PATTERN_MATCH',
  'MULTI_ATTEMPT_RESOLUTION',
  'RESOLVE_AMBIGUOUS_CLASSIFICATION',
  'RESOLVE_RECOVERABLE_INCONSISTENCY',
  'CHOOSE_AMONG_CANDIDATES'
]);

/** Capacidades permanentemente proibidas (autoridade humana). */
const FORBIDDEN_CAPABILITIES = Object.freeze([
  'APPROVE_ENTRY',
  'POST_ENTRY',
  'CLOSE_PERIOD',
  'REOPEN_PERIOD',
  'AUTO_EXPORT',
  'CREATE_ACCOUNT',
  'INVENT_ACCOUNT_CODE',
  'OVERRIDE_STRUCTURED_FISCAL_WITHOUT_RULE'
]);

const MAX_RESOLUTION_ATTEMPTS = 4;

function normalizeAutonomyMode(value) {
  if (value == null || value === '') return MODES.ASSISTED_50;
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, '_');
  if (raw === MODES.ASSISTED_50 || raw === '50' || raw === 'ASSISTED' ||
      raw === 'ASSISTIDA' || raw === '50%' || raw === 'AUTONOMY_50') {
    return MODES.ASSISTED_50;
  }
  if (raw === MODES.AUTONOMOUS_98 || raw === '98' || raw === 'AUTONOMOUS' ||
      raw === 'AUTONOMA' || raw === 'AUTÔNOMA' || raw === '98%' || raw === 'AUTONOMY_98') {
    return MODES.AUTONOMOUS_98;
  }
  const n = Number(String(value).replace('%', '').trim());
  if (n === 50) return MODES.ASSISTED_50;
  if (n === 98) return MODES.AUTONOMOUS_98;
  return null;
}

function resolveAutonomyPolicy(modeInput) {
  const mode = normalizeAutonomyMode(modeInput) || MODES.ASSISTED_50;
  const autonomous = mode === MODES.AUTONOMOUS_98;
  const capabilities = autonomous
    ? [...BASE_CAPABILITIES, ...AUTONOMOUS_CAPABILITIES]
    : [...BASE_CAPABILITIES];

  return Object.freeze({
    mode,
    percent: PERCENT[mode],
    label: LABELS[mode],
    capabilities: Object.freeze(capabilities),
    forbidden: FORBIDDEN_CAPABILITIES,
    max_resolution_attempts: autonomous ? MAX_RESOLUTION_ATTEMPTS : 1,
    allows(capability) {
      if (FORBIDDEN_CAPABILITIES.includes(capability)) return false;
      return capabilities.includes(capability);
    },
    forbids(capability) {
      return !this.allows(capability);
    },
    isAutonomous() {
      return autonomous;
    },
    isAssisted() {
      return !autonomous;
    },
    /** Autoridade final — sempre falsa para a IA. */
    mayApprove() {
      return false;
    },
    mayPost() {
      return false;
    },
    mayClosePeriod() {
      return false;
    }
  });
}

function assertNeverPosts(policy, entryStatus) {
  if (policy.mayPost()) {
    throw Object.assign(new Error('Política de autonomia inválida: IA não pode postar.'), {
      code: 'AUTONOMY_AUTHORITY_VIOLATION'
    });
  }
  if (String(entryStatus || '').toUpperCase() === 'POSTED') {
    throw Object.assign(new Error('IA não pode produzir POSTED.'), {
      code: 'AI_POST_FORBIDDEN'
    });
  }
}

module.exports = {
  MODES,
  LABELS,
  PERCENT,
  BASE_CAPABILITIES,
  AUTONOMOUS_CAPABILITIES,
  FORBIDDEN_CAPABILITIES,
  MAX_RESOLUTION_ATTEMPTS,
  normalizeAutonomyMode,
  resolveAutonomyPolicy,
  assertNeverPosts
};
