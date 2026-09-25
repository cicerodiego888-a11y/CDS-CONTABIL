-- Sprint Audácia: pipeline documental → classificação → PENDING
CREATE TABLE IF NOT EXISTS document_pipeline_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK(status IN(
      'QUEUED','PROCESSING','EXTRACTING','CLASSIFYING','SUGGESTING',
      'VALIDATING','PENDING','NEEDS_CLASSIFICATION','DUPLICATE','FAILED','COMPLETED'
    )),
  extraction_mode TEXT,
  operation_type TEXT,
  confidence REAL,
  confidence_band TEXT,
  confidence_reason TEXT,
  expense_id TEXT,
  entry_id TEXT,
  duplicate_of_document_id TEXT,
  error_code TEXT,
  error_message TEXT,
  fields_json TEXT,
  suggestion_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  UNIQUE(tenant_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_dpr_tenant_company_status
  ON document_pipeline_runs(tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_dpr_document
  ON document_pipeline_runs(document_id);

CREATE TABLE IF NOT EXISTS document_learning_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  document_id TEXT,
  entry_id TEXT,
  suggested_account_debit TEXT,
  suggested_account_credit TEXT,
  selected_account_debit TEXT,
  selected_account_credit TEXT,
  suggested_operation_type TEXT,
  selected_operation_type TEXT,
  decision TEXT NOT NULL
    CHECK(decision IN('ACCEPTED','OVERRIDDEN','REJECTED')),
  reason TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE INDEX IF NOT EXISTS idx_dld_tenant_company
  ON document_learning_decisions(tenant_id, company_id, created_at);
