'use strict';

/**
 * Sprint 40.3 — verifica higiene do pacote dist-production/
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-production');
let failed = false;

function fail(msg) {
  console.log('FAIL', msg);
  failed = true;
}
function pass(msg) {
  console.log('PASS', msg);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(path.relative(DIST, p).replace(/\\/g, '/'));
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  fail('dist-production/ ausente — rode npm run build:production');
  process.exit(2);
}

const files = walk(DIST);
pass('arquivos=' + files.length);

const banned = [
  /^node_modules(\/|$)/,
  /^\.env$/i,
  /^\.env\.(?!example$|production\.example$)/i,
  /\.db$/i,
  /\.db-wal$/i,
  /\.db-shm$/i,
  /\.sqlite/i,
  /^uploads\/(?!\.gitkeep$)/,
  /^exports\/(?!\.gitkeep$)/,
  /^backups\/(?!\.gitkeep$)/,
  /^logs\/(?!\.gitkeep$)/,
  /credentials\.json$/i,
  /test-output\.txt$/i
];

for (const f of files) {
  // Placeholders vazios de diretório são permitidos
  if (/(^|\/)\.gitkeep$/.test(f)) continue;
  // Exemplos versionáveis de env são permitidos
  if (f === '.env.example' || f === '.env.production.example') continue;
  if (banned.some((re) => re.test(f))) fail('artefato indevido: ' + f);
}

if (fs.existsSync(path.join(DIST, 'node_modules'))) fail('node_modules presente');
else pass('sem node_modules');

if (fs.existsSync(path.join(DIST, '.env'))) fail('.env presente');
else pass('sem .env');

const required = [
  'package.json',
  'backend/src/server.js',
  'frontend/public/index.html',
  'database/schema/040_user_access_pin.sql',
  'scripts/prepare-production-database.js',
  'scripts/validate-production-database.js',
  'scripts/preflight-production.js',
  'docs/DEPLOY-PRODUCAO.md',
  '.env.production.example'
];
for (const r of required) {
  if (!fs.existsSync(path.join(DIST, r))) fail('faltando ' + r);
  else pass('tem ' + r);
}

console.log('STATUS:', failed ? 'FAIL' : 'PASS');
process.exit(failed ? 2 : 0);
