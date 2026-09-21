'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s28-1-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-28-1-secret-ok';
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = '';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = '';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }

const { app, db, EVENT_TYPES } = require('../backend/src/server');

let server, base, ownerA, ownerB, companyA1, companyA2, companyB, clientA, clientA2, clientB;
const password = 'Senha@123';

function req(method, url, body, token, companyId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (companyId) headers['X-Company-Id'] = companyId;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  });
}

async function registerOffice(name, email, tenantName) {
  const a = await req('POST', '/api/auth/register', { name, email, password, tenantName });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  return (await req('POST', '/api/auth/login', { email, password, tenant: a.data.tenant_slug })).data;
}

async function createClient(ownerToken, companyId, name, email) {
  const u = await req('POST', `/api/empresas/${companyId}/users`, {
    name, email, profile: 'CLIENT_FINANCE'
  }, ownerToken);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const token = u.data.invitation.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + token + '/accept', {
    name, password, confirmation: password
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  return acc.data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  ownerA = await registerOffice('Escritório S28.1 A', 'owner.a.s281@test.local', 'Tenant S28.1 A');
  ownerB = await registerOffice('Escritório S28.1 B', 'owner.b.s281@test.local', 'Tenant S28.1 B');

  companyA1 = (await req('POST', '/api/empresas', {
    name: 'Empresa A1 Ltda', trade_name: 'SCOSY', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2 Ltda', trade_name: 'BETA', cnpj: '22333444000192'
  }, ownerA.token)).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B Ltda', cnpj: '33444555000103'
  }, ownerB.token)).data;

  clientA = await createClient(ownerA.token, companyA1.id, 'Cliente A1', 'cli.a1.s281@test.local');
  clientA2 = await createClient(ownerA.token, companyA2.id, 'Cliente A2', 'cli.a2.s281@test.local');
  clientB = await createClient(ownerB.token, companyB.id, 'Cliente B', 'cli.b.s281@test.local');
});

after(() => {
  server.close();
  try { db.close(); } catch { /* */ }
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }
});

test('escritório cria solicitação e cliente visualiza histórico', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id,
    type: 'QUESTION',
    title: 'Dúvida sobre documento',
    description: 'Favor verificar a NF-e enviada.'
  }, ownerA.token, companyA1.id);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, 'AGUARDANDO_CLIENTE');
  assert.ok(created.data.message_count >= 1);

  const list = await req('GET', '/api/client/solicitacoes', undefined, clientA.token);
  assert.equal(list.status, 200);
  const found = list.data.find(x => x.id === created.data.id);
  assert.ok(found);
  assert.equal(found.title, 'Dúvida sobre documento');

  const msgs = await req('GET', '/api/client/solicitacoes/' + created.data.id + '/mensagens', undefined, clientA.token);
  assert.equal(msgs.status, 200);
  assert.ok(msgs.data.length >= 1);
  assert.match(msgs.data[0].message, /NF-e/);
});

test('cliente responde → escritório vê → escritório responde (mesma conversa)', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id,
    type: 'DOCUMENT',
    title: 'Conversa completa',
    description: 'Mensagem inicial do escritório'
  }, ownerA.token);

  const clientMsg = await req('POST', '/api/client/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'Qual documento exatamente?'
  }, clientA.token);
  assert.equal(clientMsg.status, 201, JSON.stringify(clientMsg.data));
  assert.equal(clientMsg.data.request.status, 'AGUARDANDO_ESCRITORIO');

  const officeThread = await req('GET', '/api/solicitacoes/' + created.data.id + '/mensagens', undefined, ownerA.token, companyA1.id);
  assert.equal(officeThread.status, 200);
  assert.ok(officeThread.data.some(m => m.message === 'Qual documento exatamente?'));

  const officeMsg = await req('POST', '/api/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'A NF-e referente à despesa de setembro.'
  }, ownerA.token, companyA1.id);
  assert.equal(officeMsg.status, 201);
  assert.equal(officeMsg.data.request.status, 'AGUARDANDO_CLIENTE');

  const clientThread = await req('GET', '/api/client/solicitacoes/' + created.data.id + '/mensagens', undefined, clientA.token);
  assert.equal(clientThread.data.length, officeThread.data.length + 1);
  const texts = clientThread.data.map(m => m.message);
  assert.deepEqual(texts.slice(-2), ['Qual documento exatamente?', 'A NF-e referente à despesa de setembro.']);
  // ordem cronológica
  for (let i = 1; i < clientThread.data.length; i++) {
    assert.ok(clientThread.data[i].created_at >= clientThread.data[i - 1].created_at);
  }
});

