-- Sprint 22 — orquestração da Nova Despesa Inteligente.
CREATE TABLE IF NOT EXISTS tenant_ai_settings(
  tenant_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expense_document_analyses(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK(status IN('PROCESSING','READY','PARTIAL','FAILED','SAVED')),
  extraction_id TEXT,
  classification_source TEXT NOT NULL DEFAULT 'NONE'
    CHECK(classification_source IN('NONE','CLASSIFICATION_ENGINE','AI')),
  classification_status TEXT,
  classification_confidence REAL NOT NULL DEFAULT 0
    CHECK(classification_confidence>=0 AND classification_confidence<=1),
  classification_reason TEXT,
  suggested_category_id TEXT,
  suggested_bank_id TEXT,
  ai_suggestion_id TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  expense_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(extraction_id) REFERENCES document_extractions(id) ON DELETE SET NULL,
  FOREIGN KEY(suggested_category_id) REFERENCES categories(id),
  FOREIGN KEY(suggested_bank_id) REFERENCES banks(id),
  FOREIGN KEY(ai_suggestion_id) REFERENCES ai_classification_suggestions(id),
  FOREIGN KEY(expense_id) REFERENCES expenses(id),
  FOREIGN KEY(requested_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_usage_records(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT,
  provider TEXT,
  model TEXT,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('SUCCESS','FAILED')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_cents INTEGER,
  reference_type TEXT,
  reference_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_analysis_scope
  ON expense_document_analyses(tenant_id,company_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created
  ON ai_usage_records(tenant_id,created_at);
