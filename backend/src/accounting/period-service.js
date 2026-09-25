'use strict';

const { parseCompetence } = require('../processes/competence');
const {
  PERIOD_STATUSES,
  PERIOD_AUDIT_ACTIONS,
  isValidStatus,
  isClosed,
  assertTransition,
  labelOf
} = require('./period-statuses');

function fail(message, code, http, extra) {
  const e = Object.assign(new Error(message), { code: code || 'ERROR', http: http || 400 }, extra || {});
  return e;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function boundsForCompetence(competenceInfo) {
  const y = competenceInfo.year;
  const m = competenceInfo.month;
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
  return { period_start: start, period_end: end };
}

function competenceFromDate(occurredOn) {
  const m = String(occurredOn || '').match(/^(\d{4})-(\d{2})-\d{2}/);
  if (!m) return null;
  return parseCompetence(`${m[1]}-${m[2]}`);
}

function formatCompetenceBr(competence) {
  const info = parseCompetence(competence);
  if (!info) return String(competence || '');
  return `${String(info.month).padStart(2, '0')}/${info.year}`;
}

function closedMessage(competence) {
  return `A competência ${formatCompetenceBr(competence)} está fechada. Reabra a competência para realizar alterações.`;
}

function createAccountingPeriodService({ db, id, audit, mappings }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function companyInTenant(tenantId, companyId) {
    return one(
      'SELECT id, name, trade_name, status FROM companies WHERE tenant_id=? AND id=?',
      tenantId, companyId
    );
  }

  function getById(tenantId, periodId) {
    return one(
      `SELECT p.*, c.name company_name, c.trade_name company_trade_name,
              cu.name closed_by_name, ru.name reopened_by_name
       FROM accounting_periods p
       JOIN companies c ON c.id=p.company_id
       LEFT JOIN users cu ON cu.id=p.closed_by
       LEFT JOIN users ru ON ru.id=p.reopened_by
       WHERE p.tenant_id=? AND p.id=?`,
      tenantId, periodId
    );
  }

  function getByCompetence(tenantId, companyId, competence) {
    return one(
      `SELECT p.*, c.name company_name, c.trade_name company_trade_name
       FROM accounting_periods p
       JOIN companies c ON c.id=p.company_id
       WHERE p.tenant_id=? AND p.company_id=? AND p.competence=?`,
      tenantId, companyId, competence
    );
  }

  function list(tenantId, { companyId, status, page = 1, pageSize = 50 } = {}) {
    const p = [tenantId];
    let where = 'p.tenant_id=?';
    if (companyId) {
      where += ' AND p.company_id=?';
      p.push(companyId);
    }
    if (status && isValidStatus(status)) {
      where += ' AND p.status=?';
      p.push(status);
    }
    const total = one(`SELECT COUNT(*) n FROM accounting_periods p WHERE ${where}`, ...p).n;
    const offset = Math.max(0, (Number(page) || 1) - 1) * (Number(pageSize) || 50);
    const items = rows(
      `SELECT p.*, c.name company_name, c.trade_name company_trade_name
       FROM accounting_periods p
       JOIN companies c ON c.id=p.company_id
       WHERE ${where}
       ORDER BY p.competence DESC, p.created_at DESC
       LIMIT ? OFFSET ?`,
      ...p, Number(pageSize) || 50, offset
    );
    return { items, total, page: Number(page) || 1, page_size: Number(pageSize) || 50 };
  }

  function create(tenantId, userId, { company_id, competence }, { req, conflictMode = 'return_existing' } = {}) {
    const company = companyInTenant(tenantId, company_id);
    if (!company) throw fail('Empresa não encontrada.', 'COMPANY_NOT_FOUND', 404);
    if (company.status !== 'ACTIVE') {
      throw fail('Esta empresa está bloqueada ou indisponível.', 'COMPANY_UNAVAILABLE', 409);
    }
    const info = parseCompetence(competence);
    if (!info) throw fail('Competência inválida. Use o formato YYYY-MM.', 'INVALID_COMPETENCE', 400);
    const existing = getByCompetence(tenantId, company_id, info.competence);
    if (existing) {
      if (conflictMode === 'error') {
        throw fail('Já existe competência para esta empresa e período.', 'COMPETENCE_EXISTS', 409);
      }
      return Object.assign(existing, { _created: false });
    }
    const bounds = boundsForCompetence(info);
    const periodId = id();
    run(
      `INSERT INTO accounting_periods(
         id, tenant_id, company_id, period_start, period_end, competence, status, created_at, updated_at
       ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      periodId, tenantId, company_id, bounds.period_start, bounds.period_end,
      info.competence, PERIOD_STATUSES.OPEN, new Date().toISOString()
    );
    const created = getById(tenantId, periodId);
    if (typeof audit === 'function' && req) {
      audit(req, PERIOD_AUDIT_ACTIONS.CREATED, 'ACCOUNTING_PERIOD', periodId, null, {
        company_id, competence: info.competence, status: PERIOD_STATUSES.OPEN
      });
    }
    return Object.assign(created, { _created: true });
  }

  function ensure(tenantId, companyId, competence, opts) {
    return create(tenantId, opts && opts.userId || null, { company_id: companyId, competence }, {
      req: opts && opts.req,
      conflictMode: 'return_existing'
    });
  }

  function resolveAccountingPeriod(tenantId, companyId, occurredOn, { createIfMissing = false, userId, req } = {}) {
    const info = competenceFromDate(occurredOn);
    if (!info) return null;
    let period = getByCompetence(tenantId, companyId, info.competence);
    if (!period && createIfMissing) {
      period = ensure(tenantId, companyId, info.competence, { userId, req });
    }
    return period;
  }

  function findClosedForDate(tenantId, companyId, occurredOn) {
    const info = competenceFromDate(occurredOn);
    if (!info) return null;
    const period = getByCompetence(tenantId, companyId, info.competence);
    if (period && isClosed(period.status)) return period;
    return null;
  }

  function assertWritable(tenantId, companyId, occurredOn) {
    const closed = findClosedForDate(tenantId, companyId, occurredOn);
    if (closed) {
      throw fail(closedMessage(closed.competence), 'ACCOUNTING_PERIOD_CLOSED', 409, {
        competence: closed.competence,
        period_id: closed.id
      });
    }
  }

  function isPeriodBlocked(tenantId, companyId, occurredOn) {
    return !!findClosedForDate(tenantId, companyId, occurredOn);
  }

  function setStatus(tenantId, periodId, nextStatus, { userId, req, reason } = {}) {
    if (!isValidStatus(nextStatus)) {
      throw fail('Status de competência inválido.', 'INVALID_PERIOD_STATUS', 400);
    }
    const period = getById(tenantId, periodId);
    if (!period) throw fail('Competência não encontrada.', 'PERIOD_NOT_FOUND', 404);
    assertTransition(period.status, nextStatus);

    const before = { status: period.status, export_id: period.export_id };
    const now = new Date().toISOString();
    let auditAction = null;

    if (nextStatus === PERIOD_STATUSES.IN_REVIEW && period.status === PERIOD_STATUSES.OPEN) {
      auditAction = PERIOD_AUDIT_ACTIONS.REVIEW_STARTED;
      run(
        `UPDATE accounting_periods SET status=?, updated_at=? WHERE id=? AND tenant_id=?`,
        nextStatus, now, periodId, tenantId
      );
    } else if (nextStatus === PERIOD_STATUSES.IN_REVIEW && period.status === PERIOD_STATUSES.CLOSED) {
      // reopen handled by reopen()
      throw fail('Use a reabertura controlada para competências fechadas.', 'USE_REOPEN', 400);
    } else if (nextStatus === PERIOD_STATUSES.READY_FOR_EXPORT) {
      auditAction = PERIOD_AUDIT_ACTIONS.READY_FOR_EXPORT;
      run(
        `UPDATE accounting_periods SET status=?, updated_at=? WHERE id=? AND tenant_id=?`,
        nextStatus, now, periodId, tenantId
      );
    } else if (nextStatus === PERIOD_STATUSES.EXPORTED) {
      auditAction = PERIOD_AUDIT_ACTIONS.EXPORTED;
      run(
        `UPDATE accounting_periods SET status=?, updated_at=? WHERE id=? AND tenant_id=?`,
        nextStatus, now, periodId, tenantId
      );
    } else if (nextStatus === PERIOD_STATUSES.CLOSED) {
      return close(tenantId, periodId, { userId, req });
    } else {
      run(
        `UPDATE accounting_periods SET status=?, updated_at=? WHERE id=? AND tenant_id=?`,
        nextStatus, now, periodId, tenantId
      );
    }

    const after = getById(tenantId, periodId);
    if (typeof audit === 'function' && req && auditAction) {
      audit(req, auditAction, 'ACCOUNTING_PERIOD', periodId, before, {
        status: after.status,
        competence: after.competence,
        company_id: after.company_id,
        reason: reason || null
      });
    }
    return after;
  }

  function entriesInPeriod(tenantId, companyId, periodStart, periodEnd) {
    return rows(
      `SELECT e.* FROM entries e
       WHERE e.tenant_id=? AND e.company_id=?
         AND date(e.occurred_on)>=date(?) AND date(e.occurred_on)<=date(?)
       ORDER BY e.occurred_on, e.id`,
      tenantId, companyId, periodStart, periodEnd
    );
  }

  function entryLines(entryId) {
    return rows(
      `SELECT l.id, l.side, l.amount_cents, l.account_id, a.account_code, a.description AS account_description,
              a.account_type, a.is_postable, a.active
       FROM entry_lines l
       JOIN accounts a ON a.id=l.account_id
       WHERE l.entry_id=?
       ORDER BY l.side, l.id`,
      entryId
    );
  }

  function validateForClosing(tenantId, periodId, { requireExport = true, systemKey = 'dominio' } = {}) {
    const period = getById(tenantId, periodId);
    if (!period) throw fail('Competência não encontrada.', 'PERIOD_NOT_FOUND', 404);

    const issues = [];
    const { period_start: start, period_end: end, company_id: companyId } = period;

    // Documents
    const docsPending = one(
      `SELECT COUNT(*) n FROM documents
       WHERE tenant_id=? AND company_id=? AND deleted_at IS NULL
         AND status IN('PENDING_REVIEW','PENDING')
         AND date(created_at)>=date(?) AND date(created_at)<=date(?)`,
      tenantId, companyId, start, end
    ).n;
    if (docsPending > 0) {
      issues.push({
        code: 'DOCUMENTS_PENDING',
        severity: 'blocking',
        count: docsPending,
        message: `${docsPending} documento(s) pendente(s) na competência.`,
        navigate: { page: 'documentos' }
      });
    }

    let docsProcessing = 0;
    let docsCritical = 0;
    try {
      docsProcessing = one(
        `SELECT COUNT(*) n FROM document_extractions
         WHERE tenant_id=? AND company_id=?
           AND status IN('PENDING','PROCESSING')
           AND date(created_at)>=date(?) AND date(created_at)<=date(?)`,
        tenantId, companyId, start, end
      ).n;
      docsCritical = one(
        `SELECT COUNT(*) n FROM document_extractions
         WHERE tenant_id=? AND company_id=?
           AND status='FAILED'
           AND date(created_at)>=date(?) AND date(created_at)<=date(?)`,
        tenantId, companyId, start, end
      ).n;
    } catch {
      // schema may not have document_extractions in older DBs; ignore
    }
    if (docsProcessing > 0) {
      issues.push({
        code: 'DOCUMENTS_PROCESSING',
        severity: 'blocking',
        count: docsProcessing,
        message: `${docsProcessing} documento(s) em processamento.`,
        navigate: { page: 'documentos' }
      });
    }
    if (docsCritical > 0) {
      issues.push({
        code: 'DOCUMENTS_CRITICAL_ERROR',
        severity: 'blocking',
        count: docsCritical,
        message: `${docsCritical} documento(s) com erro crítico.`,
        navigate: { page: 'documentos' }
      });
    }

    const entries = entriesInPeriod(tenantId, companyId, start, end);
    const needsClass = entries.filter(e => e.status === 'NEEDS_CLASSIFICATION');
    if (needsClass.length) {
      issues.push({
        code: 'NEEDS_CLASSIFICATION',
        severity: 'blocking',
        count: needsClass.length,
        message: `${needsClass.length} lançamento(s) aguardando classificação.`,
        navigate: { page: 'classificacao' }
      });
    }

    const pending = entries.filter(e => e.status === 'PENDING');
    if (pending.length) {
      issues.push({
        code: 'ENTRIES_PENDING_APPROVAL',
        severity: 'blocking',
        count: pending.length,
        message: `${pending.length} lançamento(s) pendente(s) de aprovação.`,
        navigate: { page: 'aprovacao' }
      });
    }

    const openPendencies = one(
      `SELECT COUNT(*) n FROM pendencies p
       WHERE p.tenant_id=? AND p.company_id=? AND p.status='OPEN'
         AND (
           EXISTS(
             SELECT 1 FROM entries e
             WHERE e.tenant_id=p.tenant_id AND e.company_id=p.company_id
               AND (e.id=p.entity_id OR e.source_id=p.entity_id)
               AND date(e.occurred_on)>=date(?) AND date(e.occurred_on)<=date(?)
           )
           OR date(p.created_at)>=date(?) AND date(p.created_at)<=date(?)
         )`,
      tenantId, companyId, start, end, start, end
    ).n;
    if (openPendencies > 0) {
      issues.push({
        code: 'OPEN_PENDENCIES',
        severity: 'blocking',
        count: openPendencies,
        message: `${openPendencies} pendência(s) contábil(is) em aberto.`,
        navigate: { page: 'pendencias' }
      });
    }

    let debitTotal = 0;
    let creditTotal = 0;
    let unbalancedCount = 0;
    const invalidEntries = [];
    const accountIds = new Set();

    for (const e of entries) {
      const lines = entryLines(e.id);
      const debits = lines.filter(l => l.side === 'D');
      const credits = lines.filter(l => l.side === 'C');
      const sumD = debits.reduce((a, l) => a + Number(l.amount_cents || 0), 0);
      const sumC = credits.reduce((a, l) => a + Number(l.amount_cents || 0), 0);
      debitTotal += sumD;
      creditTotal += sumC;
      for (const l of lines) accountIds.add(l.account_id);

      if (!lines.length) {
        invalidEntries.push({ id: e.id, code: 'NO_LINES', message: 'Lançamento sem linhas.' });
        continue;
      }
      if (!debits.length || !credits.length) {
        invalidEntries.push({ id: e.id, code: 'MISSING_SIDES', message: 'Lançamento sem débito ou crédito.' });
        continue;
      }
      if (sumD !== sumC) {
        unbalancedCount += 1;
        invalidEntries.push({ id: e.id, code: 'UNBALANCED_ENTRY', message: 'Lançamento desbalanceado.', debit: sumD, credit: sumC });
      }
    }

    if (unbalancedCount > 0) {
      issues.push({
        code: 'UNBALANCED_ENTRY',
        severity: 'blocking',
        count: unbalancedCount,
        message: `${unbalancedCount} lançamento(s) desbalanceado(s).`,
        navigate: { page: 'lancamentos' }
      });
    }
    if (invalidEntries.length && invalidEntries.some(x => x.code !== 'UNBALANCED_ENTRY')) {
      const n = invalidEntries.filter(x => x.code !== 'UNBALANCED_ENTRY').length;
      issues.push({
        code: 'INVALID_ENTRIES',
        severity: 'blocking',
        count: n,
        message: `${n} lançamento(s) inválido(s).`,
        navigate: { page: 'lancamentos' }
      });
    }

    let unmappedAccounts = [];
    if (mappings && typeof mappings.getMap === 'function') {
      const map = mappings.getMap(tenantId, companyId, systemKey);
      const posted = entries.filter(e => e.status === 'POSTED');
      const unmappedMap = new Map();
      for (const e of posted) {
        for (const l of entryLines(e.id)) {
          if (!map.get(l.account_id)) {
            const prev = unmappedMap.get(l.account_id) || {
              account_id: l.account_id,
              account_code: l.account_code,
              description: l.account_description,
              entry_count: 0
            };
            prev.entry_count += 1;
            unmappedMap.set(l.account_id, prev);
          }
        }
      }
      unmappedAccounts = [...unmappedMap.values()];
      if (unmappedAccounts.length) {
        issues.push({
          code: 'UNMAPPED_ACCOUNTS',
          severity: 'blocking',
          count: unmappedAccounts.length,
          message: `${unmappedAccounts.length} conta(s) sem código Domínio (external_code).`,
          accounts: unmappedAccounts,
          navigate: { page: 'integracoes', tab: 'mapeamentos' }
        });
      }
    }

    if (requireExport && !period.export_id && period.status !== PERIOD_STATUSES.EXPORTED) {
      // Allow close after export was recorded as EXPORTED even if export_id somehow missing only if status EXPORTED
      const exportsInPeriod = one(
        `SELECT COUNT(*) n FROM exports
         WHERE tenant_id=? AND company_id=?
           AND period_start=? AND period_end=?`,
        tenantId, companyId, start, end
      ).n;
      if (!exportsInPeriod && period.status !== PERIOD_STATUSES.EXPORTED) {
        issues.push({
          code: 'EXPORT_REQUIRED',
          severity: 'blocking',
          count: 1,
          message: 'É necessário gerar a exportação Domínio antes do fechamento.',
          navigate: { page: 'exportacoes' }
        });
      }
    }

    const blocking = issues.filter(i => i.severity === 'blocking');
    return {
      ok: blocking.length === 0,
      period,
      issues,
      blocking_count: blocking.length,
      stats: {
        document_pending_count: docsPending,
        document_processing_count: docsProcessing,
        document_critical_count: docsCritical,
        entry_count: entries.length,
        entry_pending_count: pending.length,
        entry_needs_classification_count: needsClass.length,
        entry_posted_count: entries.filter(e => e.status === 'POSTED').length,
        entry_rejected_count: entries.filter(e => e.status === 'REJECTED').length,
        debit_total_cents: debitTotal,
        credit_total_cents: creditTotal,
        unbalanced_entry_count: unbalancedCount,
        unmapped_account_count: unmappedAccounts.length,
        open_pendency_count: openPendencies,
        invalid_entry_count: invalidEntries.length
      },
      invalid_entries: invalidEntries,
      unmapped_accounts: unmappedAccounts
    };
  }

  function buildSummary(tenantId, periodId) {
    const validation = validateForClosing(tenantId, periodId, { requireExport: false });
    const period = validation.period;
    const s = validation.stats;

    const documentCount = one(
      `SELECT COUNT(*) n FROM documents
       WHERE tenant_id=? AND company_id=? AND deleted_at IS NULL
         AND date(created_at)>=date(?) AND date(created_at)<=date(?)`,
      tenantId, period.company_id, period.period_start, period.period_end
    ).n;

    let exportRow = null;
    if (period.export_id) {
      exportRow = one('SELECT * FROM exports WHERE tenant_id=? AND id=?', tenantId, period.export_id);
    }
    const priorExports = rows(
      `SELECT id, system_key, status, checksum, created_at, period_start, period_end, created_by,
              (SELECT COUNT(*) FROM export_items WHERE export_id=exports.id) entry_count
       FROM exports
       WHERE tenant_id=? AND company_id=?
         AND period_start=? AND period_end=?
       ORDER BY created_at DESC`,
      tenantId, period.company_id, period.period_start, period.period_end
    );

    const balanced = s.debit_total_cents === s.credit_total_cents && s.unbalanced_entry_count === 0;
    const checklist = {
      documents_ok: s.document_pending_count === 0 && s.document_processing_count === 0 && s.document_critical_count === 0,
      entries_approved: s.entry_pending_count === 0 && s.entry_needs_classification_count === 0,
      balanced,
      accounts_mapped: s.unmapped_account_count === 0,
      pendencies_resolved: s.open_pendency_count === 0,
      export_ready: !!period.export_id || period.status === PERIOD_STATUSES.EXPORTED || priorExports.length > 0
    };

    const canExport = period.status !== PERIOD_STATUSES.CLOSED
      && checklist.entries_approved
      && checklist.balanced
      && checklist.accounts_mapped
      && s.entry_posted_count > 0;

    const canClose = period.status === PERIOD_STATUSES.EXPORTED
      && validation.ok
      && checklist.export_ready;

    return {
      id: period.id,
      company_id: period.company_id,
      company_name: period.company_trade_name || period.company_name,
      competence: period.competence,
      competence_label: formatCompetenceBr(period.competence),
      status: period.status,
      status_label: labelOf(period.status),
      period_start: period.period_start,
      period_end: period.period_end,
      document_count: documentCount,
      document_pending_count: s.document_pending_count,
      entry_count: s.entry_count,
      entry_pending_count: s.entry_pending_count + s.entry_needs_classification_count,
      entry_posted_count: s.entry_posted_count,
      entry_rejected_count: s.entry_rejected_count,
      debit_total: s.debit_total_cents,
      credit_total: s.credit_total_cents,
      debit_total_cents: s.debit_total_cents,
      credit_total_cents: s.credit_total_cents,
      balanced,
      unmapped_account_count: s.unmapped_account_count,
      unbalanced_entry_count: s.unbalanced_entry_count,
      open_pendency_count: s.open_pendency_count,
      export_id: period.export_id,
      export_status: exportRow ? exportRow.status : (priorExports.length ? 'PRIOR_EXPORT' : null),
      export_hint: !period.export_id && priorExports.length
        ? 'Exportação anterior registrada.'
        : null,
      can_export: canExport,
      can_close: canClose,
      checklist,
      issues: validation.issues,
      validation_ok: validation.ok
    };
  }

  function close(tenantId, periodId, { userId, req } = {}) {
    const period = getById(tenantId, periodId);
    if (!period) throw fail('Competência não encontrada.', 'PERIOD_NOT_FOUND', 404);
    if (isClosed(period.status)) {
      throw fail('Competência já está fechada.', 'ALREADY_CLOSED', 409);
    }

    // Fechamento definitivo exige EXPORTED (ou READY com export_id já vinculado).
    if (period.status === PERIOD_STATUSES.READY_FOR_EXPORT && period.export_id) {
      run(
        `UPDATE accounting_periods SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
        PERIOD_STATUSES.EXPORTED, periodId, tenantId
      );
    } else if (period.status !== PERIOD_STATUSES.EXPORTED) {
      throw fail(
        'A competência precisa estar exportada antes do fechamento definitivo.',
        'EXPORT_REQUIRED',
        409
      );
    }

    const validation = validateForClosing(tenantId, periodId, { requireExport: true });
    if (!validation.ok) {
      throw fail('A competência não pode ser fechada. Resolva as pendências impeditivas.', 'CLOSE_BLOCKED', 409, {
        issues: validation.issues,
        details: validation.issues
      });
    }

    const before = { status: getById(tenantId, periodId).status };
    const now = new Date().toISOString();
    run(
      `UPDATE accounting_periods
       SET status=?, closed_at=?, closed_by=?, updated_at=?
       WHERE id=? AND tenant_id=?`,
      PERIOD_STATUSES.CLOSED, now, userId || null, now, periodId, tenantId
    );
    const after = getById(tenantId, periodId);
    if (typeof audit === 'function' && req) {
      audit(req, PERIOD_AUDIT_ACTIONS.CLOSED, 'ACCOUNTING_PERIOD', periodId, before, {
        status: PERIOD_STATUSES.CLOSED,
        competence: after.competence,
        company_id: after.company_id,
        closed_at: after.closed_at,
        closed_by: after.closed_by
      });
    }
    return after;
  }

  function reopen(tenantId, periodId, { userId, reason, req } = {}) {
    const period = getById(tenantId, periodId);
    if (!period) throw fail('Competência não encontrada.', 'PERIOD_NOT_FOUND', 404);
    if (!isClosed(period.status)) {
      throw fail('Somente competências fechadas podem ser reabertas.', 'NOT_CLOSED', 409);
    }
    const why = String(reason || '').trim();
    if (why.length < 5) {
      throw fail('Informe o motivo da reabertura.', 'REASON_REQUIRED', 400);
    }
    const before = {
      status: period.status,
      closed_at: period.closed_at,
      closed_by: period.closed_by
    };
    const now = new Date().toISOString();
    // Preserve previous closed_at/closed_by history fields — do not null them.
    run(
      `UPDATE accounting_periods
       SET status=?, reopened_at=?, reopened_by=?, reopen_reason=?, updated_at=?
       WHERE id=? AND tenant_id=?`,
      PERIOD_STATUSES.IN_REVIEW, now, userId || null, why, now, periodId, tenantId
    );
    const after = getById(tenantId, periodId);
    if (typeof audit === 'function' && req) {
      audit(req, PERIOD_AUDIT_ACTIONS.REOPENED, 'ACCOUNTING_PERIOD', periodId, before, {
        status: PERIOD_STATUSES.IN_REVIEW,
        competence: after.competence,
        company_id: after.company_id,
        reopened_at: after.reopened_at,
        reopened_by: after.reopened_by,
        reopen_reason: why
      });
    }
    return after;
  }

  function markExported(tenantId, periodId, exportId, { userId, req, meta } = {}) {
    const period = getById(tenantId, periodId);
    if (!period) throw fail('Competência não encontrada.', 'PERIOD_NOT_FOUND', 404);
    if (isClosed(period.status)) {
      throw fail(closedMessage(period.competence), 'ACCOUNTING_PERIOD_CLOSED', 409, {
        competence: period.competence,
        period_id: period.id
      });
    }
    if (period.status !== PERIOD_STATUSES.EXPORTED) {
      assertTransition(period.status, PERIOD_STATUSES.EXPORTED);
    }
    const before = { status: period.status, export_id: period.export_id };
    const now = new Date().toISOString();
    run(
      `UPDATE accounting_periods
       SET status=?, export_id=?, updated_at=?
       WHERE id=? AND tenant_id=?`,
      PERIOD_STATUSES.EXPORTED, exportId, now, periodId, tenantId
    );
    const after = getById(tenantId, periodId);
    if (typeof audit === 'function' && req) {
      audit(req, PERIOD_AUDIT_ACTIONS.EXPORTED, 'ACCOUNTING_PERIOD', periodId, before, {
        status: PERIOD_STATUSES.EXPORTED,
        export_id: exportId,
        competence: after.competence,
        company_id: after.company_id,
        user_id: userId || null,
        ...(meta || {})
      });
    }
    return after;
  }

  function linkExportByPeriod(tenantId, companyId, periodStart, periodEnd, exportId, opts) {
    const startInfo = competenceFromDate(periodStart);
    const endInfo = competenceFromDate(periodEnd);
    if (!startInfo || !endInfo || startInfo.competence !== endInfo.competence) {
      // Period spanning multiple months: ensure/update only if exact competence month match on start
      if (!startInfo) return null;
    }
    const competence = startInfo.competence;
    const bounds = boundsForCompetence(startInfo);
    // Only auto-link when export window matches the full competence month
    if (periodStart === bounds.period_start && periodEnd === bounds.period_end) {
      const period = ensure(tenantId, companyId, competence, opts);
      return markExported(tenantId, period.id, exportId, opts);
    }
    // Partial window: still try to find matching competence and link if exists
    const period = getByCompetence(tenantId, companyId, competence);
    if (period && !isClosed(period.status)) {
      return markExported(tenantId, period.id, exportId, opts);
    }
    return period || null;
  }

  function history(tenantId, periodId) {
    const period = getById(tenantId, periodId);
    if (!period) throw fail('Competência não encontrada.', 'PERIOD_NOT_FOUND', 404);
    const audits = rows(
      `SELECT a.id, a.action, a.created_at, a.before_json, a.after_json, u.name user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id=a.user_id
       WHERE a.tenant_id=? AND a.entity_type='ACCOUNTING_PERIOD' AND a.entity_id=?
       ORDER BY a.created_at ASC`,
      tenantId, periodId
    );
    const exportsList = rows(
      `SELECT x.id, x.system_key, x.status, x.checksum, x.created_at, x.period_start, x.period_end,
              u.name created_by_name,
              (SELECT COUNT(*) FROM export_items WHERE export_id=x.id) entry_count
       FROM exports x
       LEFT JOIN users u ON u.id=x.created_by
       WHERE x.tenant_id=? AND x.company_id=?
         AND x.period_start=? AND x.period_end=?
       ORDER BY x.created_at ASC`,
      tenantId, period.company_id, period.period_start, period.period_end
    );

    const events = [];
    for (const a of audits) {
      let after = {};
      try { after = JSON.parse(a.after_json || '{}'); } catch { after = {}; }
      let label = a.action;
      if (a.action === PERIOD_AUDIT_ACTIONS.CLOSED) label = 'Competência fechada';
      else if (a.action === PERIOD_AUDIT_ACTIONS.REOPENED) label = 'Competência reaberta';
      else if (a.action === PERIOD_AUDIT_ACTIONS.EXPORTED) label = 'Exportação Domínio vinculada';
      else if (a.action === PERIOD_AUDIT_ACTIONS.CREATED) label = 'Competência criada';
      else if (a.action === PERIOD_AUDIT_ACTIONS.REVIEW_STARTED) label = 'Conferência iniciada';
      else if (a.action === PERIOD_AUDIT_ACTIONS.READY_FOR_EXPORT) label = 'Pronta para exportação';
      events.push({
        at: a.created_at,
        type: a.action,
        label,
        user_name: a.user_name || null,
        reason: after.reopen_reason || after.reason || null,
        meta: after
      });
    }
    for (const x of exportsList) {
      const already = events.some(e => e.meta && e.meta.export_id === x.id);
      if (!already) {
        events.push({
          at: x.created_at,
          type: 'EXPORT_CREATED',
          label: period.export_id === x.id
            ? `Exportação Domínio · ${x.entry_count} lançamentos`
            : `Exportação anterior registrada · ${x.entry_count} lançamentos`,
          user_name: x.created_by_name || null,
          reason: null,
          meta: { export_id: x.id, entry_count: x.entry_count, checksum: x.checksum }
        });
      }
    }
    events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { period, events, exports: exportsList };
  }

  return {
    create,
    ensure,
    getById,
    getByCompetence,
    list,
    setStatus,
    close,
    reopen,
    markExported,
    linkExportByPeriod,
    validateForClosing,
    buildSummary,
    history,
    resolveAccountingPeriod,
    assertWritable,
    isPeriodBlocked,
    findClosedForDate,
    formatCompetenceBr,
    closedMessage,
    competenceFromDate,
    boundsForCompetence
  };
}

module.exports = {
  createAccountingPeriodService,
  parseCompetence,
  competenceFromDate,
  formatCompetenceBr,
  closedMessage,
  boundsForCompetence
};
