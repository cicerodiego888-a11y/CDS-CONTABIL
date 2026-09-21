'use strict';

const {
  NOTIFICATION_TYPES,
  PREF_KEYS,
  isKnownType,
  prefKeyForType,
  fromDomainEvent,
  DOMAIN_PUSH_TYPES
} = require('./types');
const {
  buildContent,
  buildPushPayload,
  BRAND_TITLE,
  ICON,
  BADGE,
  safePreview
} = require('./templates');
const { createRecipientResolver } = require('./resolver');

function createNotificationService({ db, id, pushService, realtime, auditSystem }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const qRows = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);
  const resolver = createRecipientResolver({ db });

  function audit(action, ctx, after) {
    if (!auditSystem) return;
    try {
      auditSystem({
        tenantId: ctx.tenant_id,
        userId: ctx.actor_user_id || null,
        action,
        entityType: 'NOTIFICATION',
        entityId: ctx.notification_id || ctx.entity_id || null,
        after: after || null
      });
    } catch { /* best-effort */ }
  }

  function defaultPrefs() {
    return {
      requests_enabled: true,
      documents_enabled: true,
      expenses_enabled: true,
      classification_enabled: true,
      approval_enabled: true,
      processes_enabled: true,
      integrations_enabled: true,
      push_enabled: true,
      visual_enabled: true,
      sound_enabled: false
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
      row = one('SELECT * FROM user_notification_prefs WHERE user_id=?', userId);
    }
    const d = defaultPrefs();
    if (!row) return d;
    return {
      requests_enabled: Number(row.requests_enabled) !== 0,
      documents_enabled: row.documents_enabled == null ? true : Number(row.documents_enabled) !== 0,
      expenses_enabled: row.expenses_enabled == null ? true : Number(row.expenses_enabled) !== 0,
      classification_enabled: row.classification_enabled == null ? true : Number(row.classification_enabled) !== 0,
      approval_enabled: row.approval_enabled == null ? true : Number(row.approval_enabled) !== 0,
      processes_enabled: row.processes_enabled == null ? true : Number(row.processes_enabled) !== 0,
      integrations_enabled: row.integrations_enabled == null ? true : Number(row.integrations_enabled) !== 0,
      push_enabled: Number(row.push_enabled) !== 0,
      visual_enabled: Number(row.visual_enabled) !== 0,
      sound_enabled: Number(row.sound_enabled) === 1
    };
  }

  function savePrefs(userId, tenantId, body) {
    const cur = prefs(userId, tenantId);
    const next = { ...cur };
    for (const key of Object.keys(defaultPrefs())) {
      if (body[key] != null) next[key] = !!body[key];
    }
    // aliases do sprint
    if (body.request_message != null) next.requests_enabled = !!body.request_message;
    if (body.document_received != null) next.documents_enabled = !!body.document_received;
    if (body.expense_received != null) next.expenses_enabled = !!body.expense_received;
    if (body.approval_pending != null) next.approval_enabled = !!body.approval_pending;
    if (body.process_overdue != null) next.processes_enabled = !!body.process_overdue;

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

  function categoryEnabled(userPrefs, type) {
    const key = prefKeyForType(type);
    if (key === PREF_KEYS.push) return !!userPrefs.push_enabled;
    return userPrefs[key] !== false;
  }

  function companyName(tenantId, companyId) {
    if (!companyId) return null;
    const c = one('SELECT name, trade_name FROM companies WHERE id=? AND tenant_id=?', companyId, tenantId);
    return c ? (c.trade_name || c.name) : null;
  }

  function insertInApp(row) {
    const nid = row.id || id();
    try {
      exec(
        `INSERT OR IGNORE INTO notifications(
           id,tenant_id,user_id,type,title,message,event_id,company_id,recipient_user_id,
           entity_type,entity_id,context,url,preview,actor_user_id
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        nid,
        row.tenant_id,
        row.recipient_user_id,
        row.type,
        row.title,
        row.message,
        row.event_id || null,
        row.company_id || null,
        row.recipient_user_id,
        row.entity_type || null,
        row.entity_id || null,
        row.context || null,
        row.url || null,
        row.preview || null,
        row.actor_user_id || null
      );
    } catch (e) {
      // Colunas url/preview/actor podem não existir ainda em DB antigo — fallback
      if (String(e.message || '').includes('no such column')) {
        exec(
          `INSERT OR IGNORE INTO notifications(
             id,tenant_id,user_id,type,title,message,event_id,company_id,recipient_user_id,
             entity_type,entity_id,context
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          nid,
          row.tenant_id,
          row.recipient_user_id,
          row.type,
          row.title,
          row.message,
          row.event_id || null,
          row.company_id || null,
          row.recipient_user_id,
          row.entity_type || null,
          row.entity_id || null,
          row.context || null
        );
      } else {
        throw e;
      }
    }
    const created = one('SELECT * FROM notifications WHERE id=?', nid)
      || one(
        'SELECT * FROM notifications WHERE event_id=? AND recipient_user_id=?',
        row.event_id, row.recipient_user_id
      );
    if (created && realtime && typeof realtime.publish === 'function') {
      try {
        realtime.publish(row.recipient_user_id, 'notification', {
          id: created.id,
          type: row.type,
          title: row.title,
          message: row.message,
          context: row.context || null,
          preview: row.preview || null,
          url: row.url || null,
          company_id: row.company_id || null,
          entity_type: row.entity_type || null,
          entity_id: row.entity_id || null,
          event_id: row.event_id || null,
          created_at: created.created_at || new Date().toISOString()
        });
      } catch { /* realtime best-effort */ }
    }
    return created;
  }

  async function sendPushToUser({ tenantId, userId, type, payload, actorUserId, notificationId }) {
    if (!pushService || typeof pushService.sendToUser !== 'function') {
      return { sent: 0, failed: 0, skipped: 'no_push_service' };
    }
    const userPrefs = prefs(userId, tenantId);
    if (!userPrefs.push_enabled) {
      return { sent: 0, failed: 0, skipped: 'prefs_off' };
    }
    if (!categoryEnabled(userPrefs, type)) {
      return { sent: 0, failed: 0, skipped: 'category_off' };
    }
    try {
      const result = await pushService.sendToUser({
        tenantId,
        userId,
        payload,
        auditCtx: { actorUserId },
        skipPrefsCheck: true // já validamos aqui
      });
      audit(
        result.sent > 0 ? 'NOTIFICATION_PUSH_SENT' : (result.failed > 0 ? 'NOTIFICATION_PUSH_FAILED' : 'NOTIFICATION_PUSH_SENT'),
        { tenant_id: tenantId, actor_user_id: actorUserId, notification_id: notificationId, entity_id: payload.entity_id },
        {
          user_id: userId,
          tenant_id: tenantId,
          company_id: payload.company_id || null,
          notification_id: notificationId || null,
          type,
          result: result.sent > 0 ? 'sent' : (result.skipped || (result.failed ? 'failed' : 'skipped')),
          sent: result.sent,
          failed: result.failed,
          statusCode: result.failures && result.failures[0] ? result.failures[0].statusCode : null
        }
      );
      return result;
    } catch (e) {
      audit('NOTIFICATION_PUSH_FAILED', {
        tenant_id: tenantId,
        actor_user_id: actorUserId,
        notification_id: notificationId
      }, {
        user_id: userId,
        type,
        result: 'failed',
        error: String(e && e.message || 'error').slice(0, 80)
      });
      return { sent: 0, failed: 1, skipped: 'exception' };
    }
  }

  /**
   * Pipeline canônico:
   * resolve → validate → prefs → in-app → push → audit
   */
  async function notify(input) {
    const type = input.type;
    if (!type || !isKnownType(type)) {
      return { ok: false, skipped: 'unknown_type', recipients: [], results: [] };
    }
    const tenantId = input.tenant_id;
    if (!tenantId) return { ok: false, skipped: 'tenant_required', recipients: [], results: [] };

    const companyId = input.company_id || null;
    if (companyId) {
      const company = one('SELECT id FROM companies WHERE id=? AND tenant_id=?', companyId, tenantId);
      if (!company) return { ok: false, skipped: 'company_mismatch', recipients: [], results: [] };
    }

    const name = input.company_name || companyName(tenantId, companyId);
    const recipients = resolver.resolve({
      type,
      tenant_id: tenantId,
      company_id: companyId,
      actor_user_id: input.actor_user_id || null,
      actor_role: input.actor_role || null,
      candidate_user_ids: input.recipient_user_ids || input.candidate_user_ids || [],
      request: input.request || null,
      responsible_user_id: input.responsible_user_id || null
    });

    if (!recipients.length) {
      return { ok: true, skipped: 'no_recipients', recipients: [], results: [], payload: null };
    }

    const content = buildContent(type, {
      ...input,
      company_name: name,
      preview: safePreview(input.preview || input.context || '')
    });

    const forClient = recipients.every((uid) => {
      const u = resolver.activeUser(tenantId, uid);
      return u && u.role === 'CLIENT';
    });

    const pushPayload = buildPushPayload(type, {
      ...input,
      tenant_id: tenantId,
      company_id: companyId,
      company_name: name,
      entity_id: input.entity_id,
      entity_type: input.entity_type,
      for_client: forClient || String(input.actor_role || '').toUpperCase() !== 'CLIENT' && type.startsWith('REQUEST'),
      preview: content.preview
    });

    // Correção for_client: se ator é escritório e tipo request → clientes
    if (type.startsWith('REQUEST')) {
      const actorIsClient = String(input.actor_role || '').toUpperCase() === 'CLIENT';
      Object.assign(pushPayload, buildPushPayload(type, {
        ...input,
        tenant_id: tenantId,
        company_id: companyId,
        company_name: name,
        entity_id: input.entity_id || input.request_id,
        entity_type: input.entity_type || 'request',
        for_client: !actorIsClient,
        preview: content.preview
      }));
    }

    const skipInApp = !!input.skip_in_app;
    const skipPush = !!input.skip_push;
    const results = [];

    for (const uid of recipients) {
      const userPrefs = prefs(uid, tenantId);
      if (!categoryEnabled(userPrefs, type)) {
        results.push({ user_id: uid, in_app: false, push: { skipped: 'category_off' } });
        continue;
      }
      if (!userPrefs.visual_enabled && !userPrefs.push_enabled) {
        results.push({ user_id: uid, in_app: false, push: { skipped: 'prefs_off' } });
        continue;
      }

      let notification = null;
      if (!skipInApp && userPrefs.visual_enabled) {
        notification = insertInApp({
          tenant_id: tenantId,
          company_id: companyId,
          recipient_user_id: uid,
          actor_user_id: input.actor_user_id || null,
          type,
          title: content.in_app_title,
          message: content.in_app_message,
          context: content.in_app_context,
          preview: content.preview,
          url: pushPayload.url,
          entity_type: input.entity_type || null,
          entity_id: input.entity_id || null,
          event_id: input.event_id || null
        });
        audit('NOTIFICATION_CREATED', {
          tenant_id: tenantId,
          actor_user_id: input.actor_user_id,
          notification_id: notification && notification.id,
          entity_id: input.entity_id
        }, {
          type,
          recipient_user_id: uid,
          company_id: companyId,
          entity_type: input.entity_type || null,
          entity_id: input.entity_id || null
        });
      }

      let pushResult = { skipped: 'skip_push' };
      if (!skipPush) {
        pushResult = await sendPushToUser({
          tenantId,
          userId: uid,
          type,
          payload: pushPayload,
          actorUserId: input.actor_user_id,
          notificationId: notification && notification.id
        });
      }

      results.push({
        user_id: uid,
        in_app: !!(notification && notification.id),
        notification_id: notification && notification.id,
        push: pushResult
      });
    }

    audit('NOTIFICATION_SENT', {
      tenant_id: tenantId,
      actor_user_id: input.actor_user_id,
      entity_id: input.entity_id
    }, {
      type,
      company_id: companyId,
      recipients: recipients.length,
      attempts: results.length
    });

    return {
      ok: true,
      type,
      recipients,
      results,
      payload: {
        title: pushPayload.title,
        body: pushPayload.body,
        url: pushPayload.url,
        type: pushPayload.type,
        company_id: pushPayload.company_id,
        entity_id: pushPayload.entity_id,
        icon: ICON,
        badge: BADGE
      }
    };
  }

  /**
   * Solicitações — preserva comportamento bidirecional da 28.1.1.
   * In-app já é criado pelo domain-events; aqui focamos push (+ skip_in_app default).
   */
  async function notifyRequestMessage(input) {
    const empty = { direction: null, recipients: [], results: [], attempts: 0, payload: null };
    try {
      const request = one(
        'SELECT * FROM requests WHERE tenant_id=? AND company_id=? AND id=?',
        input.tenantId, input.companyId, input.requestId
      );
      if (!request) return { ...empty, skipped: 'request_not_found' };

      const isClient = String(input.actorRole || '').toUpperCase() === 'CLIENT';
      const direction = isClient ? 'client_to_office' : 'office_to_client';

      const result = await notify({
        type: NOTIFICATION_TYPES.REQUEST_MESSAGE,
        tenant_id: input.tenantId,
        company_id: input.companyId,
        actor_user_id: input.actorUserId,
        actor_role: input.actorRole,
        entity_type: 'request',
        entity_id: input.requestId,
        request_id: input.requestId,
        message_id: input.messageId || null,
        title: input.title,
        preview: input.preview,
        company_name: input.companyName,
        event_id: input.eventId || null,
        request,
        skip_in_app: input.skip_in_app !== false // default: não duplicar in-app do domain-events
      });

      return {
        direction,
        recipients: result.recipients || [],
        results: (result.results || []).map((r) => ({
          user_id: r.user_id,
          ...(r.push || {})
        })),
        attempts: (result.results || []).length,
        payload: result.payload,
        skipped: result.skipped || null
      };
    } catch (e) {
      console.error('notify_request_message_failed', e && e.message);
      return { ...empty, skipped: 'exception', error: String(e && e.message || 'error').slice(0, 120) };
    }
  }

  /**
   * Push complementar após fan-out in-app do domain-events.
   * Não cria nova linha in-app.
   */
  async function deliverPushForDomainEvent(event, companyName, payload, recipientIds) {
    if (!event || !DOMAIN_PUSH_TYPES.has(event.event_type)) {
      return { skipped: 'not_push_eligible' };
    }
    const type = fromDomainEvent(event.event_type);
    if (!type) return { skipped: 'unmapped' };

    let recipients = Array.isArray(recipientIds) && recipientIds.length
      ? recipientIds.filter((uid) => resolver.validateCandidate(
        event.tenant_id,
        event.company_id,
        uid,
        { allowClient: true, allowOffice: true }
      ))
      : resolver.resolve({
        type,
        tenant_id: event.tenant_id,
        company_id: event.company_id,
        actor_user_id: event.actor_user_id,
        responsible_user_id: payload && payload.responsible_user_id
      });

    const actor = event.actor_user_id
      ? resolver.activeUser(event.tenant_id, event.actor_user_id)
      : null;
    const actorRole = actor ? String(actor.role || '').toUpperCase() : '';

    // Documento: cliente→escritório OU escritório→cliente
    if (type === NOTIFICATION_TYPES.DOCUMENT_RECEIVED) {
      if (actorRole === 'CLIENT') {
        recipients = recipients.filter((uid) => {
          const u = resolver.activeUser(event.tenant_id, uid);
          return u && u.role !== 'CLIENT';
        });
      } else {
        recipients = recipients.filter((uid) => {
          const u = resolver.activeUser(event.tenant_id, uid);
          return u && u.role === 'CLIENT';
        });
      }
    } else {
      // Demais tipos operacionais: nunca push para CLIENT
      const officeOnly = new Set([
        NOTIFICATION_TYPES.EXPENSE_RECEIVED,
        NOTIFICATION_TYPES.EXPENSE_CREATED,
        NOTIFICATION_TYPES.REVENUE_RECEIVED,
        NOTIFICATION_TYPES.CLASSIFICATION_PENDING,
        NOTIFICATION_TYPES.CLASSIFICATION_COMPLETED,
        NOTIFICATION_TYPES.APPROVAL_PENDING,
        NOTIFICATION_TYPES.APPROVAL_COMPLETED,
        NOTIFICATION_TYPES.APPROVAL_REJECTED,
        NOTIFICATION_TYPES.ENTRY_CREATED,
        NOTIFICATION_TYPES.ENTRY_POSTED,
        NOTIFICATION_TYPES.INTEGRATION_COMPLETED,
        NOTIFICATION_TYPES.INTEGRATION_FAILED,
        NOTIFICATION_TYPES.PROCESS_CREATED,
        NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE,
        NOTIFICATION_TYPES.PROCESS_COMPLETED,
        NOTIFICATION_TYPES.PENDENCY_UPDATED
      ]);
      if (officeOnly.has(type)) {
        recipients = recipients.filter((uid) => {
          const u = resolver.activeUser(event.tenant_id, uid);
          return u && u.role !== 'CLIENT';
        });
      }
    }

    if (!recipients.length) return { skipped: 'no_recipients' };

    const forClient = actorRole !== 'CLIENT' && type === NOTIFICATION_TYPES.DOCUMENT_RECEIVED;

    return notify({
      type,
      tenant_id: event.tenant_id,
      company_id: event.company_id,
      actor_user_id: event.actor_user_id,
      actor_role: actorRole || null,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      event_id: event.id,
      company_name: companyName,
      preview: payload && (payload.original_name || payload.description || payload.preview || payload.title || payload.note),
      amount_cents: payload && payload.amount_cents,
      original_name: payload && payload.original_name,
      description: payload && payload.description,
      process_name: payload && payload.process_name,
      step_name: payload && payload.step_name,
      title: payload && payload.title,
      responsible_user_id: payload && payload.responsible_user_id,
      recipient_user_ids: recipients,
      for_client: forClient,
      skip_in_app: true
    });
  }

  function unreadCount(tenantId, userId, { companyId = null } = {}) {
    let sql = 'SELECT COUNT(*) n FROM notifications WHERE tenant_id=? AND COALESCE(recipient_user_id,user_id)=? AND read_at IS NULL';
    const p = [tenantId, userId];
    if (companyId) {
      sql += ' AND company_id=?';
      p.push(companyId);
    }
    return one(sql, ...p).n;
  }

  function markRead(tenantId, userId, notificationId) {
    const before = one(
      'SELECT * FROM notifications WHERE id=? AND tenant_id=? AND COALESCE(recipient_user_id,user_id)=?',
      notificationId, tenantId, userId
    );
    if (!before) return null;
    if (!before.read_at) {
      exec(
        'UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND COALESCE(recipient_user_id,user_id)=?',
        notificationId, tenantId, userId
      );
      audit('NOTIFICATION_READ', {
        tenant_id: tenantId,
        actor_user_id: userId,
        notification_id: notificationId
      }, { type: before.type, company_id: before.company_id });
    }
    return one('SELECT * FROM notifications WHERE id=?', notificationId);
  }

  function markAllRead(tenantId, userId) {
    const result = exec(
      'UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND COALESCE(recipient_user_id,user_id)=? AND read_at IS NULL',
      tenantId, userId
    );
    audit('NOTIFICATION_READ', { tenant_id: tenantId, actor_user_id: userId }, { all: true, changes: result.changes });
    return { ok: true, changes: result.changes };
  }

  return {
    notify,
    notifyRequestMessage,
    deliverPushForDomainEvent,
    prefs,
    savePrefs,
    unreadCount,
    markRead,
    markAllRead,
    resolver,
    types: NOTIFICATION_TYPES,
    BRAND_TITLE,
    ICON,
    BADGE
  };
}

module.exports = { createNotificationService };
