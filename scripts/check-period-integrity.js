'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
let dbPath = path.join(root, 'database', 'cds-contabil-connect.db');
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/^\s*CDS_DB_PATH\s*=\s*(.+)\s*$/m);
  if (m) dbPath = path.resolve(root, m[1].trim().replace(/^["']|["']$/g, ''));
}
if (!fs.existsSync(dbPath)) {
  console.log('db_missing', dbPath);
  process.exit(0);
}
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
console.log('db_path', dbPath);
console.log('foreign_keys', db.pragma('foreign_keys', { simple: true }));
console.log('integrity_check', JSON.stringify(db.pragma('integrity_check')));
console.log('foreign_key_check_count', db.pragma('foreign_key_check').length);
let t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_periods'").get();
console.log('accounting_periods_table', t || null);
if (!t) {
  const sql = fs.readFileSync(path.join(root, 'database', 'schema', '035_accounting_periods.sql'), 'utf8');
  db.exec(sql);
  console.log('migration_applied', true);
  t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_periods'").get();
  console.log('accounting_periods_table', t || null);
  console.log('integrity_check_after', JSON.stringify(db.pragma('integrity_check')));
  console.log('foreign_key_check_after', db.pragma('foreign_key_check').length);
}
db.close();
