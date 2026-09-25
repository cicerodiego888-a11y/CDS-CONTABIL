'use strict';

const PERIOD_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  READY_FOR_EXPORT: 'READY_FOR_EXPORT',
  EXPORTED: 'EXPORTED',
  CLOSED: 'CLOSED'
});

const PERIOD_STATUS_LABELS = Object.freeze({
  OPEN: 'Aberta',
  IN_REVIEW: 'Em conferência',
  READY_FOR_EXPORT: 'Pronta para exportação',
  EXPORTED: 'Exportada',
  CLOSED: 'Fechada'
});

const PERIOD_AUDIT_ACTIONS = Object.freeze({
  CREATED: 'ACCOUNTING_PERIOD_CREATED',
  REVIEW_STARTED: 'ACCOUNTING_PERIOD_REVIEW_STARTED',
  READY_FOR_EXPORT: 'ACCOUNTING_PERIOD_READY_FOR_EXPORT',
  EXPORTED: 'ACCOUNTING_PERIOD_EXPORTED',
  CLOSED: 'ACCOUNTING_PERIOD_CLOSED',
  REOPENED: 'ACCOUNTING_PERIOD_REOPENED'
});

/** Transições permitidas no lifecycle da competência. */
const ALLOWED_TRANSITIONS = Object.freeze({
  OPEN: ['IN_REVIEW', 'READY_FOR_EXPORT', 'EXPORTED'],
  IN_REVIEW: ['READY_FOR_EXPORT', 'EXPORTED'],
  READY_FOR_EXPORT: ['EXPORTED', 'IN_REVIEW'],
  EXPORTED: ['CLOSED', 'IN_REVIEW'],
  CLOSED: ['IN_REVIEW']
});

function isValidStatus(status) {
  return Object.prototype.hasOwnProperty.call(PERIOD_STATUSES, status);
}

function isClosed(status) {
  return status === PERIOD_STATUSES.CLOSED;
}

function isBlocked(status) {
  return isClosed(status);
}

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`Transição de competência não permitida: ${from} → ${to}.`);
    err.code = 'INVALID_PERIOD_TRANSITION';
    err.http = 409;
    err.from = from;
    err.to = to;
    throw err;
  }
}

function labelOf(status) {
  return PERIOD_STATUS_LABELS[status] || status;
}

module.exports = {
  PERIOD_STATUSES,
  PERIOD_STATUS_LABELS,
  PERIOD_AUDIT_ACTIONS,
  ALLOWED_TRANSITIONS,
  isValidStatus,
  isClosed,
  isBlocked,
  canTransition,
  assertTransition,
  labelOf
};
