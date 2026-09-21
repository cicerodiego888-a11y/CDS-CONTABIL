'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s282-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-28-2-notification-center';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}

const {
  NOTIFICATION_TYPES,
  DOMAIN_TO_NOTIFICATION,
  templates,
  createRecipientResolver,
  createNotificationService
} = require('../backend/src/notifications');
const { app, db, notificationService, pushService, emitEvent, EVENT_TYPES } = require('../backend/src/server');

let server, base, ownerA, ownerB, companyA, companyB, companyC, clientA, clientB, staffA;
const password = 'Senha@123';

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
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório NC A', email: 'owner.nc.a@test.local', password, tenantName: 'Tenant NC A'
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.nc.a@test.local', password, tenant: a.data.tenant_slug
  })).data;

  const b = await req('POST', '/api/auth/register', {
    name: 'Escritório NC B', email: 'owner.nc.b@test.local', password, tenantName: 'Tenant NC B'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.nc.b@test.local', password, tenant: b.data.tenant_slug
  })).data;

  companyA = (await req('POST', '/api/empresas', {
    name: 'Empresa A NC', trade_name: 'EMPRESA A', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B NC', trade_name: 'EMPRESA B', cnpj: '22333444000192'
  }, ownerA.token)).data;
  companyC = (await req('POST', '/api/empresas', {
    name: 'Empresa C NC', trade_name: 'EMPRESA C', cnpj: '33444555000103'
  }, ownerB.token)).data;

  const staff = await req('POST', '/api/usuarios', {
    name: 'Staff NC', email: 'staff.nc@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.nc@test.local', password, tenant: ownerA.user.tenant_slug || a.data.tenant_slug
  })).data;

  const uA = await req('POST', `/api/empresas/${companyA.id}/users`, {
    name: 'Cliente A', email: 'client.nc.a@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  const tokA = uA.data.invitation.activation_url.split('/convite/')[1];
  clientA = (await req('POST', '/api/invitations/' + tokA + '/accept', {
    name: 'Cliente A', password, confirmation: password
  })).data;

  const uB = await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'client.nc.b@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token);
  const tokB = uB.data.invitation.activation_url.split('/convite/')[1];
  clientB = (await req('POST', '/api/invitations/' + tokB + '/accept', {
    name: 'Cliente B', password, confirmation: password
  })).data;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('catálogo de tipos oficiais existe', () => {
  assert.equal(NOTIFICATION_TYPES.REQUEST_MESSAGE, 'REQUEST_MESSAGE');
  assert.equal(NOTIFICATION_TYPES.DOCUMENT_RECEIVED, 'DOCUMENT_RECEIVED');
  assert.equal(NOTIFICATION_TYPES.EXPENSE_RECEIVED, 'EXPENSE_RECEIVED');
  assert.equal(NOTIFICATION_TYPES.CLASSIFICATION_PENDING, 'CLASSIFICATION_PENDING');
  assert.equal(NOTIFICATION_TYPES.APPROVAL_PENDING, 'APPROVAL_PENDING');
  assert.equal(NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE, 'PROCESS_STEP_OVERDUE');
  assert.equal(NOTIFICATION_TYPES.INTEGRATION_FAILED, 'INTEGRATION_FAILED');
  assert.equal(DOMAIN_TO_NOTIFICATION.DOCUMENT_UPLOADED, 'DOCUMENT_RECEIVED');
  assert.equal(DOMAIN_TO_NOTIFICATION.EXPENSE_CREATED, 'EXPENSE_RECEIVED');
  assert.equal(DOMAIN_TO_NOTIFICATION.CLASSIFICATION_REQUIRED, 'CLASSIFICATION_PENDING');
});

test('templates: identidade CDS, icon, badge, preview seguro, deep-link', () => {
  const payload = templates.buildPushPayload(NOTIFICATION_TYPES.DOCUMENT_RECEIVED, {
    tenant_id: 't1',
    company_id: companyA.id,
    entity_id: 'doc-1',
    entity_type: 'document',
    company_name: 'SCOSY EMPREENDIMENTOS',
    original_name: 'NF-e — Fornecedor XYZ',
    actor_role: 'CLIENT',
    preview: 'senha secreta token eyJhbGciOiJIUzI1NiJ9.abc'
  });
  assert.equal(payload.title, 'CDS Contábil Connect');
  assert.match(payload.body, /Novo documento recebido/);
  assert.equal(payload.icon, '/assets/cds-pwa-192.png');
  assert.equal(payload.badge, '/assets/cds-push-badge.png');
  assert.ok(payload.actions.some((a) => a.action === 'open'));
  assert.equal(payload.url, `/empresas/${companyA.id}`);
  assert.equal(payload.tag, 'document:doc-1');
  assert.ok(!/eyJ/.test(payload.preview || ''));
  assert.ok(!/senha secreta token eyJ/.test(payload.body));

  const toClient = templates.buildPushPayload(NOTIFICATION_TYPES.DOCUMENT_RECEIVED, {
    tenant_id: 't1',
    company_id: companyA.id,
    entity_id: 'doc-2',
    for_client: true,
    actor_role: 'OWNER',
    original_name: 'Boleto.pdf'
  });
  assert.match(toClient.body, /escritório enviou um documento/i);
  assert.equal(toClient.url, '/portal/?page=documents');
});

test('NotificationService e resolver existem no server', () => {
  assert.ok(notificationService);
  assert.ok(typeof notificationService.notify === 'function');
  assert.ok(typeof notificationService.notifyRequestMessage === 'function');
  assert.ok(notificationService.resolver);
  assert.ok(pushService);
});

test('isolamento tenant/company no resolver', () => {
  const resolver = createRecipientResolver({ db });
  const recipientsA = resolver.resolve({
    type: NOTIFICATION_TYPES.DOCUMENT_RECEIVED,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    actor_user_id: clientA.user.id,
    actor_role: 'CLIENT'
  });
  assert.ok(recipientsA.includes(ownerA.user.id));
  assert.ok(!recipientsA.includes(clientA.user.id));
  assert.ok(!recipientsA.includes(ownerB.user.id));

  // Escritório envia documento → CLIENTES da empresa A
  const toClients = resolver.resolve({
    type: NOTIFICATION_TYPES.DOCUMENT_RECEIVED,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    actor_user_id: ownerA.user.id,
    actor_role: 'OWNER'
  });
  assert.ok(toClients.includes(clientA.user.id));
  assert.ok(!toClients.includes(clientB.user.id));
  assert.ok(!toClients.includes(ownerA.user.id));

  const recipientsB = resolver.resolve({
    type: NOTIFICATION_TYPES.EXPENSE_RECEIVED,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyB.id,
    actor_user_id: clientB.user.id
  });
  assert.ok(recipientsB.includes(ownerA.user.id));
  assert.ok(!recipientsB.includes(clientB.user.id));

  const recipientsC = resolver.resolve({
    type: NOTIFICATION_TYPES.EXPENSE_RECEIVED,
    tenant_id: ownerB.user.tenant_id,
    company_id: companyC.id
  });
  assert.ok(recipientsC.includes(ownerB.user.id));
  assert.ok(!recipientsC.includes(ownerA.user.id));

  // candidato cego de outro tenant é descartado
  const leaked = resolver.resolve({
    type: NOTIFICATION_TYPES.EXPENSE_RECEIVED,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    candidate_user_ids: [ownerB.user.id, clientA.user.id]
  });
  assert.ok(!leaked.includes(ownerB.user.id));
  assert.ok(!leaked.includes(clientA.user.id));
});

test('preferências por categoria', async () => {
  const saved = await req('PUT', '/api/push/prefs', {
    requests_enabled: true,
    documents_enabled: false,
    expenses_enabled: true,
    push_enabled: true
  }, ownerA.token);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.documents_enabled, false);
  assert.equal(saved.data.expenses_enabled, true);

  const prefs = notificationService.prefs(ownerA.user.id, ownerA.user.tenant_id);
  assert.equal(prefs.documents_enabled, false);

  // restaurar
  await req('PUT', '/api/push/prefs', { documents_enabled: true }, ownerA.token);
});

test('unread / read / read-all aliases', async () => {
  emitEvent({
    tenantId: ownerA.user.tenant_id,
    companyId: companyA.id,
    eventType: EVENT_TYPES.DOCUMENT_UPLOADED,
    actorUserId: clientA.user.id,
    entityType: 'document',
    entityId: crypto.randomUUID(),
    payload: { original_name: 'nota.pdf' }
  });

  const unread = await req('GET', '/api/notificacoes/nao-lidas', undefined, ownerA.token);
  assert.equal(unread.status, 200, JSON.stringify(unread.data));
  assert.ok(Number(unread.data.unread) >= 1);

  const list = await req('GET', '/api/notificacoes?page=1&page_size=10', undefined, ownerA.token);
  const item = (list.data.items || []).find((x) => x.type === 'DOCUMENT_UPLOADED' || x.type === 'DOCUMENT_RECEIVED');
  assert.ok(item, 'espera notificação de documento');

  const read = await req('PATCH', `/api/notificacoes/${item.id}/read`, {}, ownerA.token);
  assert.equal(read.status, 200, JSON.stringify(read.data));

  const all = await req('PATCH', '/api/notificacoes/read-all', {}, ownerA.token);
  assert.equal(all.status, 200, JSON.stringify(all.data));
});

test('Solicitações usam NotificationService (push bidirecional sem quebrar)', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA.id,
    title: 'Pedido NC',
    description: 'Preciso de ajuda',
    type: 'GENERAL'
  }, ownerA.token);
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const msg = await req('POST', `/api/client/solicitacoes/${created.data.id}/mensagens`, {
    message: 'BOA NOITE'
  }, clientA.token);
  assert.equal(msg.status, 201, JSON.stringify(msg.data));

  // motor central disponível e resolve destinatários do escritório
  const result = await notificationService.notifyRequestMessage({
    tenantId: ownerA.user.tenant_id,
    companyId: companyA.id,
    requestId: created.data.id,
    actorUserId: clientA.user.id,
    actorRole: 'CLIENT',
    title: created.data.title,
    companyName: 'EMPRESA A',
    preview: 'BOA NOITE',
    messageId: msg.data.id || msg.data.message?.id
  });
  assert.ok(result.recipients.includes(ownerA.user.id) || result.recipients.includes(staffA.user.id));
  assert.ok(!result.recipients.includes(clientA.user.id));
  assert.ok(!result.recipients.includes(clientB.user.id));
  assert.equal(result.direction, 'client_to_office');
  if (result.payload) {
    assert.equal(result.payload.title, 'CDS Contábil Connect');
    assert.match(result.payload.url, /\/empresas\//);
  }
});

