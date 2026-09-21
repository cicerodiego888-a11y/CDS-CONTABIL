'use strict';

const { createRequestService } = require('./service');

function mountRequestRoutes(app, deps) {
  const {
    auth, role, scope, deny, audit, emitEvent, companyOk, companyVisibleToUser,
    pageParams, paged, requireClient, requireClientCompany, clientCompanyId,
    emitFromReq, EVENT_TYPES, pushService, notificationService
  } = deps;
  const service = createRequestService(deps);
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(err, res) {
    if (!err) return;
    return deny(res, err.http || 500, err.message || 'Erro em solicitações.', err.code || 'REQUEST_ERROR');
  }

  function loadVisibleRequest(req, res, requestId) {
    const row = service.getRequest(req.user.tenant_id, requestId);
    if (!row) {
      deny(res, 404, 'Solicitação não encontrada.', 'NOT_FOUND');
      return null;
    }
    if (!companyOk(req, row.company_id) || !companyVisibleToUser(req, row.company_id)) {
      deny(res, 404, 'Solicitação não encontrada.', 'NOT_FOUND');
      return null;
    }
    if (req.companyScope && row.company_id !== req.companyScope) {
      deny(res, 404, 'Solicitação não encontrada.', 'NOT_FOUND');
      return null;
    }
    return row;
  }

  function notifyMessage(req, result, audience) {
    try {
      const eventType = EVENT_TYPES.REQUEST_MESSAGE_CREATED || 'REQUEST_MESSAGE_CREATED';
      const ev = emitFromReq(req, eventType, {
        companyId: result.request.company_id,
        entityType: 'request',
        entityId: result.request.id,
        payload: {
          title: result.request.title,
          status: result.status,
          message_id: result.message.id,
          preview: String(result.message.message || '').slice(0, 120)
        }
      });
      if (result.previous_status !== result.status) {
        emitFromReq(req, EVENT_TYPES.REQUEST_STATUS_CHANGED || 'REQUEST_STATUS_CHANGED', {
          companyId: result.request.company_id,
          entityType: 'request',
          entityId: result.request.id,
          payload: { title: result.request.title, status: result.status }
        });
      }
      // Compatibilidade: resposta do cliente ainda gera REQUEST_UPDATED
      if (audience === 'office') {
        emitFromReq(req, EVENT_TYPES.REQUEST_UPDATED, {
          companyId: result.request.company_id,
          entityType: 'request',
          entityId: result.request.id,
          payload: { title: result.request.title }
        });
      }
      if (notificationService && typeof notificationService.notifyRequestMessage === 'function') {
        setImmediate(() => {
          try {
            notificationService.notifyRequestMessage({
              tenantId: req.user.tenant_id,
              companyId: result.request.company_id,
              requestId: result.request.id,
              actorUserId: req.user.sub,
              actorRole: req.user.role,
              title: result.request.title,
              companyName: result.request.company_trade_name || result.request.company_name,
              preview: String(result.message.message || '').slice(0, 120),
              messageId: result.message.id,
              eventId: ev && ev.id
            });
          } catch (e) {
            console.error('push_notify_failed', e && e.message);
          }
        });
      } else if (pushService && typeof pushService.notifyRequestMessage === 'function') {
        setImmediate(() => {
          try {
            pushService.notifyRequestMessage({
              tenantId: req.user.tenant_id,
              companyId: result.request.company_id,
              requestId: result.request.id,
              actorUserId: req.user.sub,
              actorRole: req.user.role,
              title: result.request.title,
              companyName: result.request.company_trade_name || result.request.company_name,
              preview: String(result.message.message || '').slice(0, 120),
              messageId: result.message.id,
              eventId: ev && ev.id
            });
          } catch (e) {
            console.error('push_notify_failed', e && e.message);
          }
        });
      }
    } catch (e) {
      console.error('request_message_notify_failed', e && e.message);
    }
  }

  // ——— Escritório ———
  app.get('/api/solicitacoes', auth, scope, (req, res) => {
    try {
      const sc = deps.scopedCompanyWhere(req, 'r');
      let { where, p } = sc;
      if (req.query.status) {
        where += ' AND r.status=?';
        p.push(String(req.query.status));
      }
      const q = String(req.query.q || req.query.search || '').trim();
      if (q) {
        where += ' AND (r.title LIKE ? OR IFNULL(r.description,\'\') LIKE ?)';
        p.push(`%${q}%`, `%${q}%`);
      }
      const total = deps.one(`SELECT COUNT(*) n FROM requests r WHERE ${where}`, ...p).n;
      const { page, page_size, offset } = pageParams(req, 25);
      const items = deps.qRows(
        `SELECT r.*, c.name company_name, c.trade_name company_trade_name, u.name created_by_name, au.name assigned_name
         FROM requests r
         JOIN companies c ON c.id=r.company_id
         JOIN users u ON u.id=r.created_by
         LEFT JOIN users au ON au.id=r.assigned_to
         WHERE ${where}
         ORDER BY COALESCE(r.updated_at, r.created_at) DESC
         LIMIT ? OFFSET ?`,
        ...p, page_size, offset
      ).map(row => service.enrichRequest(row, req.user.sub));
      const unread_total = service.unreadTotal(req.user.tenant_id, req.user.sub, req.companyScope || null);
      res.json({ ...paged(items, total, page, page_size), unread_total });
    } catch (e) { handle(e, res); }
  });

  app.get('/api/solicitacoes/nao-lidas', auth, scope, (req, res) => {
    res.json({ unread_total: service.unreadTotal(req.user.tenant_id, req.user.sub, req.companyScope || null) });
  });

  app.post('/api/solicitacoes', auth, scope, (req, res) => {
    try {
      if (req.companyScope) req.body.company_id = req.companyScope;
      if (!companyOk(req, req.body.company_id)) return res.status(403).json({ error: 'COMPANY_FORBIDDEN' });
      if (!req.body.company_id) return res.status(400).json({ error: 'COMPANY_REQUIRED' });
      const writable = deps.one('SELECT status FROM companies WHERE tenant_id=? AND id=?', req.user.tenant_id, req.body.company_id);
      if (!writable) return deny(res, 404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      if (writable.status !== 'ACTIVE') return deny(res, 409, 'Esta empresa está bloqueada ou indisponível.', 'COMPANY_UNAVAILABLE');
      if (!String(req.body.title || '').trim()) return deny(res, 400, 'Informe o título.', 'TITLE_REQUIRED');
      const created = service.createRequest({
        tenantId: req.user.tenant_id,
        companyId: req.body.company_id,
        userId: req.user.sub,
        role: req.user.role,
        type: req.body.type || 'GENERAL',
        title: String(req.body.title).trim(),
        description: req.body.description || null,
        priority: req.body.priority || 'NORMAL'
      });
      emitFromReq(req, EVENT_TYPES.REQUEST_CREATED, {
        companyId: req.body.company_id,
        entityType: 'request',
        entityId: created.id,
        payload: { title: created.title, description: created.description || null }
      });
      audit(req, 'REQUEST_CREATED', 'REQUEST', created.id, null, { title: created.title, status: created.status });
      // Web Push office→cliente na criação (motor central)
      if (notificationService && typeof notificationService.notifyRequestMessage === 'function') {
        const first = service.listMessages(req.user.tenant_id, created.company_id, created.id)[0];
        setImmediate(() => {
          try {
            notificationService.notifyRequestMessage({
              tenantId: req.user.tenant_id,
              companyId: created.company_id,
              requestId: created.id,
              actorUserId: req.user.sub,
              actorRole: req.user.role,
              title: created.title,
              companyName: created.company_trade_name || created.company_name,
              preview: String((first && first.message) || created.description || created.title || '').slice(0, 120),
              messageId: first && first.id
            });
          } catch (e) {
            console.error('push_notify_create_failed', e && e.message);
          }
        });
      } else if (pushService && typeof pushService.notifyRequestMessage === 'function') {
        const first = service.listMessages(req.user.tenant_id, created.company_id, created.id)[0];
        setImmediate(() => {
          try {
            pushService.notifyRequestMessage({
              tenantId: req.user.tenant_id,
              companyId: created.company_id,
              requestId: created.id,
              actorUserId: req.user.sub,
              actorRole: req.user.role,
              title: created.title,
              companyName: created.company_trade_name || created.company_name,
              preview: String((first && first.message) || created.description || created.title || '').slice(0, 120),
              messageId: first && first.id
            });
          } catch (e) {
            console.error('push_notify_create_failed', e && e.message);
          }
        });
      }
      res.status(201).json(service.enrichRequest(created, req.user.sub));
    } catch (e) { handle(e, res); }
  });

  app.get('/api/solicitacoes/:id', auth, scope, (req, res) => {
    try {
      const row = loadVisibleRequest(req, res, req.params.id);
      if (!row) return;
      res.json(service.enrichRequest(row, req.user.sub));
    } catch (e) { handle(e, res); }
  });

  app.get('/api/solicitacoes/:id/mensagens', auth, scope, (req, res) => {
    try {
      const row = loadVisibleRequest(req, res, req.params.id);
      if (!row) return;
      const marked = service.markRead({
        tenantId: req.user.tenant_id,
        companyId: row.company_id,
        requestId: row.id,
        userId: req.user.sub
      });
      if (marked.marked) {
        audit(req, 'REQUEST_MESSAGE_READ', 'REQUEST', row.id, null, { marked: marked.marked });
        try {
          emitFromReq(req, EVENT_TYPES.REQUEST_MESSAGE_READ || 'REQUEST_MESSAGE_READ', {
            companyId: row.company_id,
            entityType: 'request',
            entityId: row.id,
            payload: { title: row.title, status: row.status }
          });
        } catch { /* optional event */ }
      }
      res.json(service.listMessages(req.user.tenant_id, row.company_id, row.id));
    } catch (e) { handle(e, res); }
  });

  app.post('/api/solicitacoes/:id/mensagens', auth, scope, (req, res) => {
    try {
      const row = loadVisibleRequest(req, res, req.params.id);
      if (!row) return;
      const result = service.addMessage({
        tenantId: req.user.tenant_id,
        companyId: row.company_id,
        requestId: row.id,
        userId: req.user.sub,
        role: req.user.role,
        message: req.body.message
      });
      audit(req, 'REQUEST_MESSAGE_CREATED', 'REQUEST', row.id, null, {
        message_id: result.message.id,
        status: result.status
      });
      notifyMessage(req, result, 'client');
      res.status(201).json({
        ...result.message,
        user_name: req.user.name || null,
        role: req.user.role,
        request: result.request
      });
    } catch (e) { handle(e, res); }
  });

  app.patch('/api/solicitacoes/:id', auth, office, scope, (req, res) => {
    try {
      const row = loadVisibleRequest(req, res, req.params.id);
      if (!row) return;
      delete req.body.tenant_id;
      delete req.body.company_id;
      const { before, after } = service.patchRequest(req.user.tenant_id, row.company_id, row.id, req.body || {});
      audit(req, 'REQUEST_UPDATED', 'REQUEST', row.id,
        { status: before.status, assigned_to: before.assigned_to },
        { status: after.status, assigned_to: after.assigned_to }
      );
      if (before.status !== after.status_raw && before.status !== after.status) {
        try {
          emitFromReq(req, EVENT_TYPES.REQUEST_STATUS_CHANGED || 'REQUEST_STATUS_CHANGED', {
            companyId: row.company_id,
            entityType: 'request',
            entityId: row.id,
            payload: { title: row.title, status: after.status }
          });
        } catch { /* optional */ }
      }
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  // ——— Portal do cliente ———
  app.get('/api/client/solicitacoes', auth, requireClient, requireClientCompany, (req, res) => {
    try {
      const companyId = clientCompanyId(req);
      const rows = deps.qRows(
        `SELECT r.*, c.name company_name, c.trade_name company_trade_name, u.name created_by_name
         FROM requests r
         JOIN companies c ON c.id=r.company_id
         LEFT JOIN users u ON u.id=r.created_by
         WHERE r.tenant_id=? AND r.company_id=?
         ORDER BY COALESCE(r.updated_at, r.created_at) DESC`,
        req.user.tenant_id, companyId
      ).map(row => {
        const enriched = service.enrichRequest(row, req.user.sub);
        // Compat: responses legado espelha mensagens (somente leitura)
        enriched.responses = service.listMessages(req.user.tenant_id, companyId, row.id).map(m => ({
          message: m.message,
          created_at: m.created_at,
          user_name: m.user_name,
          role: m.role
        }));
        return enriched;
      });
      res.json(rows);
    } catch (e) { handle(e, res); }
  });

  app.get('/api/client/solicitacoes/:id', auth, requireClient, requireClientCompany, (req, res) => {
    try {
      const companyId = clientCompanyId(req);
      const row = service.getRequest(req.user.tenant_id, req.params.id);
      if (!row || row.company_id !== companyId) return deny(res, 404, 'Solicitação não encontrada.', 'NOT_FOUND');
      res.json(service.enrichRequest(row, req.user.sub));
    } catch (e) { handle(e, res); }
  });

  app.get('/api/client/solicitacoes/:id/mensagens', auth, requireClient, requireClientCompany, (req, res) => {
    try {
      const companyId = clientCompanyId(req);
      const row = service.getRequest(req.user.tenant_id, req.params.id);
      if (!row || row.company_id !== companyId) return deny(res, 404, 'Solicitação não encontrada.', 'NOT_FOUND');
      const marked = service.markRead({
        tenantId: req.user.tenant_id,
        companyId,
        requestId: row.id,
        userId: req.user.sub
      });
      if (marked.marked) audit(req, 'REQUEST_MESSAGE_READ', 'REQUEST', row.id, null, { marked: marked.marked });
      res.json(service.listMessages(req.user.tenant_id, companyId, row.id));
    } catch (e) { handle(e, res); }
  });

  function clientPostMessage(req, res) {
    try {
      const companyId = clientCompanyId(req);
      const row = service.getRequest(req.user.tenant_id, req.params.id);
      if (!row || row.company_id !== companyId) return deny(res, 404, 'Solicitação não encontrada.', 'NOT_FOUND');
      const result = service.addMessage({
        tenantId: req.user.tenant_id,
        companyId,
        requestId: row.id,
        userId: req.user.sub,
        role: 'CLIENT',
        message: req.body.message
      });
      audit(req, 'CLIENT_RESPONDED_REQUEST', 'REQUEST', row.id, null, { message_id: result.message.id });
      audit(req, 'REQUEST_MESSAGE_CREATED', 'REQUEST', row.id, null, { message_id: result.message.id, status: result.status });
      notifyMessage(req, result, 'office');
      res.status(201).json({
        ...result.message,
        user_name: req.user.name || null,
        role: 'CLIENT',
        request: result.request
      });
    } catch (e) { handle(e, res); }
  }

  app.post('/api/client/solicitacoes/:id/mensagens', auth, requireClient, requireClientCompany, clientPostMessage);
  // Legado: /resposta continua, mas grava em request_messages (não em client_request_responses)
  app.post('/api/client/solicitacoes/:id/resposta', auth, requireClient, requireClientCompany, clientPostMessage);

  return service;
}

module.exports = { mountRequestRoutes };
