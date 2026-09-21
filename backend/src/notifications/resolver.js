'use strict';

const { NOTIFICATION_TYPES } = require('./types');

/**
 * NotificationRecipientResolver — destinatários com isolamento tenant/company.
 * Nunca aceita lista cega do frontend sem revalidação.
 */
function createRecipientResolver({ db }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const qRows = (sql, ...p) => db.prepare(sql).all(...p);

  function activeUser(tenantId, userId) {
    if (!tenantId || !userId) return null;
    return one(
      'SELECT id, tenant_id, company_id, role, active FROM users WHERE id=? AND tenant_id=? AND active=1',
      userId, tenantId
    );
  }

  function staffVisibleToCompany(tenantId, companyId, userId) {
    const user = activeUser(tenantId, userId);
    if (!user) return false;
    if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') return true;
    if (user.role !== 'STAFF') return false;
    const tenant = one('SELECT assign_staff_companies FROM tenants WHERE id=?', tenantId);
    if (!tenant || Number(tenant.assign_staff_companies) !== 1) return true;
    const n = one('SELECT COUNT(*) n FROM company_assignees WHERE company_id=?', companyId);
    if (!n || Number(n.n) === 0) return true;
    return !!one(
      'SELECT 1 AS ok FROM company_assignees WHERE company_id=? AND user_id=?',
      companyId, userId
    );
  }

  function officeTeam(tenantId, companyId) {
    const users = qRows(
      "SELECT id, role FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') AND active=1",
      tenantId
    );
    if (!companyId) return users.map((u) => u.id);
    return users.filter((u) => staffVisibleToCompany(tenantId, companyId, u.id)).map((u) => u.id);
  }

  function companyAssignees(tenantId, companyId) {
      return qRows(
      `SELECT ca.user_id AS id FROM company_assignees ca
       JOIN users u ON u.id=ca.user_id
       WHERE ca.company_id=? AND u.active=1
         AND u.role IN('OWNER','ACCOUNTANT','STAFF')
         AND u.tenant_id=?`,
      companyId, tenantId
    ).map((r) => r.id);
  }

  function companyClients(tenantId, companyId) {
    if (!companyId) return [];
    return qRows(
      "SELECT id FROM users WHERE tenant_id=? AND company_id=? AND role='CLIENT' AND active=1",
      tenantId, companyId
    ).map((u) => u.id);
  }

  function validateCandidate(tenantId, companyId, userId, { allowClient = false, allowOffice = true } = {}) {
    const user = activeUser(tenantId, userId);
    if (!user) return null;
    if (user.role === 'CLIENT') {
      if (!allowClient) return null;
      if (companyId && user.company_id !== companyId) return null;
      return user.id;
    }
    if (!allowOffice) return null;
    if (companyId && !staffVisibleToCompany(tenantId, companyId, user.id)) return null;
    return user.id;
  }

  /**
   * Resolve destinatários para um tipo canônico.
   * candidateUserIds são revalidados — nunca confiados cegamente.
   */
  function resolve(input) {
    const tenantId = input.tenant_id;
    const companyId = input.company_id || null;
    const type = input.type;
    const actorUserId = input.actor_user_id || null;
    const candidates = Array.isArray(input.candidate_user_ids) ? input.candidate_user_ids : [];
    const ids = new Set();
    const officeInternal = new Set([
      NOTIFICATION_TYPES.DOCUMENT_ANALYSIS_COMPLETED,
      NOTIFICATION_TYPES.DOCUMENT_ANALYSIS_FAILED,
      NOTIFICATION_TYPES.EXPENSE_RECEIVED,
      NOTIFICATION_TYPES.EXPENSE_CREATED,
      NOTIFICATION_TYPES.EXPENSE_UPDATED,
      NOTIFICATION_TYPES.REVENUE_RECEIVED,
      NOTIFICATION_TYPES.REVENUE_CREATED,
      NOTIFICATION_TYPES.CLASSIFICATION_PENDING,
      NOTIFICATION_TYPES.CLASSIFICATION_COMPLETED,
      NOTIFICATION_TYPES.APPROVAL_PENDING,
      NOTIFICATION_TYPES.APPROVAL_COMPLETED,
      NOTIFICATION_TYPES.APPROVAL_REJECTED,
      NOTIFICATION_TYPES.ENTRY_CREATED,
      NOTIFICATION_TYPES.ENTRY_UPDATED,
      NOTIFICATION_TYPES.ENTRY_POSTED,
      NOTIFICATION_TYPES.INTEGRATION_COMPLETED,
      NOTIFICATION_TYPES.INTEGRATION_FAILED,
      NOTIFICATION_TYPES.PROCESS_CREATED,
      NOTIFICATION_TYPES.PROCESS_STEP_DUE,
      NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE,
      NOTIFICATION_TYPES.PROCESS_COMPLETED,
      NOTIFICATION_TYPES.PENDENCY_CREATED,
      NOTIFICATION_TYPES.PENDENCY_UPDATED
    ]);

    function add(uid, opts) {
      const ok = validateCandidate(tenantId, companyId, uid, opts);
      if (ok && ok !== actorUserId) ids.add(ok);
    }

    // Candidatos explícitos (revalidados; CLIENT bloqueado em tipos internos)
    for (const uid of candidates) {
      const allowClient = !officeInternal.has(type)
        || (type === NOTIFICATION_TYPES.DOCUMENT_RECEIVED && String(input.actor_role || '').toUpperCase() !== 'CLIENT');
      add(uid, {
        allowClient,
        allowOffice: true
      });
    }

    if (ids.size) return [...ids];

    switch (type) {
      case NOTIFICATION_TYPES.REQUEST_MESSAGE:
      case NOTIFICATION_TYPES.REQUEST_CREATED: {
        const actor = actorUserId ? activeUser(tenantId, actorUserId) : null;
        const actorRole = String(input.actor_role || (actor && actor.role) || '').toUpperCase();
        if (actorRole === 'CLIENT') {
          const request = input.request || null;
          if (request && request.assigned_to) add(request.assigned_to, { allowOffice: true });
          if (request && request.created_by) add(request.created_by, { allowOffice: true });
          for (const uid of companyAssignees(tenantId, companyId)) add(uid, { allowOffice: true });
          if (!ids.size) {
            for (const uid of officeTeam(tenantId, companyId)) add(uid, { allowOffice: true });
          }
        } else {
          for (const uid of companyClients(tenantId, companyId)) {
            add(uid, { allowClient: true, allowOffice: false });
          }
        }
        break;
      }
      case NOTIFICATION_TYPES.DOCUMENT_RECEIVED: {
        const actor = actorUserId ? activeUser(tenantId, actorUserId) : null;
        const actorRole = String(input.actor_role || (actor && actor.role) || '').toUpperCase();
        if (actorRole === 'CLIENT') {
          const assignees = companyAssignees(tenantId, companyId);
          if (assignees.length) {
            for (const uid of assignees) add(uid, { allowOffice: true });
            for (const u of qRows(
              "SELECT id FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT') AND active=1",
              tenantId
            )) add(u.id, { allowOffice: true });
          } else {
            for (const uid of officeTeam(tenantId, companyId)) add(uid, { allowOffice: true });
          }
        } else {
          // Escritório enviou documento → CLIENTES da empresa
          for (const uid of companyClients(tenantId, companyId)) {
            add(uid, { allowClient: true, allowOffice: false });
          }
        }
        break;
      }
      case NOTIFICATION_TYPES.EXPENSE_RECEIVED:
      case NOTIFICATION_TYPES.EXPENSE_CREATED:
      case NOTIFICATION_TYPES.REVENUE_RECEIVED:
      case NOTIFICATION_TYPES.REVENUE_CREATED:
      case NOTIFICATION_TYPES.CLASSIFICATION_PENDING:
      case NOTIFICATION_TYPES.CLASSIFICATION_COMPLETED:
      case NOTIFICATION_TYPES.APPROVAL_PENDING:
      case NOTIFICATION_TYPES.APPROVAL_COMPLETED:
      case NOTIFICATION_TYPES.APPROVAL_REJECTED:
      case NOTIFICATION_TYPES.ENTRY_CREATED:
      case NOTIFICATION_TYPES.ENTRY_POSTED:
      case NOTIFICATION_TYPES.INTEGRATION_COMPLETED:
      case NOTIFICATION_TYPES.INTEGRATION_FAILED:
      case NOTIFICATION_TYPES.PENDENCY_CREATED:
      case NOTIFICATION_TYPES.PENDENCY_UPDATED: {
        // Processos internos do escritório — não notificar CLIENT
        const assignees = companyAssignees(tenantId, companyId);
        if (assignees.length) {
          for (const uid of assignees) add(uid, { allowOffice: true });
          // OWNER/ACCOUNTANT sempre
          for (const u of qRows(
            "SELECT id FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT') AND active=1",
            tenantId
          )) add(u.id, { allowOffice: true });
        } else {
          for (const uid of officeTeam(tenantId, companyId)) add(uid, { allowOffice: true });
        }
        break;
      }
      case NOTIFICATION_TYPES.PROCESS_CREATED:
      case NOTIFICATION_TYPES.PROCESS_STEP_DUE:
      case NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE:
      case NOTIFICATION_TYPES.PROCESS_COMPLETED: {
        if (input.responsible_user_id) {
          add(input.responsible_user_id, { allowOffice: true });
        } else {
          for (const uid of officeTeam(tenantId, companyId)) add(uid, { allowOffice: true });
        }
        break;
      }
      default: {
        for (const uid of officeTeam(tenantId, companyId)) add(uid, { allowOffice: true });
      }
    }

    return [...ids];
  }

  return {
    resolve,
    validateCandidate,
    officeTeam,
    companyClients,
    companyAssignees,
    staffVisibleToCompany,
    activeUser
  };
}

module.exports = { createRecipientResolver };
