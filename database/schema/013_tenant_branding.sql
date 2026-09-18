CREATE TABLE IF NOT EXISTS tenant_branding(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE,
  office_name TEXT,
  slogan TEXT,
  logo_path TEXT,
  logo_mime TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant ON tenant_branding(tenant_id);
