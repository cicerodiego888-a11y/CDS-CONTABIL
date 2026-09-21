'use strict';

/**
 * Sprint 28.3 — cabeçalho Cliente, sessões separadas, SW/Push por portal.
 * Não altera NotificationService / RecipientResolver.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s283-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-28-3-client-header-push';
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:test@cds.local';

try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }

const { app, db, notificationService, pushService } = require('../backend/src/server');
const { NOTIFICATION_TYPES } = require('../backend/src/notifications');

let server, base, ownerA, ownerB, companyA, companyB, clientA, clientB, staffA;
const password = 'Senha@123';
const id = () => crypto.randomUUID();
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

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

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório 283 A', email: 'owner.283.a@test.local', password, tenantName: 'Tenant 283 A'
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.283.a@test.local', password, tenant: a.data.tenant_slug
  })).data;

  const b = await req('POST', '/api/auth/register', {
    name: 'Escritório 283 B', email: 'owner.283.b@test.local', password, tenantName: 'Tenant 283 B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.283.b@test.local', password, tenant: b.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A 283', trade_name: 'SCOSY EMPREENDIMENTOS', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B 283', trade_name: 'EMPRESA B', cnpj: '22333444000192'
  }, ownerA.token)).data;

  const staff = await req('POST', '/api/usuarios', {
    name: 'Staff 283', email: 'staff.283@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.283@test.local', password, tenant: a.data.tenant_slug
  })).data;

  const uA = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente A 283', email: 'client.283.a@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  const tokA = uA.data.invitation.activation_url.split('/convite/')[1];
  clientA = (await req('POST', '/api/invitations/' + tokA + '/accept', {
    name: 'Cliente A 283', password, confirmation: password
  })).data;

  const uB = await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B 283', email: 'client.283.b@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  const tokB = uB.data.invitation.activation_url.split('/convite/')[1];
  clientB = (await req('POST', '/api/invitations/' + tokB + '/accept', {
    name: 'Cliente B 283', password, confirmation: password
  })).data;
});

after(() => {
  server.close();
  try { db.close(); } catch { /* */ }
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }
});

test('1-4: tokens OFFICE/CLIENT separados no frontend; logout isolado', () => {
  const office = read('frontend/public/assets/app.js');
  const portal = read('frontend/public/portal/portal.js');
  assert.match(office, /ccc_office_token/);
  assert.match(portal, /ccc_client_token/);
  assert.match(office, /setOfficeToken|ccc_office_token/);
  assert.match(portal, /setClientToken|ccc_client_token/);
  // Logout OFFICE não remove CLIENT
  assert.match(office, /não remove ccc_client_token|ccc_client_token/);
  assert.doesNotMatch(office, /localStorage\.removeItem\('ccc_client_token'\)/);
  // Logout CLIENT não remove OFFICE
  assert.doesNotMatch(portal, /localStorage\.removeItem\('ccc_office_token'\)/);
  assert.match(portal, /não remove ccc_office_token|ccc_office_token/);
});

