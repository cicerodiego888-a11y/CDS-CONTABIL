'use strict';

/**
 * Sprint 40.1 — gera dist-production/ sem node_modules, .env, banco nem uploads.
 * Não altera o projeto original.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-production');

const INCLUDE = [
  'backend',
  'frontend',
  'database/schema',
  'scripts/preflight-production.js',
  'scripts/prepare-production-database.js',
  'scripts/validate-production-database.js',
  'scripts/lib/production-database.js',
  'scripts/check-production-package.js',
  'scripts/smoke-production.js',
  'scripts/setup.js',
  'scripts/db-integrity.js',
  'scripts/backup.js',
  'scripts/restore.js',
  'deploy/nginx/cds-contabil.conf.example',
  'deploy/systemd/cds-contabil.service.example',
  'package.json',
  'package-lock.json',
  '.env.example',
  '.env.production.example',
  'README.md',
  'docs/V1.0-CERTIFICATION.md',
  'docs/PRODUCAO-BANCO.md',
  'docs/PRODUCAO-SECRETS.md',
  'docs/DEPLOY-PRODUCAO.md',
  'docs/BACKUP-PRODUCAO.md'
];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist-production',
  'uploads',
  'exports',
  'backups',
  'logs',
  'agent-transcripts',
  'coverage',
  '.cursor'
]);

const SKIP_FILE_RE = [
  /^\.env$/i,
  /^\.env\.(?!example$|production\.example$)/i,
  /\.db$/i,
  /\.db-wal$/i,
  /\.db-shm$/i,
  /\.sqlite$/i,
  /\.zip$/i,
  /credentials\.json$/i,
  /\.pem$/i,
  /\.key$/i
];

function shouldSkipFile(name) {
  return SKIP_FILE_RE.some((re) => re.test(name));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyTree(src, dest) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isFile()) {
    if (shouldSkipFile(path.basename(src))) return;
    copyFile(src, dest);
    return;
  }
  ensureDir(dest);
  for (const name of fs.readdirSync(src)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (shouldSkipFile(name)) continue;
    copyTree(path.join(src, name), path.join(dest, name));
  }
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  rimraf(OUT);
  ensureDir(OUT);

  for (const rel of INCLUDE) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      console.warn('SKIP missing', rel);
      continue;
    }
    const dest = path.join(OUT, rel);
    copyTree(src, dest);
  }

  // Placeholder dirs (vazios) para o host criar volumes
  for (const d of ['uploads', 'exports', 'backups', 'logs', 'database']) {
    ensureDir(path.join(OUT, d));
    fs.writeFileSync(path.join(OUT, d, '.gitkeep'), '');
  }

  // README de deploy mínimo
  fs.writeFileSync(path.join(OUT, 'DEPLOY.md'), [
    '# CDS Contábil Connect — pacote de produção',
    '',
    '1. Copie `.env.production.example` para `.env` e preencha segredos.',
    '2. `npm ci --omit=dev` (ou `npm install --omit=dev`).',
    '3. `npm run preflight:production`',
    '4. `npm start`',
    '',
    'Não inclua `node_modules`, `.env`, banco SQLite nem uploads neste pacote.',
    ''
  ].join('\n'));

  console.log('Pacote gerado em dist-production/');
}

main();
