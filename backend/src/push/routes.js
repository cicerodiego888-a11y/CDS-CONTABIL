'use strict';

const { createPushService } = require('./service');

function mountPushRoutes(app, deps) {
  const { auth, role, deny, audit } = deps;
  const service = createPushService({
    db: deps.db,
    id: deps.id,
    config: deps.config,
    auditSystem: ({ tenantId, userId, action, entityType, entityId, after }) => {
      try {
        deps.db.prepare(
          'INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_json,after_json,ip) VALUES(?,?,?,?,?,?,?,?,?)'
        ).run(deps.id(), tenantId, userId || null, action, entityType, entityId, null, after ? JSON.stringify(after) : null, null);
      } catch { /* audit best-effort */ }
    }
  });
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(err, res) {
    if (!err) return;
    return deny(res, err.http || 500, err.message || 'Erro no Web Push.', err.code || 'PUSH_ERROR');
  }

  app.get('/api/push/public-key', auth, (req, res) => {
    const info = service.publicKey();
    // Nunca expor chave privada
    res.json({ configured: info.configured, publicKey: info.publicKey });
  });

  app.get('/api/push/status', auth, (req, res) => {
    res.json(service.status(req.user.sub, req.user.tenant_id));
  });

  app.get('/api/push/prefs', auth, (req, res) => {
    res.json(service.prefs(req.user.sub, req.user.tenant_id));
  });

  app.put('/api/push/prefs', auth, (req, res) => {
    try {
      delete req.body.tenant_id;
      delete req.body.user_id;
      const saved = service.savePrefs(req.user.sub, req.user.tenant_id, req.body || {});
      audit(req, 'PUSH_PREFS_UPDATED', 'USER', req.user.sub, null, {
        requests_enabled: saved.requests_enabled,
        push_enabled: saved.push_enabled,
        visual_enabled: saved.visual_enabled,
        sound_enabled: saved.sound_enabled
      });
      res.json(saved);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/push/subscribe', auth, (req, res) => {
    try {
      delete req.body.tenant_id;
      delete req.body.user_id;
      const row = service.subscribe({
        tenantId: req.user.tenant_id,
        userId: req.user.sub,
        subscription: req.body.subscription || req.body,
        userAgent: req.get('user-agent') || null
      });
      audit(req, 'PUSH_SUBSCRIBED', 'PUSH_SUBSCRIPTION', row.id, null, { active: 1 });
      res.status(201).json(row);
    } catch (e) { handle(e, res); }
  });

  app.delete('/api/push/subscribe', auth, (req, res) => {
    try {
      const endpoint = (req.body && req.body.endpoint) || req.query.endpoint;
      const result = service.unsubscribe({
        tenantId: req.user.tenant_id,
        userId: req.user.sub,
        endpoint
      });
      audit(req, 'PUSH_UNSUBSCRIBED', 'PUSH_SUBSCRIPTION', null, null, { removed: result.removed });
      res.json(result);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/push/test', auth, office, async (req, res) => {
    try {
      if (req.user.role === 'CLIENT') {
        return deny(res, 403, 'Você não tem permissão para realizar esta operação.', 'FORBIDDEN');
      }
      const result = await service.sendTest({
        tenantId: req.user.tenant_id,
        userId: req.user.sub,
        actorUserId: req.user.sub
      });
      if (result.skipped === 'not_configured') {
        return deny(res, 503, 'Web Push não configurado neste ambiente (VAPID).', 'PUSH_NOT_CONFIGURED');
      }
      res.json({ ok: true, ...result });
    } catch (e) { handle(e, res); }
  });

  return service;
}

module.exports = { mountPushRoutes };
