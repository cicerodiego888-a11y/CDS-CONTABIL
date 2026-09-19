'use strict';

const crypto = require('crypto');

const MAGIC = Buffer.from('CDSE1');

function keyBytes(secret, kid) {
  const raw = String(secret || '');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.scryptSync(raw, 'cds-doc-' + String(kid || 'v1'), 32);
}

function createDocumentCrypto({ key, kid, keys }) {
  const currentKid = String(kid || 'v1');
  const store = Object.assign({ [currentKid]: key }, keys || {});

  function material(id) {
    const secret = store[id];
    if (!secret) throw Object.assign(new Error('Chave de documento indisponível.'), { code: 'DOCUMENT_KEY_MISSING', http: 500 });
    return keyBytes(secret, id);
  }

  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', material(currentKid), iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const kidBuf = Buffer.from(currentKid, 'utf8');
    if (kidBuf.length > 255) throw new Error('encryption kid too long');
    return Buffer.concat([MAGIC, Buffer.from([kidBuf.length]), kidBuf, iv, tag, enc]);
  }

  function isEncrypted(buf) {
    return Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
  }

  function decrypt(buf) {
    if (!isEncrypted(buf)) return Buffer.from(buf);
    let o = MAGIC.length;
    const kidLen = buf[o];
    o += 1;
    const fileKid = buf.subarray(o, o + kidLen).toString('utf8');
    o += kidLen;
    const iv = buf.subarray(o, o + 12);
    o += 12;
    const tag = buf.subarray(o, o + 16);
    o += 16;
    const enc = buf.subarray(o);
    const decipher = crypto.createDecipheriv('aes-256-gcm', material(fileKid), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  }

  return { encrypt, decrypt, isEncrypted, kid: currentKid };
}

module.exports = { createDocumentCrypto, MAGIC };
