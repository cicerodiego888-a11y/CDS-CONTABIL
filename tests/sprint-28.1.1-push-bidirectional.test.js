'use strict';

/**
 * Sprint 28.1.1 — diagnóstico bidirecional do Web Push.
 * Prova a assimetria: escritório com subscription recebe;
 * cliente sem subscription NÃO recebe (mesmo com destinatário correto).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-s2811-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-sprint-28-1-1-secret-ok';
// VAPID de teste (somente ambiente de teste; não é produção)
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:test@cds.local';

try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }

const { app, db } = require('../backend/src/server');
const { createPushService } = require('../backend/src/push/service');
const { createRequestService } = require('../backend/src/requests/service');

let server, base, owner, company, client;
const password = 'Senha@123';
const id = () => crypto.randomUUID();

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

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await req('POST', '/api/auth/register', {
    name: 'Escritório 28.1.1', email: 'owner.s2811@test.local', password, tenantName: 'Tenant 2811'
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  owner = (await req('POST', '/api/auth/login', {
    email: 'owner.s2811@test.local', password, tenant: a.data.tenant_slug
  })).data;
  company = (await req('POST', '/api/empresas', {
    name: 'SCOSY EMPREENDIMENTOS', trade_name: 'SCOSY', cnpj: '11222333000181'
  }, owner.token)).data;
  const u = await req('POST', `/api/empresas/${company.id}/users`, {
    name: 'Cliente Portal', email: 'cli.s2811@test.local', profile: 'CLIENT_FINANCE'
  }, owner.token);
  const token = u.data.invitation.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + token + '/accept', {
    name: 'Cliente Portal', password, confirmation: password
  });
  assert.equal(acc.status, 200);
  client = acc.data;
});

after(() => {
  server.close();
  try { db.close(); } catch { /* */ }
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch { /* */ }
});

function fakeSub(suffix) {
  return {
    endpoint: 'https://push.example.test/cds/' + suffix + '/' + crypto.randomUUID(),
    keys: { p256dh: Buffer.from('p256dh-' + suffix).toString('base64'), auth: Buffer.from('auth-' + suffix).toString('base64') }
  };
}

test('CORREÇÃO: Portal Cliente registra subscription (mesmo mecanismo do escritório)', () => {
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  const pushClient = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/push-client.js'), 'utf8');
  assert.match(index, /push-client\.js/);
  assert.match(portal, /subscribePush|ensurePushReady|syncPortalPush/);
  assert.match(portal, /Ativar (push|notifica)/i);
  assert.match(portal, /solicitacao/);
  assert.match(portal, /pushEnableBanner|push-enable-banner|pushPermissionModal/);
  assert.match(portal, /Permitir (notifica|neste navegador)|Ativar notifica/i);
  assert.match(pushClient, /ensurePushReady|requestPermission|detectBrowser|Brave/);
  assert.match(portal, /brave:\/\/settings|Brave|pushFailToast|Permitir neste navegador/);
  assert.match(appJs, /subscribePush/);
  assert.match(appJs, /Ativar push|Permitir neste navegador/);
});

test('GET /api/push/status reflete subscription ativa do usuário', async () => {
  const before = await req('GET', '/api/push/status', undefined, client.token);
  assert.equal(before.status, 200);
  assert.equal(before.data.subscribed, false);
  assert.equal(before.data.active_subscriptions, 0);

  const fake = fakeSub('status-client');
  const sub = await req('POST', '/api/push/subscribe', { subscription: fake }, client.token);
  assert.equal(sub.status, 201);

  const after = await req('GET', '/api/push/status', undefined, client.token);
  assert.equal(after.status, 200);
  assert.equal(after.data.subscribed, true);
  assert.ok(after.data.active_subscriptions >= 1);
  assert.equal(after.data.configured, true);

  // Limpa para não contaminar o teste de assimetria (sem subscription)
  const un = await req('DELETE', '/api/push/subscribe', { endpoint: fake.endpoint }, client.token);
  assert.equal(un.status, 200);
  const cleared = await req('GET', '/api/push/status', undefined, client.token);
  assert.equal(cleared.data.subscribed, false);
});

