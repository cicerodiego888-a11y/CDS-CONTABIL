'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const cp = require('child_process');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s15-'));
process.env.CDS_DB_PATH = path.join(tmp, 's15.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-15-cert-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.DEMO_MODE = 'false';

const { app, db, documentStorage } = require('../backend/src/server');
const { loadConfig } = require('../backend/src/config');
const { MAGIC } = require('../backend/src/documents/crypto');
const root = path.resolve(__dirname, '..');
const password = 'Senha@123';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let server, base, ownerA, ownerB, staffA, companyA, companyB, adminA, financeA, viewerA, clientB;

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  const r = await req('POST', '/api/invitations/' + token + '/accept', { name, password, confirmation: password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

function leak(obj) {
  return JSON.stringify(obj || {});
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await req('POST', '/api/auth/register', { name: 'Cert A', email: 'owner.a.s15@test.local', password, tenantName: 'Tenant Cert A' });
  ownerA = (await req('POST', '/api/auth/login', { email: 'owner.a.s15@test.local', password, tenant: a.data.tenant_slug })).data;
  const b = await req('POST', '/api/auth/register', { name: 'Cert B', email: 'owner.b.s15@test.local', password, tenantName: 'Tenant Cert B' });
  ownerB = (await req('POST', '/api/auth/login', { email: 'owner.b.s15@test.local', password, tenant: b.data.tenant_slug })).data;
  await req('POST', '/api/usuarios', { name: 'Staff Cert', email: 'staff.s15@test.local', password, role: 'STAFF' }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', { email: 'staff.s15@test.local', password, tenant: a.data.tenant_slug })).data;
  companyA = (await req('POST', '/api/empresas', { name: 'Empresa A1 Cert', cnpj: '38204469000115' }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', { name: 'Empresa B1 Cert', cnpj: '11222333000181' }, ownerB.token)).data;
  adminA = await accept((await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Admin A', email: 'admin.s15@test.local', profile: 'CLIENT_ADMIN' }, ownerA.token)).data.invitation, 'Admin A');
  financeA = await accept((await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'Fin A', email: 'fin.s15@test.local', profile: 'CLIENT_FINANCE' }, ownerA.token)).data.invitation, 'Fin A');
  viewerA = await accept((await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'View A', email: 'view.s15@test.local', profile: 'CLIENT_VIEWER' }, ownerA.token)).data.invitation, 'View A');
  clientB = await accept((await req('POST', `/api/empresas/${companyB.id}/users`, { name: 'Admin B', email: 'adminb.s15@test.local', profile: 'CLIENT_ADMIN' }, ownerB.token)).data.invitation, 'Admin B');
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  try { db.close(); } catch {}
  await new Promise(resolve => setTimeout(resolve, 80));
  for (let i = 0; i < 8; i++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
});

test('produção recusa JWT fraco, chave documental curta e DEMO_MODE', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: '', CDS_DB_PATH: path.join(tmp, 'p.db') }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short', CDS_DB_PATH: path.join(tmp, 'p.db') }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'strong-secret-16+', DOCUMENT_ENCRYPTION_KEY: 'curta', CDS_DB_PATH: path.join(tmp, 'p.db') }), /DOCUMENT_ENCRYPTION_KEY/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', JWT_SECRET: 'strong-secret-16+', DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', DEMO_MODE: 'true', CDS_DB_PATH: path.join(tmp, 'p.db')
  }), /DEMO_MODE/);
  const ok = loadConfig({
    NODE_ENV: 'production', JWT_SECRET: 'strong-production-secret', DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', DEMO_MODE: 'false', CDS_DB_PATH: 'official.db'
  });
  assert.equal(ok.CDS_DB_PATH, 'official.db');
  assert.equal(ok.DEMO_MODE, false);
});

