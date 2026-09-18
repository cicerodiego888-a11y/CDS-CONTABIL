CREATE TABLE IF NOT EXISTS tenant_email_settings(
  tenant_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'smtp',
  host TEXT,
  port INTEGER NOT NULL DEFAULT 587,
  username TEXT,
  email_from TEXT,
  from_name TEXT,
  secure INTEGER NOT NULL DEFAULT 0,
  password_cipher TEXT,
  password_iv TEXT,
  password_tag TEXT,
  password_salt TEXT,
  last_test_status TEXT,
  last_tested_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_email_settings_tenant ON tenant_email_settings(tenant_id);
