'use strict';

const PROCESS_EVENT_TYPES = Object.freeze({
  OCCURRENCE_AUTO_CREATED: 'PROCESS_OCCURRENCE_AUTO_CREATED',
  OCCURRENCE_MANUALLY_CREATED: 'PROCESS_OCCURRENCE_MANUALLY_CREATED',
  OCCURRENCE_STARTED: 'PROCESS_OCCURRENCE_STARTED',
  STEP_STARTED: 'PROCESS_STEP_STARTED',
  STEP_COMPLETED: 'PROCESS_STEP_COMPLETED',
  OCCURRENCE_COMPLETED: 'PROCESS_OCCURRENCE_COMPLETED',
  STEP_OVERDUE: 'PROCESS_STEP_OVERDUE'
});

function createProcessEventService({ db, id, emitEvent }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function parsePayload(event) {
    try { return JSON.parse(event.payload_json || '{}'); } catch { return {}; }
  }

  function officeRecipient(tenantId, companyId, userId) {
    if (!userId) return null;
    const user = one(
      `SELECT id,tenant_id,role,active FROM users
       WHERE id=? AND tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') AND active=1`,
      userId, tenantId
    );
    if (!user) return null;
    if (user.role !== 'STAFF') return user;
    const tenant = one('SELECT assign_staff_companies FROM tenants WHERE id=?', tenantId);
    if (!tenant || Number(tenant.assign_staff_companies) !== 1) return user;
    const assignments = one('SELECT COUNT(*) n FROM company_assignees WHERE company_id=?', companyId);
    if (!assignments || Number(assignments.n) === 0) return user;
    return one(
      'SELECT ? id WHERE EXISTS(SELECT 1 FROM company_assignees WHERE company_id=? AND user_id=?)',
      userId, companyId, userId
    ) ? user : null;
  }

  function preferenceOn(tenantId, userId, eventType) {
    const pref = one(
      'SELECT in_app_enabled FROM notification_preferences WHERE tenant_id=? AND user_id=? AND event_type=?',
      tenantId, userId, eventType
    );
    return !pref || Number(pref.in_app_enabled) === 1;
  }

  function notificationCopy(event, payload) {
    switch (event.event_type) {
      case PROCESS_EVENT_TYPES.OCCURRENCE_AUTO_CREATED:
      case PROCESS_EVENT_TYPES.OCCURRENCE_MANUALLY_CREATED:
        return {
          recipient: payload.responsible_user_id,
          title: 'Novo processo disponível',
          message: payload.title || payload.process_name || 'Uma nova ocorrência está disponível.',
          context: payload.source === 'AUTOMATIC' ? 'Gerada automaticamente' : 'Criada manualmente'
        };
      case PROCESS_EVENT_TYPES.STEP_COMPLETED:
        if (!payload.next_responsible_user_id ||
            payload.next_responsible_user_id === event.actor_user_id) return null;
        return {
          recipient: payload.next_responsible_user_id,
          title: 'Nova etapa disponível',
          message: 'Há uma nova etapa do processo aguardando sua execução.',
          context: payload.step_name || payload.process_name || ''
        };
      case PROCESS_EVENT_TYPES.OCCURRENCE_COMPLETED:
        return {
          recipient: payload.responsible_user_id,
          title: 'Processo concluído',
          message: payload.title || payload.process_name || 'A ocorrência foi concluída.',
          context: 'Todas as etapas obrigatórias foram concluídas.'
        };
      case PROCESS_EVENT_TYPES.STEP_OVERDUE:
        return {
          recipient: payload.responsible_user_id,
          title: 'Etapa atrasada',
          message: `A etapa ${payload.step_name || 'do processo'} está atrasada.`,
          context: payload.process_name || ''
        };
      default:
        return null;
    }
  }

  function auditNotification(event, notificationId, recipientId, payload) {
    run(
      `INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_json)
       VALUES(?,?,?,?,?,?,?)`,
      id(), event.tenant_id, event.actor_user_id || null, 'PROCESS_NOTIFICATION_CREATED',
      'NOTIFICATION', notificationId, JSON.stringify({
        recipient_user_id: recipientId,
        process_id: payload.process_id || null,
        occurrence_id: payload.occurrence_id || null,
        step_id: payload.step_id || null,
        event_type: event.event_type
      })
    );
  }

  function handle(event) {
    if (!event || !Object.values(PROCESS_EVENT_TYPES).includes(event.event_type)) return null;
    const payload = parsePayload(event);
    const copy = notificationCopy(event, payload);
    if (!copy) return null;
    const recipient = officeRecipient(event.tenant_id, event.company_id, copy.recipient);
    if (!recipient || !preferenceOn(event.tenant_id, recipient.id, event.event_type)) return null;
    const notificationId = id();
    const result = run(
      `INSERT OR IGNORE INTO notifications(
         id,tenant_id,user_id,type,title,message,event_id,company_id,recipient_user_id,
         entity_type,entity_id,context
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      notificationId, event.tenant_id, recipient.id, event.event_type, copy.title, copy.message,
      event.id, event.company_id || null, recipient.id, 'process_occurrence',
      payload.occurrence_id || event.entity_id, copy.context || null
    );
    if (!result.changes) {
      return one(
        'SELECT * FROM notifications WHERE event_id=? AND recipient_user_id=?',
        event.id, recipient.id
      );
    }
    auditNotification(event, notificationId, recipient.id, payload);
    return one('SELECT * FROM notifications WHERE id=?', notificationId);
  }

  function publish(input) {
    const event = emitEvent(input);
    if (event) handle(event);
    return event;
  }

  function scanOverdue(now = new Date()) {
    const date = now.toISOString().slice(0, 10);
    const overdue = rows(
      `SELECT s.id step_id,s.name step_name,s.responsible_user_id,s.occurrence_id,
              o.tenant_id,o.company_id,o.process_id,o.title,p.name process_name
       FROM process_occurrence_steps s
       JOIN process_occurrences o ON o.id=s.occurrence_id
       JOIN processes p ON p.id=o.process_id
       WHERE s.due_date<? AND s.status NOT IN('CONCLUIDA','CANCELADA')
         AND o.status NOT IN('CONCLUIDA','CANCELADA')`,
      date
    );
    let emitted = 0;
    let notified = 0;
    for (const step of overdue) {
      const previousEvent = one(
        `SELECT id FROM domain_events
         WHERE tenant_id=? AND event_type=? AND entity_type='process_occurrence_step' AND entity_id=?`,
        step.tenant_id, PROCESS_EVENT_TYPES.STEP_OVERDUE, step.step_id
      );
      const previousNotification = previousEvent
        ? one('SELECT id FROM notifications WHERE event_id=? LIMIT 1', previousEvent.id)
        : null;
      const event = publish({
        tenantId: step.tenant_id,
        companyId: step.company_id,
        eventType: PROCESS_EVENT_TYPES.STEP_OVERDUE,
        actorUserId: null,
        entityType: 'process_occurrence_step',
        entityId: step.step_id,
        payload: {
          process_id: step.process_id,
          occurrence_id: step.occurrence_id,
          step_id: step.step_id,
          responsible_user_id: step.responsible_user_id,
          step_name: step.step_name,
          process_name: step.process_name,
          title: step.title
        }
      });
      if (event) {
        if (!previousEvent) emitted += 1;
        if (!previousNotification &&
            one('SELECT id FROM notifications WHERE event_id=? LIMIT 1', event.id)) notified += 1;
      }
    }
    return { checked: overdue.length, emitted, notified };
  }

  return { publish, handle, scanOverdue, PROCESS_EVENT_TYPES };
}

module.exports = { createProcessEventService, PROCESS_EVENT_TYPES };
