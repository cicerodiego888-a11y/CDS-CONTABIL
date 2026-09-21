'use strict';

function mountNotificationRoutes(app, deps) {
  const {
    auth, role, deny, audit, notificationService, requireOffice, requireClient,
    requireClientCompany, clientCompanyId
  } = deps;

  if (!notificationService) return null;

  // Aliases padronizados (Sprint 28.2) — não removem rotas legadas.
  app.get('/api/notificacoes/nao-lidas', auth, (req, res, next) => {
    if (req.user.role === 'CLIENT') {
      return requireClientCompany(req, res, () => {
        const companyId = clientCompanyId(req);
        const n = notificationService.unreadCount(req.user.tenant_id, req.user.sub, { companyId });
        res.json({ unread: n, unread_total: n });
      });
    }
    const n = notificationService.unreadCount(req.user.tenant_id, req.user.sub);
    res.json({ unread: n, unread_total: n });
  });

  app.patch('/api/notificacoes/:id/read', auth, (req, res, next) => {
    // Sprint 28.3: CLIENT pode marcar as próprias notificações (mesmo motor).
    if (req.user.role === 'CLIENT') {
      return requireClientCompany(req, res, () => {
        const companyId = clientCompanyId(req);
        const row = notificationService.markRead(req.user.tenant_id, req.user.sub, req.params.id);
        if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
        if (companyId && row.company_id && row.company_id !== companyId) {
          return deny(res, 404, 'Notificação não encontrada.', 'NOT_FOUND');
        }
        audit(req, 'NOTIFICATION_READ', 'NOTIFICATION', row.id, null, { type: row.type, portal: 'CLIENT' });
        return res.json({ ok: true, id: row.id, read_at: row.read_at });
      });
    }
    const row = notificationService.markRead(req.user.tenant_id, req.user.sub, req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    audit(req, 'NOTIFICATION_READ', 'NOTIFICATION', row.id, null, { type: row.type });
    res.json({ ok: true, id: row.id, read_at: row.read_at });
  });

  app.patch('/api/notificacoes/read-all', auth, (req, res, next) => {
    // Sprint 28.3: CLIENT e OFFICE usam o mesmo endpoint do NotificationService.
    if (req.user.role === 'CLIENT') {
      return requireClientCompany(req, res, () => {
        const result = notificationService.markAllRead(req.user.tenant_id, req.user.sub);
        res.json(result);
      });
    }
    if (!['OWNER', 'ACCOUNTANT', 'STAFF'].includes(req.user.role)) {
      return deny(res, 403, 'Você não tem permissão para realizar esta operação.', 'FORBIDDEN');
    }
    const result = notificationService.markAllRead(req.user.tenant_id, req.user.sub);
    res.json(result);
  });

  // Preferências unificadas (categorias + push) — complementar a /api/push/prefs
  app.get('/api/notificacoes/prefs-canais', auth, (req, res) => {
    res.json(notificationService.prefs(req.user.sub, req.user.tenant_id));
  });

  app.put('/api/notificacoes/prefs-canais', auth, (req, res) => {
    delete req.body.tenant_id;
    delete req.body.user_id;
    const saved = notificationService.savePrefs(req.user.sub, req.user.tenant_id, req.body || {});
    // espelha no push service se existir
    if (deps.pushService && typeof deps.pushService.savePrefs === 'function') {
      try {
        deps.pushService.savePrefs(req.user.sub, req.user.tenant_id, saved);
      } catch { /* ignore */ }
    }
    audit(req, 'NOTIFICATION_PREFS_UPDATED', 'USER', req.user.sub, null, {
      requests_enabled: saved.requests_enabled,
      documents_enabled: saved.documents_enabled,
      expenses_enabled: saved.expenses_enabled,
      push_enabled: saved.push_enabled
    });
    res.json(saved);
  });

  return notificationService;
}

module.exports = { mountNotificationRoutes };
