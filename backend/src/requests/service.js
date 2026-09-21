'use strict';

const {
  STATUS,
  normalizeStatus,
  isClosed,
  statusLabel,
  statusAfterMessage,
  isOfficeRole
} = require('./status');

function createRequestService({ db, id }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const qRows = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);

  function enrichRequest(row, userId) {
    if (!row) return null;
    const last = one(
      `SELECT m.message, m.created_at, m.user_id, u.name user_name, m.created_by_role
       FROM request_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id=? AND m.company_id=? AND m.request_id=?
       ORDER BY datetime(m.created_at) DESC, m.rowid DESC LIMIT 1`,
      row.tenant_id, row.company_id, row.id
    );
    const message_count = one(
      'SELECT COUNT(*) n FROM request_messages WHERE tenant_id=? AND company_id=? AND request_id=?',
      row.tenant_id, row.company_id, row.id
    ).n;
    let unread_count = 0;
    if (userId) {
      unread_count = one(
        `SELECT COUNT(*) n FROM request_messages m
         WHERE m.tenant_id=? AND m.company_id=? AND m.request_id=?
           AND m.user_id<>?
           AND NOT EXISTS (
             SELECT 1 FROM request_message_reads r
             WHERE r.message_id=m.id AND r.user_id=?
           )`,
        row.tenant_id, row.company_id, row.id, userId, userId
      ).n;
    }
    return {
      ...row,
      status: normalizeStatus(row.status),
      status_raw: row.status,
      status_label: statusLabel(row.status),
      last_message: last ? {
        message: last.message,
        created_at: last.created_at,
        user_id: last.user_id,
        user_name: last.user_name,
        role: last.created_by_role
      } : null,
      message_count,
      unread_count
    };
  }

  function getRequest(tenantId, requestId) {
    return one(
      `SELECT r.*, c.name company_name, c.trade_name company_trade_name,
              cu.name created_by_name, au.name assigned_name
       FROM requests r
       JOIN companies c ON c.id=r.company_id
       LEFT JOIN users cu ON cu.id=r.created_by
       LEFT JOIN users au ON au.id=r.assigned_to
       WHERE r.tenant_id=? AND r.id=?`,
      tenantId, requestId
    );
  }

  function listMessages(tenantId, companyId, requestId) {
    return qRows(
      `SELECT m.id, m.message, m.created_at, m.user_id, m.created_by_role AS role,
              u.name AS user_name
       FROM request_messages m
       LEFT JOIN users u ON u.id=m.user_id
       WHERE m.tenant_id=? AND m.company_id=? AND m.request_id=?
       ORDER BY datetime(m.created_at) ASC, m.rowid ASC`,
      tenantId, companyId, requestId
    );
  }

  function insertMessage({ tenantId, companyId, requestId, userId, role, message, createdAt }) {
    const mid = id();
    const text = String(message || '').trim();
    if (!text) {
      const err = new Error('Mensagem obrigatória.');
      err.code = 'MESSAGE_REQUIRED';
      err.http = 400;
      throw err;
    }
    exec(
      `INSERT INTO request_messages(id,tenant_id,company_id,request_id,user_id,message,created_by_role,created_at)
       VALUES(?,?,?,?,?,?,?,COALESCE(?,strftime('%Y-%m-%d %H:%M:%f','now')))`,
      mid, tenantId, companyId, requestId, userId, text, role || null, createdAt || null
    );
    return one('SELECT * FROM request_messages WHERE id=?', mid);
  }

  function createRequest({ tenantId, companyId, userId, role, type, title, description, priority }) {
    const rid = id();
    const desc = description ? String(description).trim() : null;
    const status = STATUS.AGUARDANDO_CLIENTE;
    db.transaction(() => {
      exec(
        `INSERT INTO requests(id,tenant_id,company_id,created_by,type,title,description,priority,status)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        rid, tenantId, companyId, userId, type || 'GENERAL', title, desc, priority || 'NORMAL', status
      );
      const first = desc || String(title || '').trim();
      if (first) {
        insertMessage({
          tenantId, companyId, requestId: rid, userId, role: role || 'STAFF', message: first
        });
      }
    })();
    return getRequest(tenantId, rid);
  }

  function addMessage({ tenantId, companyId, requestId, userId, role, message }) {
    const req = one(
      'SELECT * FROM requests WHERE tenant_id=? AND company_id=? AND id=?',
      tenantId, companyId, requestId
    );
    if (!req) {
      const err = new Error('Solicitação não encontrada.');
      err.code = 'NOT_FOUND';
      err.http = 404;
      throw err;
    }
    if (isClosed(req.status)) {
      const err = new Error('Solicitação encerrada.');
      err.code = 'REQUEST_CLOSED';
      err.http = 409;
      throw err;
    }
    const nextStatus = statusAfterMessage(role);
    let msg;
    db.transaction(() => {
      msg = insertMessage({ tenantId, companyId, requestId, userId, role, message });
      exec(
        'UPDATE requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND company_id=?',
        nextStatus, requestId, tenantId, companyId
      );
    })();
    return {
      message: msg,
      request: enrichRequest(getRequest(tenantId, requestId), userId),
      previous_status: req.status,
      status: nextStatus
    };
  }

  function markRead({ tenantId, companyId, requestId, userId }) {
    const msgs = qRows(
      `SELECT m.id FROM request_messages m
       WHERE m.tenant_id=? AND m.company_id=? AND m.request_id=?
         AND m.user_id<>?
         AND NOT EXISTS (
           SELECT 1 FROM request_message_reads r
           WHERE r.message_id=m.id AND r.user_id=?
         )`,
      tenantId, companyId, requestId, userId, userId
    );
    if (!msgs.length) return { marked: 0 };
    const insert = db.prepare(
      'INSERT OR IGNORE INTO request_message_reads(id,tenant_id,message_id,user_id,read_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)'
    );
    db.transaction(() => {
      for (const m of msgs) insert.run(id(), tenantId, m.id, userId);
    })();
    return { marked: msgs.length, message_ids: msgs.map(m => m.id) };
  }

  function unreadTotal(tenantId, userId, companyId) {
    let sql = `SELECT COUNT(*) n FROM request_messages m
      JOIN requests r ON r.id=m.request_id
      WHERE m.tenant_id=? AND m.user_id<>?
        AND NOT EXISTS (
          SELECT 1 FROM request_message_reads rd
          WHERE rd.message_id=m.id AND rd.user_id=?
        )`;
    const p = [tenantId, userId, userId];
    if (companyId) {
      sql += ' AND m.company_id=?';
      p.push(companyId);
    }
    return one(sql, ...p).n;
  }

  function patchRequest(tenantId, companyId, requestId, body) {
    const req = one(
      'SELECT * FROM requests WHERE tenant_id=? AND company_id=? AND id=?',
      tenantId, companyId, requestId
    );
    if (!req) {
      const err = new Error('Solicitação não encontrada.');
      err.code = 'NOT_FOUND';
      err.http = 404;
      throw err;
    }
    let status = req.status;
    if (body.status != null) {
      const raw = String(body.status).trim().toUpperCase();
      if (['CONCLUDED', 'CONCLUIDA', 'COMPLETED'].includes(raw)) status = STATUS.CONCLUDED;
      else if (['CANCELLED', 'CANCELADA'].includes(raw)) status = STATUS.CANCELLED;
      else if (['AGUARDANDO_CLIENTE', 'AGUARDANDO_ESCRITORIO', 'OPEN', 'RESPONDED'].includes(raw)) {
        status = normalizeStatus(raw);
      } else {
        const err = new Error('Situação inválida.');
        err.code = 'INVALID_STATUS';
        err.http = 400;
        throw err;
      }
    }
    const assigned = body.assigned_to !== undefined ? (body.assigned_to || null) : req.assigned_to;
    const resolution = body.resolution !== undefined ? (body.resolution || null) : req.resolution;
    exec(
      'UPDATE requests SET status=?, assigned_to=?, resolution=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND company_id=?',
      status, assigned, resolution, requestId, tenantId, companyId
    );
    return {
      before: req,
      after: enrichRequest(getRequest(tenantId, requestId), null)
    };
  }

  function messageRecipients({ tenantId, companyId, actorUserId, actorRole, request }) {
    if (String(actorRole).toUpperCase() === 'CLIENT') {
      const ids = new Set();
      if (request.assigned_to) ids.add(request.assigned_to);
      if (request.created_by) ids.add(request.created_by);
      const assignees = qRows(
        "SELECT ca.user_id FROM company_assignees ca JOIN users u ON u.id=ca.user_id WHERE ca.company_id=? AND u.active=1 AND u.role IN('OWNER','ACCOUNTANT','STAFF')",
        companyId
      );
      for (const a of assignees) ids.add(a.user_id);
      if (!ids.size) {
        for (const u of qRows(
          "SELECT id FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') AND active=1",
          tenantId
        )) ids.add(u.id);
      }
      ids.delete(actorUserId);
      return [...ids];
    }
    return qRows(
      "SELECT id FROM users WHERE tenant_id=? AND company_id=? AND role='CLIENT' AND active=1",
      tenantId, companyId
    ).map(u => u.id).filter(uid => uid !== actorUserId);
  }

  return {
    enrichRequest,
    getRequest,
    listMessages,
    createRequest,
    addMessage,
    markRead,
    unreadTotal,
    patchRequest,
    messageRecipients,
    STATUS,
    normalizeStatus,
    isClosed,
    statusLabel,
    isOfficeRole
  };
}

module.exports = { createRequestService };
