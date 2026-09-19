-- Sprint 23 — controle de IA e consumo por escritório.
CREATE TABLE IF NOT EXISTS ai_model_pricing(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_price_usd_per_1m REAL NOT NULL DEFAULT 0
    CHECK(input_price_usd_per_1m>=0),
  cached_input_price_usd_per_1m REAL
    CHECK(cached_input_price_usd_per_1m IS NULL OR cached_input_price_usd_per_1m>=0),
  output_price_usd_per_1m REAL NOT NULL DEFAULT 0
    CHECK(output_price_usd_per_1m>=0),
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_pricing_active
  ON ai_model_pricing(provider,model,effective_from);

CREATE TABLE IF NOT EXISTS ai_limit_warnings(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_ym TEXT NOT NULL,
  level INTEGER NOT NULL CHECK(level IN(50,80,100)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  UNIQUE(tenant_id,period_ym,level)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_op_created
  ON ai_usage_records(tenant_id,operation_type,created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_company_created
  ON ai_usage_records(tenant_id,company_id,created_at);

INSERT OR IGNORE INTO ai_model_pricing(
  id,provider,model,input_price_usd_per_1m,cached_input_price_usd_per_1m,
  output_price_usd_per_1m,effective_from,active
) VALUES
  ('price-openai-gpt-4.1-mini','openai','gpt-4.1-mini',0.40,0.10,1.60,'2026-01-01',1),
  ('price-openai-gpt-4o-mini','openai','gpt-4o-mini',0.15,0.075,0.60,'2026-01-01',1),
  ('price-openai-gpt-5.6-terra','openai','gpt-5.6-terra',1.25,0.125,10.00,'2026-01-01',1);