test('boot production sem JWT_SECRET falha com mensagem clara e sem vazamento', () => {
  const r = cp.spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='production';process.env.JWT_SECRET='';process.env.CDS_DB_PATH=require('os').tmpdir()+'/cds-s15-prod.db';try{require('./backend/src/server');process.exit(0)}catch(e){process.stderr.write(e.message);process.exit(2)}"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', DOCUMENT_ENCRYPTION_KEY: '', CDS_DB_PATH: path.join(os.tmpdir(), 'cds-s15-prod.db') },
    encoding: 'utf8'
  });
  assert.notEqual(r.status, 0);
  const out = String(r.stderr || '') + String(r.stdout || '');
  assert.match(out, /JWT_SECRET/);
  assert.doesNotMatch(out, /stack|at Object|password|DOCUMENT_ENCRYPTION_KEY=|Admin@123/i);
});

test('API padroniza 400/401/403/404/409/422 sem vazar segredo ou caminho físico', async () => {
  const bad = await req('POST', '/api/auth/login', { email: 'x', password: 'y', tenant: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'INVALID_CREDENTIALS');
  assert.doesNotMatch(leak(bad.data), /password_hash|stack|C:\\\\projetos|DOCUMENT_ENCRYPTION/i);

  const noAuth = await req('GET', '/api/empresas');
  assert.equal(noAuth.status, 401);

  const missing = await req('POST', '/api/despesas', { company_id: companyA.id }, ownerA.token);
  assert.equal(missing.status, 400);

  const forbidden = await req('GET', '/api/documentos', undefined, viewerA.token);
  assert.ok(forbidden.status === 403 || forbidden.status === 401);

  const nf = await req('GET', '/api/empresas/' + crypto.randomUUID(), undefined, ownerA.token);
  assert.equal(nf.status, 404);
  assert.doesNotMatch(leak(nf.data), /uploads[\\/]|storage_path|stack/i);

  await req('POST', '/api/empresas', { name: 'Dup CNPJ', cnpj: '38204469000115' }, ownerA.token).then(r => {
    assert.ok(r.status === 409 || r.status === 400, JSON.stringify(r.data));
  });

  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('not-a-pdf')], { type: 'text/plain' }), 'x.txt');
  fd.append('company_id', companyA.id);
  const invalid = await fetch(base + '/api/documentos/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerA.token }, body: fd });
  assert.equal(invalid.status, 422);
});

