'use strict';

const { createExportService, SYSTEM_LABELS } = require('./service');

function mountExportRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, audit, companyOk, today, pageParams, paged, scopedCompanyWhere, exportDir,
    periodService
  } = deps;

  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const qRows = (sql, ...p) => db.prepare(sql).all(...p);
  const service = createExportService(deps);
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(err, res) {
    if (!err) return;
    const body = {
      error: err.code || 'EXPORT_FAILED',
      message: err.message || 'Não foi possível gerar a exportação.'
    };
    if (err.preview) body.preview = err.preview;
    if (err.details) body.details = err.details;
    if (err.competence) body.competence = err.competence;
    if (err.period_id) body.period_id = err.period_id;
    return res.status(err.http || 422).json(body);
  }

  function resolveCompanyId(req) {
    if (req.companyScope) return req.companyScope;
    return req.body && req.body.company_id || req.query && req.query.company_id || null;
  }

  app.get('/api/exportacoes', auth, office, scope, (req, res) => {
    const sc = scopedCompanyWhere(req, 'x');
    let { where, p } = sc;
    const total = one(`SELECT COUNT(*) n FROM exports x WHERE ${where}`, ...p).n;
    const { page, page_size, offset } = pageParams(req, 25);
    const items = qRows(
      `SELECT x.*,c.name company_name FROM exports x JOIN companies c ON c.id=x.company_id WHERE ${where} ORDER BY x.created_at DESC LIMIT ? OFFSET ?`,
      ...p, page_size, offset
    );
    res.json(paged(items, total, page, page_size));
  });

  app.post('/api/exportacoes/previa', auth, office, scope, (req, res) => {
    try {
      if (req.companyScope) req.body.company_id = req.companyScope;
      const { company_id, system_key, period_start, period_end } = req.body || {};
      if (!company_id || !SYSTEM_LABELS[system_key] || !today(period_start) || !today(period_end) || !companyOk(req, company_id)) {
        return res.status(400).json({ error: 'INVALID_EXPORT' });
      }
      const preview = service.preview({
        tenantId: req.user.tenant_id,
        companyId: company_id,
        systemKey: system_key,
        periodStart: period_start,
        periodEnd: period_end,
        companyOk: true
      });
      res.json(preview);
    } catch (err) {
      handle(err, res);
    }
  });

  app.post('/api/exportacoes/gerar', auth, office, scope, (req, res) => {
    try {
      if (req.companyScope) req.body.company_id = req.companyScope;
      const { company_id, system_key, period_start, period_end, delimiter = ';' } = req.body || {};
      if (!company_id || !SYSTEM_LABELS[system_key] || !today(period_start) || !today(period_end) || !companyOk(req, company_id)) {
        return res.status(400).json({ error: 'INVALID_EXPORT' });
      }
      const result = service.generate({
        tenantId: req.user.tenant_id,
        companyId: company_id,
        systemKey: system_key,
        periodStart: period_start,
        periodEnd: period_end,
        delimiter,
        userId: req.user.sub,
        companyOk: true,
        req
      });
      res.status(201).json(result);
    } catch (err) {
      handle(err, res);
    }
  });

  app.get('/api/exportacoes/:id/download', auth, scope, (req, res) => {
    const x = one('SELECT * FROM exports WHERE tenant_id=? AND id=?', req.user.tenant_id, req.params.id);
    if (!x || !companyOk(req, x.company_id)) return res.status(404).end();
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(x.file_path)) return res.status(404).end();
    res.download(x.file_path, path.basename(x.file_path));
  });

  app.get('/api/empresas/:id/integracoes/dominio/mapeamentos', auth, office, scope, (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyOk(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      if (req.companyScope && req.companyScope !== companyId) {
        return deny(res, 403, 'Você não tem permissão para realizar esta operação.', 'COMPANY_SCOPE_MISMATCH');
      }
      const items = service.mappings.listAccountsWithMapping(req.user.tenant_id, companyId, 'dominio');
      res.json({
        system_key: 'dominio',
        layout_label: service.registry.get('dominio').metadata().layout_label,
        items
      });
    } catch (err) {
      handle(err, res);
    }
  });

  app.put('/api/empresas/:id/integracoes/dominio/mapeamentos', auth, role('OWNER', 'ACCOUNTANT'), scope, (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyOk(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      if (req.companyScope && req.companyScope !== companyId) {
        return deny(res, 403, 'Você não tem permissão para realizar esta operação.', 'COMPANY_SCOPE_MISMATCH');
      }
      const accountId = req.body && (req.body.account_id || req.body.accountId);
      const externalCode = req.body && (req.body.external_code || req.body.codigo_dominio);
      const row = service.mappings.upsert(
        req.user.tenant_id, companyId, 'dominio', accountId, externalCode, req.user.sub
      );
      audit(req, 'ACCOUNT_EXTERNAL_MAPPING_UPSERT', 'ACCOUNT_MAPPING', row.id, null, {
        company_id: companyId,
        account_id: accountId,
        system_key: 'dominio',
        result: 'ok'
      });
      res.json({
        id: row.id,
        account_id: row.account_id,
        external_code: row.external_code,
        active: !!row.active,
        updated_at: row.updated_at
      });
    } catch (err) {
      handle(err, res);
    }
  });

  app.delete('/api/empresas/:id/integracoes/dominio/mapeamentos/:accountId', auth, role('OWNER', 'ACCOUNTANT'), scope, (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyOk(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      if (req.companyScope && req.companyScope !== companyId) {
        return deny(res, 403, 'Você não tem permissão para realizar esta operação.', 'COMPANY_SCOPE_MISMATCH');
      }
      service.mappings.deactivate(req.user.tenant_id, companyId, 'dominio', req.params.accountId);
      audit(req, 'ACCOUNT_EXTERNAL_MAPPING_DEACTIVATE', 'ACCOUNT_MAPPING', req.params.accountId, null, {
        company_id: companyId,
        system_key: 'dominio',
        result: 'ok'
      });
      res.json({ ok: true });
    } catch (err) {
      handle(err, res);
    }
  });

  return service;
}

module.exports = { mountExportRoutes, SYSTEM_LABELS };
