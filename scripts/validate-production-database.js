'use strict';

/**
 * Sprint 40.2 — valida banco de produção (sem destruir dados).
 *
 * Uso:
 *   CDS_DB_PATH=./database/production/cds-contabil-connect.db npm run validate:production-db
 *   node scripts/validate-production-database.js --path ./database/production/cds-contabil-connect.db
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
  openReadonly,
  runIntegrity,
  runForeignKeys,
  businessCounts,
  missingEssentialTables,
  hasPilotResidue,
  samePath,
  countTable
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
  console.log('PRODUCTION DATABASE VALIDATION');
  console.log('========================================');
  console.log('');
  console.log('Target:', target);
  console.log('Pilot (must stay separate):', pilot);
  console.log('');

  if (!fs.existsSync(target)) {
    console.log('Database: MISSING');
    console.log('STATUS: BLOCKED');
    process.exit(2);
  }

  if (samePath(target, pilot)) {
    console.log('Database: PILOT_PATH');
    console.log('Development residue: POSSIBLE (alvo é o banco piloto)');
    console.log('STATUS: BLOCKED');
    console.log('Não use o banco piloto como produção. Prepare um arquivo novo.');
    process.exit(2);
  }

  const db = openReadonly(target);
  db.pragma('foreign_keys = ON');

  const integrity = runIntegrity(db);
  const fks = runForeignKeys(db);
  const missing = missingEssentialTables(db);
  const counts = businessCounts(db);
  const residue = hasPilotResidue(counts);

  console.log('Database: OK');
  console.log('Migrations: OK (' + migrations.length + ' files in schema/)');
  console.log('Integrity:', integrity.ok ? 'OK' : 'FAIL');
  console.log('Foreign Keys:', fks.ok ? 'OK' : 'FAIL');
  console.log('');
  console.log('Business data:');
  console.log('');
  console.log('Tenants:', counts.tenants ?? 'n/a');
  console.log('Users:', counts.users ?? 'n/a');
  console.log('Companies:', counts.companies ?? 'n/a');
  console.log('Documents:', counts.documents ?? 'n/a');
  console.log('Entries:', counts.entries ?? 'n/a');
  console.log('Notifications:', counts.notifications ?? 'n/a');
  console.log('Invitations:', counts.client_invitations ?? 'n/a');
  console.log('Office registrations:', counts.office_registrations ?? 'n/a');
  console.log('');

  // Reference data from migrations (allowed)
  const pricing = countTable(db, 'ai_model_pricing');
  if (pricing != null) console.log('ai_model_pricing (system):', pricing);

  console.log('');
  console.log('Essential tables:', missing.length ? 'MISSING ' + missing.join(',') : 'OK');
  console.log('Development residue:', residue ? residue : 'NONE');
  console.log('');

  db.close();

  const ready = integrity.ok && fks.ok && !missing.length && !residue;
  console.log('STATUS:', ready ? 'READY_FOR_FIRST_ONBOARDING' : 'BLOCKED');
  process.exit(ready ? 0 : 2);
}

main();
