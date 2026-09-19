'use strict';

const { createDocumentNormalizationService } = require('./normalization');
const { LocalDocumentInterpreter } = require('./interpreter');
const { createDocumentExtractionService } = require('./extraction');

function mountDocumentIntelligenceRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, companyOk, documentAccess,
    documentStorage, auditSystem
  } = deps;
  const normalization = createDocumentNormalizationService();
  const interpreter = new LocalDocumentInterpreter(normalization);
  const service = createDocumentExtractionService({
    db, id, storage: documentStorage, normalization, interpreter, auditSystem
  });
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
      error && error.message || 'Não foi possível analisar o documento.',
      error && error.code || 'DOCUMENT_EXTRACTION_ERROR'
    );
  }

  app.post('/api/documentos/:id/extracao', auth, office, scope, (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      const result = service.request(req.user.tenant_id, req.params.id, req.user.sub);
      res.status(result.created ? 202 : 200).json(result);
    } catch (error) { handle(error, res); }
  });

  app.get('/api/documentos/:id/extracao', auth, office, scope, (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      const extraction = service.get(req.user.tenant_id, req.params.id);
      if (!extraction) return deny(res, 404, 'Extração não encontrada.', 'EXTRACTION_NOT_FOUND');
      res.json(extraction);
    } catch (error) { handle(error, res); }
  });

  app.patch('/api/documentos/:id/extracao', auth, office, scope, (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      res.json(service.review(
        req.user.tenant_id, req.params.id, req.user.sub, req.body || {}
      ));
    } catch (error) { handle(error, res); }
  });

  app.post('/api/documentos/:id/extracao/reprocessar', auth, office, scope, (req, res) => {
    try {
      if (!authorizedDocument(req, res)) return;
      const result = service.request(
        req.user.tenant_id, req.params.id, req.user.sub, { force: true }
      );
      res.status(202).json(result);
    } catch (error) { handle(error, res); }
  });

  return { service, normalization, interpreter };
}

module.exports = { mountDocumentIntelligenceRoutes };
