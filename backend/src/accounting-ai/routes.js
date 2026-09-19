'use strict';

const { createAccountingAIService } = require('./service');

function mountAccountingAIRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, companyOk, documentAccess,
    provider, auditSystem
  } = deps;
  const service = createAccountingAIService({ db, id, provider, auditSystem, aiControl: deps.aiControl });
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function authorizedDocument(req, res) {
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

  function handle(error, res) {
    return deny(
      res,
      error && error.http || 500,
      error && error.message || 'Não foi possível concluir a sugestão inteligente.',
      error && error.code || 'ACCOUNTING_AI_ERROR'
    );
  }

  app.get('/api/ia/status', auth, office, (req, res) => {
    res.json(service.providerInfo());
  });

  app.post('/api/documentos/:id/sugestao-contabil', auth, office, scope, async (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      const result = await service.requestClassification(
        req.user.tenant_id, req.params.id, req.user.sub
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { handle(error, res); }
  });

  app.post('/api/documentos/:id/sugestao-contabil/reprocessar', auth, office, scope, async (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      const result = await service.requestClassification(
        req.user.tenant_id, req.params.id, req.user.sub, { force: true }
      );
      res.json(result);
    } catch (error) { handle(error, res); }
  });

  app.get('/api/documentos/:id/sugestao-contabil', auth, office, scope, (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      const suggestion = service.getSuggestion(req.user.tenant_id, req.params.id);
      if (!suggestion) return deny(res, 404, 'Sugestão não encontrada.', 'AI_SUGGESTION_NOT_FOUND');
      res.json(suggestion);
    } catch (error) { handle(error, res); }
  });

  app.post('/api/documentos/:id/sugestao-contabil/decisao', auth, office, scope, (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      res.json(service.decide(
        req.user.tenant_id, req.params.id, req.user.sub, req.body || {}
      ));
    } catch (error) { handle(error, res); }
  });

  app.post('/api/plano-contas/preview-ia', auth, office, scope, async (req, res) => {
    try {
      const companyId = req.companyScope || req.body.company_id || null;
      if (companyId && !companyOk(req, companyId)) {
        return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      }
      res.json(await service.requestChartPreview(
        req.user.tenant_id, companyId, req.user.sub, {
          text: req.body.text,
          fileName: req.body.file_name
        }
      ));
    } catch (error) { handle(error, res); }
  });

  app.get('/api/plano-contas/preview-ia/:previewId', auth, office, (req, res) => {
    const preview = service.getChartPreview(req.user.tenant_id, req.params.previewId);
    if (!preview) return deny(res, 404, 'Prévia não encontrada.', 'AI_CHART_PREVIEW_NOT_FOUND');
    res.json(preview);
  });

  app.post('/api/plano-contas/preview-ia/:previewId/importar', auth, office, (req, res) => {
    try {
      res.status(201).json(service.importChartPreview(
        req.user.tenant_id, req.params.previewId, req.user.sub, req.body.name
      ));
    } catch (error) { handle(error, res); }
  });

  return service;
}

module.exports = { mountAccountingAIRoutes };