test('CLIENTE→ESCRITÓRIO: destinatários corretos; com subscription do contador, send tenta envio', async () => {
  const push = createPushService({ db, id });
  const requests = createRequestService({ db, id });
  assert.equal(push.isConfigured(), true);

  // Contador assina
  const sub = await req('POST', '/api/push/subscribe', { subscription: fakeSub('office') }, owner.token);
  assert.equal(sub.status, 201, JSON.stringify(sub.data));

  const created = await req('POST', '/api/solicitacoes', {
    company_id: company.id, title: 'Fluxo A', description: 'Ini'
  }, owner.token);
  const msg = await req('POST', '/api/client/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'Cliente falou'
  }, client.token);
  assert.equal(msg.status, 201);

  const recipients = requests.messageRecipients({
    tenantId: owner.user.tenant_id,
    companyId: company.id,
    actorUserId: client.user.id,
    actorRole: 'CLIENT',
    request: db.prepare('SELECT * FROM requests WHERE id=?').get(created.data.id)
  });
  assert.ok(recipients.includes(owner.user.id), 'escritório deve ser destinatário');
  assert.ok(!recipients.includes(client.user.id));

  const officeSubs = db.prepare(
    'SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=? AND active=1'
  ).get(owner.user.id).n;
  assert.ok(officeSubs >= 1, 'contador precisa ter subscription para o fluxo que funciona');

  const result = await push.notifyRequestMessage({
    tenantId: owner.user.tenant_id,
    companyId: company.id,
    requestId: created.data.id,
    actorUserId: client.user.id,
    actorRole: 'CLIENT',
    title: 'Fluxo A',
    companyName: 'SCOSY',
    preview: 'Cliente falou'
  });
  assert.ok(result);
  assert.ok(result.recipients.includes(owner.user.id));
  assert.equal(result.direction, 'client_to_office');
  // Endpoint fake → failed, mas tentativa ocorreu (não skipped por falta de sub)
  assert.ok(result.attempts >= 1);
  assert.ok(result.results.some(r => r.user_id === owner.user.id && (r.sent > 0 || r.failed > 0 || r.skipped !== 'no_subscriptions')));
});

test('CONTABILIDADE→CLIENTE: destinatário CLIENT correto; SEM subscription → skipped no_subscriptions', async () => {
  const push = createPushService({ db, id });
  const requests = createRequestService({ db, id });

  const clientSubsBefore = db.prepare(
    'SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=? AND active=1'
  ).get(client.user.id).n;
  assert.equal(clientSubsBefore, 0, 'cliente ainda sem subscription = causa raiz do teste real');

  const created = await req('POST', '/api/solicitacoes', {
    company_id: company.id, title: 'Fluxo B', description: 'Ini escritório'
  }, owner.token);
  await req('POST', '/api/solicitacoes/' + created.data.id + '/mensagens', {
    message: 'Escritório respondeu'
  }, owner.token, company.id);

  const recipients = requests.messageRecipients({
    tenantId: owner.user.tenant_id,
    companyId: company.id,
    actorUserId: owner.user.id,
    actorRole: 'OWNER',
    request: db.prepare('SELECT * FROM requests WHERE id=?').get(created.data.id)
  });
  assert.deepEqual(recipients, [client.user.id], 'destinatário CLIENT está correto');

  const result = await push.notifyRequestMessage({
    tenantId: owner.user.tenant_id,
    companyId: company.id,
    requestId: created.data.id,
    actorUserId: owner.user.id,
    actorRole: 'OWNER',
    title: 'Fluxo B',
    companyName: 'SCOSY',
    preview: 'Escritório respondeu'
  });
  assert.equal(result.direction, 'office_to_client');
  assert.deepEqual(result.recipients, [client.user.id]);
  const clientResult = result.results.find(r => r.user_id === client.user.id);
  assert.ok(clientResult);
  assert.equal(clientResult.skipped, 'no_subscriptions',
    'PONTO DE DIVERGÊNCIA: destinatário ok, mas zero push_subscriptions ativas do CLIENT');
  assert.equal(clientResult.sent, 0);
});

test('Após CLIENT assinar, CONTABILIDADE→CLIENTE deixa de ser no_subscriptions', async () => {
  const push = createPushService({ db, id });
  const sub = await req('POST', '/api/push/subscribe', { subscription: fakeSub('client') }, client.token);
  assert.equal(sub.status, 201, JSON.stringify(sub.data));
  assert.equal(sub.data.user_id, client.user.id);

  const created = await req('POST', '/api/solicitacoes', {
    company_id: company.id, title: 'Fluxo B2', description: 'Ini'
  }, owner.token);

  const result = await push.notifyRequestMessage({
    tenantId: owner.user.tenant_id,
    companyId: company.id,
    requestId: created.data.id,
    actorUserId: owner.user.id,
    actorRole: 'OWNER',
    title: 'Fluxo B2',
    companyName: 'SCOSY',
    preview: 'Agora com sub'
  });
  const clientResult = result.results.find(r => r.user_id === client.user.id);
  assert.ok(clientResult);
  assert.notEqual(clientResult.skipped, 'no_subscriptions');
  assert.ok((clientResult.sent + clientResult.failed) >= 1, 'deve tentar web-push com a subscription do cliente');
});

