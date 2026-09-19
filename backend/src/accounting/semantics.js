'use strict';

const EXPLICIT_KINDS = new Set(['TRANSFER', 'RECLASSIFICATION', 'ADJUSTMENT', 'OPENING']);

function lineFail(message, code, http) {
  const e = new Error(message);
  e.code = code;
  e.http = http || 422;
  return e;
}

function inferKind(sourceType, entryKind) {
  const raw = String(entryKind || '').trim().toUpperCase();
  if (EXPLICIT_KINDS.has(raw)) return raw;
  const src = String(sourceType || '').trim().toUpperCase();
  if (src === 'TRANSFER') return 'TRANSFER';
  if (src === 'RECLASSIFICATION' || src === 'RECLASSIFY') return 'RECLASSIFICATION';
  if (src === 'ADJUSTMENT' || src === 'AJUSTE') return 'ADJUSTMENT';
  if (src === 'MANUAL') return 'MANUAL';
  if (src === 'REVENUE') return 'REVENUE';
  return src || 'EXPENSE';
}

function validateAccountingSemantics({ sourceType, entryKind, lines, accountsById }) {
  const kind = inferKind(sourceType, entryKind);
  const list = Array.isArray(lines) ? lines : [];
  if (list.length < 2) throw lineFail('Informe ao menos duas linhas.', 'INVALID_ENTRY', 400);

  const debits = list.filter(l => String(l.side).toUpperCase() === 'D');
  const credits = list.filter(l => String(l.side).toUpperCase() === 'C');
  if (!debits.length || !credits.length) throw lineFail('Informe débito e crédito.', 'INVALID_ENTRY', 400);

  if (EXPLICIT_KINDS.has(kind)) return { ok: true, kind };

  const samePair = debits.length === 1 && credits.length === 1 && debits[0].account_id === credits[0].account_id;
  if (samePair && (kind === 'EXPENSE' || kind === 'REVENUE' || kind === 'MANUAL')) {
    throw lineFail('Débito e crédito não podem usar a mesma conta nesta operação.', 'SEMANTIC_INVALID', 422);
  }

  if (accountsById) {
    for (const l of list) {
      const a = accountsById.get ? accountsById.get(l.account_id) : accountsById[l.account_id];
      if (!a) continue;
      if (Number(a.active) === 0) throw lineFail('Conta inativa.', 'ACCOUNT_INACTIVE');
    }
  }

  return { ok: true, kind };
}

module.exports = { validateAccountingSemantics, inferKind, EXPLICIT_KINDS };
