-- Esteira: NEEDS_CLASSIFICATION → PENDING → POSTED (ou REJECTED → NEEDS_CLASSIFICATION).
-- PENDING no banco = PENDING_APPROVAL. Sem estado operacional APPROVED.
-- posted_at/posted_by/generated_by_workflow via ensureColumn no boot (não editar 001).
CREATE INDEX IF NOT EXISTS idx_entries_tenant_status ON entries(tenant_id,company_id,status);