test('isolamento: mensagem Empresa A não seleciona CLIENT da Empresa B', async () => {
  const requests = createRequestService({ db, id });
  const companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B', cnpj: '22333444000192'
  }, owner.token)).data;
  const u = await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'cli.b.s2811@test.local', profile: 'CLIENT_FINANCE'
  }, owner.token);
  const tok = u.data.invitation.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    name: 'Cliente B', password, confirmation: password
  });
  const clientB = acc.data;

  const created = await req('POST', '/api/solicitacoes', {
    company_id: company.id, title: 'Só A', description: 'x'
  }, owner.token);
  const recipients = requests.messageRecipients({
    tenantId: owner.user.tenant_id,
    companyId: company.id,
    actorUserId: owner.user.id,
    actorRole: 'OWNER',
    request: db.prepare('SELECT * FROM requests WHERE id=?').get(created.data.id)
  });
  assert.ok(recipients.includes(client.user.id));
  assert.ok(!recipients.includes(clientB.user.id));
});

test('payload office→client usa deep-link do portal; client→office usa /empresas', async () => {
  const push = createPushService({ db, id });
  const created = await req('POST', '/api/solicitacoes', {
    company_id: company.id, title: 'Payload', description: 'doc'
  }, owner.token);

  const toClient = push.buildRequestPayload({
    actorRole: 'OWNER',
    companyId: company.id,
    requestId: created.data.id,
    title: 'Payload',
    companyName: 'SCOSY EMPREENDIMENTOS',
    preview: 'Segue o documento conforme solicitado.'
  });
  assert.equal(toClient.title, 'CDS Contábil Connect');
  assert.match(toClient.body, /Nova mensagem/);
  assert.match(toClient.body, /SCOSY/);
  assert.match(toClient.url, /\/portal\//);
  assert.ok(toClient.icon.includes('cds-pwa-192') || toClient.icon.includes('cds-push-icon'));
  assert.ok(!JSON.stringify(toClient).includes(process.env.WEB_PUSH_VAPID_PRIVATE_KEY));

  const toOffice = push.buildRequestPayload({
    actorRole: 'CLIENT',
    companyId: company.id,
    requestId: created.data.id,
    title: 'Payload',
    companyName: 'SCOSY EMPREENDIMENTOS',
    preview: 'Preciso de ajuda'
  });
  assert.match(toOffice.url, /\/empresas\//);
  assert.ok(toOffice.url.includes(created.data.id));
});

test('service worker usa ícone CDS e actions com fallback', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../frontend/public/service-worker.js'), 'utf8');
  assert.match(sw, /cds-pwa-192\.png|cds-push-icon\.png/);
  assert.match(sw, /Abrir conversa/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /CDS Contábil Connect/);
  assert.ok(fs.existsSync(path.join(__dirname, '../frontend/public/assets/cds-pwa-192.png')));
  assert.ok(fs.existsSync(path.join(__dirname, '../frontend/public/assets/cds-push-icon.png')));
});

test('SSE /api/realtime/stream entrega notification office→client em tempo real', async () => {
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  const pushClient = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/push-client.js'), 'utf8');
  assert.match(pushClient, /CdsRealtime|connectRealtime|EventSource/);
  assert.match(portal, /CdsRealtime|__cdsStartPortalRealtime|realtime\/stream/);

  const events = [];
  await new Promise((resolve, reject) => {
    const url = base + '/api/realtime/stream?token=' + encodeURIComponent(client.token);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      reject(new Error('SSE timeout sem notification'));
    }, 8000);

    fetch(url, { headers: { Accept: 'text/event-stream' }, signal: ac.signal })
      .then(async (res) => {
        assert.equal(res.status, 200, 'stream deve autenticar com ?token=');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        // cria solicitação/mensagem enquanto o stream está aberto
        setTimeout(async () => {
          try {
            const created = await req('POST', '/api/solicitacoes', {
              company_id: company.id, title: 'SSE Realtime', description: 'ping sse'
            }, owner.token);
            assert.equal(created.status, 201, JSON.stringify(created.data));
            await req('POST', '/api/solicitacoes/' + created.data.id + '/mensagens', {
              message: 'mensagem sse agora'
            }, owner.token, company.id);
          } catch (e) {
            clearTimeout(timer);
            ac.abort();
            reject(e);
          }
        }, 200);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const chunk of parts) {
            const ev = (chunk.match(/^event:\s*(.+)$/m) || [])[1];
            const dataLine = (chunk.match(/^data:\s*(.+)$/m) || [])[1];
            if (!ev || !dataLine) continue;
            let data = {};
            try { data = JSON.parse(dataLine); } catch { /* */ }
            events.push({ ev, data });
            if (ev === 'notification' && (data.type === 'REQUEST_MESSAGE_CREATED' || data.type === 'REQUEST_CREATED')) {
              clearTimeout(timer);
              ac.abort();
              resolve();
              return;
            }
          }
        }
      })
      .catch((err) => {
        if (err && err.name === 'AbortError' && events.some(e => e.ev === 'notification')) {
          clearTimeout(timer);
          resolve();
          return;
        }
        clearTimeout(timer);
        reject(err);
      });
  });

  assert.ok(events.some(e => e.ev === 'connected'));
  assert.ok(events.some(e => e.ev === 'notification' && e.data.entity_id));
});
