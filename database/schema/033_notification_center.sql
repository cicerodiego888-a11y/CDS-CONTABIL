-- Sprint 28.2 — Motor central de notificações (evolução idempotente)
-- Reutiliza tabela notifications e user_notification_prefs existentes.

-- Colunas extras na notificação canônica (sem perda de dados)
-- Aplicadas também via ensureColumn no database.js

-- Preferências por categoria (default = ligado, compatível com 28.1)
-- documents_enabled, expenses_enabled, classification_enabled,
-- approval_enabled, processes_enabled, integrations_enabled

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_company_recipient_created
  ON notifications(tenant_id, company_id, recipient_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_recipient_read
  ON notifications(tenant_id, recipient_user_id, read_at);
