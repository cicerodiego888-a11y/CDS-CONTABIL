-- Sprint 28: mapeamento genérico de contas para sistemas externos (ex.: Domínio).
CREATE TABLE IF NOT EXISTS account_external_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  system_key TEXT NOT NULL,
  external_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  UNIQUE(company_id, account_id, system_key)
);
CREATE INDEX IF NOT EXISTS idx_aem_tenant_company_system
  ON account_external_mappings(tenant_id, company_id, system_key);
CREATE INDEX IF NOT EXISTS idx_aem_account
  ON account_external_mappings(account_id);
