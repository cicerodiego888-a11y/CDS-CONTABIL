'use strict';

const { createSmartExpenseService } = require('./service');

function mountSmartExpenseRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, companyOk, documentAccess,
    auditSystem, extractionService, accountingAIService, classify, config,
    requireClient, requireClientCompany, clientCompanyId, aiControl
  } = deps;

  const service = createSmartExpenseService({
    db, id, auditSystem, extractionService, accountingAIService, classify, config, aiControl
  });

  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(error, res) {
    return deny(
      res,
      error && error.http || 500,
      error && error.message || 'Não foi possível analisar a despesa.',
      error && error.code || 'SMART_EXPENSE_ERROR'
    );
  }

  function authorizedOfficeDocument(req, res) {
    const loaded = documentAccess.load(req.user.tenant_id, req.params.id);
    if (loaded.error) {
      deny(res, loaded.status, loaded.message, loaded.error);
      return null;
    }
    const access = documentAccess.authorize(req, loaded.document, companyOk);
    if (access.error) {
      deny(res, access.status, access.message, access.error);
      return null;
    }
    return loaded.document;
  }

  function authorizedClientDocument(req, res) {
    const loaded = documentAccess.load(req.user.tenant_id, req.params.id);
    if (loaded.error) {
      deny(res, 404, 'Documento não encontrado.', 'NOT_FOUND');
      return null;
    }
    if (loaded.document.company_id !== clientCompanyId(req)) {
      deny(res, 404, 'Documento não encontrado.', 'NOT_FOUND');
      return null;
    }
    return loaded.document;
  }

  app.get('/api/ia/enabled', auth, office, (req, res) => {
    res.json({
      enabled: service.aiEnabled(req.user.tenant_id),
      provider: accountingAIService ? accountingAIService.providerInfo() : { configured: false }
    });
  });

  app.post('/api/documentos/:id/analise-despesa', auth, office, scope, async (req, res) => {
    try {
      if (!authorizedOfficeDocument(req, res)) return;
      const result = await service.analyze(
        req.user.tenant_id, req.params.id, req.user.sub, { force: !!req.body.force }
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { handle(error, res); }
  });

  app.post('/api/documentos/:id/analise-despesa/reler', auth, office, scope, async (req, res) => {
    try {
      if (!authorizedOfficeDocument(req, res)) return;
      const result = await service.analyze(
        req.user.tenant_id, req.params.id, req.user.sub, { force: true }
      );
      res.json(result);
    } catch (error) { handle(error, res); }
  });

  app.get('/api/documentos/:id/analise-despesa', auth, office, scope, (req, res) => {
    try {
      if (!authorizedOfficeDocument(req, res)) return;
      const analysis = service.getAnalysis(req.user.tenant_id, req.params.id);
      if (!analysis) return deny(res, 404, 'Análise não encontrada.', 'EXPENSE_ANALYSIS_NOT_FOUND');
      res.json(analysis);
    } catch (error) { handle(error, res); }
  });

  app.post('/api/client/documentos/:id/analise-despesa', auth, requireClient, requireClientCompany, async (req, res) => {
    try {
      if (!authorizedClientDocument(req, res)) return;
      const result = await service.analyze(
        req.user.tenant_id, req.params.id, req.user.sub, { force: !!req.body.force }
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { handle(error, res); }
  });

  app.post('/api/client/documentos/:id/analise-despesa/reler', auth, requireClient, requireClientCompany, async (req, res) => {
    try {
      if (!authorizedClientDocument(req, res)) return;
      const result = await service.analyze(
        req.user.tenant_id, req.params.id, req.user.sub, { force: true }
      );
      res.json(result);
    } catch (error) { handle(error, res); }
  });

  app.get('/api/client/documentos/:id/analise-despesa', auth, requireClient, requireClientCompany, (req, res) => {
    try {
      if (!authorizedClientDocument(req, res)) return;
      const analysis = service.getAnalysis(req.user.tenant_id, req.params.id);
      if (!analysis) return deny(res, 404, 'Análise não encontrada.', 'EXPENSE_ANALYSIS_NOT_FOUND');
      res.json(analysis);
    } catch (error) { handle(error, res); }
  });

  return service;
}

module.exports = { mountSmartExpenseRoutes };
