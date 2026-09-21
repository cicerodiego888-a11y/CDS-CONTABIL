'use strict';

const CLOSED = new Set(['CONCLUDED', 'CANCELLED', 'CONCLUIDA', 'CANCELADA']);
const WAITING_CLIENT = new Set(['AGUARDANDO_CLIENTE', 'OPEN', 'PENDING']);
const WAITING_OFFICE = new Set(['AGUARDANDO_ESCRITORIO', 'RESPONDED']);

const STATUS = Object.freeze({
  AGUARDANDO_CLIENTE: 'AGUARDANDO_CLIENTE',
  AGUARDANDO_ESCRITORIO: 'AGUARDANDO_ESCRITORIO',
  CONCLUDED: 'CONCLUDED',
  CANCELLED: 'CANCELLED'
});

function normalizeStatus(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return STATUS.AGUARDANDO_CLIENTE;
  if (s === 'CONCLUIDA' || s === 'CONCLUDED' || s === 'COMPLETED') return STATUS.CONCLUDED;
  if (s === 'CANCELADA' || s === 'CANCELLED') return STATUS.CANCELLED;
  if (WAITING_OFFICE.has(s) || s === 'RESPONDED') return STATUS.AGUARDANDO_ESCRITORIO;
  if (WAITING_CLIENT.has(s) || s === 'OPEN' || s === 'PENDING') return STATUS.AGUARDANDO_CLIENTE;
  if (s === STATUS.AGUARDANDO_CLIENTE || s === STATUS.AGUARDANDO_ESCRITORIO) return s;
  return s;
}

function isClosed(status) {
  return CLOSED.has(normalizeStatus(status)) || CLOSED.has(String(status || '').toUpperCase());
}

function statusLabel(status) {
  const n = normalizeStatus(status);
  return ({
    AGUARDANDO_CLIENTE: 'Aguardando cliente',
    AGUARDANDO_ESCRITORIO: 'Aguardando escritório',
    CONCLUDED: 'Concluída',
    CANCELLED: 'Cancelada',
    OPEN: 'Aguardando cliente',
    RESPONDED: 'Aguardando escritório',
    PENDING: 'Aguardando cliente'
  })[n] || ({
    OPEN: 'Aguardando cliente',
    RESPONDED: 'Aguardando escritório'
  })[String(status || '').toUpperCase()] || String(status || '-');
}

function statusAfterMessage(actorRole) {
  const role = String(actorRole || '').toUpperCase();
  if (role === 'CLIENT') return STATUS.AGUARDANDO_ESCRITORIO;
  return STATUS.AGUARDANDO_CLIENTE;
}

function isOfficeRole(role) {
  return ['OWNER', 'ACCOUNTANT', 'STAFF'].includes(String(role || '').toUpperCase());
}

module.exports = {
  STATUS,
  CLOSED,
  normalizeStatus,
  isClosed,
  statusLabel,
  statusAfterMessage,
  isOfficeRole
};
