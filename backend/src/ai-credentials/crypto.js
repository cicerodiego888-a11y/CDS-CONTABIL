'use strict';

const crypto = require('crypto');

const DEV_AI_CRED_KEY = 'cds-dev-ai-credential-key-not-for-production!!';

function materialFromSecret(secret, saltBuf) {
  return crypto.scryptSync(String(secret), saltBuf, 32);
}

function encryptApiKey(plain, masterKey) {
  const salt = crypto.randomBytes(16);
  const key = materialFromSecret(masterKey, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain || ''), 'utf8'), cipher.final()]);
  return {
    encrypted_api_key: enc.toString('base64'),
    key_iv: iv.toString('base64'),
    key_tag: cipher.getAuthTag().toString('base64'),
    key_salt: salt.toString('base64')
  };
}

function decryptApiKey(row, masterKey) {
  if (!row || !row.encrypted_api_key) return '';
  try {
    const key = materialFromSecret(masterKey, Buffer.from(row.key_salt, 'base64'));
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', key, Buffer.from(row.key_iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(row.key_tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_api_key, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function last4Of(apiKey) {
  const s = String(apiKey || '').trim();
  if (s.length < 4) return null;
  return s.slice(-4);
}

function fingerprint(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 12);
}

module.exports = {
  DEV_AI_CRED_KEY,
  encryptApiKey,
  decryptApiKey,
  last4Of,
  fingerprint
};
