-- Sprint 36.1: código interno do cliente (CLI-000001) por tenant.
-- A coluna companies.codigo_cliente é adicionada via ensureColumn em database.js
-- (antes do índice único).

CREATE TABLE IF NOT EXISTS tenant_client_code_seq (
  tenant_id TEXT PRIMARY KEY,
  next_num INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
