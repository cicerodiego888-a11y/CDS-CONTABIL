-- Sprint 20 — Inteligência Documental (fundação).
CREATE TABLE IF NOT EXISTS document_extractions(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN('PENDING','PROCESSING','EXTRACTED','FAILED','REVIEWED')),
  extraction_method TEXT,
  extracted_text TEXT,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  requested_by TEXT,
  reviewed_by TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  extracted_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(requested_by) REFERENCES users(id),
  FOREIGN KEY(reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS document_extracted_fields(
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  raw_value TEXT,
  normalized_value TEXT,
  reviewed_value TEXT,
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence>=0 AND confidence<=1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(extraction_id) REFERENCES document_extractions(id) ON DELETE CASCADE,
  UNIQUE(extraction_id,field_name)
);

CREATE INDEX IF NOT EXISTS idx_document_extractions_scope
  ON document_extractions(tenant_id,company_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_document_extracted_fields_extraction
  ON document_extracted_fields(extraction_id,field_name);
