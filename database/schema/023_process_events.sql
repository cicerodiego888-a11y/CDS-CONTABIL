-- Sprint 19 — Idempotência dos eventos do Motor de Processos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_process_domain_events_unique_once
  ON domain_events(tenant_id,event_type,entity_type,entity_id)
  WHERE event_type IN(
    'PROCESS_OCCURRENCE_AUTO_CREATED',
    'PROCESS_OCCURRENCE_MANUALLY_CREATED',
    'PROCESS_STEP_OVERDUE'
  );

CREATE INDEX IF NOT EXISTS idx_process_events_occurrence
  ON domain_events(tenant_id,company_id,event_type,created_at);
