-- Sprint 18 — Recorrência mensal e geração automática.
CREATE TABLE IF NOT EXISTS process_recurrences (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'MENSAL' CHECK(frequency='MENSAL'),
  generation_day INTEGER NOT NULL DEFAULT 1 CHECK(generation_day BETWEEN 1 AND 31),
  start_year INTEGER NOT NULL,
  start_month INTEGER NOT NULL CHECK(start_month BETWEEN 1 AND 12),
  active INTEGER NOT NULL DEFAULT 1,
  last_generated_year INTEGER,
  last_generated_month INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_process_recurrences_due
  ON process_recurrences(active, frequency, start_year, start_month);
CREATE INDEX IF NOT EXISTS idx_process_recurrences_tenant_company
  ON process_recurrences(tenant_id, company_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_process_occurrences_process_company_period
  ON process_occurrences(process_id, company_id, competence_year, competence_month);