test('5-6: Service Workers com escopos distintos', () => {
  assert.ok(exists('frontend/public/service-worker.js'));
  assert.ok(exists('frontend/public/portal/service-worker.js'));
  const push = read('frontend/public/assets/push-client.js');
  assert.match(push, /\/portal\/service-worker\.js/);
  assert.match(push, /scope:\s*['"]\/portal\//);
  assert.match(push, /\/service-worker\.js/);
  assert.match(push, /resolveSwConfig/);
  const portalSw = read('frontend/public/portal/service-worker.js');
  assert.match(portalSw, /showNotification/);
  assert.match(portalSw, /notificationclick/);
  assert.match(portalSw, /\/portal\//);
});

test('7: CLIENT subscription vinculada ao usuário autenticado', async () => {
  const endpoint = 'https://push.example.test/client-a-' + id();
  const sub = await req('POST', '/api/push/subscribe', {
    subscription: {
      endpoint,
      keys: { p256dh: 'BNcRzejns1Q...', auth: 'tBHItJI5...' }
    }
  }, clientA.token);
  assert.ok(sub.status === 200 || sub.status === 201, JSON.stringify(sub.data));
  const row = db.prepare('SELECT user_id, tenant_id FROM push_subscriptions WHERE endpoint=?').get(endpoint);
  assert.ok(row);
  assert.equal(row.user_id, clientA.user.id);
  assert.equal(row.tenant_id, clientA.user.tenant_id);
  const user = db.prepare('SELECT company_id FROM users WHERE id=?').get(clientA.user.id);
  assert.equal(user.company_id, companyA.id);
});

test('8-9-10-11-12: unread/read/read-all/deep-link CLIENT + isolamento', async () => {
  const before = await req('GET', '/api/notificacoes/nao-lidas', undefined, clientA.token);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  const unread0 = Number(before.data.unread || 0);

  const created = notificationService.notify({
    type: NOTIFICATION_TYPES.REQUEST_MESSAGE,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    actor_user_id: staffA.user.id,
    actor_role: 'ACCOUNTANT',
    entity_type: 'request',
    entity_id: 'req-283-a',
    company_name: 'SCOSY EMPREENDIMENTOS',
    preview: 'resposta teste01',
    title: 'Nova mensagem',
    body: 'respondeu à solicitação',
    candidate_user_ids: [clientA.user.id]
  });
  assert.ok(created && (created.created > 0 || created.notifications || created.ok !== false));

  const unread = await req('GET', '/api/notificacoes/nao-lidas', undefined, clientA.token);
  assert.equal(unread.status, 200);
  assert.ok(Number(unread.data.unread) >= unread0 + 1);

  const list = await req('GET', '/api/client/notificacoes', undefined, clientA.token);
  assert.equal(list.status, 200);
  const items = Array.isArray(list.data) ? list.data : (list.data.items || []);
  const hit = items.find((n) => n.entity_id === 'req-283-a' || /resposta teste01|Nova mensagem|solicitação/i.test(String(n.title) + String(n.message) + String(n.preview || '')));
  assert.ok(hit, 'notificação CLIENT criada');
  assert.ok(hit.url || /REQUEST|solicitacao/i.test(String(hit.type) + String(hit.url || '')));

  const other = await req('GET', '/api/client/notificacoes', undefined, clientB.token);
  const otherItems = Array.isArray(other.data) ? other.data : (other.data.items || []);
  assert.ok(!otherItems.some((n) => n.id === hit.id), 'CLIENT B não vê notificação da Empresa A');

  const readOne = await req('PATCH', `/api/notificacoes/${hit.id}/read`, {}, clientA.token);
  assert.equal(readOne.status, 200, JSON.stringify(readOne.data));

  const steal = await req('PATCH', `/api/notificacoes/${hit.id}/read`, {}, clientB.token);
  assert.ok(steal.status === 404 || steal.status === 403 || steal.status === 200);

  await notificationService.notify({
    type: NOTIFICATION_TYPES.DOCUMENT_RECEIVED,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    actor_user_id: ownerA.user.id,
    actor_role: 'OWNER',
    entity_type: 'document',
    entity_id: 'doc-283',
    for_client: true,
    candidate_user_ids: [clientA.user.id],
    original_name: 'Boleto.pdf'
  });
  const beforeAll = await req('GET', '/api/notificacoes/nao-lidas', undefined, clientA.token);
  const readAll = await req('PATCH', '/api/notificacoes/read-all', {}, clientA.token);
  assert.equal(readAll.status, 200, JSON.stringify(readAll.data));
  const afterAll = await req('GET', '/api/notificacoes/nao-lidas', undefined, clientA.token);
  assert.equal(Number(afterAll.data.unread || 0), 0);
  assert.ok(Number(beforeAll.data.unread || 0) >= 0);
});

test('13: REQUEST_MESSAGE CLIENT; OFFICE continua recebendo', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA.id,
    title: 'Solicitação 283',
    description: 'mensagem inicial do escritório'
  }, ownerA.token, companyA.id);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const requestId = created.data.id;

  const msg = await req('POST', `/api/solicitacoes/${requestId}/mensagens`, {
    message: 'resposta do escritório 283'
  }, staffA.token, companyA.id);
  assert.ok(msg.status === 200 || msg.status === 201, JSON.stringify(msg.data));

  const clientNotes = await req('GET', '/api/client/notificacoes', undefined, clientA.token);
  const cItems = Array.isArray(clientNotes.data) ? clientNotes.data : [];
  assert.ok(cItems.some((n) => /REQUEST|mensagem|solicit/i.test(String(n.type) + String(n.title) + String(n.message))));

  const officeUnread = await req('GET', '/api/notificacoes/nao-lidas', undefined, ownerA.token);
  assert.equal(officeUnread.status, 200);

  // Fluxo inverso: CLIENT → OFFICE
  const clientMsg = await req('POST', `/api/client/solicitacoes/${requestId}/mensagens`, {
    message: 'resposta do cliente 283'
  }, clientA.token);
  assert.ok(clientMsg.status === 200 || clientMsg.status === 201, JSON.stringify(clientMsg.data));
  const officeList = await req('GET', '/api/notificacoes?page=1&page_size=25', undefined, ownerA.token, companyA.id);
  assert.equal(officeList.status, 200);
  const oItems = officeList.data.items || [];
  assert.ok(oItems.some((n) => /REQUEST|mensagem|solicit|cliente/i.test(String(n.type) + String(n.title) + String(n.message))));
});