test('documentos: PDF/PNG relativos, criptografados, view/download, isolamento e exclusão lógica', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'cert.pdf');
  fd.append('company_id', companyA.id);
  const up = await fetch(base + '/api/documentos/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerA.token }, body: fd });
  const doc = await up.json();
  assert.equal(up.status, 201, JSON.stringify(doc));
  const row = db.prepare('SELECT * FROM documents WHERE id=?').get(doc.id);
  assert.match(String(row.storage_path).replace(/\\/g, '/'), /^documents\//);
  assert.ok(!path.isAbsolute(row.storage_path));
  assert.doesNotMatch(row.storage_path, /C:\\|D:\\|\/home\/|Users\\/i);
  const disk = fs.readFileSync(documentStorage.physical(row.storage_path));
  assert.ok(disk.subarray(0, MAGIC.length).equals(MAGIC));
  const view = await fetch(base + '/api/documentos/' + doc.id + '/view', { headers: { Authorization: 'Bearer ' + ownerA.token } });
  assert.equal(view.status, 200);
  assert.equal(Buffer.from(await view.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const dl = await fetch(base + '/api/documentos/' + doc.id + '/download', { headers: { Authorization: 'Bearer ' + ownerA.token } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /attachment/i);
  assert.equal((await fetch(base + '/api/documentos/' + doc.id + '/view', { headers: { Authorization: 'Bearer ' + ownerB.token } })).status, 404);
  assert.equal((await fetch(base + '/api/client/documentos/' + doc.id + '/view', { headers: { Authorization: 'Bearer ' + clientB.token } })).status, 404);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND action IN('DOCUMENT_VIEWED','DOCUMENT_DOWNLOADED')").get(doc.id).n >= 1);

  const imgFd = new FormData();
  imgFd.append('file', new Blob([png], { type: 'image/png' }), 'foto.png');
  const imgUp = await fetch(base + '/api/client/documentos', { method: 'POST', headers: { Authorization: 'Bearer ' + financeA.token }, body: imgFd });
  const img = await imgUp.json();
  assert.equal(imgUp.status, 201, JSON.stringify(img));
  const imgRow = db.prepare('SELECT storage_path FROM documents WHERE id=?').get(img.id);
  assert.match(String(imgRow.storage_path).replace(/\\/g, '/'), /^documents\//);

  const del = await req('DELETE', '/api/client/documentos/' + img.id, {}, financeA.token);
  assert.equal(del.status, 200);
  const gone = db.prepare('SELECT deleted_at FROM documents WHERE id=?').get(img.id);
  assert.ok(gone.deleted_at);
  assert.equal((await fetch(base + '/api/client/documentos/' + img.id + '/view', { headers: { Authorization: 'Bearer ' + financeA.token } })).status, 404);
});

test('perfis CLIENT e STAFF respeitam regras de credencial e operação', async () => {
  const dash = await req('GET', '/api/client/dashboard', undefined, viewerA.token);
  assert.equal(dash.status, 200);
  const create = await req('POST', '/api/client/despesas', { occurred_on: '2026-09-18', description: 'viewer-block', amount: '10,00', payment_method: 'PIX' }, viewerA.token);
  assert.equal(create.status, 403);

  const finExp = await req('POST', '/api/client/despesas', { occurred_on: '2026-09-18', description: 'fin-ok', amount: '12,00', payment_method: 'PIX' }, financeA.token);
  assert.equal(finExp.status, 201, JSON.stringify(finExp.data));

  const staffAdmin = await req('POST', `/api/empresas/${companyA.id}/users`, { name: 'X', email: 'x.admin.s15@test.local', profile: 'CLIENT_ADMIN' }, staffA.token);
  assert.equal(staffAdmin.status, 403);

  const users = await req('GET', `/api/empresas/${companyA.id}/users`, undefined, ownerA.token);
  const adminRow = users.data.find(x => x.email === 'admin.s15@test.local');
  assert.equal(adminRow.credential_status, 'CONFIGURADA');
  assert.equal(adminRow.password, undefined);
  const reveal = await req('POST', `/api/client-users/${adminRow.id}/password`, {}, ownerA.token);
  assert.equal(reveal.status, 403);
  assert.equal(reveal.data.error, 'PASSWORD_NOT_RECOVERABLE');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='SENSITIVE_DATA_ACCESSED' AND entity_id=?").get(adminRow.id).n >= 1);
});

test('isolamento tenant/company: despesa, receita, lançamento, notificação e IDs manuais', async () => {
  const exp = await req('POST', '/api/despesas', { company_id: companyA.id, occurred_on: '2026-09-18', description: 'iso-a', amount: '20,00', payment_method: 'PIX' }, ownerA.token);
  const rev = await req('POST', '/api/receitas', { company_id: companyA.id, occurred_on: '2026-09-18', description: 'rev-a', amount: '30,00', receipt_method: 'PIX' }, ownerA.token);
  assert.equal(exp.status, 201);
  assert.equal(rev.status, 201);
  const bExp = await req('GET', '/api/client/despesas', undefined, clientB.token);
  assert.equal(bExp.data.some(x => x.id === exp.data.id), false);
  const bRev = await req('GET', '/api/client/receitas', undefined, clientB.token);
  assert.equal(bRev.data.some(x => x.id === rev.data.id), false);
  const entryCross = await req('GET', '/api/lancamentos/' + (exp.data.entry_id || 'x'), undefined, ownerB.token);
  assert.ok(entryCross.status === 404 || entryCross.status === 403);
  const notes = await req('GET', '/api/client/notificacoes', undefined, clientB.token);
  assert.doesNotMatch(JSON.stringify(notes.data), new RegExp(companyA.id));
  const spoof = await req('GET', '/api/client/documentos/' + crypto.randomUUID(), undefined, clientB.token);
  assert.ok(spoof.status === 404 || spoof.status === 403);
  const companyHeader = await req('GET', '/api/despesas', undefined, ownerA.token, companyB.id);
  assert.ok(companyHeader.status === 404 || companyHeader.status === 403);
});

test('sessão revoke impede reuso; login/logout funcionam', async () => {
  const sess = (await req('POST', '/api/auth/login', { email: 'staff.s15@test.local', password, tenant: ownerA.user.tenant_slug })).data;
  assert.equal((await req('GET', '/api/auth/me', undefined, sess.token)).status, 200);
  assert.equal((await req('POST', '/api/auth/logout', { revoke: true }, sess.token)).status, 200);
  assert.equal((await req('GET', '/api/auth/me', undefined, sess.token)).status, 401);
});

test('backup/restore operacional: banco + documento relativo + integridade', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'restore.pdf');
  fd.append('company_id', companyA.id);
  const up = await fetch(base + '/api/documentos/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerA.token }, body: fd });
  const doc = await up.json();
  assert.equal(up.status, 201);
  const row = db.prepare('SELECT storage_path,sha256 FROM documents WHERE id=?').get(doc.id);
  assert.ok(row, 'documento deve persistir no banco de origem');
  db.pragma('wal_checkpoint(FULL)');

  const restoreDir = path.join(tmp, 'restore');
  fs.mkdirSync(path.join(restoreDir, 'uploads'), { recursive: true });
  const destDb = path.join(restoreDir, 'cds.db');
  await db.backup(destDb);
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, ent.name), b = path.join(to, ent.name);
      if (ent.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
    }
  };
  copyDir(process.env.UPLOAD_DIR, path.join(restoreDir, 'uploads'));
  const Database = require('better-sqlite3');
  const rdb = new Database(destDb);
  rdb.pragma('foreign_keys=ON');
  assert.equal(rdb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(rdb.prepare('PRAGMA foreign_key_check').all().length, 0);
  const restored = rdb.prepare('SELECT storage_path,sha256 FROM documents WHERE id=?').get(doc.id);
  assert.equal(restored.storage_path, row.storage_path);
  assert.equal(restored.sha256, row.sha256);
  assert.ok(!path.isAbsolute(restored.storage_path));
  const abs = path.join(restoreDir, 'uploads', restored.storage_path);
  assert.ok(fs.existsSync(abs));
  rdb.close();
});

test('frontend regressivo: áreas do núcleo permanecem no painel e no portal', () => {
  const office = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
  const portal = fs.readFileSync(path.join(root, 'frontend/public/portal/portal.js'), 'utf8');
  for (const token of ['login', 'dashboard', 'empresas', 'despesas', 'receitas', 'categorias', 'bancos', 'documentos', 'pendencias', 'solicitacoes', 'notificacoes', 'lancamentos', 'classificacao', 'aprovacao', 'exportacoes']) {
    assert.match(office, new RegExp(token));
  }
  assert.match(office, /CONFIGURADA|NÃO CONFIGURADA/);
  assert.match(office, /demo-hint/);
  assert.doesNotMatch(office, /value="admin@demo\.local"/);
  assert.match(portal, /Portal do cliente/);
  assert.match(portal, /Nova despesa/);
  assert.doesNotMatch(portal, /debit_account/);
});

test('repositório: zip ignorado, sem DB_FILE, .env.example sem segredo real', () => {
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gi, /\*\.zip/);
  assert.match(gi, /\.env/);
  assert.equal(fs.existsSync(path.join(root, 'backend.zip')), false);
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(example, /CDS_DB_PATH=/);
  assert.match(example, /DOCUMENT_ENCRYPTION_KEY=/);
  assert.match(example, /DEMO_MODE=/);
  assert.doesNotMatch(example, /DB_FILE=/);
  assert.doesNotMatch(example, /sk_live|AIza|-----BEGIN/);
  const cfg = fs.readFileSync(path.join(root, 'backend/src/config.js'), 'utf8');
  assert.match(cfg, /CDS_DB_PATH/);
  assert.doesNotMatch(cfg, /DB_FILE/);
});