test('documento e despesa disparam eventos utilizáveis pelo motor', async () => {
  const expense = await req('POST', '/api/client/despesas', {
    occurred_on: '2026-09-20',
    description: 'Fornecedor XYZ',
    amount: '850,00',
    payment_method: 'PIX'
  }, clientA.token);
  assert.equal(expense.status, 201, JSON.stringify(expense.data));

  const ev = db.prepare(
    "SELECT * FROM domain_events WHERE tenant_id=? AND event_type='EXPENSE_CREATED' AND entity_id=?"
  ).get(ownerA.user.tenant_id, expense.data.id);
  assert.ok(ev);

  const pushResult = await notificationService.deliverPushForDomainEvent(
    ev,
    'EMPRESA A',
    JSON.parse(ev.payload_json),
    null
  );
  assert.ok(pushResult.ok || pushResult.skipped === 'no_recipients' || pushResult.recipients);
  if (pushResult.recipients) {
    assert.ok(!pushResult.recipients.includes(clientA.user.id));
    assert.ok(!pushResult.recipients.includes(ownerB.user.id));
  }

  // documento
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'comprovante.png');
  const docRes = await fetch(base + '/api/client/documentos', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + clientA.token },
    body: fd
  });
  const docData = await docRes.json();
  assert.equal(docRes.status, 201, JSON.stringify(docData));
  const docEv = db.prepare(
    "SELECT * FROM domain_events WHERE tenant_id=? AND event_type='DOCUMENT_UPLOADED' AND entity_id=?"
  ).get(ownerA.user.tenant_id, docData.id);
  assert.ok(docEv);
  assert.equal(DOMAIN_TO_NOTIFICATION.DOCUMENT_UPLOADED, 'DOCUMENT_RECEIVED');
});

