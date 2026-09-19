'use strict';

const fs = require('fs');
const path = require('path');
const { resolveSafePath: storageResolve } = require('./storage');

const PDF = 'application/pdf';
const JPEG = 'image/jpeg';
const PNG = 'image/png';

function detectContentType(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return PDF;
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return PNG;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return JPEG;
  return null;
}

function normalizeStoredMime(mime) {
  const m = String(mime || '').toLowerCase().trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') return JPEG;
  if (m === 'application/x-pdf') return PDF;
  if (m === PDF || m === JPEG || m === PNG) return m;
  if (m.includes('pdf')) return PDF;
  if (m === 'image/png') return PNG;
  if (m.startsWith('image/jpeg')) return JPEG;
  return m || null;
}

function mimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.pdf') return PDF;
  if (ext === '.jpg' || ext === '.jpeg') return JPEG;
  if (ext === '.png') return PNG;
  return null;
}

function sniffFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return detectContentType(n > 0 ? buf.subarray(0, n) : buf);
  } catch {
    return null;
  }
}

function resolveContentType(document, safePath, plainBuf) {
  const sniffed = plainBuf ? detectContentType(plainBuf) : sniffFile(safePath);
  if (sniffed) return sniffed;
  return normalizeStoredMime(document.mime_type) || mimeFromName(document.original_name) || 'application/octet-stream';
}

function isLogicalDocumentId(id) {
  const s = String(id || '');
  if (!s || s.length > 80) return false;
  if (/[\\/]|\.\.|%2e|%2f|%5c|%00/i.test(s)) return false;
  return true;
}

function resolveSafePath(storagePath, uploadsRoot) {
  return storageResolve(storagePath, uploadsRoot);
}

function safeFileName(name) {
  const base = path.basename(String(name || 'documento')).replace(/[\r\n"\\]/g, '_');
  return base || 'documento';
}

function createDocumentAccess({ one, uploadsRoot, storage }) {
  const root = path.resolve(uploadsRoot);

  function load(tenantId, documentId, opts) {
    if (!tenantId || !isLogicalDocumentId(documentId)) {
      return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
    }
    const document = one('SELECT * FROM documents WHERE tenant_id=? AND id=?', tenantId, documentId);
    if (!document) return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
    if (document.deleted_at && !(opts && opts.includeDeleted)) {
      return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
    }
    return { document };
  }

  function authorize(req, document, companyOkFn) {
    if (!document) return { error: 'DOCUMENT_ACCESS_DENIED', status: 403, message: 'Acesso ao documento não permitido.' };
    if (req.user.role === 'CLIENT') {
      if (document.company_id !== (req.companyScope || req.clientCompany && req.clientCompany.id)) {
        return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
      }
      return { ok: true };
    }
    if (typeof companyOkFn === 'function' && !companyOkFn(req, document.company_id)) {
      return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
    }
    return { ok: true };
  }

  function send(res, document, disposition) {
    const safe = resolveSafePath(document.storage_path, root);
    if (!safe || !fs.existsSync(safe) || !fs.statSync(safe).isFile()) {
      return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
    }
    const plain = storage ? storage.readPlain(document.storage_path) : fs.readFileSync(safe);
    if (!plain) return { error: 'NOT_FOUND', status: 404, message: 'Documento não encontrado.' };
    const mime = resolveContentType(document, safe, plain);
    const mode = disposition === 'inline' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${mode}; filename="${safeFileName(document.original_name)}"`);
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(plain);
    return { ok: true };
  }

  return { load, send, authorize, resolveContentType, isLogicalDocumentId, resolveSafePath };
}

module.exports = {
  createDocumentAccess,
  detectContentType,
  resolveContentType,
  isLogicalDocumentId,
  resolveSafePath,
  PDF,
  JPEG,
  PNG
};
