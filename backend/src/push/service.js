'use strict';

const webpush = require('web-push');
const { resolveVapid } = require('./vapid');
const { createRequestService } = require('../requests/service');

function createPushService({ db, id, auditSystem, config }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const qRows = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);
  const requestService = createRequestService({ db, id });
  const vapid = resolveVapid(process.env);
  let webPushReady = false;

  if (vapid.configured) {
    try {
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      webPushReady = true;
    } catch (e) {
      console.warn('web_push_vapid_invalid', e && e.message);
      webPushReady = false;
    }
  }

  function publicKey() {
    return { configured: webPushReady, publicKey: webPushReady ? vapid.publicKey : null };
  }

  function status(userId, tenantId) {
    const active = one(
      'SELECT COUNT(*) n FROM push_subscriptions WHERE tenant_id=? AND user_id=? AND active=1',
      tenantId, userId
    ).n;
    const prefsRow = prefs(userId, tenantId);
    return {
      configured: webPushReady,
      active_subscriptions: active,
      subscribed: active > 0,
      requests_enabled: prefsRow.requests_enabled,
      documents_enabled: prefsRow.documents_enabled,
      expenses_enabled: prefsRow.expenses_enabled,
      classification_enabled: prefsRow.classification_enabled,
      approval_enabled: prefsRow.approval_enabled,
      processes_enabled: prefsRow.processes_enabled,
      integrations_enabled: prefsRow.integrations_enabled,
      push_enabled: prefsRow.push_enabled
    };
  }

  function prefs(userId, tenantId) {
    let row = one('SELECT * FROM user_notification_prefs WHERE user_id=?', userId);
    if (!row) {
      exec(
        `INSERT OR IGNORE INTO user_notification_prefs(
          user_id,tenant_id,requests_enabled,documents_enabled,expenses_enabled,
          classification_enabled,approval_enabled,processes_enabled,integrations_enabled,
          push_enabled,visual_enabled,sound_enabled
        ) VALUES(?,?,1,1,1,1,1,1,1,1,1,0)`,
        userId, tenantId
      );
      row = one('SELECT * FROM user_notification_prefs WHERE user_id=?', userId) || {
        requests_enabled: 1, documents_enabled: 1, expenses_enabled: 1,
        classification_enabled: 1, approval_enabled: 1, processes_enabled: 1,
        integrations_enabled: 1, push_enabled: 1, visual_enabled: 1, sound_enabled: 0
      };
    }
    const on = (v) => v == null ? true : Number(v) !== 0;
    return {
      requests_enabled: Number(row.requests_enabled) !== 0,
      documents_enabled: on(row.documents_enabled),
      expenses_enabled: on(row.expenses_enabled),
      classification_enabled: on(row.classification_enabled),
      approval_enabled: on(row.approval_enabled),
      processes_enabled: on(row.processes_enabled),
      integrations_enabled: on(row.integrations_enabled),
      push_enabled: Number(row.push_enabled) !== 0,
      visual_enabled: Number(row.visual_enabled) !== 0,
      sound_enabled: Number(row.sound_enabled) === 1
    };
  }

  function savePrefs(userId, tenantId, body) {
    const cur = prefs(userId, tenantId);
    const next = {
      requests_enabled: body.requests_enabled != null ? !!body.requests_enabled : cur.requests_enabled,
      documents_enabled: body.documents_enabled != null ? !!body.documents_enabled : cur.documents_enabled,
      expenses_enabled: body.expenses_enabled != null ? !!body.expenses_enabled : cur.expenses_enabled,
      classification_enabled: body.classification_enabled != null ? !!body.classification_enabled : cur.classification_enabled,
      approval_enabled: body.approval_enabled != null ? !!body.approval_enabled : cur.approval_enabled,
      processes_enabled: body.processes_enabled != null ? !!body.processes_enabled : cur.processes_enabled,
      integrations_enabled: body.integrations_enabled != null ? !!body.integrations_enabled : cur.integrations_enabled,
      push_enabled: body.push_enabled != null ? !!body.push_enabled : cur.push_enabled,
      visual_enabled: body.visual_enabled != null ? !!body.visual_enabled : cur.visual_enabled,
      sound_enabled: body.sound_enabled != null ? !!body.sound_enabled : cur.sound_enabled
    };
    exec(
      `INSERT INTO user_notification_prefs(
         user_id,tenant_id,requests_enabled,documents_enabled,expenses_enabled,
         classification_enabled,approval_enabled,processes_enabled,integrations_enabled,
         push_enabled,visual_enabled,sound_enabled,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         requests_enabled=excluded.requests_enabled,
         documents_enabled=excluded.documents_enabled,
         expenses_enabled=excluded.expenses_enabled,
         classification_enabled=excluded.classification_enabled,
         approval_enabled=excluded.approval_enabled,
         processes_enabled=excluded.processes_enabled,
         integrations_enabled=excluded.integrations_enabled,
         push_enabled=excluded.push_enabled,
         visual_enabled=excluded.visual_enabled,
         sound_enabled=excluded.sound_enabled,
         updated_at=CURRENT_TIMESTAMP`,
      userId, tenantId,
      next.requests_enabled ? 1 : 0,
      next.documents_enabled ? 1 : 0,
      next.expenses_enabled ? 1 : 0,
      next.classification_enabled ? 1 : 0,
      next.approval_enabled ? 1 : 0,
      next.processes_enabled ? 1 : 0,
      next.integrations_enabled ? 1 : 0,
      next.push_enabled ? 1 : 0,
      next.visual_enabled ? 1 : 0,
      next.sound_enabled ? 1 : 0
    );
    return prefs(userId, tenantId);
  }

  function subscribe({ tenantId, userId, subscription, userAgent }) {
    const endpoint = String(subscription && subscription.endpoint || '').trim();
    const keys = (subscription && subscription.keys) || {};
    const p256dh = String(keys.p256dh || '').trim();
    const auth = String(keys.auth || '').trim();
    if (!endpoint || !p256dh || !auth) {
      const err = new Error('Assinatura Push inválida.');
      err.code = 'INVALID_SUBSCRIPTION';
      err.http = 400;
      throw err;
    }
    const existing = one('SELECT * FROM push_subscriptions WHERE endpoint=?', endpoint);
    if (existing) {
      if (existing.tenant_id !== tenantId || existing.user_id !== userId) {
        const err = new Error('Endpoint já vinculado a outro usuário.');
        err.code = 'ENDPOINT_CONFLICT';
        err.http = 409;
        throw err;
      }
      exec(
        `UPDATE push_subscriptions SET p256dh=?, auth=?, user_agent=?, active=1, updated_at=CURRENT_TIMESTAMP, last_used_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        p256dh, auth, userAgent || null, existing.id
      );
      return one('SELECT id,tenant_id,user_id,active,created_at,updated_at FROM push_subscriptions WHERE id=?', existing.id);
    }
    const sid = id();
    exec(
      `INSERT INTO push_subscriptions(id,tenant_id,user_id,endpoint,p256dh,auth,user_agent,active,last_used_at)
       VALUES(?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`,
      sid, tenantId, userId, endpoint, p256dh, auth, userAgent || null
    );
    return one('SELECT id,tenant_id,user_id,active,created_at,updated_at FROM push_subscriptions WHERE id=?', sid);
  }

  function unsubscribe({ tenantId, userId, endpoint }) {
    const ep = String(endpoint || '').trim();
    if (!ep) {
      const err = new Error('Endpoint obrigatório.');
      err.code = 'ENDPOINT_REQUIRED';
      err.http = 400;
      throw err;
    }
    const row = one('SELECT * FROM push_subscriptions WHERE endpoint=? AND tenant_id=? AND user_id=?', ep, tenantId, userId);
    if (!row) return { ok: true, removed: 0 };
    exec('UPDATE push_subscriptions SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?', row.id);
    return { ok: true, removed: 1 };
  }

  function deactivate(endpoint) {
    exec(
      'UPDATE push_subscriptions SET active=0, updated_at=CURRENT_TIMESTAMP WHERE endpoint=?',
      endpoint
    );
  }

  function buildRequestPayload(input) {
    const isClient = String(input.actorRole || '').toUpperCase() === 'CLIENT';
    const company = String(input.companyName || 'Empresa').trim();
    const preview = String(input.preview || '').trim().slice(0, 100);
    const requestTitle = String(input.title || 'solicitação').trim().slice(0, 80);
    const line2 = isClient
      ? `${company} respondeu à solicitação.`
      : `${company}\nO escritório respondeu à solicitação.`;
    const bodyParts = ['Nova mensagem', line2];
    if (preview) bodyParts.push(`"${preview}"`);
    else if (requestTitle) bodyParts.push(requestTitle);
    const url = isClient
      ? `/empresas/${input.companyId}/solicitacoes/${input.requestId}`
      : `/portal/?solicitacao=${encodeURIComponent(input.requestId)}`;
    return {
      type: 'REQUEST_MESSAGE',
      tenant_id: input.tenantId || null,
      company_id: input.companyId,
      request_id: input.requestId,
      message_id: input.messageId || null,
      title: 'CDS Contábil Connect',
      body: bodyParts.join('\n').slice(0, 220),
      url,
      icon: '/assets/cds-pwa-192.png',
      badge: '/assets/cds-push-badge.png',
      tag: input.requestId ? ('request-' + input.requestId) : undefined,
      actions: [
        { action: 'open', title: 'Abrir conversa' },
        { action: 'company', title: 'Ir para a empresa' }
      ]
    };
  }

  async function sendToUser({ tenantId, userId, payload, auditCtx, skipPrefsCheck }) {
    if (!webPushReady) return { sent: 0, failed: 0, skipped: 'not_configured', subscriptions: 0 };
    if (!skipPrefsCheck) {
      const userPrefs = prefs(userId, tenantId);
      if (!userPrefs.push_enabled) {
        return { sent: 0, failed: 0, skipped: 'prefs_off', subscriptions: 0 };
      }
      // Compat 28.1: REQUEST_* ainda respeita requests_enabled quando chamado direto
      const t = String(payload && payload.type || '');
      if ((t === 'REQUEST_MESSAGE' || t === 'REQUEST_CREATED' || !t) && !userPrefs.requests_enabled) {
        return { sent: 0, failed: 0, skipped: 'prefs_off', subscriptions: 0 };
      }
    }
    const subs = qRows(
      'SELECT * FROM push_subscriptions WHERE tenant_id=? AND user_id=? AND active=1',
      tenantId, userId
    );
    if (!subs.length) {
      return { sent: 0, failed: 0, skipped: 'no_subscriptions', subscriptions: 0 };
    }
    let sent = 0;
    let failed = 0;
    const safePayload = {
      type: payload.type || 'REQUEST_MESSAGE',
      tenant_id: tenantId,
      company_id: payload.company_id || null,
      request_id: payload.request_id || null,
      message_id: payload.message_id || null,
      entity_type: payload.entity_type || null,
      entity_id: payload.entity_id || null,
      page: payload.page || null,
      preview: payload.preview ? String(payload.preview).slice(0, 100) : null,
      title: String(payload.title || 'CDS Contábil Connect').slice(0, 80),
      body: String(payload.body || '').slice(0, 220),
      url: payload.url || '/',
      icon: payload.icon || '/assets/cds-pwa-192.png',
      badge: payload.badge || '/assets/cds-push-badge.png',
      tag: payload.tag || null,
      actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : undefined,
      data: payload.data || undefined
    };
    const failures = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(safePayload),
          { TTL: 60 * 60 }
        );
        exec('UPDATE push_subscriptions SET last_used_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?', sub.id);
        sent += 1;
        if (auditSystem) {
          try {
            auditSystem({
              tenantId,
              userId: auditCtx && auditCtx.actorUserId,
              action: 'PUSH_SENT',
              entityType: 'PUSH_SUBSCRIPTION',
              entityId: sub.id,
              after: {
                user_id: userId,
                type: safePayload.type,
                request_id: safePayload.request_id,
                company_id: safePayload.company_id,
                result: 'sent'
              }
            });
          } catch { /* ignore */ }
        }
      } catch (err) {
        failed += 1;
        const statusCode = err && (err.statusCode || err.status);
        const code = err && (err.code || err.body || null);
        if (statusCode === 404 || statusCode === 410) {
          deactivate(sub.endpoint);
        }
        failures.push({ statusCode: statusCode || null, code: code ? String(code).slice(0, 40) : null });
        if (auditSystem) {
          try {
            auditSystem({
              tenantId,
              userId: auditCtx && auditCtx.actorUserId,
              action: 'PUSH_FAILED',
              entityType: 'PUSH_SUBSCRIPTION',
              entityId: sub.id,
              after: {
                user_id: userId,
                statusCode: statusCode || null,
                request_id: safePayload.request_id,
                company_id: safePayload.company_id,
                result: 'failed'
              }
            });
          } catch { /* ignore */ }
        }
      }
    }
    return { sent, failed, skipped: null, subscriptions: subs.length, failures };
  }

  async function notifyRequestMessage(input) {
    const empty = {
      direction: null, recipients: [], results: [], attempts: 0, payload: null
    };
    try {
      const request = one(
        'SELECT * FROM requests WHERE tenant_id=? AND company_id=? AND id=?',
        input.tenantId, input.companyId, input.requestId
      );
      if (!request) return { ...empty, skipped: 'request_not_found' };

      const recipients = requestService.messageRecipients({
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        request
      });
      const isClient = String(input.actorRole || '').toUpperCase() === 'CLIENT';
      const direction = isClient ? 'client_to_office' : 'office_to_client';
      const payload = buildRequestPayload({
        ...input,
        tenantId: input.tenantId,
        messageId: input.messageId || null
      });
      const results = [];
      for (const uid of recipients) {
        const r = await sendToUser({
          tenantId: input.tenantId,
          userId: uid,
          payload,
          auditCtx: { actorUserId: input.actorUserId }
        });
        results.push({ user_id: uid, ...r });
        if (r.skipped === 'no_subscriptions') {
          console.warn('push_skipped_no_subscriptions', {
            direction,
            user_id: uid,
            request_id: input.requestId,
            company_id: input.companyId
          });
        }
      }
      return {
        direction,
        recipients,
        results,
        attempts: results.length,
        payload: {
          title: payload.title,
          body: payload.body,
          url: payload.url,
          type: payload.type,
          company_id: payload.company_id,
          request_id: payload.request_id
        }
      };
    } catch (e) {
      console.error('notify_request_message_failed', e && e.message);
      return { ...empty, skipped: 'exception', error: String(e && e.message || 'error').slice(0, 120) };
    }
  }

  async function sendTest({ tenantId, userId, actorUserId }) {
    return sendToUser({
      tenantId,
      userId,
      payload: {
        type: 'PUSH_TEST',
        title: 'CDS Contábil Connect',
        body: 'Nova mensagem\nNotificação de teste do CDS Contábil Connect.',
        url: '/configuracoes',
        company_id: null,
        request_id: null,
        icon: '/assets/cds-pwa-192.png',
        badge: '/assets/cds-push-badge.png'
      },
      auditCtx: { actorUserId }
    });
  }

  return {
    publicKey,
    status,
    prefs,
    savePrefs,
    subscribe,
    unsubscribe,
    sendToUser,
    notifyRequestMessage,
    buildRequestPayload,
    sendTest,
    isConfigured: () => webPushReady
  };
}

module.exports = { createPushService };
