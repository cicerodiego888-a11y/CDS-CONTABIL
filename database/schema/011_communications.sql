CREATE TABLE IF NOT EXISTS communication_settings(
  tenant_id TEXT PRIMARY KEY,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_provider TEXT NOT NULL DEFAULT 'meta',
  whatsapp_phone_number_id TEXT,
  display_number TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE TABLE IF NOT EXISTS communication_event_prefs(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  UNIQUE(tenant_id,event_type),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_comm_prefs_tenant ON communication_event_prefs(tenant_id,event_type);
CREATE TABLE IF NOT EXISTS communication_jobs(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT,
  event_id TEXT,
  notification_id TEXT,
  recipient_user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  destination TEXT,
  template_key TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  provider_message_id TEXT,
  locked_at TEXT,
  locked_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_jobs_idempotency
  ON communication_jobs(event_id,recipient_user_id,channel)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_jobs_tenant_status ON communication_jobs(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_due ON communication_jobs(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_provider_msg ON communication_jobs(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_event ON communication_jobs(event_id);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_company ON communication_jobs(tenant_id,company_id);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_notification ON communication_jobs(notification_id);
