CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id,status);
CREATE INDEX IF NOT EXISTS idx_entries_tenant_status ON entries(tenant_id,status,occurred_on);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_company ON expenses(tenant_id,company_id,occurred_on);
CREATE INDEX IF NOT EXISTS idx_revenues_tenant_company ON revenues(tenant_id,company_id,occurred_on);
CREATE INDEX IF NOT EXISTS idx_pendencies ON pendencies(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_logs(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_requests ON requests(tenant_id,status,created_at);
