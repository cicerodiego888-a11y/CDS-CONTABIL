'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeFileName(name) {
  const base = path.basename(String(name || 'arquivo')).replace(/[^\w.\- ()[\]]+/g, '_').replace(/^\.+/, '');
  return (base || 'arquivo').slice(0, 180);
}

function isRelativeStoragePath(p) {
  const n = String(p || '').replace(/\\/g, '/');
  return !/^[a-zA-Z]:\//.test(n) && !n.startsWith('/') && !n.startsWith('\\\\');
}

function resolveSafePath(storagePath, uploadsRoot) {
  if (!storagePath) return null;
  const root = path.resolve(uploadsRoot);
  const raw = String(storagePath);
  const normalized = raw.replace(/\\/g, '/');
  if (/\.\.|%2e|%2f|%5c|%00/i.test(normalized)) return null;
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) return null;
  return resolved;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function createDocumentStorage({ uploadsRoot, cryptoLayer }) {
  const root = path.resolve(uploadsRoot);
  fs.mkdirSync(path.join(root, 'documents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'documentos'), { recursive: true });
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });

  function relativeFor(documentId, originalName) {
    return toPosix(path.posix.join('documents', String(documentId), safeFileName(originalName)));
  }

  function physical(storagePath) {
    return resolveSafePath(storagePath, root);
  }

  function exists(storagePath) {
    const abs = physical(storagePath);
    return !!(abs && fs.existsSync(abs) && fs.statSync(abs).isFile());
  }

  function readPlain(storagePath) {
    const abs = physical(storagePath);
    if (!abs || !fs.existsSync(abs)) return null;
    const raw = fs.readFileSync(abs);
    if (!cryptoLayer) return raw;
    try { return cryptoLayer.decrypt(raw); } catch { return null; }
  }

  function saveBuffer({ documentId, originalName, buffer, encrypt = true }) {
    const rel = relativeFor(documentId, originalName);
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const digest = sha256(buffer);
    const payload = encrypt && cryptoLayer ? cryptoLayer.encrypt(buffer) : buffer;
    fs.writeFileSync(abs, payload);
    return {
      storage_path: rel,
      sha256: digest,
      size_bytes: buffer.length,
      encrypted: !!(encrypt && cryptoLayer),
      encryption_kid: encrypt && cryptoLayer ? cryptoLayer.kid : null,
      physical_path: abs
    };
  }

  function ingestUpload(file, documentId) {
    const tmp = file.path;
    const buf = fs.readFileSync(tmp);
    const stored = saveBuffer({ documentId, originalName: file.originalname, buffer: buf, encrypt: true });
    try { fs.unlinkSync(tmp); } catch {}
    return stored;
  }

  function removeFile(storagePath) {
    const abs = physical(storagePath);
    if (!abs) return false;
    try { fs.unlinkSync(abs); return true; } catch { return false; }
  }

  function locateExisting(storagePath, originalName, documentId) {
    const candidates = [];
    if (storagePath) {
      if (path.isAbsolute(storagePath)) candidates.push(storagePath);
      const safe = physical(storagePath);
      if (safe) candidates.push(safe);
      candidates.push(path.join(root, 'documentos', path.basename(storagePath)));
    }
    if (originalName) candidates.push(path.join(root, 'documentos', path.basename(originalName)));
    if (documentId) {
      const dir = path.join(root, 'documents', documentId);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) candidates.push(path.join(dir, f));
      }
    }
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {}
    }
    return null;
  }

  return {
    root,
    cryptoLayer,
    relativeFor,
    physical,
    exists,
    readPlain,
    saveBuffer,
    ingestUpload,
    removeFile,
    locateExisting,
    resolveSafePath: (p) => physical(p),
    sha256,
    safeFileName,
    isRelativeStoragePath
  };
}

module.exports = {
  createDocumentStorage,
  resolveSafePath,
  safeFileName,
  isRelativeStoragePath,
  sha256
};
