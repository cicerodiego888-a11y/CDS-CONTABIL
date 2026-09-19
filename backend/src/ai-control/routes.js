'use strict';

const { createAiControlService } = require('./service');

function mountAiControlRoutes(app, deps) {
  const { db, id, auth, role, deny, auditSystem, config, credentialService } = deps;
  const service = createAiControlService({ db, id, auditSystem, config, credentialService });
  const admin = role('OWNER', 'ACCOUNTANT');
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(error, res) {
    return deny(
      res,
      error && error.http || 500,
      error && error.message || 'Não foi possível concluir a operação de IA.',
      error && error.code || 'AI_CONTROL_ERROR'
    );
  }

  app.get('/api/ai/settings', auth, office, (req, res) => {
    try {
      res.json(service.getSettings(req.user.tenant_id));
    } catch (error) { handle(error, res); }
  });

  app.patch('/api/ai/settings', auth, admin, (req, res) => {
    try {
      const body = req.body || {};
      delete body.tenant_id;
      delete body.provider;
      delete body.api_key;
      delete body.OPENAI_API_KEY;
      delete body.estimated_cost_cents;
      delete body.tokens;
      res.json(service.updateSettings(req.user.tenant_id, req.user.sub, body));
    } catch (error) { handle(error, res); }
  });

  app.get('/api/ai/usage/summary', auth, office, (req, res) => {
    try {
      res.json(service.summary(req.user.tenant_id, {
        period_ym: req.query.period_ym || req.query.period
      }));
    } catch (error) { handle(error, res); }
  });

  app.get('/api/ai/usage', auth, office, (req, res) => {
    try {
      res.json(service.listUsage(req.user.tenant_id, {
        period_ym: req.query.period_ym || req.query.period,
        company_id: req.query.company_id,
        operation_type: req.query.operation_type,
        from: req.query.from,
        to: req.query.to
      }));
    } catch (error) { handle(error, res); }
  });

  app.get('/api/ai/usage/by-client', auth, office, (req, res) => {
    try {
      res.json(service.byClient(req.user.tenant_id, {
        period_ym: req.query.period_ym || req.query.period
      }));
    } catch (error) { handle(error, res); }
  });

  app.get('/api/ai/usage/by-operation', auth, office, (req, res) => {
    try {
      res.json(service.byOperation(req.user.tenant_id, {
        period_ym: req.query.period_ym || req.query.period
      }));
    } catch (error) { handle(error, res); }
  });

  // Alias em português (compatível com /api/ia/* existente)
  app.get('/api/ia/config', auth, office, (req, res) => {
    try { res.json(service.getSettings(req.user.tenant_id)); }
    catch (error) { handle(error, res); }
  });

  return service;
}

module.exports = { mountAiControlRoutes };
