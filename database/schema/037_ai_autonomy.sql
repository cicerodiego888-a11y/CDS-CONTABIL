-- Sprint autonomia IA: coluna em tenant_ai_settings (também via ensureColumn).
-- Default ASSISTED_50 — não ativa 98% silenciosamente.

-- SQLite: ADD COLUMN é idempotente via applySchema/ensureColumn no boot.
-- Este arquivo documenta a migração lógica.

-- ALTER TABLE tenant_ai_settings ADD COLUMN autonomy_mode TEXT NOT NULL DEFAULT 'ASSISTED_50';
