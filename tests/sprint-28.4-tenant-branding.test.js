'use strict';

/**
 * Sprint 28.4 — Identidade visual do escritório (tenant branding).
 * Logo pertence ao tenant; CLIENT apenas consome; login resolve por slug.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s284-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-28-4-tenant-branding';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }

const { app, db } = require('../backend/src/server');
const root = path.resolve(__dirname, '..');
const brandRoot = path.join(root, 'uploads', 'branding');

let server, base;
let ownerA, ownerB, ownerC, slugA, slugB, slugC;
let accA, staffA;
let clientAdmin, clientFinance, clientViewer;
let companyA;

const password = 'Senha@123';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pngB = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pngC = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const webp = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => {
    let data = null;
    try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  });
}

async function uploadLogo(token, buf, filename, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: type || 'image/png' }), filename);
  const r = await fetch(base + '/api/tenant/branding/logo', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  let data = null;
  try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data };
}

async function getOfficeLogo(token) {
  const r = await fetch(base + '/api/tenant/branding/logo', {
    headers: { Authorization: 'Bearer ' + (token || '') }
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, type: r.headers.get('content-type') };
}

async function getPublicLogo(slug) {
  const meta = await req('GET', '/api/public/branding?tenant=' + encodeURIComponent(slug));
  if (!meta.data || !meta.data.logo_url) return { status: meta.status, meta, buf: null };
  const r = await fetch(base + meta.data.logo_url);
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, meta, buf, type: r.headers.get('content-type'), logo_url: meta.data.logo_url };
}

async function accept(invite, name) {
  const token = invite.activation_url.split('/convite/')[1];
  const r = await req('POST', '/api/invitations/' + token + '/accept', {
    name, password, confirmation: password
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

async function registerOwner(email, tenantName) {
  const reg = await req('POST', '/api/auth/register', {
    name: 'Owner ' + tenantName, email, password, tenantName
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const login = await req('POST', '/api/auth/login', {
    email, password, tenant: reg.data.tenant_slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return { slug: reg.data.tenant_slug, ...login.data };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  ownerA = await registerOwner('owner.284.a@test.local', 'Escritório Alfa 284');
  slugA = ownerA.slug;
  ownerB = await registerOwner('owner.284.b@test.local', 'Escritório Beta 284');
  slugB = ownerB.slug;
  ownerC = await registerOwner('owner.284.c@test.local', 'Escritório Gama 284');
  slugC = ownerC.slug;

  const acc = await req('POST', '/api/usuarios', {
    name: 'Contador A', email: 'acc.284@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  accA = (await req('POST', '/api/auth/login', {
    email: 'acc.284@test.local', password, tenant: slugA
  })).data;

  const staff = await req('POST', '/api/usuarios', {
    name: 'Staff A', email: 'staff.284@test.local', password, role: 'STAFF'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.284@test.local', password, tenant: slugA
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Cliente Alfa 284', trade_name: 'Alfa', cnpj: '11222333000181'
  }, ownerA.token)).data;

  clientAdmin = await accept((await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Admin Cliente', email: 'cli.admin.284@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data.invitation, 'Admin Cliente');

  clientFinance = await accept((await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Fin Cliente', email: 'cli.fin.284@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token)).data.invitation, 'Fin Cliente');

  clientViewer = await accept((await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'View Cliente', email: 'cli.view.284@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data.invitation, 'View Cliente');
});

after(() => {
  const rows = db.prepare('SELECT logo_path FROM tenant_branding').all();
  for (const row of rows) {
    if (!row.logo_path) continue;
    try { fs.unlinkSync(path.join(brandRoot, row.logo_path)); } catch { /* */ }
  }
  server.close();
  try { db.close(); } catch { /* */ }
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }
});

test('1-4 GET branding sem logo (fallback CDS)', async () => {
  const r = await req('GET', '/api/tenant/branding', undefined, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.configured, false);
  assert.equal(r.data.has_logo, false);
  assert.equal(r.data.logo_url, null);
  assert.equal(r.data.logo_path, undefined);
  assert.ok(!JSON.stringify(r.data).includes(brandRoot));
  assert.ok(!JSON.stringify(r.data).includes('C:\\'));
});

test('5 OWNER cria branding (PNG)', async () => {
  const up = await uploadLogo(ownerA.token, png, 'logo-a.png', 'image/png');
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.configured, true);
  assert.equal(up.data.has_logo, true);
  assert.match(up.data.logo_url, /\/api\/tenant\/branding\/logo\?v=/);
  const row = db.prepare('SELECT * FROM tenant_branding WHERE tenant_id=?').get(ownerA.user.tenant_id);
  assert.equal(row.logo_path, ownerA.user.tenant_id + '/logo.png');
  assert.ok(fs.existsSync(path.join(brandRoot, row.logo_path)));
  assert.equal(row.logo_mime, 'image/png');
  assert.ok(Number(row.logo_size) > 0);
  assert.ok(row.logo_updated_at);
  const audit = db.prepare(
    "SELECT action FROM audit_logs WHERE tenant_id=? AND action LIKE 'TENANT_BRANDING_%' ORDER BY created_at DESC LIMIT 1"
  ).get(ownerA.user.tenant_id);
  assert.ok(audit && (audit.action === 'TENANT_BRANDING_CREATED' || audit.action === 'TENANT_BRANDING_UPDATED'));
});

