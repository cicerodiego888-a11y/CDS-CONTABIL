-- Sprint 21 — IA assistiva para classificação e importação de plano.
CREATE TABLE IF NOT EXISTS ai_classification_suggestions(
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK(status IN('REQUESTED','COMPLETED','FAILED','ACCEPTED','REJECTED','OVERRIDDEN')),
  provider TEXT,
  model TEXT,
  context_hash TEXT,
  operation_type TEXT,
  suggested_history TEXT,
  suggested_category_id TEXT,
  suggested_bank_id TEXT,
  primary_account_id TEXT,
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence>=0 AND confidence<=1),
  reason TEXT,
  error_code TEXT,
  requested_by TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(extraction_id) REFERENCES document_extractions(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(suggested_category_id) REFERENCES categories(id),
  FOREIGN KEY(suggested_bank_id) REFERENCES banks(id),
  FOREIGN KEY(primary_account_id) REFERENCES accounts(id),
  FOREIGN KEY(requested_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_classification_candidates(
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence>=0 AND confidence<=1),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(suggestion_id) REFERENCES ai_classification_suggestions(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  UNIQUE(suggestion_id,account_id),
  UNIQUE(suggestion_id,rank)
);

CREATE TABLE IF NOT EXISTS ai_classification_decisions(
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('ACCEPTED','REJECTED','OVERRIDDEN')),
  suggested_account_id TEXT,
  selected_account_id TEXT,
  selected_category_id TEXT,
  selected_bank_id TEXT,
  selected_history TEXT,
  reason TEXT,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(suggestion_id) REFERENCES ai_classification_suggestions(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(suggested_account_id) REFERENCES accounts(id),
  FOREIGN KEY(selected_account_id) REFERENCES accounts(id),
  FOREIGN KEY(selected_category_id) REFERENCES categories(id),
  FOREIGN KEY(selected_bank_id) REFERENCES banks(id),
  FOREIGN KEY(decided_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_chart_previews(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT,
  status TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK(status IN('PROCESSING','READY','INVALID','FAILED','IMPORTED')),
  provider TEXT,
  model TEXT,
  source_file TEXT,
  rows_json TEXT NOT NULL DEFAULT '[]',
  issues_json TEXT NOT NULL DEFAULT '[]',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  context_hash TEXT,
  error_code TEXT,
  requested_by TEXT NOT NULL,
  imported_plan_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  imported_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(requested_by) REFERENCES users(id),
  FOREIGN KEY(imported_plan_id) REFERENCES account_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_scope
  ON ai_classification_suggestions(tenant_id,company_id,status,requested_at);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_suggestion
  ON ai_classification_decisions(suggestion_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chart_previews_scope
  ON ai_chart_previews(tenant_id,status,created_at);
