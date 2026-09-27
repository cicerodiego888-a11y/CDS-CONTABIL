'use strict';
const Database = require('better-sqlite3');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const dbPath = env.match(/^CDS_DB_PATH=(.+)$/m)[1].trim().replace(/^["']|["']$/g, '');
const db = new Database(dbPath, { readonly: true });

console.log('=== AI SETTINGS ===');
console.log(db.prepare('SELECT enabled,autonomy_mode,model_display FROM tenant_ai_settings').all());

console.log('\n=== RECENT PIPELINE RUNS ===');
console.log(db.prepare(`
  SELECT id, document_id, status, extraction_mode, confidence, error_code,
         substr(error_message,1,120) error_message, expense_id, entry_id,
         created_at, completed_at
  FROM document_pipeline_runs
  ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 12
`).all());

console.log('\n=== RECENT ENTRIES BY STATUS ===');
console.log(db.prepare(`
  SELECT status, COUNT(*) n FROM entries GROUP BY status
`).all());

console.log('\n=== RECENT ENTRIES ===');
console.log(db.prepare(`
  SELECT id, description, status, source_type, source_id, confidence, created_at
  FROM entries ORDER BY created_at DESC LIMIT 12
`).all());

console.log('\n=== APPROVAL QUEUE ===');
console.log(db.prepare(`
  SELECT id, description, status, created_at FROM entries WHERE status='PENDING' ORDER BY created_at DESC LIMIT 10
`).all());

console.log('\n=== AI DECISION AUDITS ===');
console.log(db.prepare(`
  SELECT action, entity_id, created_at, substr(after_json,1,220) after_json
  FROM audit_logs
  WHERE action IN ('AI_DECISION','AI_DECISION_ENGINE','AI_AUTONOMY_MODE','DOCUMENT_AI_INTERPRETED','ENTRY_CREATED','CLASSIFICATION_REQUIRED','PIPELINE_COMPLETED','PIPELINE_FAILED')
  ORDER BY created_at DESC LIMIT 20
`).all());

console.log('\n=== EXPENSES WITHOUT PENDING/POSTED ENTRY ===');
console.log(db.prepare(`
  SELECT e.id, e.description, e.amount_cents, e.occurred_on, e.created_at,
         (SELECT status FROM entries en WHERE en.source_id=e.id ORDER BY en.created_at DESC LIMIT 1) entry_status
  FROM expenses e
  ORDER BY e.created_at DESC LIMIT 10
`).all());
