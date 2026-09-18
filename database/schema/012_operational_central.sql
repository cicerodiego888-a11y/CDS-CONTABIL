CREATE TABLE IF NOT EXISTS movement_imports(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  issues_json TEXT NOT NULL DEFAULT '[]',
  source_file TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE INDEX IF NOT EXISTS idx_movement_imports_tenant_company ON movement_imports(tenant_id,company_id,created_at);
CREATE INDEX IF NOT EXISTS idx_movement_imports_tenant_status ON movement_imports(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_origin ON expenses(tenant_id,company_id,origin,created_at);
CREATE INDEX IF NOT EXISTS idx_revenues_origin ON revenues(tenant_id,company_id,origin,created_at);
CREATE INDEX IF NOT EXISTS idx_documents_origin ON documents(tenant_id,company_id,created_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_company_created ON domain_events(tenant_id,company_id,created_at);
