/* Sprint 28.1 / 28.1.1 / 28.2 — Web Push Service Worker (payload canônico) */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function buildOptions(data) {
  const title = String(data.title || 'CDS Contábil Connect');
  const preview = data.preview ? String(data.preview).trim() : '';
  let body = String(data.body || 'Nova atualização');
  if (preview && body.indexOf('"' + preview) === -1 && body.indexOf(preview) === -1) {
    body = (body + '\n"' + preview + '"').slice(0, 220);
  }
  const url = String((data.data && data.data.url) || data.url || '/');
  const companyId = (data.data && data.data.company_id) || data.company_id || null;
  const entityType = (data.data && data.data.entity_type) || data.entity_type || null;
  const entityId = (data.data && data.data.entity_id) || data.entity_id || null;
  const page = (data.data && data.data.page) || data.page || null;
  const type = data.type || 'REQUEST_MESSAGE';
  const options = {
    body,
    icon: data.icon || '/assets/cds-pwa-192.png',
    badge: data.badge || '/assets/cds-push-badge.png',
    data: {
      url,
      type,
      company_id: companyId,
      request_id: data.request_id || (type && String(type).indexOf('REQUEST') === 0 ? entityId : null),
      message_id: data.message_id || null,
      tenant_id: data.tenant_id || (data.data && data.data.tenant_id) || null,
      entity_type: entityType,
      entity_id: entityId,
      page,
      preview: preview || null
    },
    tag: data.tag || (data.request_id ? ('request:' + data.request_id) : (entityId ? (String(type).toLowerCase() + ':' + entityId) : ('cds-' + Date.now()))),
    renotify: true,
    requireInteraction: false
  };
  if (Array.isArray(data.actions) && data.actions.length) {
    options.actions = data.actions.slice(0, 2).map((a) => ({
      action: String(a.action || 'open'),
      title: String(a.title || (a.action === 'company' ? 'Ir para a empresa' : 'Abrir'))
    }));
  } else {
    options.actions = [
      { action: 'open', title: 'Abrir conversa' },
      { action: 'company', title: 'Ir para a empresa' }
    ];
  }
  return { title, options };
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try { data = { body: event.data && event.data.text() }; } catch { data = {}; }
  }
  if (data && typeof data.body === 'string') {
    data.body = data.body
      .replace(/\s*via\s+Microsoft Edge/gi, '')
      .replace(/\s*via\s+Google Chrome/gi, '')
      .replace(/\s*via\s+Brave/gi, '')
      .replace(/\blocalhost(:\d+)?\b/gi, '')
      .trim();
  }
  if (!data.title || /localhost/i.test(String(data.title))) {
    data.title = 'CDS Contábil Connect';
  }
  const built = buildOptions(data);
  event.waitUntil(self.registration.showNotification(built.title, built.options));
});

async function openTarget(targetUrl, data) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of all) {
    try {
      const u = new URL(client.url);
      if (u.origin === self.location.origin) {
        client.postMessage({
          type: 'CDS_PUSH_OPEN',
          url: targetUrl,
          company_id: data.company_id,
          request_id: data.request_id,
          entity_type: data.entity_type,
          entity_id: data.entity_id,
          page: data.page,
          action: data.action || 'open'
        });
        if ('focus' in client) await client.focus();
        return;
      }
    } catch { /* continue */ }
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow(targetUrl);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = Object.assign({}, event.notification.data || {});
  data.action = event.action || 'open';
  let targetUrl = data.url || '/';
  if (data.action === 'company' && data.company_id) {
    if (String(targetUrl).includes('/portal')) {
      targetUrl = '/portal/';
    } else {
      targetUrl = '/empresas/' + data.company_id;
    }
  }
  event.waitUntil(openTarget(targetUrl, data));
});
