-- Sprint 28.1: mensagens de solicitação + Web Push
CREATE TABLE IF NOT EXISTS request_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by_role TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_request_messages_thread
  ON request_messages(tenant_id, company_id, request_id, created_at);

CREATE TABLE IF NOT EXISTS request_message_reads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(message_id) REFERENCES request_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id),
  UNIQUE(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_request_message_reads_user
  ON request_message_reads(tenant_id, user_id, read_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  UNIQUE(endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(tenant_id, user_id, active);

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  requests_enabled INTEGER NOT NULL DEFAULT 1,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  visual_enabled INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- Migração do histórico legado (idempotente)
INSERT OR IGNORE INTO request_messages(id, tenant_id, company_id, request_id, user_id, message, created_by_role, created_at)
SELECT c.id, c.tenant_id, c.company_id, c.request_id, c.user_id, c.message,
       COALESCE((SELECT u.role FROM users u WHERE u.id=c.user_id), 'CLIENT'),
       c.created_at
FROM client_request_responses c
WHERE NOT EXISTS (SELECT 1 FROM request_messages m WHERE m.id=c.id);
