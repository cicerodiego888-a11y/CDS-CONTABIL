'use strict';

/**
 * Sprint 40.1 — preflight de produção.
 * Saída: apenas linhas PASS / WARN / FAIL (nunca imprime valores de segredos).
 */

const fs = require('fs');
const path = require('path');
  const {
  isLocalhostUrl,
  isPrivateHostname,
  parseCorsOrigins
} = require('../backend/src/config');
const { isUnsafePublicUrl } = require('../backend/src/public-urls');

const ROOT = path.resolve(__dirname, '..');
const results = [];

function note(level, code, detail) {
  results.push({ level, code, detail: detail || '' });
  const line = detail ? `${level} ${code} — ${detail}` : `${level} ${code}`;
  console.log(line);
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function dirHasEntries(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((name) => name !== '.gitkeep');
  } catch {
    return false;
  }
}

function loadDotEnv(filePath) {
  const out = {};
  if (!exists(filePath)) return out;
  const text = readText(filePath);
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function flag(v) {
  return /^(1|true|yes|on)$/i.test(String(v || '').trim());
}

function weakJwt(s) {
  const weak = new Set([
    '',
    'cds-contabil-connect-change-this-secret',
    'cds-dev-only-not-for-production',
    'troque-esta-chave-por-uma-chave-aleatoria-e-secreta',
    'troque-esta-chave-em-producao'
  ]);
  return !s || weak.has(s) || s.length < 16;
}

function main() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
  } catch { /* optional */ }

  const env = { ...loadDotEnv(path.join(ROOT, '.env')), ...process.env };
  const fileEnv = loadDotEnv(path.join(ROOT, '.env'));

  // --- Repo hygiene ---
  if (!exists(path.join(ROOT, '.env.example'))) note('FAIL', 'ENV_EXAMPLE_MISSING', '.env.example ausente');
  else note('PASS', 'ENV_EXAMPLE', 'presente');

  if (!exists(path.join(ROOT, '.env.production.example'))) note('FAIL', 'ENV_PRODUCTION_EXAMPLE_MISSING', '.env.production.example ausente');
  else note('PASS', 'ENV_PRODUCTION_EXAMPLE', 'presente');

  if (!exists(path.join(ROOT, '.env'))) note('WARN', 'ENV_FILE_MISSING', '.env real não encontrado (necessário no host)');
  else note('PASS', 'ENV_FILE', 'presente (valores não exibidos)');

  const gi = readText(path.join(ROOT, '.gitignore'));
  const needGi = ['.env', '.env.*', '!.env.example', '!.env.production.example', 'database/**/*.db', 'node_modules/', 'uploads/*', 'exports/*', 'backups/*', 'logs/*', 'test-output.txt'];
  const missingGi = needGi.filter((x) => !gi.includes(x));
  if (missingGi.length) note('FAIL', 'GITIGNORE', 'faltam regras: ' + missingGi.join(', '));
  else note('PASS', 'GITIGNORE', 'regras de produção presentes');

  const example = readText(path.join(ROOT, '.env.example'));
  const prodExample = readText(path.join(ROOT, '.env.production.example'));
  if (/DB_FILE=/.test(example) || /DB_FILE=/.test(prodExample)) note('FAIL', 'DB_FILE', 'DB_FILE ainda documentado');
  else note('PASS', 'DB_FILE', 'não utilizado');

  if (/SMTP_HOST=/.test(example)) note('WARN', 'SMTP_LEGACY', 'SMTP_HOST ainda em .env.example; preferir CDS_EMAIL_*');
  else note('PASS', 'EMAIL_VARS', 'exemplo usa CDS_EMAIL_*');

  const secretLeakPatterns = [
    /sk-[a-zA-Z0-9]{20,}/,
    /AIza[0-9A-Za-z\-_]{20,}/,
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
    /xox[baprs]-[0-9A-Za-z-]{10,}/
  ];
  const versioned = [example, prodExample, readText(path.join(ROOT, 'backend/src/config.js'))].join('\n');
  if (secretLeakPatterns.some((re) => re.test(versioned))) note('FAIL', 'SECRET_IN_REPO', 'possível segredo em arquivo versionável');
  else note('PASS', 'SECRET_IN_REPO', 'exemplos sem segredos reais detectados');

  // --- Runtime / production readiness ---
  const nodeEnv = String(env.NODE_ENV || 'development').trim() || 'development';
  if (nodeEnv !== 'production') note('FAIL', 'NODE_ENV', 'deve ser production para hospedagem (atual ≠ production)');
  else note('PASS', 'NODE_ENV', 'production');

  if (flag(env.DEMO_MODE)) note('FAIL', 'DEMO_MODE', 'não pode estar ativo em produção');
  else note('PASS', 'DEMO_MODE', 'desligado');

  if (weakJwt(String(env.JWT_SECRET || '').trim())) note('FAIL', 'JWT_SECRET', 'ausente ou fraco');
  else note('PASS', 'JWT_SECRET', 'definido');

  const docKey = String(env.DOCUMENT_ENCRYPTION_KEY || '').trim();
  if (!docKey || docKey.length < 32) note('FAIL', 'DOCUMENT_ENCRYPTION_KEY', 'ausente ou curta');
  else note('PASS', 'DOCUMENT_ENCRYPTION_KEY', 'definida');

  if (!String(env.CDS_DB_PATH || '').trim() && !exists(path.join(ROOT, 'database', 'cds-contabil-connect.db'))) {
    note('WARN', 'CDS_DB_PATH', 'caminho padrão; confirme no host');
  } else note('PASS', 'CDS_DB_PATH', 'configurado ou banco local presente');

  for (const [key, defRel] of [['UPLOAD_DIR', 'uploads'], ['EXPORT_DIR', 'exports'], ['BACKUP_DIR', 'backups']]) {
    const dir = path.resolve(ROOT, env[key] || path.join(ROOT, defRel));
    try {
      fs.mkdirSync(dir, { recursive: true });
      note('PASS', key, 'diretório disponível');
    } catch {
      note('FAIL', key, 'não foi possível garantir diretório');
    }
  }

  const officeUrl = String(env.CDS_OFFICE_PUBLIC_URL || '').trim();
  if (!officeUrl) note('FAIL', 'CDS_OFFICE_PUBLIC_URL', 'obrigatória');
  else if (isLocalhostUrl(officeUrl) || isUnsafePublicUrl(officeUrl)) note('FAIL', 'CDS_OFFICE_PUBLIC_URL', 'localhost/privado não permitido');
  else if (!/^https:\/\//i.test(officeUrl)) note('FAIL', 'CDS_OFFICE_PUBLIC_URL', 'deve ser HTTPS');
  else {
    try {
      const u = new URL(officeUrl);
      if (isPrivateHostname(u.hostname)) note('FAIL', 'CDS_OFFICE_PUBLIC_URL', 'host privado não permitido');
      else note('PASS', 'CDS_OFFICE_PUBLIC_URL', 'HTTPS pública válida');
    } catch {
      note('FAIL', 'CDS_OFFICE_PUBLIC_URL', 'URL inválida');
    }
  }

  const emailAppUrl = String(env.CDS_EMAIL_APP_URL || '').trim();
  if (!emailAppUrl) note('PASS', 'CDS_EMAIL_APP_URL', 'opcional — usa CDS_OFFICE_PUBLIC_URL');
  else if (isUnsafePublicUrl(emailAppUrl)) note('FAIL', 'CDS_EMAIL_APP_URL', 'localhost/privado não permitido em produção');
  else note('PASS', 'CDS_EMAIL_APP_URL', 'definida e segura');

  const cors = parseCorsOrigins(env.CDS_CORS_ORIGIN);
  if (!cors.length) note('FAIL', 'CDS_CORS_ORIGIN', 'obrigatória');
  else if (cors.some((o) => o === '*' || o.includes('*'))) note('FAIL', 'CDS_CORS_ORIGIN', 'wildcard (*) não permitido');
  else if (cors.some((o) => isLocalhostUrl(o))) note('FAIL', 'CDS_CORS_ORIGIN', 'localhost não permitido');
  else note('PASS', 'CDS_CORS_ORIGIN', 'definida');

  if (!flag(env.CDS_AUTH_COOKIE)) note('WARN', 'CDS_AUTH_COOKIE', 'recomendado true em produção');
  else note('PASS', 'CDS_AUTH_COOKIE', 'true');

  const clientPort = env.CLIENT_PORT === '' || env.CLIENT_PORT === '0' ? 0 : Number(env.CLIENT_PORT);
  if (Number.isNaN(clientPort)) note('FAIL', 'CLIENT_PORT', 'inválido');
  else if (clientPort === 0) note('PASS', 'CLIENT_PORT', '0 (portal no mesmo servidor)');
  else note('WARN', 'CLIENT_PORT', 'porta secundária ativa; em produção prefira 0');

  const emailProvider = String(env.CDS_EMAIL_PROVIDER || '').trim().toLowerCase();
  const smtpOk = env.CDS_EMAIL_HOST && env.CDS_EMAIL_USER && env.CDS_EMAIL_PASSWORD && env.CDS_EMAIL_FROM;
  if (emailProvider === 'smtp' || emailProvider === '') {
    if (!smtpOk) note('WARN', 'SMTP', 'SMTP incompleto (convites/recuperação podem falhar)');
    else note('PASS', 'SMTP', 'campos básicos presentes');
  } else if (emailProvider === 'off') note('WARN', 'SMTP', 'provider off');
  else note('PASS', 'SMTP', 'provider=' + emailProvider);

  // --- Deploy package hygiene ---
  const dist = path.join(ROOT, 'dist-production');
  if (exists(dist)) {
    if (exists(path.join(dist, 'node_modules'))) note('FAIL', 'DIST_NODE_MODULES', 'node_modules presente no pacote');
    else note('PASS', 'DIST_NODE_MODULES', 'ausente');
    if (exists(path.join(dist, '.env'))) note('FAIL', 'DIST_ENV', '.env presente no pacote');
    else note('PASS', 'DIST_ENV', 'ausente');
    for (const name of ['uploads', 'exports', 'backups', 'logs']) {
      if (dirHasEntries(path.join(dist, name))) note('FAIL', 'DIST_' + name.toUpperCase(), name + '/ com conteúdo no pacote');
      else note('PASS', 'DIST_' + name.toUpperCase(), 'limpo ou ausente');
    }
    const dbFiles = [];
    const dbDir = path.join(dist, 'database');
    if (exists(dbDir)) {
      for (const f of fs.readdirSync(dbDir)) {
        if (/\.db(-wal|-shm)?$/i.test(f)) dbFiles.push(f);
      }
    }
    if (dbFiles.length) note('FAIL', 'DIST_DB', 'arquivos de banco no pacote');
    else note('PASS', 'DIST_DB', 'sem .db no pacote');
  } else {
    note('WARN', 'DIST_PACKAGE', 'dist-production/ ainda não gerado (rode scripts/build-production-package.js)');
  }

  // node_modules no projeto de desenvolvimento é esperado
  if (exists(path.join(ROOT, 'node_modules'))) note('PASS', 'DEV_NODE_MODULES', 'presente apenas no ambiente de desenvolvimento');
  else note('WARN', 'DEV_NODE_MODULES', 'ausente — rode npm install antes de desenvolver');

  // Garantia: não vazou segredo na saída
  const dumped = results.map((r) => r.detail).join(' ');
  const secretVals = [
    fileEnv.JWT_SECRET,
    fileEnv.DOCUMENT_ENCRYPTION_KEY,
    fileEnv.CDS_EMAIL_PASSWORD,
    fileEnv.OPENAI_API_KEY,
    fileEnv.WEB_PUSH_VAPID_PRIVATE_KEY,
    fileEnv.AI_CREDENTIAL_ENCRYPTION_KEY
  ].filter((v) => v && String(v).length >= 8);
  for (const secret of secretVals) {
    if (dumped.includes(secret)) {
      note('FAIL', 'SECRET_LEAK', 'saída do preflight continha valor sensível');
      break;
    }
  }

  const failed = results.some((r) => r.level === 'FAIL');
  const warned = results.some((r) => r.level === 'WARN');
  process.exitCode = failed ? 2 : warned ? 1 : 0;
}

main();
