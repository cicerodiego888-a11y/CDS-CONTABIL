CREATE TABLE IF NOT EXISTS domain_events(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PROCESSED',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_created ON domain_events(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_company ON domain_events(tenant_id,company_id,created_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_type ON domain_events(tenant_id,event_type,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_events_unique_once ON domain_events(tenant_id,event_type,entity_type,entity_id)
  WHERE event_type IN('EXPENSE_CREATED','REVENUE_CREATED','DOCUMENT_UPLOADED','CLASSIFICATION_REQUIRED','ENTRY_CREATED','ENTRY_APPROVED','ENTRY_REJECTED','REQUEST_CREATED');

CREATE TABLE IF NOT EXISTS notification_preferences(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  UNIQUE(user_id,event_type),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON notification_preferences(tenant_id,user_id,event_type);
