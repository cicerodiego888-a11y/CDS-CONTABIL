'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = process.argv[2];
const destDir = process.argv[3] || path.join(root, 'restore-work');

if (!src) {
  console.error('Uso: node scripts/restore.js <backup.db> [diretorio-destino]');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
const dbDest = path.join(destDir, 'cds-contabil-connect.db');
fs.copyFileSync(src, dbDest);

const backupDir = path.dirname(path.resolve(src));
const uploadsFromBackup = path.join(backupDir, 'uploads');
const uploadsSrc = fs.existsSync(uploadsFromBackup) ? uploadsFromBackup : path.join(root, 'uploads');
const uploadsDest = path.join(destDir, 'uploads');
if (fs.existsSync(uploadsSrc)) copyDir(uploadsSrc, uploadsDest);

console.log('Restore preparado em', destDir);
console.log('Para validar:');
console.log('  set CDS_DB_PATH=' + dbDest);
console.log('  set UPLOAD_DIR=' + uploadsDest);
console.log('  node backend/src/server.js');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}
