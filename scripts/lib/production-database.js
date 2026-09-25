'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applySchema } = require('../../backend/src/database');

const BUSINESS_TABLES = [
  'tenants',
  'users',
  'companies',
  'documents',
  'document_extractions',
  'document_pipeline_runs',
  'entries',
  'entry_lines',
  'notifications',
  'domain_events',
  'request_messages',
  'push_subscriptions',
  'audit_logs',
  'communication_jobs',
  'client_invitations',
  'office_registrations',
  'accounting_periods',
  'exports',
  'pendencies',
  'ai_usage_records',
  'ai_provider_credentials'
];

const ESSENTIAL_TABLES = [
  'tenants',
  'users',
  'companies',
  'documents',
  'entries',
  'entry_lines',
  'notifications',
  'office_registrations',
  'client_invitations',
  'audit_logs'
];

function rootDir() {
  return path.resolve(__dirname, '../..');
}

function schemaDir() {
  return path.join(rootDir(), 'database', 'schema');
}

function listMigrations() {
  return fs.readdirSync(schemaDir()).filter((x) => x.endsWith('.sql')).sort();
}

function pilotDbPath() {
  return path.resolve(rootDir(), 'database', 'cds-contabil-connect.db');
}

function resolveTargetPath(explicit) {
  const raw = String(explicit || process.env.CDS_DB_PATH || '').trim();
  if (!raw) {
    return path.resolve(rootDir(), 'database', 'production', 'cds-contabil-connect.db');
  }
  return path.resolve(rootDir(), raw);
}

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row;
}

function countTable(db, name) {
  if (!tableExists(db, name)) return null;
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n);
}

function businessCounts(db) {
  const out = {};
  for (const t of BUSINESS_TABLES) {
    out[t] = countTable(db, t);
  }
  return out;
}

function missingEssentialTables(db) {
  return ESSENTIAL_TABLES.filter((t) => !tableExists(db, t));
}

function openReadonly(dbPath) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function createFreshDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    const err = new Error('DATABASE_EXISTS');
    err.code = 'DATABASE_EXISTS';
    throw err;
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  applySchema(db, schemaDir());
  return db;
}

function runIntegrity(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  const ok = rows.length === 1 && String(rows[0].integrity_check).toLowerCase() === 'ok';
  return { ok, rows };
}

function runForeignKeys(db) {
  const rows = db.prepare('PRAGMA foreign_key_check').all();
  return { ok: rows.length === 0, rows };
}

function hasPilotResidue(counts) {
  const zeroOk = [
    'tenants', 'users', 'companies', 'documents', 'entries', 'entry_lines',
    'notifications', 'domain_events', 'request_messages', 'push_subscriptions',
    'audit_logs', 'communication_jobs', 'client_invitations', 'office_registrations',
    'accounting_periods', 'exports', 'pendencies', 'ai_usage_records', 'ai_provider_credentials',
    'document_extractions', 'document_pipeline_runs'
  ];
  for (const t of zeroOk) {
    if (counts[t] == null) continue;
    if (counts[t] > 0) return t + '=' + counts[t];
  }
  return null;
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

module.exports = {
  BUSINESS_TABLES,
  ESSENTIAL_TABLES,
  rootDir,
  schemaDir,
  listMigrations,
  pilotDbPath,
  resolveTargetPath,
  tableExists,
  countTable,
  businessCounts,
  missingEssentialTables,
  openReadonly,
  createFreshDatabase,
  runIntegrity,
  runForeignKeys,
  hasPilotResidue,
  samePath
};
