'use strict';

const path = require('path');

const WEAK_JWT = new Set([
  '',
  'cds-contabil-connect-change-this-secret',
  'cds-dev-only-not-for-production',
  'troque-esta-chave-por-uma-chave-aleatoria-e-secreta'
]);

const DEV_JWT = 'cds-dev-only-not-for-production';
const DEV_DOC_KEY = 'cds-dev-document-key-not-for-production-32b';
const DEV_AI_CRED_KEY = 'cds-dev-ai-credential-key-not-for-production!!';

function flag(v) {
  return /^(1|true|yes|on)$/i.test(String(v || '').trim());
}

function resolveJwtSecret(env, isProd) {
  const s = String(env.JWT_SECRET || '').trim();
  if (isProd) {
    if (!s || WEAK_JWT.has(s) || s.length < 16) {
      throw new Error('JWT_SECRET is required in production and must be a strong secret (min 16 chars).');
    }
    return s;
  }
  return s || DEV_JWT;
}

function resolveDocumentKey(env, isProd) {
  const s = String(env.DOCUMENT_ENCRYPTION_KEY || '').trim();
  if (isProd) {
    if (!s || s === DEV_DOC_KEY || s.length < 32) {
      throw new Error('DOCUMENT_ENCRYPTION_KEY is required in production (min 32 chars).');
    }
    return s;
  }
  return s || DEV_DOC_KEY;
}

function resolveAiCredentialKey(env, isProd) {
  const s = String(env.AI_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (isProd) {
    // Em produção a master key só é obrigatória se houver credencial no cofre
    // (validado no serviço). Aqui apenas rejeita chave fraca quando informada.
    if (s && (s === DEV_AI_CRED_KEY || s.length < 32)) {
      throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY must be a strong secret in production (min 32 chars).');
    }
    return s;
  }
  return s || DEV_AI_CRED_KEY;
}

function loadConfig(env = process.env) {
  const ROOT = path.resolve(__dirname, '../..');
  try {
    require('dotenv').config({ path: path.resolve(ROOT, '.env') });
  } catch { /* dotenv optional in constrained environments */ }

  const NODE_ENV = String(env.NODE_ENV || 'development').trim() || 'development';
  const IS_PROD = NODE_ENV === 'production';
  const DEMO_MODE = flag(env.DEMO_MODE);

  if (IS_PROD && DEMO_MODE) {
    throw new Error('DEMO_MODE cannot be enabled when NODE_ENV=production.');
  }

  const JWT_SECRET = resolveJwtSecret(env, IS_PROD);
  const DOCUMENT_ENCRYPTION_KEY = resolveDocumentKey(env, IS_PROD);
  const DOCUMENT_ENCRYPTION_KID = String(env.DOCUMENT_ENCRYPTION_KID || 'v1').trim() || 'v1';
  const AI_CREDENTIAL_ENCRYPTION_KEY = resolveAiCredentialKey(env, IS_PROD);

  const CDS_DB_PATH = env.CDS_DB_PATH || path.join(ROOT, 'database', 'cds-contabil-connect.db');
  const UPLOAD_DIR = env.UPLOAD_DIR || path.join(ROOT, 'uploads');
  const EXPORT_DIR = env.EXPORT_DIR || path.join(ROOT, 'exports');
  const PUBLIC_DIR = path.join(ROOT, 'frontend', 'public');

  return {
    ROOT,
    NODE_ENV,
    IS_PROD,
    DEMO_MODE,
    PORT: Number(env.PORT || 3333),
    CLIENT_PORT: env.CLIENT_PORT === '' || env.CLIENT_PORT === '0' ? 0 : Number(env.CLIENT_PORT || Number(env.PORT || 3333) + 1),
    CDS_DB_PATH,
    UPLOAD_DIR,
    EXPORT_DIR,
    PUBLIC_DIR,
    JWT_SECRET,
    DOCUMENT_ENCRYPTION_KEY,
    DOCUMENT_ENCRYPTION_KID,
    AI_CREDENTIAL_ENCRYPTION_KEY,
    AI_PROVIDER: String(env.AI_PROVIDER || 'off').trim().toLowerCase() || 'off',
    AI_ENABLED: flag(env.AI_ENABLED),
    OPENAI_API_KEY: String(env.OPENAI_API_KEY || ''),
    AI_MODEL: String(env.AI_MODEL || 'gpt-5.6-terra').trim() || 'gpt-5.6-terra',
    OPENAI_BASE_URL: String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim(),
    AI_TIMEOUT_MS: Math.max(1000, Number(env.AI_TIMEOUT_MS || 30000)),
    AI_DEBUG: flag(env.AI_DEBUG),
    AUTH_COOKIE: flag(env.CDS_AUTH_COOKIE),
    CORS_ORIGIN: String(env.CDS_CORS_ORIGIN || '')
  };
}

module.exports = {
  loadConfig,
  resolveJwtSecret,
  resolveDocumentKey,
  resolveAiCredentialKey,
  DEV_DOC_KEY,
  DEV_AI_CRED_KEY,
  DEV_JWT
};
