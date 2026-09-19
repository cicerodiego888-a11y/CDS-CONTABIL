'use strict';

const { parseCompetence } = require('./competence');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function competenceOf(year, month) {
  return `${Number(year)}-${pad2(month)}`;
}

function nextCompetence(year, month) {
  const y = Number(year);
  const m = Number(month);
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

function generationDate(year, month, requestedDay) {
  const day = Math.min(Math.max(1, Number(requestedDay) || 1), lastDayOfMonth(year, month));
  return `${Number(year)}-${pad2(month)}-${pad2(day)}`;
}

function todayIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function createProcessRecurrenceService({ db, id, processService, publishEvent }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function fail(message, code, http) {
    const error = new Error(message);
    error.code = code || 'RECURRENCE_ERROR';
    error.http = http || 400;
    return error;
  }

  function recurrenceRow(tenantId, processId) {
    return one(
      `SELECT r.*,p.name process_name,p.status process_status,p.created_by process_created_by
       FROM process_recurrences r
       JOIN processes p ON p.id=r.process_id
       WHERE r.tenant_id=? AND r.process_id=?`,
      tenantId, processId
    );
  }

  function processRow(tenantId, processId) {
    return one(
      'SELECT * FROM processes WHERE tenant_id=? AND id=?',
      tenantId, processId
    );
  }

  function projection(row) {
    if (!row) return null;
    let next;
    if (row.last_generated_year && row.last_generated_month) {
      next = nextCompetence(row.last_generated_year, row.last_generated_month);
    } else {
      next = { year: row.start_year, month: row.start_month };
    }
    const last = row.last_generated_year && row.last_generated_month
      ? competenceOf(row.last_generated_year, row.last_generated_month)
      : null;
    return {
      ...row,
      active: Number(row.active) === 1,
      last_competence: last,
      next_competence: competenceOf(next.year, next.month),
      next_generation_date: generationDate(next.year, next.month, row.generation_day)
    };
  }

  function get(tenantId, processId) {
    return projection(recurrenceRow(tenantId, processId));
  }

  function configure(tenantId, processId, body, userId) {
    const process = processRow(tenantId, processId);
    if (!process) throw fail('Processo não encontrado.', 'NOT_FOUND', 404);
    const frequency = String(body.frequency || 'MENSAL').trim().toUpperCase();
    if (!['MENSAL', 'MONTHLY'].includes(frequency)) {
      throw fail('Nesta versão, somente a recorrência mensal é permitida.', 'INVALID_FREQUENCY', 400);
    }
    const generationDay = Number(body.generation_day);
    if (!Number.isInteger(generationDay) || generationDay < 1 || generationDay > 31) {
      throw fail('O dia de geração deve estar entre 1 e 31.', 'INVALID_GENERATION_DAY', 400);
    }
    const start = parseCompetence(body.start_competence ||
      (body.start_year && body.start_month ? competenceOf(body.start_year, body.start_month) : ''));
    if (!start) {
      throw fail('Informe a competência inicial no formato AAAA-MM.', 'INVALID_COMPETENCE', 400);
    }
    const active = body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
    const before = recurrenceRow(tenantId, processId);
    if (before) {
      run(
        `UPDATE process_recurrences
         SET frequency='MENSAL',generation_day=?,start_year=?,start_month=?,active=?,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND process_id=?`,
        generationDay, start.year, start.month, active, tenantId, processId
      );
    } else {
      run(
        `INSERT INTO process_recurrences(
           id,process_id,tenant_id,company_id,frequency,generation_day,start_year,start_month,active,created_by
         ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        id(), processId, tenantId, process.company_id, 'MENSAL', generationDay,
        start.year, start.month, active, userId || process.created_by || null
      );
    }
    return { before: projection(before), after: get(tenantId, processId), created: !before };
  }

  function setActive(tenantId, processId, active) {
    const before = recurrenceRow(tenantId, processId);
    if (!before) throw fail('Recorrência não configurada.', 'RECURRENCE_NOT_FOUND', 404);
    run(
      'UPDATE process_recurrences SET active=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND process_id=?',
      active ? 1 : 0, tenantId, processId
    );
    return { before: projection(before), after: get(tenantId, processId) };
  }

  function audit(tenantId, userId, action, entityType, entityId, payload) {
    run(
      `INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_json)
       VALUES(?,?,?,?,?,?,?)`,
      id(), tenantId, userId || null, action, entityType, entityId,
      payload ? JSON.stringify(payload) : null
    );
  }

  function existingOccurrence(row, year, month) {
    return one(
      `SELECT id FROM process_occurrences
       WHERE tenant_id=? AND process_id=? AND company_id=?
         AND competence_year=? AND competence_month=?`,
      row.tenant_id, row.process_id, row.company_id, year, month
    );
  }

  function markGenerated(row, year, month) {
    const currentKey = Number(row.last_generated_year || 0) * 100 + Number(row.last_generated_month || 0);
    const nextKey = Number(year) * 100 + Number(month);
    if (currentKey && nextKey < currentKey) return;
    run(
      `UPDATE process_recurrences
       SET last_generated_year=?,last_generated_month=?,updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND process_id=?`,
      year, month, row.tenant_id, row.process_id
    );
  }

  function generateCompetence(row, competence, options = {}) {
    if (!row) throw fail('Recorrência não configurada.', 'RECURRENCE_NOT_FOUND', 404);
    if (row.process_status !== 'ATIVO') {
      throw fail('Processo inativo não pode gerar ocorrência.', 'PROCESS_INACTIVE', 409);
    }
    if (!Number(row.active)) {
      throw fail('Recorrência inativa não pode gerar ocorrência.', 'RECURRENCE_INACTIVE', 409);
    }
    const parsed = typeof competence === 'string' ? parseCompetence(competence) : competence;
    if (!parsed) throw fail('Competência inválida.', 'INVALID_COMPETENCE', 400);
    const actor = options.userId || row.process_created_by || null;
    audit(row.tenant_id, actor, 'PROCESS_OCCURRENCE_GENERATION_REQUESTED', 'PROCESS_RECURRENCE', row.id, {
      process_id: row.process_id,
      company_id: row.company_id,
      competence: parsed.competence,
      source: options.source || 'MANUAL'
    });
    const existing = existingOccurrence(row, parsed.year, parsed.month);
    if (existing) {
      markGenerated(row, parsed.year, parsed.month);
      return {
        created: false,
        existing: true,
        occurrence: processService.getOccurrence(row.tenant_id, existing.id),
        message: `Ocorrência da competência ${pad2(parsed.month)}/${parsed.year} já existe.`
      };
    }
    let occurrence;
    try {
      occurrence = processService.createOccurrence(row.tenant_id, actor, {
        process_id: row.process_id,
        company_id: row.company_id,
        competence: parsed.competence
      });
    } catch (error) {
      if (error.code !== 'OCCURRENCE_EXISTS' && !/UNIQUE constraint/i.test(error.message || '')) throw error;
      const duplicate = existingOccurrence(row, parsed.year, parsed.month);
      if (!duplicate) throw error;
      markGenerated(row, parsed.year, parsed.month);
      return {
        created: false,
        existing: true,
        occurrence: processService.getOccurrence(row.tenant_id, duplicate.id),
        message: `Ocorrência da competência ${pad2(parsed.month)}/${parsed.year} já existe.`
      };
    }
    markGenerated(row, parsed.year, parsed.month);
    const source = options.source || 'AUTOMATIC';
    audit(row.tenant_id, actor,
      source === 'AUTOMATIC' ? 'PROCESS_OCCURRENCE_AUTO_CREATED' : 'PROCESS_OCCURRENCE_CREATED',
      'PROCESS_OCCURRENCE', occurrence.id, {
      recurrence_id: row.id,
      process_id: row.process_id,
      company_id: row.company_id,
      competence: parsed.competence,
      source
    });
    if (publishEvent) {
      publishEvent({
        tenantId: row.tenant_id,
        companyId: row.company_id,
        eventType: source === 'AUTOMATIC'
          ? 'PROCESS_OCCURRENCE_AUTO_CREATED'
          : 'PROCESS_OCCURRENCE_MANUALLY_CREATED',
        actorUserId: actor,
        entityType: 'process_occurrence',
        entityId: occurrence.id,
        payload: {
          process_id: row.process_id,
          occurrence_id: occurrence.id,
          responsible_user_id: occurrence.responsible_user_id,
          process_name: row.process_name,
          title: occurrence.title,
          source
        }
      });
    }
    return {
      created: true,
      existing: false,
      occurrence,
      message: `Ocorrência da competência ${pad2(parsed.month)}/${parsed.year} criada.`
    };
  }

  function generateNow(tenantId, processId, userId, requestedCompetence, now = new Date()) {
    const row = recurrenceRow(tenantId, processId);
    const view = projection(row);
    if (!view) throw fail('Recorrência não configurada.', 'RECURRENCE_NOT_FOUND', 404);
    let target = requestedCompetence ? parseCompetence(requestedCompetence) : null;
    if (requestedCompetence && !target) throw fail('Competência inválida.', 'INVALID_COMPETENCE', 400);
    if (!target) {
      const current = parseCompetence(todayIso(now).slice(0, 7));
      const start = parseCompetence(competenceOf(row.start_year, row.start_month));
      target = current.competence < start.competence ? start : current;
    }
    return generateCompetence(row, target, { userId, source: 'MANUAL' });
  }

  function isDue(row, now) {
    const view = projection(row);
    return view && view.next_generation_date <= todayIso(now);
  }

  function runDue(now = new Date()) {
    const dueDate = todayIso(now);
    if (!dueDate) throw fail('Data de execução inválida.', 'INVALID_DATE', 400);
    const recurring = rows(
      `SELECT r.*,p.name process_name,p.status process_status,p.created_by process_created_by
       FROM process_recurrences r
       JOIN processes p ON p.id=r.process_id
       WHERE r.active=1 AND r.frequency='MENSAL' AND p.status='ATIVO'
       ORDER BY r.tenant_id,r.process_id`
    );
    const result = { checked: recurring.length, created: 0, existing: 0, errors: [] };
    for (const initial of recurring) {
      let row = initial;
      for (let guard = 0; guard < 120 && isDue(row, now); guard += 1) {
        const view = projection(row);
        try {
          const generated = generateCompetence(row, view.next_competence, { source: 'AUTOMATIC' });
          if (generated.created) result.created += 1;
          else result.existing += 1;
        } catch (error) {
          result.errors.push({ process_id: row.process_id, code: error.code || 'ERROR', message: error.message });
          break;
        }
        row = recurrenceRow(row.tenant_id, row.process_id);
      }
    }
    return result;
  }

  return {
    get,
    configure,
    setActive,
    generateNow,
    generateCompetence,
    runDue,
    isDue
  };
}

module.exports = {
  createProcessRecurrenceService,
  competenceOf,
  nextCompetence,
  lastDayOfMonth,
  generationDate
};
