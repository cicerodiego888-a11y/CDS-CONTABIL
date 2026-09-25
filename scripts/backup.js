'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../backend/src/config');

const config = loadConfig(process.env);
const db = config.CDS_DB_PATH;
if (!fs.existsSync(db)) {
  console.error('Banco não encontrado em CDS_DB_PATH:', db);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = config.BACKUP_DIR || path.join(config.ROOT, 'backups');
const destDir = path.join(backupRoot, 'backup-' + stamp);
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(db, path.join(destDir, 'cds-contabil-connect.db'));
const shm = db + '-shm';
const wal = db + '-wal';
if (fs.existsSync(wal)) fs.copyFileSync(wal, path.join(destDir, 'cds-contabil-connect.db-wal'));
if (fs.existsSync(shm)) fs.copyFileSync(shm, path.join(destDir, 'cds-contabil-connect.db-shm'));

const uploads = config.UPLOAD_DIR;
const uploadsDest = path.join(destDir, 'uploads');
if (fs.existsSync(uploads)) copyDir(uploads, uploadsDest);

fs.writeFileSync(path.join(destDir, 'MANIFEST.json'), JSON.stringify({
  created_at: new Date().toISOString(),
  cds_db_path: db,
  upload_dir: uploads,
  backup_dir: backupRoot,
  portable: true,
  restore: 'node scripts/restore.js ' + path.join(destDir, 'cds-contabil-connect.db')
}, null, 2));

console.log(destDir);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}
