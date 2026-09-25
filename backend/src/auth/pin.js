'use strict';

const bcrypt = require('bcryptjs');

const PIN_ROUNDS = 12;
const PIN_DIGITS = 4;

function normalizePinInput(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Aceita somente exatamente 4 dígitos 0–9 (preserva zeros à esquerda). */
function isValidPin(value) {
  const raw = normalizePinInput(value);
  return /^\d{4}$/.test(raw);
}

function pinValidationError(pin, confirmation) {
  const p = normalizePinInput(pin);
  const c = confirmation === undefined || confirmation === null
    ? null
    : normalizePinInput(confirmation);
  if (!isValidPin(p)) {
    return {
      message: 'O PIN deve ter exatamente 4 números.',
      code: 'INVALID_PIN'
    };
  }
  if (c !== null && p !== c) {
    return {
      message: 'A confirmação do PIN não confere.',
      code: 'PIN_CONFIRMATION_MISMATCH'
    };
  }
  return null;
}

function hashPin(pin) {
  return bcrypt.hashSync(normalizePinInput(pin), PIN_ROUNDS);
}

function pinMatches(pinHash, pin) {
  if (!pinHash) return false;
  try {
    return bcrypt.compareSync(normalizePinInput(pin), pinHash);
  } catch {
    return false;
  }
}

function isPinConfigured(user) {
  return !!(user && user.pin_hash);
}

function requiresPinSetup(user) {
  if (!user) return false;
  if (isPinConfigured(user)) return false;
  return Number(user.pin_setup_required || 0) === 1;
}

function publicPinState(user) {
  const configured = isPinConfigured(user);
  return {
    pin_configured: configured,
    requires_pin_setup: requiresPinSetup(user)
  };
}

module.exports = {
  PIN_DIGITS,
  PIN_ROUNDS,
  normalizePinInput,
  isValidPin,
  pinValidationError,
  hashPin,
  pinMatches,
  isPinConfigured,
  requiresPinSetup,
  publicPinState
};
