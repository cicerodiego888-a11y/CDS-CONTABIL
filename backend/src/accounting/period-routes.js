'use strict';

const { createAccountingPeriodService } = require('./period-service');
const { PERIOD_STATUSES, labelOf } = require('./period-statuses');

function mountAccountingPeriodRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, audit, companyOk, pageParams, paged, mappings
  } = deps;

  const service = createAccountingPeriodService({ db, id, audit, mappings });
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');
  const closer = role('OWNER', 'ACCOUNTANT');

  function handle(err, res) {
    if (!err) return;
    const body = {
      error: err.code || 'PERIOD_ERROR',
      message: err.message || 'Erro na competência contábil.'
    };
    if (err.issues) body.issues = err.issues;
    if (err.details) body.details = err.details;
    if (err.competence) body.competence = err.competence;
    if (err.period_id) body.period_id = err.period_id;
    return res.status(err.http || 500).json(body);
  }

  function resolveCompanyId(req) {
    if (req.companyScope) return req.companyScope;
    return (req.body && req.body.company_id) || (req.query && req.query.company_id) || null;
  }

  function loadVisible(req, res, periodId) {
    const period = service.getById(req.user.tenant_id, periodId);
    if (!period || !companyOk(req, period.company_id)) {
      deny(res, 404, 'Competência não encontrada.', 'PERIOD_NOT_FOUND');
      return null;
    }
    if (req.companyScope && req.companyScope !== period.company_id) {
      deny(res, 403, 'Você não tem permissão para realizar esta operação.', 'COMPANY_SCOPE_MISMATCH');
      return null;
    }
    return period;
  }

  app.get('/api/contabilidade/competencias', auth, office, scope, (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (companyId && !companyOk(req, companyId)) {
        return deny(res, 404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      }
      const { page, page_size } = pageParams(req, 25);
      const result = service.list(req.user.tenant_id, {
        companyId,
        status: req.query.status ? String(req.query.status).toUpperCase() : null,
        page,
        pageSize: page_size
      });
      const items = result.items.map(p => ({
        ...p,
        status_label: labelOf(p.status),
        competence_label: service.formatCompetenceBr(p.competence)
      }));
      res.json(paged(items, result.total, page, page_size));
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/contabilidade/competencias', auth, office, scope, (req, res) => {
    try {
      if (req.companyScope) req.body.company_id = req.companyScope;
      const companyId = req.body && req.body.company_id;
      const competence = req.body && req.body.competence;
      if (!companyId || !companyOk(req, companyId)) {
        return deny(res, 404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      }
      const conflict = String(req.query.conflict || req.body.conflict || 'return_existing');
      const created = service.create(
        req.user.tenant_id,
        req.user.sub,
        { company_id: companyId, competence },
        { req, conflictMode: conflict === 'error' ? 'error' : 'return_existing' }
      );
      const isNew = !!created._created;
      const payload = { ...created };
      delete payload._created;
      res.status(isNew ? 201 : 200).json({
        ...payload,
        status_label: labelOf(created.status),
        competence_label: service.formatCompetenceBr(created.competence)
      });
    } catch (err) {
      handle(err, res);
    }
  });

  app.get('/api/contabilidade/competencias/:id', auth, office, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      res.json({
        ...period,
        status_label: labelOf(period.status),
        competence_label: service.formatCompetenceBr(period.competence)
      });
    } catch (err) {
      handle(err, res);
    }
  });

  app.get('/api/contabilidade/competencias/:id/resumo', auth, office, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      res.json(service.buildSummary(req.user.tenant_id, period.id));
    } catch (err) {
      handle(err, res);
    }
  });

  app.get('/api/contabilidade/competencias/:id/historico', auth, office, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      res.json(service.history(req.user.tenant_id, period.id));
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/contabilidade/competencias/:id/iniciar-conferencia', auth, closer, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      const after = service.setStatus(req.user.tenant_id, period.id, PERIOD_STATUSES.IN_REVIEW, {
        userId: req.user.sub, req
      });
      res.json({ ...after, status_label: labelOf(after.status) });
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/contabilidade/competencias/:id/pronta-exportacao', auth, closer, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      const validation = service.validateForClosing(req.user.tenant_id, period.id, { requireExport: false });
      if (!validation.ok) {
        return res.status(409).json({
          error: 'NOT_READY',
          message: 'A competência ainda possui pendências impeditivas.',
          issues: validation.issues,
          details: validation.issues
        });
      }
      const after = service.setStatus(req.user.tenant_id, period.id, PERIOD_STATUSES.READY_FOR_EXPORT, {
        userId: req.user.sub, req
      });
      res.json({ ...after, status_label: labelOf(after.status) });
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/contabilidade/competencias/:id/fechar', auth, closer, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      const after = service.close(req.user.tenant_id, period.id, {
        userId: req.user.sub, req
      });
      res.json({
        ...after,
        status_label: labelOf(after.status),
        competence_label: service.formatCompetenceBr(after.competence)
      });
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/contabilidade/competencias/:id/reabrir', auth, closer, scope, (req, res) => {
    try {
      const period = loadVisible(req, res, req.params.id);
      if (!period) return;
      const reason = req.body && (req.body.reason || req.body.motivo);
      const after = service.reopen(req.user.tenant_id, period.id, {
        userId: req.user.sub, reason, req
      });
      res.json({
        ...after,
        status_label: labelOf(after.status),
        competence_label: service.formatCompetenceBr(after.competence)
      });
    } catch (err) {
      handle(err, res);
    }
  });

  return service;
}

module.exports = { mountAccountingPeriodRoutes };
