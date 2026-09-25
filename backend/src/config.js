'use strict';

const path = require('path');

const WEAK_JWT = new Set([
  '',
  'cds-contabil-connect-change-this-secret',
  'cds-dev-only-not-for-production',
  'troque-esta-chave-por-uma-chave-aleatoria-e-secreta',
  'troque-esta-chave-em-producao'
]);

const DEV_JWT = 'cds-dev-only-not-for-production';
const DEV_DOC_KEY = 'cds-dev-document-key-not-for-production-32b';
const DEV_AI_CRED_KEY = 'cds-dev-ai-credential-key-not-for-production!!';

function flag(v) {
  return /^(1|true|yes|on)$/i.test(String(v || '').trim());
}

function isLocalhostUrl(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return false;
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(s)
    || s.includes('://localhost')
    || s.includes('://127.0.0.1');
}

function parseCorsOrigins(value) {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
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

function isPrivateHostname(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function assertProductionPublicUrl(env) {
  const url = String(env.CDS_OFFICE_PUBLIC_URL || env.PUBLIC_OFFICE_URL || '').trim();
  if (!url) {
    throw new Error('CDS_OFFICE_PUBLIC_URL is required in production.');
  }
  if (isLocalhostUrl(url)) {
    throw new Error('CDS_OFFICE_PUBLIC_URL cannot use localhost in production.');
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error('CDS_OFFICE_PUBLIC_URL must be an absolute https URL in production.');
  }
  try {
    const u = new URL(url);
    if (isPrivateHostname(u.hostname)) {
      throw new Error('CDS_OFFICE_PUBLIC_URL cannot use a private host in production.');
    }
  } catch (e) {
    if (e && /CDS_OFFICE_PUBLIC_URL/.test(String(e.message || ''))) throw e;
    throw new Error('CDS_OFFICE_PUBLIC_URL must be a valid absolute https URL in production.');
  }
  return url.replace(/\/$/, '');
}

function assertProductionCors(env) {
  const raw = String(env.CDS_CORS_ORIGIN || '').trim();
  const origins = parseCorsOrigins(raw);
  if (!origins.length) {
    throw new Error('CDS_CORS_ORIGIN is required in production.');
  }
  if (origins.some((o) => o === '*' || o.includes('*'))) {
    throw new Error('CDS_CORS_ORIGIN cannot use wildcard (*) in production.');
  }
  if (origins.some((o) => isLocalhostUrl(o))) {
    throw new Error('CDS_CORS_ORIGIN cannot use localhost in production.');
  }
  return origins;
}

function resolveClientPort(env) {
  if (env.CLIENT_PORT === '' || env.CLIENT_PORT === '0') return 0;
  return Number(env.CLIENT_PORT || Number(env.PORT || 3333) + 1);
}

function loadConfig(env = process.env) {
  const ROOT = path.resolve(__dirname, '../..');
  try {
    require('dotenv').config({ path: path.resolve(ROOT, '.env') });
  } catch { /* dotenv optional in constrained environments */ }

  const {
    resolveNetworkMode,
    assertLanAllowed
  } = require('./network-mode');

  const NODE_ENV = String(env.NODE_ENV || 'development').trim() || 'development';
  const IS_PROD = NODE_ENV === 'production';
  const DEMO_MODE = flag(env.DEMO_MODE);
  const NETWORK_MODE = resolveNetworkMode(env);

  if (IS_PROD && DEMO_MODE) {
    throw new Error('DEMO_MODE cannot be enabled when NODE_ENV=production.');
  }

  const JWT_SECRET = resolveJwtSecret(env, IS_PROD);
  const DOCUMENT_ENCRYPTION_KEY = resolveDocumentKey(env, IS_PROD);
  const DOCUMENT_ENCRYPTION_KID = String(env.DOCUMENT_ENCRYPTION_KID || 'v1').trim() || 'v1';
  const AI_CREDENTIAL_ENCRYPTION_KEY = resolveAiCredentialKey(env, IS_PROD);

  let CORS_ORIGIN = String(env.CDS_CORS_ORIGIN || '');
  let OFFICE_PUBLIC_URL = String(env.CDS_OFFICE_PUBLIC_URL || env.PUBLIC_OFFICE_URL || '').trim();
  if (IS_PROD) {
    OFFICE_PUBLIC_URL = assertProductionPublicUrl(env);
    CORS_ORIGIN = assertProductionCors(env).join(',');
  }

  const CDS_DB_PATH = env.CDS_DB_PATH || path.join(ROOT, 'database', 'cds-contabil-connect.db');
  const UPLOAD_DIR = env.UPLOAD_DIR || path.join(ROOT, 'uploads');
  const EXPORT_DIR = env.EXPORT_DIR || path.join(ROOT, 'exports');
  const BACKUP_DIR = env.BACKUP_DIR || path.join(ROOT, 'backups');
  const PUBLIC_DIR = path.join(ROOT, 'frontend', 'public');
  const CLIENT_PORT = resolveClientPort(env);

  assertLanAllowed({
    networkMode: NETWORK_MODE,
    isProd: IS_PROD,
    dbPath: CDS_DB_PATH,
    root: ROOT
  });

  return {
    ROOT,
    NODE_ENV,
    IS_PROD,
    DEMO_MODE,
    NETWORK_MODE,
    PORT: Number(env.PORT || 3333),
    CLIENT_PORT,
    CDS_DB_PATH,
    UPLOAD_DIR,
    EXPORT_DIR,
    BACKUP_DIR,
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
    CORS_ORIGIN,
    OFFICE_PUBLIC_URL
  };
}

module.exports = {
  loadConfig,
  resolveJwtSecret,
  resolveDocumentKey,
  resolveAiCredentialKey,
  resolveClientPort,
  assertProductionPublicUrl,
  assertProductionCors,
  isLocalhostUrl,
  isPrivateHostname,
  parseCorsOrigins,
  DEV_DOC_KEY,
  DEV_AI_CRED_KEY,
  DEV_JWT
};