test('2 OWNER atualiza branding (JPEG) e versiona cache', async () => {
  const before = await req('GET', '/api/tenant/branding', undefined, ownerA.token);
  const v1 = before.data.updated_at;
  await new Promise((r) => setTimeout(r, 20));
  const up = await uploadLogo(ownerA.token, jpg, 'marca.jpg', 'image/jpeg');
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.has_logo, true);
  assert.match(up.data.logo_url, /\?v=/);
  assert.notEqual(up.data.updated_at, v1);
  const logo = await getOfficeLogo(ownerA.token);
  assert.equal(logo.status, 200);
  assert.equal(logo.type, 'image/jpeg');
  assert.ok(logo.buf.equals(jpg));
  const audit = db.prepare(
    "SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action='TENANT_BRANDING_UPDATED'"
  ).get(ownerA.user.tenant_id);
  assert.ok(audit.n >= 1);
});

test('15-16 WEBP aceito; 17-19 inválidos rejeitados', async () => {
  const ok = await uploadLogo(ownerA.token, webp, 'logo.webp', 'image/webp');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.has_logo, true);

  const fakePng = await uploadLogo(ownerA.token, Buffer.from('<html>x</html>'), 'x.png', 'image/png');
  assert.equal(fakePng.status, 422);

  const fakeJs = await uploadLogo(ownerA.token, Buffer.from('alert(1)'), 'x.png', 'image/png');
  assert.equal(fakeJs.status, 422);

  const svg = await uploadLogo(ownerA.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.svg', 'image/svg+xml');
  assert.equal(svg.status, 422);

  const badMime = await uploadLogo(ownerA.token, png, 'x.gif', 'image/gif');
  assert.equal(badMime.status, 422);

  const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0x41);
  big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
  const tooBig = await uploadLogo(ownerA.token, big, 'big.png', 'image/png');
  assert.ok([413, 422].includes(tooBig.status), JSON.stringify(tooBig.data));
  if (tooBig.status === 413) {
    assert.match(String(tooBig.data.message || ''), /5 MB/);
  }
});

test('6 ACCOUNTANT autorizado a alterar logo', async () => {
  const up = await uploadLogo(accA.token, png, 'acc.png', 'image/png');
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const patch = await req('PATCH', '/api/tenant/branding', { slogan: 'Contabilidade clara' }, accA.token);
  assert.equal(patch.status, 200);
  assert.equal(patch.data.slogan, 'Contabilidade clara');
});

test('7 STAFF bloqueado em POST/DELETE', async () => {
  const get = await req('GET', '/api/tenant/branding', undefined, staffA.token);
  assert.equal(get.status, 200);
  assert.equal((await uploadLogo(staffA.token, png, 's.png', 'image/png')).status, 403);
  assert.equal((await req('DELETE', '/api/tenant/branding/logo', undefined, staffA.token)).status, 403);
  assert.equal((await req('PATCH', '/api/tenant/branding', { slogan: 'no' }, staffA.token)).status, 403);
});

test('8-10 CLIENT_* bloqueados em mutação; 24 consumidor via /api/client/branding', async () => {
  for (const client of [clientAdmin, clientFinance, clientViewer]) {
    assert.equal((await req('GET', '/api/tenant/branding', undefined, client.token)).status, 403);
    assert.equal((await uploadLogo(client.token, png, 'c.png', 'image/png')).status, 403);
    assert.equal((await req('DELETE', '/api/tenant/branding/logo', undefined, client.token)).status, 403);
    assert.equal((await req('PATCH', '/api/tenant/branding', { office_name: 'Hack' }, client.token)).status, 403);
    assert.equal((await req('POST', '/api/client/branding/logo', {}, client.token)).status, 403);
    assert.equal((await req('DELETE', '/api/client/branding/logo', undefined, client.token)).status, 403);
    assert.equal((await req('PATCH', '/api/client/branding', { office_name: 'Hack' }, client.token)).status, 403);

    const get = await req('GET', '/api/client/branding', undefined, client.token);
    assert.equal(get.status, 200, JSON.stringify(get.data));
    assert.equal(get.data.has_logo, true);
    assert.match(get.data.logo_url, /\/api\/client\/branding\/logo/);
    assert.equal(get.data.logo_path, undefined);
  }
});

