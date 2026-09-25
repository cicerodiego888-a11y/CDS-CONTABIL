/* Sprint 28.1 / 28.1.1 — Web Push client helpers */
(function (global) {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function detectBrowser() {
    const ua = navigator.userAgent || '';
    // Brave se identifica como Chrome no UA; usar API do próprio Brave
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') return 'Brave';
    if (/Brave/i.test(ua)) return 'Brave';
    if (/Edg\//.test(ua)) return 'Microsoft Edge';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Google Chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    return 'este navegador';
  }

  function resolveSwConfig() {
    const path = String((global.location && global.location.pathname) || '');
    if (path.indexOf('/portal') === 0) {
      return { url: '/portal/service-worker.js', scope: '/portal/' };
    }
    return { url: '/service-worker.js', scope: '/' };
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    const cfg = resolveSwConfig();
    const reg = await navigator.serviceWorker.register(cfg.url, { scope: cfg.scope });
    if (reg.installing) {
      await new Promise((resolve) => {
        reg.installing.addEventListener('statechange', function onChange() {
          if (this.state === 'activated' || this.state === 'redundant') {
            this.removeEventListener('statechange', onChange);
            resolve();
          }
        });
      });
    }
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function getPublicKey(api) {
    const info = await api('/push/public-key');
    if (!info || !info.configured || !info.publicKey) return null;
    return info.publicKey;
  }

  async function localSubscription() {
    const reg = await ensureServiceWorker();
    if (!reg || !reg.pushManager) return null;
    return reg.pushManager.getSubscription();
  }

  async function permissionState() {
    if (!('Notification' in global)) return 'unsupported';
    return Notification.permission;
  }

  function classifySubscribeError(err, permission) {
    const msg = String((err && err.message) || err || '').toLowerCase();
    const name = String((err && err.name) || '');
    if (permission === 'denied') return 'denied';
    if (permission === 'default') return 'dismissed';
    if (
      name === 'AbortError' ||
      name === 'NotAllowedError' ||
      /registration failed|push service|gcm|fcm|messaging|blocked|not supported/i.test(msg)
    ) {
      return detectBrowser() === 'Brave' ? 'brave_push_blocked' : 'push_blocked';
    }
    return 'error';
  }

  async function subscribePush(api) {
    const reg = await ensureServiceWorker();
    if (!reg) throw Object.assign(new Error('Service Worker indisponível neste navegador.'), { code: 'no_sw' });
    if (!reg.pushManager) {
      throw Object.assign(new Error('Push não disponível neste navegador.'), { code: 'no_push_manager' });
    }
    const key = await getPublicKey(api);
    if (!key) throw Object.assign(new Error('Web Push não configurado no servidor (VAPID).'), { code: 'not_configured' });
    if (!('Notification' in global)) {
      throw Object.assign(new Error('Notificações não suportadas neste navegador.'), { code: 'unsupported' });
    }
    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      const code = permission === 'denied' ? 'denied' : 'dismissed';
      throw Object.assign(new Error(code === 'denied' ? 'Permissão de notificação negada.' : 'Permissão não concedida.'), { code, permission });
    }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key)
        });
      } catch (err) {
        const code = classifySubscribeError(err, permission);
        throw Object.assign(new Error(err && err.message ? err.message : 'Falha ao assinar push.'), { code, permission, cause: err });
      }
    }
    await api('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    return sub;
  }

  async function ensurePushReady(api, options) {
    const opts = options || {};
    const prompt = opts.prompt === true;
    const result = {
      configured: false,
      permission: await permissionState(),
      subscribed: false,
      synced: false,
      reason: null,
      browser: detectBrowser()
    };
    try {
      const key = await getPublicKey(api);
      result.configured = !!key;
      if (!key) {
        result.reason = 'not_configured';
        return result;
      }
      if (result.permission === 'unsupported') {
        result.reason = 'unsupported';
        return result;
      }
      if (result.permission === 'denied') {
        result.reason = 'denied';
        return result;
      }
      if (result.permission === 'granted') {
        await subscribePush(api);
        result.subscribed = true;
        result.synced = true;
        result.permission = 'granted';
        return result;
      }
      if (prompt && result.permission === 'default') {
        try {
          await subscribePush(api);
          result.permission = await permissionState();
          result.subscribed = result.permission === 'granted';
          result.synced = result.subscribed;
          if (!result.subscribed) {
            result.reason = result.permission === 'denied' ? 'denied' : 'dismissed';
          }
          return result;
        } catch (err) {
          result.permission = await permissionState();
          result.reason = (err && err.code) || classifySubscribeError(err, result.permission);
          return result;
        }
      }
      const local = await localSubscription();
      result.subscribed = !!local;
      result.reason = 'needs_permission';
      return result;
    } catch (err) {
      result.permission = await permissionState();
      result.reason = (err && err.code) || classifySubscribeError(err, result.permission);
      return result;
    }
  }

  async function unsubscribePush(api) {
    const reg = await ensureServiceWorker();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  }

  global.CdsPush = {
    ensureServiceWorker,
    resolveSwConfig,
    subscribePush,
    ensurePushReady,
    unsubscribePush,
    getPublicKey,
    permissionState,
    localSubscription,
    detectBrowser
  };

  function connectRealtime(token, handlers) {
    const h = handlers || {};
    if (typeof EventSource === 'undefined') {
      return { close() {}, connected: false };
    }
    let es = null;
    let closed = false;
    let retryMs = 1000;
    function open() {
      if (closed) return;
      try { if (es) es.close(); } catch { /* */ }
      const useQuery = token && token !== 'cookie';
      const url = useQuery
        ? '/api/realtime/stream?token=' + encodeURIComponent(token)
        : '/api/realtime/stream';
      es = new EventSource(url);
      es.addEventListener('connected', () => {
        retryMs = 1000;
        if (h.onConnected) h.onConnected();
      });
      es.addEventListener('notification', (ev) => {
        let data = {};
        try { data = JSON.parse(ev.data || '{}'); } catch { data = {}; }
        if (h.onNotification) h.onNotification(data);
      });
      es.onerror = () => {
        try { es.close(); } catch { /* */ }
        if (closed) return;
        const wait = retryMs;
        retryMs = Math.min(retryMs * 2, 15000);
        setTimeout(open, wait);
      };
    }
    open();
    return {
      connected: true,
      close() {
        closed = true;
        try { if (es) es.close(); } catch { /* */ }
      }
    };
  }

  global.CdsRealtime = { connect: connectRealtime };
})(window);
