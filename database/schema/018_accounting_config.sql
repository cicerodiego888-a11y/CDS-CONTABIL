CREATE INDEX IF NOT EXISTS idx_categories_tenant_company_name ON categories(tenant_id, company_id, name);
CREATE INDEX IF NOT EXISTS idx_banks_tenant_company_name ON banks(tenant_id, company_id, name);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_analytic ON accounts(tenant_id, account_type, is_postable, active);
