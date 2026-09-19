-- Sprint 16 — Motor de Processos (fundação)
CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sector TEXT,
  status TEXT NOT NULL DEFAULT 'ATIVO' CHECK(status IN ('ATIVO','INATIVO')),
  responsible_user_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (responsible_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_processes_tenant ON processes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_processes_tenant_company ON processes(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS process_steps (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  step_order INTEGER NOT NULL DEFAULT 1,
  responsible_user_id TEXT,
  due_offset_days INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (responsible_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_process_steps_process ON process_steps(process_id, step_order);
CREATE INDEX IF NOT EXISTS idx_process_steps_tenant ON process_steps(tenant_id);

CREATE TABLE IF NOT EXISTS process_occurrences (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  competence TEXT NOT NULL,
  competence_year INTEGER NOT NULL,
  competence_month INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','EM_ANDAMENTO','CONCLUIDA','CANCELADA')),
  responsible_user_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES processes(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (responsible_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_process_occurrences_unique_competence
  ON process_occurrences(process_id, competence);
CREATE INDEX IF NOT EXISTS idx_process_occurrences_tenant ON process_occurrences(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_process_occurrences_company ON process_occurrences(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS process_occurrence_steps (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL,
  process_id TEXT NOT NULL,
  source_step_id TEXT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  step_order INTEGER NOT NULL DEFAULT 1,
  responsible_user_id TEXT,
  due_offset_days INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','EM_ANDAMENTO','CONCLUIDA','BLOQUEADA','CANCELADA')),
  started_at TEXT,
  started_by TEXT,
  completed_at TEXT,
  completed_by TEXT,
  observation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (occurrence_id) REFERENCES process_occurrences(id) ON DELETE CASCADE,
  FOREIGN KEY (process_id) REFERENCES processes(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (responsible_user_id) REFERENCES users(id),
  FOREIGN KEY (started_by) REFERENCES users(id),
  FOREIGN KEY (completed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_process_occurrence_steps_occ ON process_occurrence_steps(occurrence_id, step_order);
CREATE INDEX IF NOT EXISTS idx_process_occurrence_steps_tenant ON process_occurrence_steps(tenant_id);