test('11-25 isolamento A/B/C sem vazamento', async () => {
  assert.equal((await uploadLogo(ownerB.token, pngB, 'b.png', 'image/png')).status, 200);
  assert.equal((await uploadLogo(ownerC.token, pngC, 'c.png', 'image/png')).status, 200);

  const logoA = await getOfficeLogo(ownerA.token);
  const logoB = await getOfficeLogo(ownerB.token);
  const logoC = await getOfficeLogo(ownerC.token);
  assert.equal(logoA.status, 200);
  assert.equal(logoB.status, 200);
  assert.equal(logoC.status, 200);
  assert.ok(logoA.buf.equals(png));
  assert.ok(logoB.buf.equals(pngB));
  assert.ok(logoC.buf.equals(pngC));
  assert.ok(!logoA.buf.equals(logoB.buf));
  assert.ok(!logoB.buf.equals(logoC.buf));
  assert.ok(!logoC.buf.equals(logoA.buf));

  const pubA = await getPublicLogo(slugA);
  const pubB = await getPublicLogo(slugB);
  const pubC = await getPublicLogo(slugC);
  assert.equal(pubA.status, 200);
  assert.equal(pubB.status, 200);
  assert.equal(pubC.status, 200);
  assert.ok(pubA.buf.equals(png));
  assert.ok(pubB.buf.equals(pngB));
  assert.ok(pubC.buf.equals(pngC));
});

test('22 login com logo via slug público; sem tenant_id arbitrário', async () => {
  const ok = await req('GET', '/api/public/branding?tenant=' + encodeURIComponent(slugA));
  assert.equal(ok.status, 200);
  assert.equal(ok.data.configured, true);
  assert.match(ok.data.logo_url, /\/api\/public\/branding\/logo\?tenant=/);
  assert.match(ok.data.logo_url, /[?&]v=/);
  assert.equal(ok.data.logo_path, undefined);
  assert.ok(!JSON.stringify(ok.data).includes(ownerA.user.tenant_id) || ok.data.logo_url.includes(slugA));

  const byId = await req('GET', '/api/public/branding?tenant_id=' + encodeURIComponent(ownerA.user.tenant_id));
  assert.equal(byId.status, 200);
  assert.equal(byId.data.configured, false);
  assert.equal(byId.data.logo_url, null);

  const unknown = await req('GET', '/api/public/branding?tenant=nao-existe-284');
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.configured, false);
});

test('3 remover branding; 12-13 fallback CDS; auditoria DELETE', async () => {
  const del = await req('DELETE', '/api/tenant/branding/logo', undefined, ownerA.token);
  assert.equal(del.status, 200);
  assert.equal(del.data.configured, false);
  assert.equal(del.data.has_logo, false);
  assert.equal(del.data.logo_url, null);
  assert.equal((await getOfficeLogo(ownerA.token)).status, 404);

  const pub = await req('GET', '/api/public/branding?tenant=' + encodeURIComponent(slugA));
  assert.equal(pub.status, 200);
  assert.equal(pub.data.configured, false);
  assert.equal(pub.data.logo_url, null);

  const audit = db.prepare(
    "SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action='TENANT_BRANDING_DELETED'"
  ).get(ownerA.user.tenant_id);
  assert.ok(audit.n >= 1);

  // restaura para não quebrar asserts posteriores se houver
  assert.equal((await uploadLogo(ownerA.token, png, 'restore.png', 'image/png')).status, 200);
});

test('UI Contador e Portal Cliente consomem identidade (sem config no cliente)', () => {
  const appJs = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /Identidade do Escritório/);
  assert.match(appJs, /Configure como seu escritório será apresentado aos clientes/);
  assert.match(appJs, /login-office-logo/);
  assert.match(appJs, /office\.logo_url|x\.office/);
  assert.match(appJs, /brand-mark-office/);
  assert.match(appJs, /Alterar logo|Enviar logo/);
  assert.match(appJs, /Remover logo/);
  assert.match(appJs, /5 MB/);

  const portalJs = fs.readFileSync(path.join(root, 'frontend/public/portal/portal.js'), 'utf8');
  assert.match(portalJs, /\/api\/public\/branding\?tenant=/);
  assert.match(portalJs, /\/client\/branding/);
  assert.doesNotMatch(portalJs, /\/tenant\/branding\/logo['"]?\s*,\s*\{\s*method:\s*['"]POST/);
  assert.doesNotMatch(portalJs, /pickLogo|clearLogo|brandForm/);

  const docs = fs.readFileSync(path.join(root, 'docs/SPRINT-28.4-IDENTIDADE-ESCRITORIO.md'), 'utf8');
  assert.match(docs, /TENANT/);
  assert.match(docs, /CLIENT/);
  assert.match(docs, /fallback/i);
});

test('schema 034 presente; tabela tenant_branding UNIQUE(tenant_id)', () => {
  assert.ok(fs.existsSync(path.join(root, 'database/schema/034_tenant_branding_meta.sql')));
  assert.ok(fs.existsSync(path.join(root, 'database/schema/013_tenant_branding.sql')));
  const cols = db.prepare('PRAGMA table_info(tenant_branding)').all().map((c) => c.name);
  assert.ok(cols.includes('logo_size'));
  assert.ok(cols.includes('logo_updated_at'));
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tenant_branding'").get();
  assert.match(idx.sql, /tenant_id TEXT NOT NULL UNIQUE/i);
});
