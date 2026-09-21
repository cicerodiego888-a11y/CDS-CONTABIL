-- Sprint 28.4 — metadados de logo em tenant_branding (tabela criada em 013).
-- Colunas aplicadas também via ensureColumn no boot para bases já existentes.
-- SQLite: ADD COLUMN é idempotente apenas via ensureColumn; aqui documentamos o contrato.
-- logo_size INTEGER
-- logo_updated_at TEXT
SELECT 1;
