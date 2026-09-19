'use strict';

const OPERATIONS = Object.freeze({
  ACCOUNT_CLASSIFICATION: 'ACCOUNT_CLASSIFICATION',
  DOCUMENT_INTERPRETATION: 'DOCUMENT_INTERPRETATION',
  PLAN_ACCOUNT_IMPORT: 'PLAN_ACCOUNT_IMPORT',
  DOCUMENT_REANALYSIS: 'DOCUMENT_REANALYSIS',
  // aliases retained from Sprint 21/22 records
  ACCOUNTING_CLASSIFICATION: 'ACCOUNT_CLASSIFICATION',
  CHART_IMPORT: 'PLAN_ACCOUNT_IMPORT'
});

const DEFAULT_MODEL_ID = 'gpt-5.6-terra';
const DEFAULT_MODEL_DISPLAY = 'GPT-5.6 Terra';

function normalizeOperation(value) {
  const raw = String(value || '').trim().toUpperCase();
  return OPERATIONS[raw] || raw || 'ACCOUNT_CLASSIFICATION';
}

function periodYm(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthBounds(ym = periodYm()) {
  const [y, m] = String(ym).split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, toExclusive: next, period_ym: `${y}-${String(m).padStart(2, '0')}` };
}

function createAiControlService({ db, id, auditSystem, config, credentialService }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function fail(message, code, http = 400) {
    const error = new Error(message);
    error.code = code;
    error.http = http;
    return error;
  }

  function audit(tenantId, userId, action, type, entityId, payload) {
    if (auditSystem) auditSystem(tenantId, userId || null, action, type, entityId, payload);
  }

  function ensureSettingsRow(tenantId) {
    const existing = one('SELECT * FROM tenant_ai_settings WHERE tenant_id=?', tenantId);
    if (existing) return existing;
    // tenant_ai_settings.enabled = decisão do escritório (sempre inicia desativado).
    // AI_ENABLED / AI_PROVIDER = capacidade técnica da instalação — não misturar.
    run(
      `INSERT INTO tenant_ai_settings(tenant_id,enabled,model_display,updated_at)
       VALUES(?,?,?,CURRENT_TIMESTAMP)`,
      tenantId, 0, DEFAULT_MODEL_DISPLAY
    );
    return one('SELECT * FROM tenant_ai_settings WHERE tenant_id=?', tenantId);
  }

  function canonicalModel() {
    return (config && config.AI_MODEL) || DEFAULT_MODEL_ID;
  }

  function pricingFor(provider, model) {
    return one(
      `SELECT * FROM ai_model_pricing
       WHERE active=1 AND provider=? AND model=?
       ORDER BY effective_from DESC LIMIT 1`,
      provider || 'openai', model || canonicalModel()
    ) || one(
      `SELECT * FROM ai_model_pricing
       WHERE active=1 AND provider=? AND model=?
       ORDER BY effective_from DESC LIMIT 1`,
      provider || 'openai', DEFAULT_MODEL_ID
    ) || one(
      `SELECT * FROM ai_model_pricing
       WHERE active=1 AND provider=?
       ORDER BY effective_from DESC LIMIT 1`,
      provider || 'openai'
    );
  }

  function estimateCostCents(provider, model, usage) {
    const price = pricingFor(provider, model);
    if (!price) return 0;
    const input = Number(usage && usage.input_tokens || 0) || 0;
    const cached = Number(usage && usage.cached_input_tokens || 0) || 0;
    const output = Number(usage && usage.output_tokens || 0) || 0;
    const billableInput = Math.max(0, input - cached);
    const cachedPrice = price.cached_input_price_usd_per_1m != null
      ? Number(price.cached_input_price_usd_per_1m)
      : Number(price.input_price_usd_per_1m || 0);
    const usd =
      (billableInput / 1e6) * Number(price.input_price_usd_per_1m || 0) +
      (cached / 1e6) * cachedPrice +
      (output / 1e6) * Number(price.output_price_usd_per_1m || 0);
    return Math.max(0, Math.round(usd * 100));
  }

  function monthUsage(tenantId, ym = periodYm()) {
    const { from, toExclusive, period_ym } = monthBounds(ym);
    const agg = one(
      `SELECT
         COUNT(*) calls,
         COALESCE(SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END),0) success_calls,
         COALESCE(SUM(total_tokens),0) tokens,
         COALESCE(SUM(estimated_cost_cents),0) cost_cents,
         COUNT(DISTINCT document_id) documents
       FROM ai_usage_records
       WHERE tenant_id=? AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)`,
      tenantId, from, toExclusive
    ) || { calls: 0, success_calls: 0, tokens: 0, cost_cents: 0, documents: 0 };
    return {
      period_ym,
      from,
      to_exclusive: toExclusive,
      calls: Number(agg.calls || 0),
      success_calls: Number(agg.success_calls || 0),
      tokens: Number(agg.tokens || 0),
      cost_cents: Number(agg.cost_cents || 0),
      documents: Number(agg.documents || 0)
    };
  }

  function warningMessage(level) {
    if (level >= 100) {
      return 'O limite mensal de IA foi atingido. O CDS continuará funcionando normalmente utilizando os motores internos.';
    }
    if (level >= 80) return 'Seu escritório já utilizou 80% do limite de IA.';
    if (level >= 50) return 'Seu escritório já utilizou 50% do limite de IA.';
    return null;
  }

  function usagePercent(costCents, limitCents) {
    if (!limitCents || limitCents <= 0) return 0;
    return Math.min(999, Math.round((Number(costCents || 0) / Number(limitCents)) * 100));
  }

  function currentWarningLevel(percent) {
    if (percent >= 100) return 100;
    if (percent >= 80) return 80;
    if (percent >= 50) return 50;
    return 0;
  }

  function emitLimitWarnings(tenantId, userId, usage, limitCents) {
    if (!limitCents || limitCents <= 0) return [];
    const percent = usagePercent(usage.cost_cents, limitCents);
    const level = currentWarningLevel(percent);
    const emitted = [];
    for (const threshold of [50, 80, 100]) {
      if (level < threshold) continue;
      const exists = one(
        'SELECT id FROM ai_limit_warnings WHERE tenant_id=? AND period_ym=? AND level=?',
        tenantId, usage.period_ym, threshold
      );
      if (exists) continue;
      const wid = id();
      run(
        `INSERT INTO ai_limit_warnings(id,tenant_id,period_ym,level)
         VALUES(?,?,?,?)`,
        wid, tenantId, usage.period_ym, threshold
      );
      audit(tenantId, userId, threshold === 100 ? 'AI_LIMIT_REACHED' : 'AI_LIMIT_WARNING',
        'AI_SETTINGS', tenantId, {
          period_ym: usage.period_ym, level: threshold,
          cost_cents: usage.cost_cents, monthly_limit_cents: limitCents
        });
      emitted.push({
        level: threshold,
        message: warningMessage(threshold)
      });
    }
    return emitted;
  }

  function credentialStatus() {
    if (credentialService && typeof credentialService.publicStatus === 'function') {
      return credentialService.publicStatus();
    }
    const envKey = !!(config && config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY);
    return {
      provider_configured: envKey,
      credential_configured: envKey,
      credential_source: envKey ? 'env' : null,
      last_tested_at: null,
      last_test_status: null
    };
  }

  function publicSettings(tenantId) {
    const row = ensureSettingsRow(tenantId);
    const usage = monthUsage(tenantId);
    const limit = row.monthly_limit_cents == null ? null : Number(row.monthly_limit_cents);
    const percent = usagePercent(usage.cost_cents, limit);
    const level = currentWarningLevel(percent);
    const cred = credentialStatus();
    const providerConfigured = !!cred.provider_configured;
    const enabled = Number(row.enabled) === 1;
    const limitReached = !!(limit && limit > 0 && usage.cost_cents >= limit);
    const displayModel = row.model_display || DEFAULT_MODEL_DISPLAY;
    const providerModel = canonicalModel();
    return {
      enabled,
      status: enabled ? 'ATIVA' : 'DESATIVADA',
      model_display: displayModel,
      display_model: displayModel,
      provider: providerConfigured ? 'openai' : (config && config.AI_PROVIDER || 'off'),
      provider_model: providerModel,
      provider_configured: providerConfigured,
      credential_configured: !!cred.credential_configured,
      credential_source: cred.credential_source || null,
      credential_source_label: cred.credential_source_label || null,
      last_tested_at: cred.last_tested_at || null,
      last_test_status: cred.last_test_status || null,
      monthly_limit_cents: limit,
      monthly_limit_usd: limit == null ? null : Number((limit / 100).toFixed(2)),
      usage: {
        period_ym: usage.period_ym,
        cost_cents: usage.cost_cents,
        cost_usd: Number((usage.cost_cents / 100).toFixed(4)),
        calls: usage.calls,
        documents: usage.documents,
        tokens: usage.tokens,
        percent_used: percent
      },
      warning_level: level,
      warning_message: warningMessage(level),
      ai_available: enabled && !limitReached && providerConfigured,
      limit_reached: limitReached,
      updated_at: row.updated_at || null
    };
  }

  function updateSettings(tenantId, userId, input = {}) {
    ensureSettingsRow(tenantId);
    const before = publicSettings(tenantId);
    let enabled = before.enabled;
    if (input.enabled !== undefined) {
      enabled = input.enabled === true || input.enabled === 1 || input.enabled === '1' ||
        input.enabled === 'on' || input.enabled === 'true';
    }
    let limit = before.monthly_limit_cents;
    if (input.monthly_limit_cents !== undefined || input.monthly_limit_usd !== undefined) {
      if (input.monthly_limit_usd !== undefined && input.monthly_limit_usd !== null &&
          input.monthly_limit_usd !== '') {
        const usd = Number(String(input.monthly_limit_usd).replace(',', '.'));
        if (!Number.isFinite(usd) || usd < 0) throw fail('Informe um limite mensal válido.', 'INVALID_LIMIT');
        limit = Math.round(usd * 100);
      } else if (input.monthly_limit_cents === null || input.monthly_limit_cents === '') {
        limit = null;
      } else if (input.monthly_limit_cents !== undefined) {
        const cents = Number(input.monthly_limit_cents);
        if (!Number.isFinite(cents) || cents < 0) throw fail('Informe um limite mensal válido.', 'INVALID_LIMIT');
        limit = Math.round(cents);
      }
    }
    const modelDisplay = input.model_display
      ? String(input.model_display).trim().slice(0, 80) || DEFAULT_MODEL_DISPLAY
      : (before.model_display || DEFAULT_MODEL_DISPLAY);

    run(
      `UPDATE tenant_ai_settings SET enabled=?,monthly_limit_cents=?,model_display=?,
       updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`,
      enabled ? 1 : 0, limit, modelDisplay, userId || null, tenantId
    );

    audit(tenantId, userId, 'AI_SETTINGS_CHANGED', 'AI_SETTINGS', tenantId, {
      enabled, monthly_limit_cents: limit, model_display: modelDisplay
    });
    if (before.enabled !== enabled) {
      audit(tenantId, userId, enabled ? 'AI_ENABLED' : 'AI_DISABLED', 'AI_SETTINGS', tenantId, {
        enabled
      });
    }
    if (before.monthly_limit_cents !== limit) {
      audit(tenantId, userId, 'AI_LIMIT_CHANGED', 'AI_SETTINGS', tenantId, {
        before: before.monthly_limit_cents, after: limit
      });
    }
    return publicSettings(tenantId);
  }

  function availability(tenantId) {
    const settings = publicSettings(tenantId);
    if (!settings.enabled) {
      return { available: false, reason: 'AI_DISABLED', settings };
    }
    if (settings.limit_reached) {
      return { available: false, reason: 'AI_LIMIT_REACHED', settings };
    }
    return { available: true, reason: null, settings };
  }

  function recordUsage(input = {}) {
    const tenantId = input.tenant_id;
    if (!tenantId) throw fail('tenant_id obrigatório.', 'TENANT_REQUIRED');
    const provider = input.provider || (config && config.AI_PROVIDER) || 'off';
    const model = input.model || canonicalModel();
    const usage = {
      input_tokens: Number(input.input_tokens || 0) || 0,
      output_tokens: Number(input.output_tokens || 0) || 0,
      total_tokens: Number(input.total_tokens || 0) ||
        ((Number(input.input_tokens || 0) || 0) + (Number(input.output_tokens || 0) || 0)),
      cached_input_tokens: Number(input.cached_input_tokens || 0) || 0
    };
    const cost = input.estimated_cost_cents != null
      ? Math.max(0, Math.round(Number(input.estimated_cost_cents) || 0))
      : estimateCostCents(provider, model, usage);
    const rid = id();
    const operation = normalizeOperation(input.operation_type);
    const status = input.status === 'FAILED' ? 'FAILED' : 'SUCCESS';
    run(
      `INSERT INTO ai_usage_records(
         id,tenant_id,company_id,user_id,document_id,provider,model,operation_type,status,
         input_tokens,output_tokens,total_tokens,cached_input_tokens,estimated_cost_cents,
         duration_ms,error_code,reference_type,reference_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      rid, tenantId, input.company_id || null, input.user_id || null, input.document_id || null,
      provider, model, operation, status,
      usage.input_tokens || null, usage.output_tokens || null, usage.total_tokens || null,
      usage.cached_input_tokens || null, cost,
      input.duration_ms != null ? Math.round(Number(input.duration_ms) || 0) : null,
      input.error_code || null, input.reference_type || null, input.reference_id || null
    );
    audit(tenantId, input.user_id || null,
      status === 'FAILED' ? 'AI_REQUEST_FAILED' : 'AI_USAGE_RECORDED',
      'AI_USAGE', rid, {
        company_id: input.company_id || null,
        document_id: input.document_id || null,
        operation_type: operation,
        status,
        total_tokens: usage.total_tokens,
        estimated_cost_cents: cost,
        error_code: input.error_code || null
      });
    const settings = ensureSettingsRow(tenantId);
    const month = monthUsage(tenantId);
    const warnings = emitLimitWarnings(
      tenantId, input.user_id || null, month, settings.monthly_limit_cents
    );
    return {
      id: rid,
      estimated_cost_cents: cost,
      warnings,
      month
    };
  }

  function listUsage(tenantId, query = {}) {
    const { from, toExclusive } = monthBounds(query.period_ym || periodYm());
    const p = [tenantId, query.from || from, query.to || toExclusive];
    let where = 'u.tenant_id=? AND datetime(u.created_at)>=datetime(?) AND datetime(u.created_at)<datetime(?)';
    if (query.company_id) { where += ' AND u.company_id=?'; p.push(query.company_id); }
    if (query.operation_type) {
      where += ' AND u.operation_type=?';
      p.push(normalizeOperation(query.operation_type));
    }
    const items = rows(
      `SELECT u.*,c.name company_name,c.trade_name company_trade_name
       FROM ai_usage_records u
       LEFT JOIN companies c ON c.id=u.company_id
       WHERE ${where}
       ORDER BY u.created_at DESC LIMIT 200`,
      ...p
    ).map(row => ({
      id: row.id,
      company_id: row.company_id,
      company_name: row.company_trade_name || row.company_name || null,
      document_id: row.document_id,
      operation_type: row.operation_type,
      provider: row.provider,
      model: row.model,
      status: row.status,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      total_tokens: row.total_tokens,
      estimated_cost_cents: row.estimated_cost_cents,
      estimated_cost_usd: Number(((row.estimated_cost_cents || 0) / 100).toFixed(4)),
      duration_ms: row.duration_ms,
      error_code: row.error_code,
      created_at: row.created_at
    }));
    return { items, period: monthBounds(query.period_ym || periodYm()) };
  }

  function byClient(tenantId, query = {}) {
    const { from, toExclusive, period_ym } = monthBounds(query.period_ym || periodYm());
    const items = rows(
      `SELECT u.company_id,
              c.name company_name,
              c.trade_name company_trade_name,
              COUNT(*) calls,
              COUNT(DISTINCT u.document_id) documents,
              COALESCE(SUM(u.total_tokens),0) tokens,
              COALESCE(SUM(u.estimated_cost_cents),0) cost_cents
       FROM ai_usage_records u
       LEFT JOIN companies c ON c.id=u.company_id
       WHERE u.tenant_id=? AND datetime(u.created_at)>=datetime(?) AND datetime(u.created_at)<datetime(?)
         AND u.company_id IS NOT NULL
       GROUP BY u.company_id
       ORDER BY cost_cents DESC, documents DESC`,
      tenantId, from, toExclusive
    ).map(row => ({
      company_id: row.company_id,
      company_name: row.company_trade_name || row.company_name || 'Cliente',
      documents: Number(row.documents || 0),
      calls: Number(row.calls || 0),
      tokens: Number(row.tokens || 0),
      cost_cents: Number(row.cost_cents || 0),
      cost_usd: Number((Number(row.cost_cents || 0) / 100).toFixed(4))
    }));
    return { period_ym, items };
  }

  function byOperation(tenantId, query = {}) {
    const { from, toExclusive, period_ym } = monthBounds(query.period_ym || periodYm());
    const items = rows(
      `SELECT operation_type,
              COUNT(*) calls,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(estimated_cost_cents),0) cost_cents
       FROM ai_usage_records
       WHERE tenant_id=? AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)
       GROUP BY operation_type
       ORDER BY calls DESC`,
      tenantId, from, toExclusive
    ).map(row => ({
      operation_type: row.operation_type,
      label: ({
        ACCOUNT_CLASSIFICATION: 'Classificação',
        DOCUMENT_INTERPRETATION: 'Interpretação visual',
        DOCUMENT_REANALYSIS: 'Reanálise',
        PLAN_ACCOUNT_IMPORT: 'Importação de plano'
      })[row.operation_type] || row.operation_type,
      calls: Number(row.calls || 0),
      tokens: Number(row.tokens || 0),
      cost_cents: Number(row.cost_cents || 0),
      cost_usd: Number((Number(row.cost_cents || 0) / 100).toFixed(4))
    }));
    return { period_ym, items };
  }

  function summary(tenantId, query = {}) {
    const settings = publicSettings(tenantId);
    const usage = monthUsage(tenantId, query.period_ym || periodYm());
    return {
      settings,
      usage: {
        ...usage,
        cost_usd: Number((usage.cost_cents / 100).toFixed(4))
      },
      by_client: byClient(tenantId, query).items,
      by_operation: byOperation(tenantId, query).items
    };
  }

  return {
    OPERATIONS,
    DEFAULT_MODEL_ID,
    DEFAULT_MODEL_DISPLAY,
    getSettings: publicSettings,
    updateSettings,
    availability,
    recordUsage,
    estimateCostCents,
    monthUsage,
    listUsage,
    byClient,
    byOperation,
    summary,
    normalizeOperation,
    periodYm
  };
}

module.exports = {
  createAiControlService,
  OPERATIONS,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_DISPLAY,
  normalizeOperation,
  periodYm,
  monthBounds
};
