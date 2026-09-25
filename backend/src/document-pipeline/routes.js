'use strict';

const { createDocumentAccountingPipeline } = require('./accounting-pipeline');
const { OPERATION_TYPE_LIST } = require('./operation-types');

function mountDocumentPipelineRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, audit, companyOk, storage,
    extractionService, classify, assertPostableAccount, validateAccountingSemantics,
    auditSystem, emitEvent, EVENT_TYPES, accountingPeriodService, accountingAIService
  } = deps;

  const pipeline = createDocumentAccountingPipeline({
    db, id, storage, extractionService, classify, assertPostableAccount,
    validateAccountingSemantics, auditSystem, emitEvent, EVENT_TYPES,
    accountingPeriodService, accountingAIService, aiControlService: deps.aiControlService
  });

  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(err, res) {
    if (!err) return;
    return deny(res, err.http || 500, err.message || 'Erro no pipeline documental.', err.code || 'PIPELINE_ERROR');
  }

  app.get('/api/documentos/:id/pipeline', auth, office, scope, (req, res) => {
    try {
      const doc = db.prepare(
        'SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL'
      ).get(req.user.tenant_id, req.params.id);
      if (!doc || !companyOk(req, doc.company_id)) {
        return deny(res, 404, 'Documento não encontrado.', 'NOT_FOUND');
      }
      const run = pipeline.getRun(req.user.tenant_id, req.params.id);
      res.json(run || { document_id: req.params.id, status: null });
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/documentos/:id/pipeline/processar', auth, office, scope, async (req, res) => {
    try {
      const doc = db.prepare(
        'SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL'
      ).get(req.user.tenant_id, req.params.id);
      if (!doc || !companyOk(req, doc.company_id)) {
        return deny(res, 404, 'Documento não encontrado.', 'NOT_FOUND');
      }
      const force = !!(req.body && req.body.force);
      const result = await pipeline.processDocument(req.user.tenant_id, req.params.id, req.user.sub, { force });
      res.json(result);
    } catch (err) {
      handle(err, res);
    }
  });

  app.get('/api/contabilidade/naturezas', auth, office, (req, res) => {
    res.json({ items: OPERATION_TYPE_LIST });
  });

  app.get('/api/client/documentos/:id/pipeline', auth, (req, res) => {
    try {
      if (req.user.role !== 'CLIENT') return deny(res, 403, 'Acesso negado.', 'FORBIDDEN');
      const companyId = req.user.company_id;
      const doc = db.prepare(
        'SELECT * FROM documents WHERE tenant_id=? AND company_id=? AND id=? AND deleted_at IS NULL'
      ).get(req.user.tenant_id, companyId, req.params.id);
      if (!doc) return deny(res, 404, 'Documento não encontrado.', 'NOT_FOUND');
      const run = pipeline.getRun(req.user.tenant_id, req.params.id);
      res.json(run || { document_id: req.params.id, status: null, message: 'Processamento em andamento.' });
    } catch (err) {
      handle(err, res);
    }
  });

  return pipeline;
}

module.exports = { mountDocumentPipelineRoutes };