test('falha de push não cancela notify', async () => {
  const result = await notificationService.notify({
    type: NOTIFICATION_TYPES.CLASSIFICATION_PENDING,
    tenant_id: ownerA.user.tenant_id,
    company_id: companyA.id,
    actor_user_id: staffA.user.id,
    entity_type: 'entry',
    entity_id: crypto.randomUUID(),
    company_name: 'EMPRESA A',
    preview: 'Movimentação teste',
    skip_in_app: false
  });
  assert.equal(result.ok, true);
  assert.ok(result.recipients.length >= 1);
  // sem subscriptions → push skipped, mas in-app ok
  const hasInApp = result.results.some((r) => r.in_app);
  assert.ok(hasInApp);
});

test('PWA manifest e Service Worker (identidade + payload)', () => {
  const office = fs.readFileSync(path.join(__dirname, '../frontend/public/manifest.webmanifest'), 'utf8');
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/manifest.webmanifest'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '../frontend/public/service-worker.js'), 'utf8');
  assert.match(office, /"name":\s*"CDS Contábil Connect"/);
  assert.match(office, /"short_name":\s*"CDS Contábil"/);
  assert.match(office, /"display":\s*"standalone"/);
  assert.match(portal, /CDS Contábil Connect/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /cds-pwa-192\.png/);
  assert.match(sw, /cds-push-badge\.png/);
  assert.match(sw, /CDS_PUSH_OPEN/);
  assert.ok(!/via Microsoft Edge/.test(sw) || /replace.*Microsoft Edge/.test(sw));
});

