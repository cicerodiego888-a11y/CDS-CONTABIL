'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-dual-front-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-dual-front-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
const { app, db, markClientFrontPort } = require('../backend/src/server');

let officeServer, clientServer, officeBase, clientBase;

before(async () => {
  officeServer = http.createServer(app);
  clientServer = http.createServer(app);
  await new Promise(resolve => officeServer.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => clientServer.listen(0, '127.0.0.1', resolve));
  markClientFrontPort(clientServer.address().port);
  officeBase = `http://127.0.0.1:${officeServer.address().port}`;
  clientBase = `http://127.0.0.1:${clientServer.address().port}`;
});
after(() => {
  officeServer.close();
  clientServer.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('escritório e portal do cliente no mesmo app, raízes diferentes', async () => {
  const office = await fetch(officeBase + '/');
  const client = await fetch(clientBase + '/');
  const portalPath = await fetch(officeBase + '/portal/');
  assert.equal(office.status, 200);
  assert.equal(client.status, 200);
  assert.equal(portalPath.status, 200);
  const officeHtml = await office.text();
  const clientHtml = await client.text();
  const portalHtml = await portalPath.text();
  assert.match(officeHtml, /app\.js\?v=/);
  assert.doesNotMatch(officeHtml, /portal\.js\?v=/);
  assert.match(clientHtml, /Portal do Cliente/);
  assert.match(clientHtml, /portal\.js\?v=/);
  assert.match(portalHtml, /portal\.js\?v=/);
});

test('API é a mesma nas duas origens', async () => {
  const a = await fetch(officeBase + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x', password: 'y', tenant: 'nope' }) });
  const b = await fetch(clientBase + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x', password: 'y', tenant: 'nope' }) });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
});