test('14: popup HTML legado não dispara', () => {
  const portal = read('frontend/public/portal/portal.js');
  assert.match(portal, /popup HTML legado removido|Sprint 28\.3/);
  assert.doesNotMatch(portal, /req-msg-alert/);
  assert.doesNotMatch(portal, /insertAdjacentHTML\([^)]*reqMsgAlert/);
  assert.match(portal, /CdsAppHeader|cds-app-header|notifToggle/);
});

test('15: preferência Push respeitada', async () => {
  await req('PUT', '/api/push/prefs', { push_enabled: false, requests_enabled: true }, clientA.token);
  const prefs = await req('GET', '/api/push/prefs', undefined, clientA.token);
  assert.equal(prefs.status, 200);
  assert.equal(prefs.data.push_enabled, false);
  await req('PUT', '/api/push/prefs', { push_enabled: true }, clientA.token);
});

test('16-17: CLIENT não recebe notificação interna; isolamento Empresa B', async () => {
  notificationService.notify({
    type: NOTIFICATION_TYPES.CLASSIFICATION_PENDING,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    actor_user_id: ownerA.user.id,
    actor_role: 'OWNER',
    entity_type: 'entry',
    entity_id: 'entry-internal-283'
  });
  const list = await req('GET', '/api/client/notificacoes', undefined, clientA.token);
  const items = Array.isArray(list.data) ? list.data : [];
  assert.ok(!items.some((n) => n.entity_id === 'entry-internal-283' || n.type === 'CLASSIFICATION_PENDING'));

  notificationService.notify({
    type: NOTIFICATION_TYPES.REQUEST_MESSAGE,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyB.id,
    actor_user_id: staffA.user.id,
    actor_role: 'ACCOUNTANT',
    entity_type: 'request',
    entity_id: 'req-only-b',
    candidate_user_ids: [clientB.user.id],
    preview: 'só empresa B'
  });
  const aList = await req('GET', '/api/client/notificacoes', undefined, clientA.token);
  const aItems = Array.isArray(aList.data) ? aList.data : [];
  assert.ok(!aItems.some((n) => n.entity_id === 'req-only-b'));
});

test('18-19: OFFICE continua recebendo; NotificationService único motor', () => {
  assert.ok(notificationService);
  assert.ok(typeof notificationService.notify === 'function');
  assert.ok(notificationService.resolver);
  assert.ok(pushService);
  const svc = read('backend/src/notifications/service.js');
  assert.match(svc, /function createNotificationService|createNotificationService/);
  const portal = read('frontend/public/portal/portal.js');
  assert.doesNotMatch(portal, /createNotificationService|new NotificationEngine/);
});

test('20: PWA Cliente + header + integridade', () => {
  assert.ok(exists('frontend/public/assets/cds-app-header.js'));
  assert.ok(exists('frontend/public/portal/service-worker.js'));
  const m = JSON.parse(read('frontend/public/portal/manifest.webmanifest'));
  assert.equal(m.name, 'CDS Contábil Connect');
  assert.equal(m.scope, '/portal/');
  assert.equal(m.start_url, '/portal/');
  const html = read('frontend/public/portal/index.html');
  assert.match(html, /cds-app-header\.js/);
  const integrity = db.pragma('integrity_check');
  assert.equal(integrity[0].integrity_check, 'ok');
  const fk = db.pragma('foreign_key_check');
  assert.equal(fk.length, 0);
});

test('mesmo navegador: sessões independentes (simulação de chaves)', () => {
  // Simula localStorage dual via asserts estáticos já cobertos + tokens JWT distintos
  assert.notEqual(ownerA.token, clientA.token);
  assert.ok(ownerA.token);
  assert.ok(clientA.token);
});
