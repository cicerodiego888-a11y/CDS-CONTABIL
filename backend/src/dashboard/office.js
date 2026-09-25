'use strict';

const ACTIVITY_TYPES = {
  DOCUMENT_UPLOADED: 'documents',
  EXPENSE_CREATED: 'expenses',
  REVENUE_CREATED: 'revenues',
  REQUEST_CREATED: 'requests',
  REQUEST_MESSAGE_CREATED: 'requests',
  CLASSIFICATION_REQUIRED: 'classifications',
  CLASSIFICATION_COMPLETED: 'classifications'
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

function monthBounds(year, monthIndex) {
  const from = `${year}-${pad(monthIndex + 1)}-01`;
  const last = new Date(year, monthIndex + 1, 0);
  return { from, to: isoDay(last) };
}

function resolvePeriod(query, todayFn) {
  const raw = String(query.preset || query.period || '').toLowerCase();
  const now = new Date();
  const todayIso = isoDay(now);
  let preset = raw;
  let from = todayFn(query.from) ? query.from : null;
  let to = todayFn(query.to) ? query.to : null;
  if (raw === 'custom' && from && to) preset = 'custom';
  else if (raw === 'today' || raw === 'hoje') {
    preset = 'today'; from = todayIso; to = todayIso;
  } else if (raw === '7d' || raw === 'last_7' || raw === 'ultimos-7') {
    preset = '7d'; from = addDays(todayIso, -6); to = todayIso;
  } else if (raw === '30d' || raw === 'last_30' || raw === 'ultimos-30') {
    preset = '30d'; from = addDays(todayIso, -29); to = todayIso;
  } else if (raw === 'previous_month' || raw === 'mes-anterior') {
    preset = 'previous_month';
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const b = monthBounds(prev.getFullYear(), prev.getMonth());
    from = b.from; to = b.to;
  } else {
    preset = 'month';
    const b = monthBounds(now.getFullYear(), now.getMonth());
    from = (todayFn(query.from) ? query.from : b.from);
    to = (todayFn(query.to) ? query.to : b.to);
  }
  if (from && to && from > to) { const x = from; from = to; to = x; }
  return { preset, from, to };
}

function resolveActivityWindow(query, todayFn) {
  const raw = String(query.activity || query.activity_range || '7d').toLowerCase();
  const now = new Date();
  const todayIso = isoDay(now);
  if (raw === '24h' || raw === '24') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { range: '24h', from: isoDay(start), to: todayIso, grain: 'hour', since: start.toISOString() };
  }
  if (raw === '30d' || raw === '30') {
    return { range: '30d', from: addDays(todayIso, -29), to: todayIso, grain: 'day', since: addDays(todayIso, -29) };
  }
  return { range: '7d', from: addDays(todayIso, -6), to: todayIso, grain: 'day', since: addDays(todayIso, -6) };
}

function emptySeriesPoint() {
  return { documents: 0, expenses: 0, revenues: 0, requests: 0, classifications: 0 };
}

function fillSeries(rows, window) {
  const map = new Map();
  for (const r of rows) {
    const key = r.bucket;
    const cur = map.get(key) || emptySeriesPoint();
    const field = ACTIVITY_TYPES[r.event_type];
    if (field) cur[field] += Number(r.n || 0);
    map.set(key, cur);
  }
  const out = [];
  if (window.grain === 'hour') {
    const start = new Date(window.since);
    start.setMinutes(0, 0, 0);
    for (let i = 0; i < 24; i++) {
      const d = new Date(start.getTime() + i * 3600000);
      const bucket = `${isoDay(d)} ${pad(d.getHours())}:00`;
      out.push({ bucket, ...(map.get(bucket) || emptySeriesPoint()) });
    }
    return out;
  }
  let cursor = window.from;
  while (cursor <= window.to) {
    out.push({ bucket: cursor, ...(map.get(cursor) || emptySeriesPoint()) });
    cursor = addDays(cursor, 1);
  }
  const used = new Set(out.map((p) => p.bucket));
  for (const [key, val] of map) {
    if (!used.has(key)) out.push({ bucket: key, ...val });
  }
  out.sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  return out;
}

