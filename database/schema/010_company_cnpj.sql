CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tenant_cnpj_norm
  ON companies(tenant_id, cnpj_normalized)
  WHERE cnpj_normalized IS NOT NULL AND length(cnpj_normalized)>0;
CREATE INDEX IF NOT EXISTS idx_companies_cnpj_normalized ON companies(cnpj_normalized);
