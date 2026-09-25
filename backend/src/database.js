'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function ensureColumn(db, table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

function applySchema(db, schemaDir) {
  const skip = new Set(['010_company_cnpj.sql', '012_operational_central.sql', '021_process_execution.sql', '033_notification_center.sql']);
  for (const f of fs.readdirSync(schemaDir).filter(x => x.endsWith('.sql')).sort()) {
    if (skip.has(f)) continue;
    db.exec(fs.readFileSync(path.join(schemaDir, f), 'utf8'));
  }
  ensureColumn(db, 'users', 'whatsapp_phone', 'TEXT');
  ensureColumn(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'users', 'pin_hash', 'TEXT');
  ensureColumn(db, 'users', 'pin_configured_at', 'TEXT');
  ensureColumn(db, 'users', 'pin_setup_required', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'companies', 'trade_name', 'TEXT');
  ensureColumn(db, 'companies', 'address', 'TEXT');
  ensureColumn(db, 'companies', 'address_number', 'TEXT');
  ensureColumn(db, 'companies', 'complement', 'TEXT');
  ensureColumn(db, 'companies', 'neighborhood', 'TEXT');
  ensureColumn(db, 'companies', 'city', 'TEXT');
  ensureColumn(db, 'companies', 'state', 'TEXT');
  ensureColumn(db, 'companies', 'zip', 'TEXT');
  ensureColumn(db, 'companies', 'cnpj_normalized', 'TEXT');
  ensureColumn(db, 'companies', 'cadastral_status', 'TEXT');
  ensureColumn(db, 'companies', 'opened_on', 'TEXT');
  ensureColumn(db, 'companies', 'legal_nature', 'TEXT');
  ensureColumn(db, 'companies', 'main_cnae', 'TEXT');
  ensureColumn(db, 'companies', 'company_size', 'TEXT');
  ensureColumn(db, 'companies', 'share_capital', 'TEXT');
  ensureColumn(db, 'companies', 'simples_nacional', 'INTEGER');
  ensureColumn(db, 'companies', 'mei', 'INTEGER');
  db.exec(fs.readFileSync(path.join(schemaDir, '010_company_cnpj.sql'), 'utf8'));
  ensureColumn(db, 'users', 'last_access_at', 'TEXT');
  ensureColumn(db, 'expenses', 'notes', 'TEXT');
  ensureColumn(db, 'expenses', 'supplier_name', 'TEXT');
  ensureColumn(db, 'revenues', 'notes', 'TEXT');
  ensureColumn(db, 'documents', 'notes', 'TEXT');
  ensureColumn(db, 'expenses', 'origin', "TEXT NOT NULL DEFAULT 'PORTAL_CLIENTE'");
  ensureColumn(db, 'revenues', 'origin', "TEXT NOT NULL DEFAULT 'PORTAL_CLIENTE'");
  ensureColumn(db, 'documents', 'origin', "TEXT NOT NULL DEFAULT 'PORTAL_CLIENTE'");
  ensureColumn(db, 'documents', 'source', 'TEXT');
  ensureColumn(db, 'documents', 'deleted_at', 'TEXT');
  ensureColumn(db, 'documents', 'deleted_by', 'TEXT');
  ensureColumn(db, 'documents', 'deleted_source', 'TEXT');
  ensureColumn(db, 'documents', 'deletion_reason', 'TEXT');
  ensureColumn(db, 'documents', 'encrypted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'documents', 'encryption_kid', 'TEXT');
  ensureColumn(db, 'companies', 'deleted_at', 'TEXT');
  ensureColumn(db, 'companies', 'deleted_by', 'TEXT');
  ensureColumn(db, 'companies', 'deletion_reason', 'TEXT');
  ensureColumn(db, 'companies', 'archived_at', 'TEXT');
  ensureColumn(db, 'companies', 'archived_by', 'TEXT');
  ensureColumn(db, 'companies', 'archive_reason', 'TEXT');
  ensureColumn(db, 'companies', 'codigo_cliente', 'TEXT');
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tenant_codigo_cliente
      ON companies(tenant_id, codigo_cliente)
      WHERE codigo_cliente IS NOT NULL AND codigo_cliente <> ''`);
  } catch {}
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_tenant_company_deleted ON documents(tenant_id,company_id,deleted_at)');
  db.exec("UPDATE documents SET source='OFFICE' WHERE IFNULL(source,'')='' AND uploaded_by IN(SELECT id FROM users WHERE role IN('OWNER','ACCOUNTANT','STAFF')) AND IFNULL(origin,'') NOT IN('CDS_SISTEMAS','IMPORTACAO_CONTABIL','IMPORTACAO_FISCAL','OUTRA_ORIGEM_FUTURA')");
  db.exec("UPDATE documents SET source='CLIENT' WHERE IFNULL(source,'')='' AND uploaded_by IN(SELECT id FROM users WHERE role='CLIENT') AND IFNULL(origin,'') NOT IN('CDS_SISTEMAS','IMPORTACAO_CONTABIL','IMPORTACAO_FISCAL','OUTRA_ORIGEM_FUTURA')");
  ensureColumn(db, 'expenses', 'import_id', 'TEXT');
  ensureColumn(db, 'revenues', 'import_id', 'TEXT');
  ensureColumn(db, 'companies', 'cds_systems_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'notifications', 'event_id', 'TEXT');
  ensureColumn(db, 'notifications', 'company_id', 'TEXT');
  ensureColumn(db, 'notifications', 'recipient_user_id', 'TEXT');
  ensureColumn(db, 'notifications', 'entity_type', 'TEXT');
  ensureColumn(db, 'notifications', 'entity_id', 'TEXT');
  ensureColumn(db, 'notifications', 'context', 'TEXT');
  ensureColumn(db, 'notifications', 'url', 'TEXT');
  ensureColumn(db, 'notifications', 'preview', 'TEXT');
  ensureColumn(db, 'notifications', 'actor_user_id', 'TEXT');
  ensureColumn(db, 'user_notification_prefs', 'documents_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'user_notification_prefs', 'expenses_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'user_notification_prefs', 'classification_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'user_notification_prefs', 'approval_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'user_notification_prefs', 'processes_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'user_notification_prefs', 'integrations_enabled', 'INTEGER NOT NULL DEFAULT 1');
  try { db.exec(fs.readFileSync(path.join(schemaDir, '033_notification_center.sql'), 'utf8')); } catch {}
  db.exec(fs.readFileSync(path.join(schemaDir, '012_operational_central.sql'), 'utf8'));
  ensureColumn(db, 'tenant_branding', 'logo_size', 'INTEGER');
  ensureColumn(db, 'tenant_branding', 'logo_updated_at', 'TEXT');
  ensureColumn(db, 'tenants', 'assign_staff_companies', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tenants', 'slug', 'TEXT');
  ensureColumn(db, 'entries', 'posted_at', 'TEXT');
  ensureColumn(db, 'entries', 'posted_by', 'TEXT');
  ensureColumn(db, 'entries', 'generated_by_workflow', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'categories', 'created_at', 'TEXT');
  ensureColumn(db, 'categories', 'updated_at', 'TEXT');
  ensureColumn(db, 'banks', 'created_at', 'TEXT');
  ensureColumn(db, 'banks', 'updated_at', 'TEXT');
  ensureColumn(db, 'banks', 'identifier', 'TEXT');
  db.exec('UPDATE categories SET created_at=CURRENT_TIMESTAMP WHERE created_at IS NULL');
  db.exec('UPDATE banks SET created_at=CURRENT_TIMESTAMP WHERE created_at IS NULL');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_entries_tenant_status_posted ON entries(tenant_id,company_id,status,posted_at)'); } catch {}
  ensureColumn(db, 'communication_jobs', 'provider', 'TEXT');
  ensureColumn(db, 'communication_jobs', 'event_type', 'TEXT');
  ensureColumn(db, 'communication_jobs', 'updated_at', 'TEXT');
  ensureColumn(db, 'notification_preferences', 'email_enabled', 'INTEGER DEFAULT 1');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_events_company_created_once ON domain_events(tenant_id,event_type,entity_type,entity_id) WHERE event_type='COMPANY_CREATED'");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_recipient ON notifications(event_id,recipient_user_id) WHERE event_id IS NOT NULL AND recipient_user_id IS NOT NULL");
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(tenant_id,recipient_user_id,read_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications(tenant_id,recipient_user_id,created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_companies_tenant_trade ON companies(tenant_id,trade_name)');
  db.exec("UPDATE companies SET status='ARCHIVED' WHERE status IN('INACTIVE','DISABLED')");
  ensureColumn(db, 'process_occurrence_steps', 'due_date', 'TEXT');
  ensureColumn(db, 'process_occurrence_steps', 'started_at', 'TEXT');
  ensureColumn(db, 'process_occurrence_steps', 'started_by', 'TEXT');
  ensureColumn(db, 'process_occurrence_steps', 'completed_at', 'TEXT');
  ensureColumn(db, 'process_occurrence_steps', 'completed_by', 'TEXT');
  ensureColumn(db, 'process_occurrence_steps', 'observation', 'TEXT');
  db.exec(fs.readFileSync(path.join(schemaDir, '021_process_execution.sql'), 'utf8'));
  ensureColumn(db, 'tenant_ai_settings', 'monthly_limit_cents', 'INTEGER');
  ensureColumn(db, 'tenant_ai_settings', 'model_display', 'TEXT');
  ensureColumn(db, 'tenant_ai_settings', 'autonomy_mode', "TEXT NOT NULL DEFAULT 'ASSISTED_50'");
  ensureColumn(db, 'ai_usage_records', 'user_id', 'TEXT');
  ensureColumn(db, 'ai_usage_records', 'document_id', 'TEXT');
  ensureColumn(db, 'ai_usage_records', 'duration_ms', 'INTEGER');
  ensureColumn(db, 'ai_usage_records', 'error_code', 'TEXT');
  ensureColumn(db, 'ai_usage_records', 'cached_input_tokens', 'INTEGER');
  ensureColumn(db, 'client_invitations', 'purpose', "TEXT NOT NULL DEFAULT 'ACTIVATION'");
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_client_invitations_purpose ON client_invitations(purpose)'); } catch {}
}

function openDatabase({ dbPath, schemaDir, uploads }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const d of uploads || []) fs.mkdirSync(d, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys=ON');
  db.pragma('journal_mode=WAL');
  applySchema(db, schemaDir);
  return db;
}

module.exports = { openDatabase, ensureColumn, applySchema };
