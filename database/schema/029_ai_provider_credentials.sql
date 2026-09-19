-- Sprint 27.1 — cofre de credencial do provider de IA (instalação).
-- Armazena somente ciphertext AES-256-GCM. A master key fica fora do banco.
CREATE TABLE IF NOT EXISTS ai_provider_credentials(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openai',
  encrypted_api_key TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_tag TEXT NOT NULL,
  key_salt TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  last4 TEXT,
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK(status IN('configured','invalid','removed')),
  last_tested_at TEXT,
  last_test_status TEXT
    CHECK(last_test_status IS NULL OR last_test_status IN('success','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_credentials_provider
  ON ai_provider_credentials(provider);
