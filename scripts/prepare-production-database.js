'use strict';

/**
 * Sprint 40.2 — prepara banco SQLite de produção limpo.
 * NÃO apaga banco existente. NÃO reutiliza o banco piloto.
 *
 * Uso:
 *   CDS_DB_PATH=./database/production/cds-contabil-connect.db npm run prepare:production-db
 *   node scripts/prepare-production-database.js --path ./database/production/cds-contabil-connect.db
 */

const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch { /* optional */ }

const {
  listMigrations,
  pilotDbPath,
  resolveTargetPath,
  createFreshDatabase,
  runIntegrity,
  runForeignKeys,
  businessCounts,
  missingEssentialTables,
  hasPilotResidue,
  samePath,
  rootDir
} = require('./lib/production-database');

function argPath() {
  const i = process.argv.indexOf('--path');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

function main() {
  const pilot = pilotDbPath();
  const target = resolveTargetPath(argPath());
  const migrations = listMigrations();

  console.log('========================================');
  console.log('CDS CONTÁBIL CONNECT');
  console.log('PREPARE PRODUCTION DATABASE');
  console.log('========================================');
  console.log('ROOT:', rootDir());
  console.log('PILOT DB (preserved):', pilot, fs.existsSync(pilot) ? '[EXISTS]' : '[MISSING]');
  console.log('TARGET DB:', target);
  console.log('Migrations available:', migrations.length);
  console.log('');

  if (samePath(target, pilot)) {
    console.error('FAIL TARGET_IS_PILOT');
    console.error('O caminho alvo é o banco piloto. Defina CDS_DB_PATH (ou --path) para um arquivo novo,');
    console.error('ex.: ./database/production/cds-contabil-connect.db');
    process.exit(2);
  }

  if (fs.existsSync(target)) {
    console.error('FAIL DATABASE_EXISTS');
    console.error('O banco alvo já existe e NÃO será apagado ou sobrescrito.');
    console.error('Preservado. Use validate:production-db para inspecionar, ou escolha outro CDS_DB_PATH.');
    process.exit(2);
  }

  let db;
  try {
    db = createFreshDatabase(target);
  } catch (e) {
    console.error('FAIL CREATE', e && e.message);
    process.exit(2);
  }

  db.pragma('foreign_keys = ON');
  const fkOn = db.pragma('foreign_keys', { simple: true });
  const integrity = runIntegrity(db);
  const fks = runForeignKeys(db);
  const missing = missingEssentialTables(db);
  const counts = businessCounts(db);
  const residue = hasPilotResidue(counts);

  console.log('DATABASE: CREATED');
  console.log('FOREIGN_KEYS_PRAGMA:', fkOn ? 'ON' : 'OFF');
  console.log('MIGRATIONS: APPLIED (' + migrations.length + '/' + migrations.length + ')');
  console.log('INTEGRITY:', integrity.ok ? 'OK' : 'FAIL');
  console.log('FOREIGN_KEYS_CHECK:', fks.ok ? 'OK' : 'FAIL (' + fks.rows.length + ')');
  console.log('ESSENTIAL_TABLES:', missing.length ? 'MISSING ' + missing.join(',') : 'OK');
  console.log('PILOT_DATA:', residue ? 'FOUND ' + residue : 'NONE');
  console.log('');
  console.log('Business data:');
  for (const [k, v] of Object.entries(counts)) {
    if (v == null) continue;
    console.log('  ' + k + ':', v);
  }
  console.log('');

  db.close();

  const blocked = !integrity.ok || !fks.ok || missing.length || residue || !fkOn;
  if (blocked) {
    console.log('STATUS: BLOCKED');
    process.exit(2);
  }

  console.log('STATUS: READY_FOR_FIRST_ONBOARDING');
  process.exit(0);
}

main();