test('legado /resposta grava em request_messages', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id, title: 'Legado resposta', description: 'Ini'
  }, ownerA.token);
  const r = await req('POST', '/api/client/solicitacoes/' + created.data.id + '/resposta', {
    message: 'Resposta via endpoint legado'
  }, clientA.token);
  assert.equal(r.status, 201);
  const row = db.prepare('SELECT message FROM request_messages WHERE id=?').get(r.data.id);
  assert.equal(row.message, 'Resposta via endpoint legado');
});

test('não lidas e marcar como lida ao abrir conversa', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id, title: 'Unread test', description: 'Olá cliente'
  }, ownerA.token);
  await req('POST', '/api/client/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'Resposta do cliente para unread'
  }, clientA.token);

  const unread = await req('GET', '/api/solicitacoes/nao-lidas', undefined, ownerA.token, companyA1.id);
  assert.equal(unread.status, 200);
  assert.ok(unread.data.unread_total >= 1);

  const detail = await req('GET', '/api/solicitacoes/' + created.data.id, undefined, ownerA.token, companyA1.id);
  assert.ok(detail.data.unread_count >= 1);

  await req('GET', '/api/solicitacoes/' + created.data.id + '/mensagens', undefined, ownerA.token, companyA1.id);
  const after = await req('GET', '/api/solicitacoes/' + created.data.id, undefined, ownerA.token, companyA1.id);
  assert.equal(after.data.unread_count, 0);
});

test('Empresa A não acessa conversa da Empresa B (mesmo tenant)', async () => {
  const inA2 = await req('POST', '/api/solicitacoes', {
    company_id: companyA2.id, title: 'Só A2', description: 'Segredo A2'
  }, ownerA.token, companyA2.id);
  assert.equal(inA2.status, 201);

  const crossGet = await req('GET', '/api/solicitacoes/' + inA2.data.id, undefined, ownerA.token, companyA1.id);
  assert.equal(crossGet.status, 404);

  const crossMsg = await req('POST', '/api/solicitacoes/' + inA2.data.id + '/mensagens', {
    message: 'Invasão'
  }, ownerA.token, companyA1.id);
  assert.equal(crossMsg.status, 404);

  const crossPatch = await req('PATCH', '/api/solicitacoes/' + inA2.data.id, {
    status: 'CONCLUDED'
  }, ownerA.token, companyA1.id);
  assert.equal(crossPatch.status, 404);
});

test('cliente não acessa solicitação de outra empresa', async () => {
  const inA2 = await req('POST', '/api/solicitacoes', {
    company_id: companyA2.id, title: 'A2 only', description: 'x'
  }, ownerA.token);
  const denied = await req('GET', '/api/client/solicitacoes/' + inA2.data.id + '/mensagens', undefined, clientA.token);
  assert.equal(denied.status, 404);
  const deniedPost = await req('POST', '/api/client/solicitacoes/' + inA2.data.id + '/mensagens', {
    message: 'hack'
  }, clientA.token);
  assert.equal(deniedPost.status, 404);
});

test('tenant B não acessa solicitação do tenant A', async () => {
  const inA = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id, title: 'Tenant A', description: 'priv'
  }, ownerA.token);
  const denied = await req('GET', '/api/solicitacoes/' + inA.data.id, undefined, ownerB.token);
  assert.equal(denied.status, 404);
});

test('PATCH respeita company_id e status fechado bloqueia mensagem', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id, title: 'Fechar', description: 'ini'
  }, ownerA.token, companyA1.id);
  const patched = await req('PATCH', '/api/solicitacoes/' + created.data.id, {
    status: 'CONCLUDED'
  }, ownerA.token, companyA1.id);
  assert.equal(patched.status, 200);
  assert.equal(patched.data.status, 'CONCLUDED');

  const blocked = await req('POST', '/api/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'depois de concluída'
  }, ownerA.token, companyA1.id);
  assert.equal(blocked.status, 409);
});

