'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createDocumentMigrator({ db, storage, reportsDir }) {
  function migrateAll({ encrypt = true } = {}) {
    const rows = db.prepare('SELECT * FROM documents').all();
    const orphans = [];
    const migrated = [];
    const skipped = [];
    const ins = db.prepare('INSERT INTO document_migrations(id,document_id,tenant_id,company_id,old_path,new_path,sha256,status,detail) VALUES(?,?,?,?,?,?,?,?,?)');

    for (const doc of rows) {
      const found = storage.locateExisting(doc.storage_path, doc.original_name, doc.id);
      const alreadyRel = storage.isRelativeStoragePath(doc.storage_path) && storage.exists(doc.storage_path);
      if (!found && !alreadyRel) {
        const rec = { document_id: doc.id, tenant_id: doc.tenant_id, company_id: doc.company_id, original_name: doc.original_name, storage_path: doc.storage_path };
        orphans.push(rec);
        ins.run(crypto.randomUUID(), doc.id, doc.tenant_id, doc.company_id, doc.storage_path, null, doc.sha256, 'ORPHAN', 'Arquivo físico não localizado');
        continue;
      }
      const src = found || storage.physical(doc.storage_path);
      let plain;
      try { plain = storage.readPlain(storage.exists(doc.storage_path) ? doc.storage_path : null) || fs.readFileSync(src); } catch {
        orphans.push({ document_id: doc.id, tenant_id: doc.tenant_id, company_id: doc.company_id, original_name: doc.original_name, storage_path: doc.storage_path });
        ins.run(crypto.randomUUID(), doc.id, doc.tenant_id, doc.company_id, doc.storage_path, null, doc.sha256, 'ORPHAN', 'Falha ao ler arquivo');
        continue;
      }
      if (storage.cryptoLayer) {
        try { plain = storage.readPlain(doc.storage_path) || storage.cryptoLayer.decrypt(plain); } catch { /* keep plain */ }
      }
      const digest = storage.sha256(plain);
      if (doc.sha256 && doc.sha256 !== digest) {
        // preserve recorded sha if file already encrypted and we hashed ciphertext by mistake
      }
      const relOk = storage.isRelativeStoragePath(doc.storage_path) && Number(doc.encrypted) === 1 && storage.exists(doc.storage_path);
      if (relOk) {
        skipped.push(doc.id);
        continue;
      }
      const stored = storage.saveBuffer({ documentId: doc.id, originalName: doc.original_name, buffer: plain, encrypt });
      const keepSha = doc.sha256 || stored.sha256;
      db.prepare('UPDATE documents SET storage_path=?, encrypted=?, encryption_kid=?, sha256=?, size_bytes=? WHERE id=?')
        .run(stored.storage_path, stored.encrypted ? 1 : 0, stored.encryption_kid, keepSha, doc.size_bytes || stored.size_bytes, doc.id);
      if (src && path.resolve(src) !== path.resolve(stored.physical_path)) {
        /* keep original until confirmed; do not delete automatically */
      }
      ins.run(crypto.randomUUID(), doc.id, doc.tenant_id, doc.company_id, doc.storage_path, stored.storage_path, keepSha, 'MIGRATED', null);
      migrated.push({ document_id: doc.id, from: doc.storage_path, to: stored.storage_path });
    }

    const dir = reportsDir || path.join(storage.root, '..', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const orphanPath = path.join(dir, 'ORPHAN_DOCUMENTS.json');
    fs.writeFileSync(orphanPath, JSON.stringify({ generated_at: new Date().toISOString(), count: orphans.length, documents: orphans }, null, 2));
    return { migrated: migrated.length, orphans: orphans.length, skipped: skipped.length, orphanPath };
  }

  return { migrateAll };
}

module.exports = { createDocumentMigrator };
