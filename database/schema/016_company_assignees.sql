CREATE TABLE IF NOT EXISTS company_assignees(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  UNIQUE(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_assignees_tenant_user ON company_assignees(tenant_id,user_id);
CREATE INDEX IF NOT EXISTS idx_company_assignees_company ON company_assignees(company_id);
