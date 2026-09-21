'use strict';

/**
 * Sprint 28.1.2 — identidade PWA + notificação CDS Contábil Connect.
 * Estático: manifests, HTML, SW, ícones. Sem alterar fluxo VAPID/push.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CDS_DB_PATH = path.join(require('os').tmpdir(), `cds-pwa-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-pwa-identity-secret-ok';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }

const { app, db } = require('../backend/src/server');

let server, base;
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  try { db.close(); } catch { /* */ }
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }
});

test('manifest do Contador existe com identidade oficial', () => {
  assert.ok(exists('frontend/public/manifest.webmanifest'));
  const m = JSON.parse(read('frontend/public/manifest.webmanifest'));
  assert.equal(m.name, 'CDS Contábil Connect');
  assert.equal(m.short_name, 'CDS Contábil');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.theme_color, '#111111');
  assert.equal(m.background_color, '#111111');
  assert.ok(Array.isArray(m.icons) && m.icons.length >= 2);
  assert.ok(m.icons.some(i => String(i.sizes).includes('192')));
  assert.ok(m.icons.some(i => String(i.sizes).includes('512')));
  assert.ok(!JSON.stringify(m).toLowerCase().includes('localhost'));
});

test('manifest do Cliente existe com identidade oficial', () => {
  assert.ok(exists('frontend/public/portal/manifest.webmanifest'));
  const m = JSON.parse(read('frontend/public/portal/manifest.webmanifest'));
  assert.match(m.name, /CDS Contábil Connect/);
  assert.equal(m.short_name, 'CDS Contábil');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/portal/');
  assert.equal(m.scope, '/portal/');
  assert.equal(m.theme_color, '#111111');
  assert.ok(m.icons.some(i => String(i.sizes).includes('192')));
  assert.ok(m.icons.some(i => String(i.sizes).includes('512')));
});

test('HTML Contador e Cliente apontam manifest + theme-color', () => {
  const office = read('frontend/public/index.html');
  const portal = read('frontend/public/portal/index.html');
  assert.match(office, /rel="manifest"[^>]*href="\/manifest\.webmanifest"/);
  assert.match(office, /theme-color[^>]*content="#111111"/);
  assert.match(office, /application-name[^>]*content="CDS Contábil Connect"/);
  assert.match(portal, /rel="manifest"[^>]*href="\/portal\/manifest\.webmanifest"/);
  assert.match(portal, /theme-color[^>]*content="#111111"/);
  assert.match(portal, /CDS Contábil Connect/);
});

test('ícones PWA oficiais existem (192 e 512)', () => {
  assert.ok(exists('frontend/public/assets/cds-favicon-32.png'));
  assert.ok(exists('frontend/public/assets/cds-pwa-512.png'));
  assert.ok(exists('frontend/public/assets/cds-push-icon.png'));
  assert.ok(exists('frontend/public/assets/cds-push-badge.png'));
  assert.ok(exists('frontend/public/assets/cds-favicon-32.png'));
  const b192 = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/cds-pwa-192.png'));
  const b512 = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/cds-pwa-512.png'));
  assert.equal(b192.readUInt32BE(16), 192);
  assert.equal(b192.readUInt32BE(20), 192);
  assert.equal(b512.readUInt32BE(16), 512);
  assert.equal(b512.readUInt32BE(20), 512);
});

test('service worker mantém push + identidade CDS', () => {
  const sw = read('frontend/public/service-worker.js');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /CDS Contábil Connect/);
  assert.match(sw, /cds-pwa-192\.png|cds-push-icon\.png/);
  assert.match(sw, /cds-push-badge/);
  assert.match(sw, /Abrir conversa/);
  assert.match(sw, /Ir para a empresa/);
  assert.match(sw, /request_id|company_id/);
  assert.doesNotMatch(sw, /via Microsoft Edge/);
  assert.doesNotMatch(sw, /title:\s*['"]localhost/i);
});

test('HTTP serve manifests com tipo correto e HTML com link', async () => {
  const officeManifest = await fetch(base + '/manifest.webmanifest');
  assert.equal(officeManifest.status, 200);
  const ctype = officeManifest.headers.get('content-type') || '';
  assert.match(ctype, /manifest|json/i);
  const om = await officeManifest.json();
  assert.equal(om.name, 'CDS Contábil Connect');

  const clientManifest = await fetch(base + '/portal/manifest.webmanifest');
  assert.equal(clientManifest.status, 200);
  const cm = await clientManifest.json();
  assert.equal(cm.start_url, '/portal/');

  const officeHtml = await fetch(base + '/').then(r => r.text());
  assert.match(officeHtml, /manifest\.webmanifest/);
  assert.match(officeHtml, /theme-color/);

  const portalHtml = await fetch(base + '/portal/').then(r => r.text());
  assert.match(portalHtml, /portal\/manifest\.webmanifest/);
});