test('push public-key nunca expõe chave privada; subscribe vincula usuário', async () => {
  const pk = await req('GET', '/api/push/public-key', undefined, ownerA.token);
  assert.equal(pk.status, 200);
  assert.equal(pk.data.publicKey, null);
  assert.equal(pk.data.configured, false);
  assert.ok(!JSON.stringify(pk.data).includes('PRIVATE'));
  assert.ok(!('privateKey' in pk.data));

  const endpoint = 'https://push.example.test/endpoint/' + crypto.randomUUID();
  const sub = await req('POST', '/api/push/subscribe', {
    subscription: {
      endpoint,
      keys: { p256dh: 'dGVzdC1wMjU2ZGg=', auth: 'dGVzdC1hdXRo' }
    }
  }, ownerA.token);
  assert.equal(sub.status, 201, JSON.stringify(sub.data));
  assert.equal(sub.data.user_id, ownerA.user.id);
  assert.equal(sub.data.tenant_id, ownerA.user.tenant_id);
  assert.ok(!('endpoint' in sub.data) || sub.data.endpoint === undefined);

  const row = db.prepare('SELECT * FROM push_subscriptions WHERE id=?').get(sub.data.id);
  assert.equal(row.user_id, ownerA.user.id);
  assert.equal(row.endpoint, endpoint);

  const second = await req('POST', '/api/push/subscribe', {
    subscription: {
      endpoint: endpoint + '-device2',
      keys: { p256dh: 'dGVzdC1wMjU2ZGg=', auth: 'dGVzdC1hdXRoMg==' }
    }
  }, ownerA.token);
  assert.equal(second.status, 201);
  const count = db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=? AND active=1').get(ownerA.user.id).n;
  assert.ok(count >= 2);

  const un = await req('DELETE', '/api/push/subscribe', { endpoint }, ownerA.token);
  assert.equal(un.status, 200);
  assert.equal(un.data.removed, 1);

  const clientDenied = await req('POST', '/api/push/test', {}, clientA.token);
  assert.equal(clientDenied.status, 403);
});

test('falha de push não quebra criação de mensagem', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id, title: 'Push fail ok', description: 'ini'
  }, ownerA.token);
  // assinatura inválida (endpoint fake) — serviço não deve bloquear mensagem
  await req('POST', '/api/push/subscribe', {
    subscription: {
      endpoint: 'https://invalid.push.test/' + crypto.randomUUID(),
      keys: { p256dh: 'YmFkLWtleQ==', auth: 'YmFkLWF1dGg=' }
    }
  }, ownerA.token);

  const msg = await req('POST', '/api/client/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'Mensagem mesmo com push inválido'
  }, clientA.token);
  assert.equal(msg.status, 201, JSON.stringify(msg.data));
  const saved = db.prepare('SELECT message FROM request_messages WHERE id=?').get(msg.data.id);
  assert.equal(saved.message, 'Mensagem mesmo com push inválido');
});

test('evento REQUEST_MESSAGE_CREATED e última mensagem na listagem', async () => {
  const created = await req('POST', '/api/solicitacoes', {
    company_id: companyA1.id, title: 'Evento msg', description: 'Primeira'
  }, ownerA.token);
  await req('POST', '/api/client/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'Última do cliente'
  }, clientA.token);
  const ev = db.prepare("SELECT * FROM domain_events WHERE event_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 1")
    .get(EVENT_TYPES.REQUEST_MESSAGE_CREATED, created.data.id);
  assert.ok(ev);
  const list = await req('GET', '/api/solicitacoes?page=1&page_size=50', undefined, ownerA.token, companyA1.id);
  const item = (list.data.items || []).find(x => x.id === created.data.id);
  assert.ok(item);
  assert.equal(item.last_message.message, 'Última do cliente');
});

test('migração preserva client_request_responses legados', async () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN('client_request_responses','request_messages')").all().map(x => x.name);
  assert.ok(tables.includes('client_request_responses'));
  assert.ok(tables.includes('request_messages'));
});

test('frontend: Abrir conversa / sem Abrir empresa no contexto', () => {
  const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(js, /Abrir conversa/);
  assert.match(js, /openRequestConversation/);
  assert.match(js, /req-chat/);
  // dentro da empresa não deve haver botão Abrir empresa na lista de solicitações
  const block = js.slice(js.indexOf('async function requests(c)'), js.indexOf('async function importsPage'));
  assert.ok(!block.includes('Abrir empresa'));
});

test('service worker e push client presentes', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../frontend/public/service-worker.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /CDS_PUSH_OPEN/);
  const pc = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/push-client.js'), 'utf8');
  assert.match(pc, /subscribePush/);
  assert.ok(!pc.includes('WEB_PUSH_VAPID_PRIVATE'));
});
