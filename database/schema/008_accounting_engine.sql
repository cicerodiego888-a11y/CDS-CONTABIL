CREATE TABLE IF NOT EXISTS classification_runs(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  entry_id TEXT,
  status TEXT NOT NULL,
  chosen_debit_account_id TEXT,
  chosen_credit_account_id TEXT,
  origin TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  candidates_json TEXT NOT NULL DEFAULT '[]',
  decided_by TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(entry_id) REFERENCES entries(id)
);
CREATE INDEX IF NOT EXISTS idx_classification_runs_source ON classification_runs(tenant_id,source_type,source_id,created_at);
CREATE INDEX IF NOT EXISTS idx_classification_runs_entry ON classification_runs(entry_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_source_unique ON entries(tenant_id,source_type,source_id) WHERE source_id IS NOT NULL;
