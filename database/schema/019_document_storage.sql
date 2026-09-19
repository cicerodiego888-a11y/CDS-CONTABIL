CREATE TABLE IF NOT EXISTS document_migrations(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  tenant_id TEXT,
  company_id TEXT,
  old_path TEXT,
  new_path TEXT,
  sha256 TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_migrations_doc ON document_migrations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_migrations_status ON document_migrations(status);
