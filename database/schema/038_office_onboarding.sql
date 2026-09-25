-- Sprint 34: onboarding público de escritório (pending até confirmar e-mail).
CREATE TABLE IF NOT EXISTS office_registrations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  office_name TEXT NOT NULL,
  office_cnpj TEXT NOT NULL,
  office_cnpj_normalized TEXT NOT NULL,
  office_email TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN('PENDING','COMPLETED','EXPIRED','REVOKED')),
  expires_at TEXT NOT NULL,
  tenant_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_office_reg_cnpj_pending
  ON office_registrations(office_cnpj_normalized) WHERE status='PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS idx_office_reg_email_pending
  ON office_registrations(owner_email) WHERE status='PENDING';

CREATE INDEX IF NOT EXISTS idx_office_reg_status_expires
  ON office_registrations(status, expires_at);
