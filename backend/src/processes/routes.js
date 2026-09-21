'use strict';

const { createProcessService } = require('./service');
const { createProcessRecurrenceService } = require('./recurrence');
const { createProcessEventService, PROCESS_EVENT_TYPES } = require('./events');

function mountProcessRoutes(app, deps) {
  const {
    db, id, auth, role, scope, deny, audit, emitEvent, companyVisibleToUser, pageParams, paged
  } = deps;
  const service = createProcessService({ db, id });
  const events = createProcessEventService({ db, id, emitEvent });
  const recurrence = createProcessRecurrenceService({
    db, id, processService: service, publishEvent: events.publish
  });
  service.recurrence = recurrence;
  service.events = events;
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(err, res) {
    if (!err) return;
    return deny(res, err.http || 500, err.message || 'Erro no Motor de Processos.', err.code || 'PROCESS_ERROR');
  }

  function ensureCompanyVisible(req, companyId) {
    if (!companyId) return true;
    return companyVisibleToUser(req, companyId);
  }

  function visibleOccurrence(req, occurrenceId, res) {
    const occurrence = service.getOccurrence(req.user.tenant_id, occurrenceId);
    if (!occurrence || !ensureCompanyVisible(req, occurrence.company_id) ||
        (req.companyScope && occurrence.company_id !== req.companyScope)) {
      deny(res, 404, 'Ocorrência não encontrada.', 'NOT_FOUND');
      return null;
    }
    return occurrence;
  }

  app.get('/api/processos', auth, office, scope, (req, res) => {
    try {
      const { page, page_size } = pageParams(req, 25);
      const companyId = req.companyScope || (req.query.company_id ? String(req.query.company_id) : null);
      if (companyId && !ensureCompanyVisible(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      const result = service.listProcesses(req.user.tenant_id, {
        companyId,
        status: req.query.status ? String(req.query.status).toUpperCase() : null,
        q: req.query.q ? String(req.query.q).trim() : null,
        page: 1,
        pageSize: 5000
      });
      const visible = result.items.filter(p => ensureCompanyVisible(req, p.company_id));
      const offset = (page - 1) * page_size;
      res.json(paged(visible.slice(offset, offset + page_size), visible.length, page, page_size));
    } catch (e) { handle(e, res); }
  });

  app.get('/api/processos/dashboard', auth, office, scope, (req, res) => {
    try {
      const companyId = req.companyScope || (req.query.company_id ? String(req.query.company_id) : null);
      if (companyId && !ensureCompanyVisible(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      let visibleCompanyIds;
      if (!companyId) {
        const all = service.listProcesses(req.user.tenant_id, { page: 1, pageSize: 5000 }).items;
        visibleCompanyIds = [...new Set(all.filter(p => ensureCompanyVisible(req, p.company_id)).map(p => p.company_id))];
      }
      res.json(service.processDashboard(req.user.tenant_id, companyId, visibleCompanyIds));
    } catch (e) { handle(e, res); }
  });

  app.get('/api/processos/dashboard/proximos-prazos', auth, office, scope, (req, res) => {
    try {
      const companyId = req.companyScope || (req.query.company_id ? String(req.query.company_id) : null);
      if (companyId && !ensureCompanyVisible(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      let visibleCompanyIds;
      if (!companyId) {
        const all = service.listProcesses(req.user.tenant_id, { page: 1, pageSize: 5000 }).items;
        visibleCompanyIds = [...new Set(all.filter(p => ensureCompanyVisible(req, p.company_id)).map(p => p.company_id))];
      }
      const from = req.query.from ? String(req.query.from) : null;
      const to = req.query.to ? String(req.query.to) : null;
      res.json({
        items: service.listUpcomingDeadlines(req.user.tenant_id, {
          companyId,
          companyIds: visibleCompanyIds,
          limit: req.query.limit,
          from,
          to
        })
      });
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      if (req.companyScope) req.body.company_id = req.companyScope;
      if (!ensureCompanyVisible(req, req.body.company_id)) return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      const created = service.createProcess(req.user.tenant_id, req.user.sub, req.body || {});
      audit(req, 'PROCESS_CREATED', 'PROCESS', created.id, null, { name: created.name, company_id: created.company_id, status: created.status });
      res.status(201).json(created);
    } catch (e) { handle(e, res); }
  });

  app.get('/api/processos/:id', auth, office, scope, (req, res) => {
    try {
      const p = service.getProcess(req.user.tenant_id, req.params.id);
      if (!p || !ensureCompanyVisible(req, p.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      if (req.companyScope && p.company_id !== req.companyScope) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      res.json(p);
    } catch (e) { handle(e, res); }
  });

  app.patch('/api/processos/:id', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      if (req.body.company_id && !ensureCompanyVisible(req, req.body.company_id)) {
        return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      }
      const { before, after } = service.updateProcess(req.user.tenant_id, req.params.id, req.body || {});
      audit(req, 'PROCESS_UPDATED', 'PROCESS', after.id, { name: before.name, status: before.status }, { name: after.name, status: after.status });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos/:id/ativar', auth, office, scope, (req, res) => {
    try {
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      const { before, after } = service.setProcessStatus(req.user.tenant_id, req.params.id, 'ATIVO');
      audit(req, 'PROCESS_ACTIVATED', 'PROCESS', after.id, { status: before.status }, { status: after.status });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos/:id/desativar', auth, office, scope, (req, res) => {
    try {
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      const { before, after } = service.setProcessStatus(req.user.tenant_id, req.params.id, 'INATIVO');
      audit(req, 'PROCESS_DEACTIVATED', 'PROCESS', after.id, { status: before.status }, { status: after.status });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.get('/api/processos/:id/recorrencia', auth, office, scope, (req, res) => {
    try {
      const process = service.getProcess(req.user.tenant_id, req.params.id);
      if (!process || !ensureCompanyVisible(req, process.company_id)) {
        return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      }
      const configured = recurrence.get(req.user.tenant_id, req.params.id);
      if (!configured) return deny(res, 404, 'Recorrência não configurada.', 'RECURRENCE_NOT_FOUND');
      res.json(configured);
    } catch (e) { handle(e, res); }
  });

  app.put('/api/processos/:id/recorrencia', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      delete req.body.company_id;
      delete req.body.process_id;
      const process = service.getProcess(req.user.tenant_id, req.params.id);
      if (!process || !ensureCompanyVisible(req, process.company_id)) {
        return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      }
      const result = recurrence.configure(req.user.tenant_id, req.params.id, req.body || {}, req.user.sub);
      audit(req, result.created ? 'PROCESS_RECURRENCE_CREATED' : 'PROCESS_RECURRENCE_UPDATED',
        'PROCESS_RECURRENCE', result.after.id, result.before, result.after);
      res.status(result.created ? 201 : 200).json(result.after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos/:id/recorrencia/ativar', auth, office, scope, (req, res) => {
    try {
      const process = service.getProcess(req.user.tenant_id, req.params.id);
      if (!process || !ensureCompanyVisible(req, process.company_id)) {
        return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      }
      const { before, after } = recurrence.setActive(req.user.tenant_id, req.params.id, true);
      audit(req, 'PROCESS_RECURRENCE_ACTIVATED', 'PROCESS_RECURRENCE', after.id,
        { active: before.active }, { active: after.active });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos/:id/recorrencia/desativar', auth, office, scope, (req, res) => {
    try {
      const process = service.getProcess(req.user.tenant_id, req.params.id);
      if (!process || !ensureCompanyVisible(req, process.company_id)) {
        return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      }
      const { before, after } = recurrence.setActive(req.user.tenant_id, req.params.id, false);
      audit(req, 'PROCESS_RECURRENCE_DEACTIVATED', 'PROCESS_RECURRENCE', after.id,
        { active: before.active }, { active: after.active });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos/:id/recorrencia/gerar-agora', auth, office, scope, (req, res) => {
    try {
      const process = service.getProcess(req.user.tenant_id, req.params.id);
      if (!process || !ensureCompanyVisible(req, process.company_id)) {
        return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      }
      const result = recurrence.generateNow(
        req.user.tenant_id, req.params.id, req.user.sub,
        req.body && req.body.competence
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processos/:id/etapas', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      const step = service.createStep(req.user.tenant_id, req.params.id, req.body || {});
      audit(req, 'PROCESS_STEP_CREATED', 'PROCESS_STEP', step.id, null, { process_id: req.params.id, name: step.name, step_order: step.step_order });
      res.status(201).json(step);
    } catch (e) { handle(e, res); }
  });

  app.patch('/api/processos/:id/etapas/:stepId', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      const { before, after } = service.updateStep(req.user.tenant_id, req.params.id, req.params.stepId, req.body || {});
      audit(req, 'PROCESS_STEP_UPDATED', 'PROCESS_STEP', after.id, { name: before.name, step_order: before.step_order }, { name: after.name, step_order: after.step_order });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.delete('/api/processos/:id/etapas/:stepId', auth, office, scope, (req, res) => {
    try {
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      const before = service.deleteStep(req.user.tenant_id, req.params.id, req.params.stepId);
      audit(req, 'PROCESS_STEP_DELETED', 'PROCESS_STEP', before.id, { name: before.name, process_id: req.params.id }, null);
      res.json({ ok: true, id: before.id });
    } catch (e) { handle(e, res); }
  });

  app.put('/api/processos/:id/etapas/ordem', auth, office, scope, (req, res) => {
    try {
      const current = service.getProcess(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      const steps = service.reorderSteps(req.user.tenant_id, req.params.id, req.body && req.body.step_ids);
      audit(req, 'PROCESS_STEP_UPDATED', 'PROCESS', req.params.id, null, { reorder: true, count: steps.length });
      res.json({ steps });
    } catch (e) { handle(e, res); }
  });

  app.get('/api/processo-ocorrencias', auth, office, scope, (req, res) => {
    try {
      const { page, page_size } = pageParams(req, 25);
      const companyId = req.companyScope || (req.query.company_id ? String(req.query.company_id) : null);
      if (companyId && !ensureCompanyVisible(req, companyId)) return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      const result = service.listOccurrences(req.user.tenant_id, {
        companyId,
        processId: req.query.process_id ? String(req.query.process_id) : null,
        status: req.query.status ? String(req.query.status).toUpperCase().replace('CONCLUÍDA', 'CONCLUIDA') : null,
        dueStatus: req.query.deadline_status ? String(req.query.deadline_status).toUpperCase() : null,
        page: 1,
        pageSize: 5000
      });
      const visible = result.items.filter(o => ensureCompanyVisible(req, o.company_id));
      const offset = (page - 1) * page_size;
      res.json(paged(visible.slice(offset, offset + page_size), visible.length, page, page_size));
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processo-ocorrencias', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      if (req.companyScope) req.body.company_id = req.companyScope;
      const proc = service.getProcess(req.user.tenant_id, String(req.body.process_id || ''));
      if (!proc || !ensureCompanyVisible(req, proc.company_id)) return deny(res, 404, 'Processo não encontrado.', 'NOT_FOUND');
      if (!req.body.company_id) req.body.company_id = proc.company_id;
      if (!ensureCompanyVisible(req, req.body.company_id)) return deny(res, 404, 'Empresa não encontrada.', 'NOT_FOUND');
      const created = service.createOccurrence(req.user.tenant_id, req.user.sub, req.body || {});
      audit(req, 'PROCESS_OCCURRENCE_CREATED', 'PROCESS_OCCURRENCE', created.id, null, {
        process_id: created.process_id, competence: created.competence, company_id: created.company_id, steps: created.steps.length
      });
      events.publish({
        tenantId: req.user.tenant_id,
        companyId: created.company_id,
        eventType: PROCESS_EVENT_TYPES.OCCURRENCE_MANUALLY_CREATED,
        actorUserId: req.user.sub,
        entityType: 'process_occurrence',
        entityId: created.id,
        payload: {
          process_id: created.process_id,
          occurrence_id: created.id,
          responsible_user_id: created.responsible_user_id,
          process_name: created.process_name,
          title: created.title,
          source: 'MANUAL'
        }
      });
      res.status(201).json(created);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processo-ocorrencias/:id/start', auth, office, scope, (req, res) => {
    try {
      const current = visibleOccurrence(req, req.params.id, res);
      if (!current) return;
      const { before, after } = service.startOccurrence(req.user.tenant_id, req.params.id, req.user.sub);
      audit(req, 'PROCESS_OCCURRENCE_STARTED', 'PROCESS_OCCURRENCE', after.id,
        { status: before.status }, { status: after.status, started_at: after.started_at });
      events.publish({
        tenantId: req.user.tenant_id, companyId: after.company_id,
        eventType: PROCESS_EVENT_TYPES.OCCURRENCE_STARTED,
        actorUserId: req.user.sub, entityType: 'process_occurrence', entityId: after.id,
        payload: {
          process_id: after.process_id, occurrence_id: after.id,
          responsible_user_id: after.responsible_user_id, title: after.title
        }
      });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processo-ocorrencias/:id/reopen', auth, office, scope, (req, res) => {
    try {
      const current = visibleOccurrence(req, req.params.id, res);
      if (!current) return;
      const { before, after } = service.reopenOccurrence(req.user.tenant_id, req.params.id);
      audit(req, 'PROCESS_OCCURRENCE_REOPENED', 'PROCESS_OCCURRENCE', after.id,
        { status: before.status, completed_at: before.completed_at }, { status: after.status });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processo-ocorrencias/:id/steps/:stepId/start', auth, office, scope, (req, res) => {
    try {
      const current = visibleOccurrence(req, req.params.id, res);
      if (!current) return;
      const wasPending = current.status === 'PENDENTE';
      const { before, after } = service.startOccurrenceStep(
        req.user.tenant_id, req.params.id, req.params.stepId, req.user.sub
      );
      audit(req, 'PROCESS_STEP_STARTED', 'PROCESS_OCCURRENCE_STEP', before.id,
        { status: before.status }, { status: 'EM_ANDAMENTO', started_by: req.user.sub });
      events.publish({
        tenantId: req.user.tenant_id, companyId: after.company_id,
        eventType: PROCESS_EVENT_TYPES.STEP_STARTED,
        actorUserId: req.user.sub, entityType: 'process_occurrence_step', entityId: before.id,
        payload: {
          process_id: after.process_id, occurrence_id: after.id, step_id: before.id,
          responsible_user_id: before.responsible_user_id, step_name: before.name, title: after.title
        }
      });
      if (wasPending) {
        audit(req, 'PROCESS_OCCURRENCE_STARTED', 'PROCESS_OCCURRENCE', after.id,
          { status: 'PENDENTE' }, { status: after.status, started_at: after.started_at });
        events.publish({
          tenantId: req.user.tenant_id, companyId: after.company_id,
          eventType: PROCESS_EVENT_TYPES.OCCURRENCE_STARTED,
          actorUserId: req.user.sub, entityType: 'process_occurrence', entityId: after.id,
          payload: {
            process_id: after.process_id, occurrence_id: after.id,
            responsible_user_id: after.responsible_user_id, title: after.title
          }
        });
      }
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processo-ocorrencias/:id/steps/:stepId/complete', auth, office, scope, (req, res) => {
    try {
      const current = visibleOccurrence(req, req.params.id, res);
      if (!current) return;
      const { before, after, occurrence_completed } = service.completeOccurrenceStep(
        req.user.tenant_id, req.params.id, req.params.stepId, req.user.sub
      );
      audit(req, 'PROCESS_STEP_COMPLETED', 'PROCESS_OCCURRENCE_STEP', before.id,
        { status: before.status }, { status: 'CONCLUIDA', completed_by: req.user.sub });
      events.publish({
        tenantId: req.user.tenant_id, companyId: after.company_id,
        eventType: PROCESS_EVENT_TYPES.STEP_COMPLETED,
        actorUserId: req.user.sub, entityType: 'process_occurrence_step', entityId: before.id,
        payload: {
          process_id: after.process_id, occurrence_id: after.id, step_id: before.id,
          responsible_user_id: before.responsible_user_id,
          next_responsible_user_id: after.next_step && after.next_step.responsible_user_id,
          step_name: after.next_step && after.next_step.name,
          title: after.title
        }
      });
      if (occurrence_completed) {
        audit(req, 'PROCESS_OCCURRENCE_COMPLETED', 'PROCESS_OCCURRENCE', after.id,
          { status: 'EM_ANDAMENTO' }, { status: after.status, completed_at: after.completed_at });
        events.publish({
          tenantId: req.user.tenant_id, companyId: after.company_id,
          eventType: PROCESS_EVENT_TYPES.OCCURRENCE_COMPLETED,
          actorUserId: req.user.sub, entityType: 'process_occurrence', entityId: after.id,
          payload: {
            process_id: after.process_id, occurrence_id: after.id,
            responsible_user_id: after.responsible_user_id, title: after.title
          }
        });
      }
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.post('/api/processo-ocorrencias/:id/steps/:stepId/reopen', auth, office, scope, (req, res) => {
    try {
      const current = visibleOccurrence(req, req.params.id, res);
      if (!current) return;
      const { before, after } = service.reopenOccurrenceStep(
        req.user.tenant_id, req.params.id, req.params.stepId, req.user.sub,
        req.body && req.body.status
      );
      const reopened = after.steps.find(s => s.id === req.params.stepId);
      audit(req, 'PROCESS_STEP_REOPENED', 'PROCESS_OCCURRENCE_STEP', before.id,
        { status: before.status, completed_at: before.completed_at },
        { status: reopened && reopened.status, reopened_by: req.user.sub });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.patch('/api/processo-ocorrencias/:id/steps/:stepId', auth, office, scope, (req, res) => {
    try {
      const current = visibleOccurrence(req, req.params.id, res);
      if (!current) return;
      const { before, after } = service.updateOccurrenceStep(
        req.user.tenant_id, req.params.id, req.params.stepId, req.body || {}
      );
      const updated = after.steps.find(s => s.id === req.params.stepId);
      audit(req, 'PROCESS_STEP_UPDATED', 'PROCESS_OCCURRENCE_STEP', before.id,
        { observation: before.observation }, { observation: updated && updated.observation });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  app.get('/api/processo-ocorrencias/:id', auth, office, scope, (req, res) => {
    try {
      const o = service.getOccurrence(req.user.tenant_id, req.params.id);
      if (!o || !ensureCompanyVisible(req, o.company_id)) return deny(res, 404, 'Ocorrência não encontrada.', 'NOT_FOUND');
      if (req.companyScope && o.company_id !== req.companyScope) return deny(res, 404, 'Ocorrência não encontrada.', 'NOT_FOUND');
      res.json(o);
    } catch (e) { handle(e, res); }
  });

  app.patch('/api/processo-ocorrencias/:id', auth, office, scope, (req, res) => {
    try {
      delete req.body.tenant_id;
      delete req.body.company_id;
      delete req.body.process_id;
      delete req.body.competence;
      const current = service.getOccurrence(req.user.tenant_id, req.params.id);
      if (!current || !ensureCompanyVisible(req, current.company_id)) return deny(res, 404, 'Ocorrência não encontrada.', 'NOT_FOUND');
      const { before, after } = service.updateOccurrence(req.user.tenant_id, req.params.id, req.body || {});
      audit(req, 'PROCESS_OCCURRENCE_UPDATED', 'PROCESS_OCCURRENCE', after.id, { status: before.status }, { status: after.status });
      res.json(after);
    } catch (e) { handle(e, res); }
  });

  return service;
}

module.exports = { mountProcessRoutes };
