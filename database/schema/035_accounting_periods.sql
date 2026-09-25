-- Sprint final pré-produção: competência contábil / fechamento.
-- Não altera tabelas existentes; exports históricos permanecem intactos.
CREATE TABLE IF NOT EXISTS accounting_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  competence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK(status IN('OPEN','IN_REVIEW','READY_FOR_EXPORT','EXPORTED','CLOSED')),
  closed_at TEXT,
  closed_by TEXT,
  reopened_at TEXT,
  reopened_by TEXT,
  reopen_reason TEXT,
  export_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(closed_by) REFERENCES users(id),
  FOREIGN KEY(reopened_by) REFERENCES users(id),
  FOREIGN KEY(export_id) REFERENCES exports(id),
  UNIQUE(tenant_id, company_id, competence)
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_tenant_company
  ON accounting_periods(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_competence
  ON accounting_periods(tenant_id, company_id, competence);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_status
  ON accounting_periods(tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_export
  ON accounting_periods(export_id);
