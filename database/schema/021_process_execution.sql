-- Sprint 17 — Execução e checklist.
-- Colunas são aplicadas de forma idempotente por database.js para bancos existentes.
CREATE INDEX IF NOT EXISTS idx_process_occurrence_steps_due
  ON process_occurrence_steps(tenant_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_process_occurrence_steps_status
  ON process_occurrence_steps(occurrence_id, status, step_order);