function sendOfficeDashboard(req, res, deps) {
  try {
    return sendOfficeDashboardInner(req, res, deps);
  } catch (err) {
    console.error('office_dashboard_error', err && err.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Não foi possível carregar o dashboard.' });
  }
}

function sendOfficeDashboardInner(req, res, deps) {
  const { one, qRows, today, origens, staffVisibleCompanySql, portfolioAggregates } = deps;
  const tenantId = req.user.tenant_id;
  const cid = req.companyScope || null;
  const visX = staffVisibleCompanySql(req, 'company_id');
  const visDoc = staffVisibleCompanySql(req, 'd.company_id');
  const visEv = staffVisibleCompanySql(req, 'ev.company_id');
  const visC = staffVisibleCompanySql(req, 'c.id');
  const p = [tenantId];
  let companyFilter = '';
  if (cid) { companyFilter = ' AND company_id=?'; p.push(cid); }
  else { companyFilter += visX.sql; p.push(...visX.p); }

  const period = resolvePeriod(req.query, today);
  const activityWindow = resolveActivityWindow(req.query, today);
  const periodDates = [period.from, period.to];
  const dateOccurred = ' AND date(occurred_on)>=date(?) AND date(occurred_on)<=date(?)';
  const dateCreated = ' AND date(created_at)>=date(?) AND date(created_at)<=date(?)';
  let dateFilter = '';
  const datesLegacy = [];
  if (today(req.query.from)) { dateFilter += ' AND date(occurred_on)>=date(?)'; datesLegacy.push(req.query.from); }
  if (today(req.query.to)) { dateFilter += ' AND date(occurred_on)<=date(?)'; datesLegacy.push(req.query.to); }

  const companies = cid
    ? one('SELECT COUNT(*) n FROM companies WHERE tenant_id=? AND id=? AND status=\'ACTIVE\'', tenantId, cid).n
    : one(`SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.status='ACTIVE'${visC.sql}`, tenantId, ...visC.p).n;
  const exp = one(`SELECT COALESCE(SUM(amount_cents),0) n FROM expenses WHERE tenant_id=?${companyFilter}${dateFilter}`, ...p, ...datesLegacy).n;
  const rev = one(`SELECT COALESCE(SUM(amount_cents),0) n FROM revenues WHERE tenant_id=?${companyFilter}${dateFilter}`, ...p, ...datesLegacy).n;
  const pending = one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='PENDING'${companyFilter}`, ...p).n;
  const approved = one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='POSTED'${companyFilter}${dateFilter}`, ...p, ...datesLegacy).n;
  const rejected = one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='REJECTED'${companyFilter}${dateFilter}`, ...p, ...datesLegacy).n;
  const documents = one(`SELECT COUNT(*) n FROM documents WHERE tenant_id=? AND deleted_at IS NULL AND IFNULL(status,'')<>'DRAFT'${companyFilter}`, ...p).n;
  const expense_count = one(`SELECT COUNT(*) n FROM expenses WHERE tenant_id=?${companyFilter}`, ...p).n;
  const revenue_count = one(`SELECT COUNT(*) n FROM revenues WHERE tenant_id=?${companyFilter}`, ...p).n;
  const movements = expense_count + revenue_count;
  const indicators = portfolioAggregates(req, cid);
  const origins = qRows(
    `SELECT origin,COUNT(*) n FROM (SELECT origin FROM expenses WHERE tenant_id=?${companyFilter} UNION ALL SELECT origin FROM revenues WHERE tenant_id=?${companyFilter}) t GROUP BY origin`,
    ...p, ...p
  ).map(x => ({ origin: x.origin, count: x.n, origin_label: origens.label(x.origin) }));
  const activity = cid
    ? qRows(
      'SELECT ev.event_type,ev.payload_json,ev.created_at,ev.entity_type,ev.entity_id FROM domain_events ev WHERE ev.tenant_id=? AND ev.company_id=? ORDER BY ev.created_at DESC LIMIT 20',
      tenantId, cid
    ).map(ev => {
      let payload = {};
      try { payload = JSON.parse(ev.payload_json || '{}'); } catch { payload = {}; }
      return {
        event_type: ev.event_type, entity_type: ev.entity_type, entity_id: ev.entity_id, created_at: ev.created_at,
        title: ({
          EXPENSE_CREATED: 'Nova despesa enviada pelo cliente',
          DOCUMENT_UPLOADED: 'Novo documento recebido',
          IMPORT_COMPLETED: 'Importação concluída',
          REVENUE_CREATED: 'Receita recebida por importação ou integração',
          CLASSIFICATION_REQUIRED: 'Classificação aguardando análise'
        }[ev.event_type] || ev.event_type),
        payload
      };
    })
    : [];

  const monthly = qRows(
    `SELECT substr(occurred_on,1,7) month,COALESCE(SUM(CASE WHEN source_type='REVENUE' THEN (SELECT SUM(amount_cents) FROM entry_lines el WHERE el.entry_id=e.id AND el.side='D') ELSE 0 END),0) revenue,COALESCE(SUM(CASE WHEN source_type='EXPENSE' THEN (SELECT SUM(amount_cents) FROM entry_lines el WHERE el.entry_id=e.id AND el.side='D') ELSE 0 END),0) expense FROM entries e WHERE tenant_id=? AND status='POSTED'${companyFilter}${dateFilter} GROUP BY substr(occurred_on,1,7) ORDER BY month DESC LIMIT 12`,
    ...p, ...datesLegacy
  );

  const documentsPeriod = one(
    `SELECT COUNT(*) n FROM documents WHERE tenant_id=? AND deleted_at IS NULL AND IFNULL(status,'')<>'DRAFT'${companyFilter}${dateCreated}`,
    ...p, ...periodDates
  ).n;
  const docScope = cid ? { sql: ' AND d.company_id=?', p: [cid] } : visDoc;
  const documentsProcessed = one(
    `SELECT COUNT(*) n FROM documents d WHERE d.tenant_id=? AND d.deleted_at IS NULL${docScope.sql}
      AND date(d.created_at)>=date(?) AND date(d.created_at)<=date(?)
      AND (
        EXISTS(SELECT 1 FROM expenses x JOIN entries e ON e.source_id=x.id AND e.source_type='EXPENSE' AND e.tenant_id=d.tenant_id WHERE x.document_id=d.id AND e.status IN('PENDING','POSTED'))
        OR EXISTS(SELECT 1 FROM revenues x JOIN entries e ON e.source_id=x.id AND e.source_type='REVENUE' AND e.tenant_id=d.tenant_id WHERE x.document_id=d.id AND e.status IN('PENDING','POSTED'))
      )`,
    tenantId, ...docScope.p, ...periodDates
  ).n;
  const documentsPendingPeriod = Math.max(0, documentsPeriod - documentsProcessed);
  const processing_rate = documentsPeriod > 0 ? Math.round((documentsProcessed / documentsPeriod) * 100) : null;
  const periodExp = one(`SELECT COALESCE(SUM(amount_cents),0) n FROM expenses WHERE tenant_id=?${companyFilter}${dateOccurred}`, ...p, ...periodDates).n;
  const periodRev = one(`SELECT COALESCE(SUM(amount_cents),0) n FROM revenues WHERE tenant_id=?${companyFilter}${dateOccurred}`, ...p, ...periodDates).n;
  const periodPosted = one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='POSTED'${companyFilter}${dateOccurred}`, ...p, ...periodDates).n;

  const openPendencies = one(`SELECT COUNT(*) n FROM pendencies WHERE tenant_id=? AND status='OPEN'${companyFilter}`, ...p).n;
  const waitingClient = one(
    `SELECT COUNT(*) n FROM requests WHERE tenant_id=? AND status IN('AGUARDANDO_CLIENTE','WAITING_CLIENT')${companyFilter}`,
    ...p
  ).n;
  const openRequests = one(
    `SELECT COUNT(*) n FROM requests WHERE tenant_id=? AND status IN('OPEN','AGUARDANDO_CLIENTE','AGUARDANDO_ESCRITORIO','RESPONDED','PENDING','WAITING_CLIENT','WAITING_OFFICE')${companyFilter}`,
    ...p
  ).n;

  const processWhere = cid
    ? { sql: ' AND company_id=?', p: [cid] }
    : visX;
  const processP = [tenantId, ...processWhere.p];
  const processCount = one(`SELECT COUNT(*) n FROM process_occurrences WHERE tenant_id=?${processWhere.sql}`, ...processP).n;
  const processOverdue = one(
    `SELECT COUNT(*) n FROM process_occurrence_steps s
     WHERE s.tenant_id=? AND s.status NOT IN('CONCLUIDA','CANCELADA') AND s.due_date<date('now')
       AND s.occurrence_id IN (SELECT id FROM process_occurrences WHERE tenant_id=?${processWhere.sql})`,
    tenantId, ...processP
  ).n;
  const processDueSoon = one(
    `SELECT COUNT(*) n FROM process_occurrence_steps s
     WHERE s.tenant_id=? AND s.status NOT IN('CONCLUIDA','CANCELADA')
       AND s.due_date BETWEEN date('now') AND date('now','+2 days')
       AND s.occurrence_id IN (SELECT id FROM process_occurrences WHERE tenant_id=?${processWhere.sql})`,
    tenantId, ...processP
  ).n;
  const processOpen = one(
    `SELECT COUNT(*) n FROM process_occurrences WHERE tenant_id=? AND status IN('PENDENTE','EM_ANDAMENTO')${processWhere.sql}`,
    ...processP
  ).n;

  const companiesWithoutRecentDocs = cid
    ? one(
      `SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.id=? AND c.status='ACTIVE'
         AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.tenant_id=c.tenant_id AND d.company_id=c.id AND d.deleted_at IS NULL AND datetime(d.created_at)>=datetime('now','-30 days'))`,
      tenantId, cid
    ).n
    : one(
      `SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.status='ACTIVE'${visC.sql}
         AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.tenant_id=c.tenant_id AND d.company_id=c.id AND d.deleted_at IS NULL AND datetime(d.created_at)>=datetime('now','-30 days'))`,
      tenantId, ...visC.p
    ).n;

  const eventFilter = cid ? ' AND ev.company_id=?' : visEv.sql;
  const eventP = cid ? [tenantId, cid] : [tenantId, ...visEv.p];
  const bucketExpr = activityWindow.grain === 'hour'
    ? "strftime('%Y-%m-%d %H:00', ev.created_at)"
    : "date(ev.created_at)";
  const sinceExpr = activityWindow.range === '24h'
    ? "datetime('now','-1 day')"
    : (activityWindow.range === '30d' ? "datetime('now','-29 days')" : "datetime('now','-6 days')");
  const seriesRows = qRows(
    `SELECT ${bucketExpr} bucket, ev.event_type, COUNT(*) n
     FROM domain_events ev
     WHERE ev.tenant_id=?${eventFilter}
       AND datetime(replace(ev.created_at,'T',' '))>=${sinceExpr}
     GROUP BY bucket, ev.event_type`,
    ...eventP
  );
  const activity_series = fillSeries(seriesRows, activityWindow);

  const companiesOk = Math.max(0, Number(indicators.active_companies || companies || 0) - Number(indicators.companies_with_pendencies || 0));

  const kpis = {
    companies: {
      value: companies,
      hint: indicators.companies_with_activity
        ? `${indicators.companies_with_activity} com atividade recente`
        : 'sem atividade recente',
      page: 'empresas'
    },
    documents: {
      value: documents,
      hint: documentsPendingPeriod
        ? `${documentsPendingPeriod} aguardando processamento`
        : (documentsPeriod ? 'nenhum pendente no período' : 'Nenhum documento recebido no período.'),
      page: 'documentos'
    },
    pendencies: {
      value: openPendencies,
      hint: openPendencies ? `${openPendencies} abertas` : 'Tudo em dia.',
      page: 'pendencias'
    },
    requests: {
      value: openRequests || indicators.open_requests || 0,
      hint: waitingClient ? `${waitingClient} aguardando cliente` : 'sem espera do cliente',
      page: 'solicitacoes'
    },
    processes: {
      value: processOpen || processCount,
      hint: processDueSoon ? `${processDueSoon} vencendo` : (processOverdue ? `${processOverdue} atrasadas` : 'sem prazos críticos'),
      page: 'processos'
    }
  };

  const summary = {
    label: period.preset === 'month' ? 'Mês atual' : period.preset,
    from: period.from,
    to: period.to,
    documents_received: documentsPeriod,
    documents_processed: documentsProcessed,
    documents_pending: documentsPendingPeriod,
    expenses_cents: periodExp,
    revenue_cents: periodRev,
    approvals_pending: pending,
    entries_posted: periodPosted,
    processing_rate
  };

  const health = {
    companies_ok: companiesOk,
    companies_with_pendencies: indicators.companies_with_pendencies || 0,
    processes_overdue: processOverdue,
    processes_due_soon: processDueSoon,
    documents_attention: indicators.expenses_awaiting_classification || 0,
    companies_without_recent_documents: companiesWithoutRecentDocs
  };

  res.json({
    companies,
    expenses_cents: exp,
    revenue_cents: rev,
    pending,
    approved,
    rejected,
    entries_export_ready: approved,
    balance_cents: rev - exp,
    documents,
    movements,
    expense_count,
    revenue_count,
    company_id: cid,
    ...indicators,
    origins,
    activity,
    monthly,
    period,
    activity_window: { range: activityWindow.range, from: activityWindow.from, to: activityWindow.to, grain: activityWindow.grain },
    kpis,
    summary,
    activity_series,
    health,
    processing_rate,
    processes: {
      abertas: processOpen,
      total: processCount,
      vencendo: processDueSoon,
      atrasadas: processOverdue
    }
  });
}

module.exports = { sendOfficeDashboard, resolvePeriod, resolveActivityWindow, fillSeries, ACTIVITY_TYPES };
