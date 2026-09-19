'use strict';

const { parseCompetence, occurrenceTitle } = require('./competence');

const PROCESS_STATUSES = new Set(['ATIVO', 'INATIVO']);
const OCCURRENCE_STATUSES = new Set(['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA']);
const STEP_RUN_STATUSES = new Set(['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'BLOQUEADA', 'CANCELADA']);

function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function dueDateForCompetence(year, month, offsetDays) {
  return isoDate(new Date(Date.UTC(Number(year), Number(month) - 1, 1 + Number(offsetDays || 0))));
}

function classifyDueDate(dueDate, status, today = new Date()) {
  if (status === 'CONCLUIDA') return 'CONCLUIDA';
  if (status === 'CANCELADA') return 'CANCELADA';
  const due = isoDate(dueDate);
  const current = isoDate(today);
  if (!due || !current) return 'NO_PRAZO';
  if (due < current) return 'ATRASADA';
  const dueMs = Date.parse(due + 'T00:00:00Z');
  const currentMs = Date.parse(current + 'T00:00:00Z');
  return Math.round((dueMs - currentMs) / 86400000) <= 2 ? 'VENCENDO' : 'NO_PRAZO';
}

function createProcessService({ db, id }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function fail(message, code, http) {
    const e = new Error(message);
    e.code = code || 'ERROR';
    e.http = http || 400;
    return e;
  }

  function officeUser(tenantId, userId) {
    if (!userId) return null;
    return one(
      "SELECT id,name,email,role,active FROM users WHERE tenant_id=? AND id=? AND role IN('OWNER','ACCOUNTANT','STAFF')",
      tenantId, userId
    );
  }

  function assertResponsible(tenantId, userId) {
    if (userId === undefined || userId === null || userId === '') return null;
    const u = officeUser(tenantId, userId);
    if (!u) throw fail('Responsável inválido para este escritório.', 'INVALID_RESPONSIBLE', 400);
    if (!u.active) throw fail('Responsável inativo.', 'RESPONSIBLE_INACTIVE', 400);
    return u.id;
  }

  function companyInTenant(tenantId, companyId) {
    return one('SELECT id,name,trade_name,status FROM companies WHERE tenant_id=? AND id=?', tenantId, companyId);
  }

  function processRow(tenantId, processId) {
    return one(
      `SELECT p.*, c.name company_name, c.trade_name company_trade_name,
              u.name responsible_name,
              r.id recurrence_id,r.frequency recurrence_frequency,
              r.generation_day recurrence_generation_day,
              r.start_year recurrence_start_year,r.start_month recurrence_start_month,
              r.active recurrence_active,
              r.last_generated_year recurrence_last_year,
              r.last_generated_month recurrence_last_month
       FROM processes p
       JOIN companies c ON c.id=p.company_id
       LEFT JOIN users u ON u.id=p.responsible_user_id
       LEFT JOIN process_recurrences r ON r.process_id=p.id AND r.tenant_id=p.tenant_id
       WHERE p.tenant_id=? AND p.id=?`,
      tenantId, processId
    );
  }

  function stepRows(processId) {
    return rows(
      `SELECT s.*, u.name responsible_name
       FROM process_steps s
       LEFT JOIN users u ON u.id=s.responsible_user_id
       WHERE s.process_id=?
       ORDER BY s.step_order ASC, s.created_at ASC`,
      processId
    );
  }

  function withSteps(p) {
    if (!p) return null;
    const steps = stepRows(p.id);
    let recurrence = null;
    if (p.recurrence_id) {
      const lastYear = Number(p.recurrence_last_year);
      const lastMonth = Number(p.recurrence_last_month);
      const nextYear = lastYear ? (lastMonth === 12 ? lastYear + 1 : lastYear) : Number(p.recurrence_start_year);
      const nextMonth = lastYear ? (lastMonth === 12 ? 1 : lastMonth + 1) : Number(p.recurrence_start_month);
      recurrence = {
        id: p.recurrence_id,
        frequency: p.recurrence_frequency,
        generation_day: p.recurrence_generation_day,
        start_year: p.recurrence_start_year,
        start_month: p.recurrence_start_month,
        active: Number(p.recurrence_active) === 1,
        last_competence: lastYear ? `${lastYear}-${String(lastMonth).padStart(2, '0')}` : null,
        next_competence: `${nextYear}-${String(nextMonth).padStart(2, '0')}`
      };
    }
    return {
      ...p,
      recurrence,
      steps,
      step_count: steps.length,
      due_label: null
    };
  }

  function listProcesses(tenantId, { companyId, status, q, page, pageSize } = {}) {
    const p = [tenantId];
    let where = 'p.tenant_id=?';
    if (companyId) { where += ' AND p.company_id=?'; p.push(companyId); }
    if (status && PROCESS_STATUSES.has(status)) { where += ' AND p.status=?'; p.push(status); }
    if (q) {
      where += ' AND (lower(p.name) LIKE ? OR lower(IFNULL(p.sector,\'\')) LIKE ? OR lower(IFNULL(c.name,\'\')) LIKE ?)';
      const like = '%' + String(q).toLowerCase() + '%';
      p.push(like, like, like);
    }
    const total = one(
      `SELECT COUNT(*) n FROM processes p JOIN companies c ON c.id=p.company_id WHERE ${where}`,
      ...p
    ).n;
    const offset = (page - 1) * pageSize;
    const items = rows(
      `SELECT p.*, c.name company_name, c.trade_name company_trade_name, u.name responsible_name,
              (SELECT COUNT(*) FROM process_steps s WHERE s.process_id=p.id AND s.active=1) step_count,
              r.frequency recurrence_frequency,r.generation_day recurrence_generation_day,
              r.active recurrence_active,r.start_year recurrence_start_year,r.start_month recurrence_start_month,
              r.last_generated_year recurrence_last_year,r.last_generated_month recurrence_last_month
       FROM processes p
       JOIN companies c ON c.id=p.company_id
       LEFT JOIN users u ON u.id=p.responsible_user_id
       LEFT JOIN process_recurrences r ON r.process_id=p.id AND r.tenant_id=p.tenant_id
       WHERE ${where}
       ORDER BY p.name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`,
      ...p, pageSize, offset
    ).map(item => {
      if (!item.recurrence_frequency) return { ...item, recurrence: null };
      const lastYear = Number(item.recurrence_last_year);
      const lastMonth = Number(item.recurrence_last_month);
      const nextYear = lastYear ? (lastMonth === 12 ? lastYear + 1 : lastYear) : Number(item.recurrence_start_year);
      const nextMonth = lastYear ? (lastMonth === 12 ? 1 : lastMonth + 1) : Number(item.recurrence_start_month);
      return {
        ...item,
        recurrence: {
          frequency: item.recurrence_frequency,
          generation_day: item.recurrence_generation_day,
          active: Number(item.recurrence_active) === 1,
          last_competence: lastYear ? `${lastYear}-${String(lastMonth).padStart(2, '0')}` : null,
          next_competence: `${nextYear}-${String(nextMonth).padStart(2, '0')}`
        }
      };
    });
    return { items, total };
  }

  function getProcess(tenantId, processId) {
    return withSteps(processRow(tenantId, processId));
  }

  function createProcess(tenantId, userId, body) {
    const name = String(body.name || '').trim();
    if (!name) throw fail('Informe o nome do processo.', 'NAME_REQUIRED', 400);
    const companyId = String(body.company_id || '').trim();
    const company = companyInTenant(tenantId, companyId);
    if (!company) throw fail('Empresa não encontrada.', 'COMPANY_NOT_FOUND', 404);
    const responsible = assertResponsible(tenantId, body.responsible_user_id);
    const sector = String(body.sector || '').trim() || null;
    const description = String(body.description || '').trim() || null;
    const status = PROCESS_STATUSES.has(String(body.status || '').toUpperCase())
      ? String(body.status).toUpperCase()
      : 'ATIVO';
    const pid = id();
    run(
      `INSERT INTO processes(id,tenant_id,company_id,name,description,sector,status,responsible_user_id,created_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      pid, tenantId, companyId, name, description, sector, status, responsible, userId
    );
    return getProcess(tenantId, pid);
  }

  function updateProcess(tenantId, processId, body) {
    const before = processRow(tenantId, processId);
    if (!before) throw fail('Processo não encontrado.', 'NOT_FOUND', 404);
    const name = body.name !== undefined ? String(body.name || '').trim() : before.name;
    if (!name) throw fail('Informe o nome do processo.', 'NAME_REQUIRED', 400);
    let companyId = before.company_id;
    if (body.company_id !== undefined) {
      const company = companyInTenant(tenantId, String(body.company_id || '').trim());
      if (!company) throw fail('Empresa não encontrada.', 'COMPANY_NOT_FOUND', 404);
      companyId = company.id;
    }
    const responsible = body.responsible_user_id !== undefined
      ? assertResponsible(tenantId, body.responsible_user_id)
      : before.responsible_user_id;
    const sector = body.sector !== undefined ? (String(body.sector || '').trim() || null) : before.sector;
    const description = body.description !== undefined
      ? (String(body.description || '').trim() || null)
      : before.description;
    let status = before.status;
    if (body.status !== undefined) {
      const s = String(body.status || '').toUpperCase();
      if (!PROCESS_STATUSES.has(s)) throw fail('Situação inválida.', 'INVALID_STATUS', 400);
      status = s;
    }
    run(
      `UPDATE processes SET company_id=?, name=?, description=?, sector=?, status=?, responsible_user_id=?, updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND id=?`,
      companyId, name, description, sector, status, responsible, tenantId, processId
    );
    return { before, after: getProcess(tenantId, processId) };
  }

  function setProcessStatus(tenantId, processId, status) {
    if (!PROCESS_STATUSES.has(status)) throw fail('Situação inválida.', 'INVALID_STATUS', 400);
    const before = processRow(tenantId, processId);
    if (!before) throw fail('Processo não encontrado.', 'NOT_FOUND', 404);
    run('UPDATE processes SET status=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?', status, tenantId, processId);
    return { before, after: getProcess(tenantId, processId) };
  }

  function nextStepOrder(processId) {
    const row = one('SELECT COALESCE(MAX(step_order),0) n FROM process_steps WHERE process_id=?', processId);
    return Number(row.n || 0) + 1;
  }

  function getStep(tenantId, processId, stepId) {
    return one(
      `SELECT s.*, u.name responsible_name FROM process_steps s
       LEFT JOIN users u ON u.id=s.responsible_user_id
       WHERE s.tenant_id=? AND s.process_id=? AND s.id=?`,
      tenantId, processId, stepId
    );
  }

  function createStep(tenantId, processId, body) {
    const proc = processRow(tenantId, processId);
    if (!proc) throw fail('Processo não encontrado.', 'NOT_FOUND', 404);
    const name = String(body.name || '').trim();
    if (!name) throw fail('Informe o nome da etapa.', 'NAME_REQUIRED', 400);
    const responsible = assertResponsible(tenantId, body.responsible_user_id);
    const due = Number(body.due_offset_days);
    const dueOffset = Number.isFinite(due) && due >= 0 ? Math.floor(due) : 0;
    let order = body.step_order !== undefined ? Number(body.step_order) : nextStepOrder(processId);
    if (!Number.isFinite(order) || order < 1) order = nextStepOrder(processId);
    const required = body.required === false || body.required === 0 || body.required === '0' ? 0 : 1;
    const active = body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
    const sid = id();
    run(
      `INSERT INTO process_steps(id,process_id,tenant_id,name,description,step_order,responsible_user_id,due_offset_days,required,active)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      sid, processId, tenantId, name, String(body.description || '').trim() || null, order, responsible, dueOffset, required, active
    );
    return getStep(tenantId, processId, sid);
  }

  function updateStep(tenantId, processId, stepId, body) {
    const before = getStep(tenantId, processId, stepId);
    if (!before) throw fail('Etapa não encontrada.', 'NOT_FOUND', 404);
    const name = body.name !== undefined ? String(body.name || '').trim() : before.name;
    if (!name) throw fail('Informe o nome da etapa.', 'NAME_REQUIRED', 400);
    const responsible = body.responsible_user_id !== undefined
      ? assertResponsible(tenantId, body.responsible_user_id)
      : before.responsible_user_id;
    let dueOffset = before.due_offset_days;
    if (body.due_offset_days !== undefined) {
      const due = Number(body.due_offset_days);
      if (!Number.isFinite(due) || due < 0) throw fail('Prazo relativo inválido.', 'INVALID_DUE_OFFSET', 400);
      dueOffset = Math.floor(due);
    }
    let order = before.step_order;
    if (body.step_order !== undefined) {
      order = Number(body.step_order);
      if (!Number.isFinite(order) || order < 1) throw fail('Ordem inválida.', 'INVALID_ORDER', 400);
    }
    const required = body.required !== undefined
      ? (body.required === false || body.required === 0 || body.required === '0' ? 0 : 1)
      : before.required;
    const active = body.active !== undefined
      ? (body.active === false || body.active === 0 || body.active === '0' ? 0 : 1)
      : before.active;
    const description = body.description !== undefined
      ? (String(body.description || '').trim() || null)
      : before.description;
    run(
      `UPDATE process_steps SET name=?, description=?, step_order=?, responsible_user_id=?, due_offset_days=?, required=?, active=?, updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND process_id=? AND id=?`,
      name, description, order, responsible, dueOffset, required, active, tenantId, processId, stepId
    );
    return { before, after: getStep(tenantId, processId, stepId) };
  }

  function deleteStep(tenantId, processId, stepId) {
    const before = getStep(tenantId, processId, stepId);
    if (!before) throw fail('Etapa não encontrada.', 'NOT_FOUND', 404);
    run('DELETE FROM process_steps WHERE tenant_id=? AND process_id=? AND id=?', tenantId, processId, stepId);
    return before;
  }

  function reorderSteps(tenantId, processId, orderedIds) {
    const proc = processRow(tenantId, processId);
    if (!proc) throw fail('Processo não encontrado.', 'NOT_FOUND', 404);
    const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
    const existing = stepRows(processId);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length) {
      throw fail('Lista de etapas incompleta para reordenar.', 'INVALID_ORDER', 400);
    }
    for (const sid of ids) {
      if (!existing.some(s => s.id === sid)) throw fail('Etapa inválida na ordenação.', 'INVALID_ORDER', 400);
    }
    db.transaction(() => {
      ids.forEach((sid, idx) => {
        run('UPDATE process_steps SET step_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND process_id=?', idx + 1, sid, processId);
      });
    })();
    return stepRows(processId);
  }

  function occurrenceRow(tenantId, occurrenceId) {
    return one(
      `SELECT o.*, p.name process_name, p.status process_status, c.name company_name, c.trade_name company_trade_name, u.name responsible_name
       FROM process_occurrences o
       JOIN processes p ON p.id=o.process_id
       JOIN companies c ON c.id=o.company_id
       LEFT JOIN users u ON u.id=o.responsible_user_id
       WHERE o.tenant_id=? AND o.id=?`,
      tenantId, occurrenceId
    );
  }

  function occurrenceSteps(occurrenceId) {
    return rows(
      `SELECT s.*, u.name responsible_name, su.name started_by_name, cu.name completed_by_name
       FROM process_occurrence_steps s
       LEFT JOIN users u ON u.id=s.responsible_user_id
       LEFT JOIN users su ON su.id=s.started_by
       LEFT JOIN users cu ON cu.id=s.completed_by
       WHERE s.occurrence_id=?
       ORDER BY s.step_order ASC, s.created_at ASC`,
      occurrenceId
    );
  }

  function occurrenceProgress(stepList) {
    const required = stepList.filter(s => Number(s.required) === 1);
    const completedRequired = required.filter(s => s.status === 'CONCLUIDA').length;
    const completed = stepList.filter(s => s.status === 'CONCLUIDA').length;
    const next = stepList.find(s => s.status === 'EM_ANDAMENTO') ||
      stepList.find(s => s.status === 'PENDENTE') || null;
    return {
      total_steps: stepList.length,
      completed_steps: completed,
      required_steps: required.length,
      completed_required_steps: completedRequired,
      progress_percent: required.length ? Math.round((completedRequired / required.length) * 100) : 100,
      next_step: next
    };
  }

  function getOccurrence(tenantId, occurrenceId) {
    const o = occurrenceRow(tenantId, occurrenceId);
    if (!o) return null;
    const steps = occurrenceSteps(occurrenceId).map(s => ({
      ...s,
      deadline_status: classifyDueDate(s.due_date, s.status)
    }));
    const progress = occurrenceProgress(steps);
    if (o.status === 'CONCLUIDA' || o.status === 'CANCELADA') progress.next_step = null;
    const lastActivity = one(
      `SELECT event_type,created_at FROM domain_events
       WHERE tenant_id=? AND (
         (entity_type='process_occurrence' AND entity_id=?)
         OR entity_id IN (SELECT id FROM process_occurrence_steps WHERE occurrence_id=?)
       )
       ORDER BY created_at DESC LIMIT 1`,
      tenantId, occurrenceId, occurrenceId
    );
    return {
      ...o,
      steps,
      ...progress,
      last_activity_at: lastActivity ? lastActivity.created_at : o.updated_at,
      last_activity_type: lastActivity ? lastActivity.event_type : null
    };
  }

  function listOccurrences(tenantId, { companyId, processId, status, dueStatus, page, pageSize } = {}) {
    const p = [tenantId];
    let where = 'o.tenant_id=?';
    if (companyId) { where += ' AND o.company_id=?'; p.push(companyId); }
    if (processId) { where += ' AND o.process_id=?'; p.push(processId); }
    if (status && OCCURRENCE_STATUSES.has(status)) { where += ' AND o.status=?'; p.push(status); }
    const total = one(`SELECT COUNT(*) n FROM process_occurrences o WHERE ${where}`, ...p).n;
    const offset = (page - 1) * pageSize;
    let items = rows(
      `SELECT o.*, p.name process_name, c.name company_name, c.trade_name company_trade_name, u.name responsible_name,
              (SELECT COUNT(*) FROM process_occurrence_steps s WHERE s.occurrence_id=o.id) step_count,
              (SELECT COUNT(*) FROM process_occurrence_steps s WHERE s.occurrence_id=o.id AND s.status='CONCLUIDA') completed_steps,
              (SELECT COUNT(*) FROM process_occurrence_steps s WHERE s.occurrence_id=o.id AND s.required=1) required_steps,
              (SELECT COUNT(*) FROM process_occurrence_steps s WHERE s.occurrence_id=o.id AND s.required=1 AND s.status='CONCLUIDA') completed_required_steps
       FROM process_occurrences o
       JOIN processes p ON p.id=o.process_id
       JOIN companies c ON c.id=o.company_id
       LEFT JOIN users u ON u.id=o.responsible_user_id
       WHERE ${where}
       ORDER BY o.competence DESC, o.created_at DESC
       LIMIT ? OFFSET ?`,
      ...p, pageSize, offset
    );
    items = items.map(o => ({
      ...o,
      progress_percent: o.required_steps ? Math.round((o.completed_required_steps / o.required_steps) * 100) : 100,
      has_overdue: !!one(
        "SELECT 1 FROM process_occurrence_steps WHERE occurrence_id=? AND status NOT IN('CONCLUIDA','CANCELADA') AND due_date<date('now') LIMIT 1",
        o.id
      ),
      has_due_soon: !!one(
        "SELECT 1 FROM process_occurrence_steps WHERE occurrence_id=? AND status NOT IN('CONCLUIDA','CANCELADA') AND due_date BETWEEN date('now') AND date('now','+2 days') LIMIT 1",
        o.id
      )
    }));
    if (dueStatus === 'ATRASADA') items = items.filter(o => o.has_overdue);
    if (dueStatus === 'VENCENDO') items = items.filter(o => !o.has_overdue && o.has_due_soon);
    return { items, total: dueStatus ? items.length : total };
  }

  function createOccurrence(tenantId, userId, body) {
    const processId = String(body.process_id || '').trim();
    const proc = processRow(tenantId, processId);
    if (!proc) throw fail('Processo não encontrado.', 'NOT_FOUND', 404);
    if (proc.status !== 'ATIVO') throw fail('Processo inativo não pode gerar nova ocorrência.', 'PROCESS_INACTIVE', 409);
    const companyId = String(body.company_id || proc.company_id || '').trim();
    if (companyId !== proc.company_id) {
      throw fail('A empresa da ocorrência deve ser a mesma do processo.', 'COMPANY_MISMATCH', 400);
    }
    const company = companyInTenant(tenantId, companyId);
    if (!company) throw fail('Empresa não encontrada.', 'COMPANY_NOT_FOUND', 404);
    const competenceInfo = parseCompetence(body.competence);
    if (!competenceInfo) throw fail('Informe a competência no formato AAAA-MM ou MM/AAAA.', 'INVALID_COMPETENCE', 400);
    if (one('SELECT id FROM process_occurrences WHERE process_id=? AND competence=?', processId, competenceInfo.competence)) {
      throw fail('Já existe ocorrência para esta competência.', 'OCCURRENCE_EXISTS', 409);
    }
    const responsible = body.responsible_user_id !== undefined
      ? assertResponsible(tenantId, body.responsible_user_id)
      : proc.responsible_user_id;
    const title = String(body.title || '').trim() || occurrenceTitle(proc.name, competenceInfo);
    const templateSteps = stepRows(processId).filter(s => Number(s.active) === 1);
    const oid = id();
    db.transaction(() => {
      run(
        `INSERT INTO process_occurrences(id,process_id,tenant_id,company_id,competence,competence_year,competence_month,title,status,responsible_user_id,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        oid, processId, tenantId, companyId, competenceInfo.competence, competenceInfo.year, competenceInfo.month,
        title, 'PENDENTE', responsible, userId
      );
      let priorRequiredPending = false;
      templateSteps.forEach((s, idx) => {
        const initialStatus = priorRequiredPending ? 'BLOQUEADA' : 'PENDENTE';
        const dueDate = dueDateForCompetence(competenceInfo.year, competenceInfo.month, s.due_offset_days);
        run(
          `INSERT INTO process_occurrence_steps(id,occurrence_id,process_id,source_step_id,tenant_id,name,description,step_order,responsible_user_id,due_offset_days,due_date,required,status)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id(), oid, processId, s.id, tenantId, s.name, s.description, s.step_order || (idx + 1),
          s.responsible_user_id, s.due_offset_days, dueDate, s.required, initialStatus
        );
        if (Number(s.required) === 1) priorRequiredPending = true;
      });
    })();
    return getOccurrence(tenantId, oid);
  }

  function updateOccurrence(tenantId, occurrenceId, body) {
    const before = occurrenceRow(tenantId, occurrenceId);
    if (!before) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    let status = before.status;
    if (body.status !== undefined) {
      const s = String(body.status || '').toUpperCase().replace('CONCLUÍDA', 'CONCLUIDA');
      if (!OCCURRENCE_STATUSES.has(s)) throw fail('Situação inválida.', 'INVALID_STATUS', 400);
      status = s;
    }
    const responsible = body.responsible_user_id !== undefined
      ? assertResponsible(tenantId, body.responsible_user_id)
      : before.responsible_user_id;
    const title = body.title !== undefined ? (String(body.title || '').trim() || before.title) : before.title;
    let startedAt = before.started_at;
    let completedAt = before.completed_at;
    if (status === 'EM_ANDAMENTO' && !startedAt) startedAt = new Date().toISOString();
    if (status === 'CONCLUIDA') completedAt = new Date().toISOString();
    if (status === 'PENDENTE' || status === 'CANCELADA') {
      if (status === 'PENDENTE') { startedAt = null; completedAt = null; }
      if (status === 'CANCELADA') completedAt = completedAt || new Date().toISOString();
    }
    run(
      `UPDATE process_occurrences SET title=?, status=?, responsible_user_id=?, started_at=?, completed_at=?, updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND id=?`,
      title, status, responsible, startedAt, completedAt, tenantId, occurrenceId
    );
    return { before, after: getOccurrence(tenantId, occurrenceId) };
  }

  function occurrenceStep(tenantId, occurrenceId, stepId) {
    return one(
      `SELECT s.* FROM process_occurrence_steps s
       JOIN process_occurrences o ON o.id=s.occurrence_id
       WHERE s.tenant_id=? AND s.occurrence_id=? AND s.id=? AND o.tenant_id=?`,
      tenantId, occurrenceId, stepId, tenantId
    );
  }

  function refreshBlocking(occurrenceId) {
    const list = rows(
      'SELECT * FROM process_occurrence_steps WHERE occurrence_id=? ORDER BY step_order,created_at',
      occurrenceId
    );
    let priorRequiredIncomplete = false;
    for (const step of list) {
      if (step.status === 'PENDENTE' || step.status === 'BLOQUEADA') {
        const desired = priorRequiredIncomplete ? 'BLOQUEADA' : 'PENDENTE';
        if (desired !== step.status) {
          run(
            'UPDATE process_occurrence_steps SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
            desired, step.id
          );
          step.status = desired;
        }
      }
      if (Number(step.required) === 1 && step.status !== 'CONCLUIDA') priorRequiredIncomplete = true;
    }
  }

  function autoCompleteOccurrence(tenantId, occurrenceId, now) {
    const required = one(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN status='CONCLUIDA' THEN 1 ELSE 0 END) completed
       FROM process_occurrence_steps WHERE tenant_id=? AND occurrence_id=? AND required=1`,
      tenantId, occurrenceId
    );
    if (Number(required.total) > 0 && Number(required.completed || 0) === Number(required.total)) {
      run(
        `UPDATE process_occurrences
         SET status='CONCLUIDA',completed_at=?,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND id=? AND status<>'CANCELADA'`,
        now, tenantId, occurrenceId
      );
      return true;
    }
    return false;
  }

  function startOccurrence(tenantId, occurrenceId, userId) {
    const before = occurrenceRow(tenantId, occurrenceId);
    if (!before) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    if (before.status !== 'PENDENTE') {
      throw fail('Somente uma ocorrência pendente pode ser iniciada.', 'INVALID_OCCURRENCE_TRANSITION', 409);
    }
    const now = new Date().toISOString();
    run(
      `UPDATE process_occurrences
       SET status='EM_ANDAMENTO',started_at=COALESCE(started_at,?),updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND id=?`,
      now, tenantId, occurrenceId
    );
    return { before, after: getOccurrence(tenantId, occurrenceId), user_id: userId };
  }

  function startOccurrenceStep(tenantId, occurrenceId, stepId, userId) {
    const occurrence = occurrenceRow(tenantId, occurrenceId);
    if (!occurrence) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    if (!['PENDENTE', 'EM_ANDAMENTO'].includes(occurrence.status)) {
      throw fail('A ocorrência não permite iniciar etapas.', 'INVALID_OCCURRENCE_TRANSITION', 409);
    }
    const before = occurrenceStep(tenantId, occurrenceId, stepId);
    if (!before) throw fail('Etapa não encontrada.', 'NOT_FOUND', 404);
    if (before.status === 'BLOQUEADA') {
      throw fail('Conclua a etapa obrigatória anterior.', 'STEP_BLOCKED', 409);
    }
    if (before.status !== 'PENDENTE') {
      throw fail('Somente uma etapa pendente pode ser iniciada.', 'INVALID_STEP_TRANSITION', 409);
    }
    const prior = one(
      `SELECT id FROM process_occurrence_steps
       WHERE occurrence_id=? AND required=1 AND step_order<?
         AND status<>'CONCLUIDA' LIMIT 1`,
      occurrenceId, before.step_order
    );
    if (prior) throw fail('Conclua a etapa obrigatória anterior.', 'STEP_BLOCKED', 409);
    const now = new Date().toISOString();
    db.transaction(() => {
      run(
        `UPDATE process_occurrence_steps
         SET status='EM_ANDAMENTO',started_at=?,started_by=?,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND occurrence_id=? AND id=?`,
        now, userId, tenantId, occurrenceId, stepId
      );
      run(
        `UPDATE process_occurrences
         SET status='EM_ANDAMENTO',started_at=COALESCE(started_at,?),updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND id=? AND status='PENDENTE'`,
        now, tenantId, occurrenceId
      );
    })();
    return { before, after: getOccurrence(tenantId, occurrenceId) };
  }

  function completeOccurrenceStep(tenantId, occurrenceId, stepId, userId) {
    const occurrence = occurrenceRow(tenantId, occurrenceId);
    if (!occurrence) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    if (occurrence.status !== 'EM_ANDAMENTO') {
      throw fail('A ocorrência precisa estar em andamento.', 'INVALID_OCCURRENCE_TRANSITION', 409);
    }
    const before = occurrenceStep(tenantId, occurrenceId, stepId);
    if (!before) throw fail('Etapa não encontrada.', 'NOT_FOUND', 404);
    if (before.status !== 'EM_ANDAMENTO') {
      throw fail('Somente uma etapa em andamento pode ser concluída.', 'INVALID_STEP_TRANSITION', 409);
    }
    const now = new Date().toISOString();
    let occurrenceCompleted = false;
    db.transaction(() => {
      run(
        `UPDATE process_occurrence_steps
         SET status='CONCLUIDA',completed_at=?,completed_by=?,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND occurrence_id=? AND id=?`,
        now, userId, tenantId, occurrenceId, stepId
      );
      refreshBlocking(occurrenceId);
      occurrenceCompleted = autoCompleteOccurrence(tenantId, occurrenceId, now);
    })();
    return { before, after: getOccurrence(tenantId, occurrenceId), occurrence_completed: occurrenceCompleted };
  }

  function reopenOccurrence(tenantId, occurrenceId) {
    const before = occurrenceRow(tenantId, occurrenceId);
    if (!before) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    if (before.status !== 'CONCLUIDA') {
      throw fail('Somente uma ocorrência concluída pode ser reaberta.', 'INVALID_OCCURRENCE_TRANSITION', 409);
    }
    run(
      `UPDATE process_occurrences
       SET status='EM_ANDAMENTO',completed_at=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND id=?`,
      tenantId, occurrenceId
    );
    return { before, after: getOccurrence(tenantId, occurrenceId) };
  }

  function reopenOccurrenceStep(tenantId, occurrenceId, stepId, userId, targetStatus) {
    const occurrence = occurrenceRow(tenantId, occurrenceId);
    if (!occurrence) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    if (occurrence.status !== 'EM_ANDAMENTO') {
      throw fail('Reabra a ocorrência antes de reabrir uma etapa.', 'OCCURRENCE_REOPEN_REQUIRED', 409);
    }
    const before = occurrenceStep(tenantId, occurrenceId, stepId);
    if (!before) throw fail('Etapa não encontrada.', 'NOT_FOUND', 404);
    if (before.status !== 'CONCLUIDA') {
      throw fail('Somente uma etapa concluída pode ser reaberta.', 'INVALID_STEP_TRANSITION', 409);
    }
    const status = targetStatus === 'EM_ANDAMENTO' ? 'EM_ANDAMENTO' : 'PENDENTE';
    const now = new Date().toISOString();
    db.transaction(() => {
      run(
        `UPDATE process_occurrence_steps
         SET status=?,started_at=?,started_by=?,completed_at=NULL,completed_by=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND occurrence_id=? AND id=?`,
        status,
        status === 'EM_ANDAMENTO' ? now : null,
        status === 'EM_ANDAMENTO' ? userId : null,
        tenantId, occurrenceId, stepId
      );
      refreshBlocking(occurrenceId);
    })();
    return { before, after: getOccurrence(tenantId, occurrenceId) };
  }

  function updateOccurrenceStep(tenantId, occurrenceId, stepId, body) {
    const occurrence = occurrenceRow(tenantId, occurrenceId);
    if (!occurrence) throw fail('Ocorrência não encontrada.', 'NOT_FOUND', 404);
    const before = occurrenceStep(tenantId, occurrenceId, stepId);
    if (!before) throw fail('Etapa não encontrada.', 'NOT_FOUND', 404);
    const observation = body.observation === undefined
      ? before.observation
      : (String(body.observation || '').trim().slice(0, 4000) || null);
    run(
      `UPDATE process_occurrence_steps SET observation=?,updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND occurrence_id=? AND id=?`,
      observation, tenantId, occurrenceId, stepId
    );
    return { before, after: getOccurrence(tenantId, occurrenceId) };
  }

  function processDashboard(tenantId, companyId, companyIds) {
    const p = [tenantId];
    let where = 'tenant_id=?';
    if (companyId) { where += ' AND company_id=?'; p.push(companyId); }
    if (!companyId && Array.isArray(companyIds)) {
      if (!companyIds.length) return { pendentes: 0, em_andamento: 0, vencendo: 0, atrasadas: 0, concluidas: 0 };
      where += ` AND company_id IN (${companyIds.map(() => '?').join(',')})`;
      p.push(...companyIds);
    }
    const statusCount = status => one(
      `SELECT COUNT(*) n FROM process_occurrences WHERE ${where} AND status=?`,
      ...p, status
    ).n;
    const stepScope = ` AND occurrence_id IN (SELECT id FROM process_occurrences WHERE ${where})`;
    const overdue = one(
      `SELECT COUNT(*) n FROM process_occurrence_steps
       WHERE status NOT IN('CONCLUIDA','CANCELADA') AND due_date<date('now')${stepScope}`,
      ...p
    ).n;
    const dueSoon = one(
      `SELECT COUNT(*) n FROM process_occurrence_steps
       WHERE status NOT IN('CONCLUIDA','CANCELADA')
         AND due_date BETWEEN date('now') AND date('now','+2 days')${stepScope}`,
      ...p
    ).n;
    return {
      pendentes: statusCount('PENDENTE'),
      em_andamento: statusCount('EM_ANDAMENTO'),
      vencendo: dueSoon,
      atrasadas: overdue,
      concluidas: statusCount('CONCLUIDA')
    };
  }

  function purgeCompany(tenantId, companyId) {
    run('DELETE FROM process_occurrence_steps WHERE tenant_id=? AND occurrence_id IN (SELECT id FROM process_occurrences WHERE tenant_id=? AND company_id=?)', tenantId, tenantId, companyId);
    run('DELETE FROM process_occurrences WHERE tenant_id=? AND company_id=?', tenantId, companyId);
    run('DELETE FROM process_steps WHERE tenant_id=? AND process_id IN (SELECT id FROM processes WHERE tenant_id=? AND company_id=?)', tenantId, tenantId, companyId);
    run('DELETE FROM processes WHERE tenant_id=? AND company_id=?', tenantId, companyId);
  }

  return {
    listProcesses,
    getProcess,
    createProcess,
    updateProcess,
    setProcessStatus,
    createStep,
    updateStep,
    deleteStep,
    reorderSteps,
    listOccurrences,
    getOccurrence,
    createOccurrence,
    updateOccurrence,
    startOccurrence,
    startOccurrenceStep,
    completeOccurrenceStep,
    reopenOccurrence,
    reopenOccurrenceStep,
    updateOccurrenceStep,
    processDashboard,
    purgeCompany,
    parseCompetence,
    PROCESS_STATUSES,
    OCCURRENCE_STATUSES,
    STEP_RUN_STATUSES
  };
}

module.exports = { createProcessService, dueDateForCompetence, classifyDueDate };
