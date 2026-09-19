-- Sprint 24.1 — preço vigente do GPT-5.6 Terra (configuração, sem apagar histórico).
-- Valores oficiais: input 2.00 / cached 0.20 / output 12.00 (USD por 1M tokens).

UPDATE ai_model_pricing
SET
  input_price_usd_per_1m = 2.00,
  cached_input_price_usd_per_1m = 0.20,
  output_price_usd_per_1m = 12.00
WHERE provider = 'openai'
  AND model = 'gpt-5.6-terra';

INSERT INTO ai_model_pricing(
  id,provider,model,input_price_usd_per_1m,cached_input_price_usd_per_1m,
  output_price_usd_per_1m,effective_from,active
)
SELECT
  'price-openai-gpt-5.6-terra','openai','gpt-5.6-terra',2.00,0.20,12.00,'2026-01-01',1
WHERE NOT EXISTS (
  SELECT 1 FROM ai_model_pricing
  WHERE provider = 'openai' AND model = 'gpt-5.6-terra'
);
