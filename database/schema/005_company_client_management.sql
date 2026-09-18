INSERT OR IGNORE INTO client_permissions(key,description) VALUES
('client.expenses.edit','Editar despesas'),
('client.revenues.edit','Editar receitas');
CREATE INDEX IF NOT EXISTS idx_companies_tenant_status ON companies(tenant_id,status);
CREATE INDEX IF NOT EXISTS idx_companies_tenant_name ON companies(tenant_id,name);
CREATE INDEX IF NOT EXISTS idx_users_company_role ON users(tenant_id,company_id,role);