test('deep-links reais por tipo', () => {
  assert.equal(
    templates.deepLink(NOTIFICATION_TYPES.REQUEST_MESSAGE, {
      company_id: 'c1', entity_id: 'r1', for_client: false
    }),
    '/empresas/c1/solicitacoes/r1'
  );
  assert.equal(
    templates.deepLink(NOTIFICATION_TYPES.REQUEST_MESSAGE, {
      company_id: 'c1', entity_id: 'r1', for_client: true
    }),
    '/portal/?solicitacao=r1'
  );
  assert.equal(
    templates.deepLink(NOTIFICATION_TYPES.EXPENSE_RECEIVED, { company_id: 'c1', entity_id: 'e1' }),
    '/empresas/c1'
  );
  assert.equal(templates.pageForType(NOTIFICATION_TYPES.CLASSIFICATION_PENDING), 'classificacao');
  assert.equal(templates.pageForType(NOTIFICATION_TYPES.APPROVAL_PENDING), 'aprovacao');
  assert.equal(templates.pageForType(NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE), 'processos');
  assert.equal(templates.pageForType(NOTIFICATION_TYPES.INTEGRATION_FAILED), 'importacoes');
});

test('documento do escritório notifica CLIENT da empresa', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'guia-escritorio.png');
  fd.append('company_id', companyA.id);
  const up = await fetch(base + '/api/documentos/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ownerA.token },
    body: fd
  });
  const doc = await up.json();
  assert.equal(up.status, 201, JSON.stringify(doc));

  const note = db.prepare(
    `SELECT * FROM notifications
     WHERE tenant_id=? AND company_id=? AND entity_id=?
       AND COALESCE(recipient_user_id,user_id)=?`
  ).get(ownerA.user.tenant_id, companyA.id, doc.id, clientA.user.id);
  assert.ok(note, 'cliente deve receber notificação in-app');
  assert.match(String(note.title || ''), /documento/i);

  const other = db.prepare(
    `SELECT * FROM notifications
     WHERE tenant_id=? AND company_id=? AND entity_id=?
       AND COALESCE(recipient_user_id,user_id)=?`
  ).get(ownerA.user.tenant_id, companyA.id, doc.id, clientB.user.id);
  assert.equal(other, undefined, 'cliente de outra empresa não recebe');
});
