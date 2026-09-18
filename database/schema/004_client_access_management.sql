CREATE TABLE IF NOT EXISTS client_user_profiles(
  user_id TEXT PRIMARY KEY,
  profile TEXT NOT NULL CHECK(profile IN('CLIENT_ADMIN','CLIENT_FINANCE','CLIENT_VIEWER')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS client_permissions(
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS client_user_permissions(
  user_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN(0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  PRIMARY KEY(user_id,permission_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(permission_key) REFERENCES client_permissions(key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS client_invitations(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','ACCEPTED','EXPIRED','REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TEXT,
  created_by TEXT NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_client_profiles_profile ON client_user_profiles(profile);
CREATE INDEX IF NOT EXISTS idx_client_permissions_user ON client_user_permissions(user_id,permission_key);
CREATE INDEX IF NOT EXISTS idx_client_invitations_tenant_company ON client_invitations(tenant_id,company_id,status);
CREATE INDEX IF NOT EXISTS idx_client_invitations_user_status ON client_invitations(user_id,status);
CREATE INDEX IF NOT EXISTS idx_client_invitations_expiration ON client_invitations(expires_at,status);
CREATE INDEX IF NOT EXISTS idx_client_invitations_email ON client_invitations(tenant_id,email);
INSERT OR IGNORE INTO client_permissions(key,description) VALUES
('client.dashboard.view','Visualizar dashboard'),
('client.expenses.view','Visualizar despesas'),
('client.expenses.create','Criar despesas'),
('client.revenues.view','Visualizar receitas'),
('client.revenues.create','Criar receitas'),
('client.documents.view','Visualizar documentos'),
('client.documents.upload','Enviar documentos'),
('client.pending.view','Visualizar pendencias'),
('client.pending.respond','Responder pendencias'),
('client.requests.view','Visualizar solicitacoes'),
('client.requests.respond','Responder solicitacoes'),
('client.notifications.view','Visualizar notificacoes'),
('client.reports.view','Visualizar relatorios'),
('client.users.view','Visualizar usuarios'),
('client.users.create','Criar usuarios'),
('client.users.edit','Editar usuarios'),
('client.users.block','Bloquear usuarios');
