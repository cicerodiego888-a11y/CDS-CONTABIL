'use strict';

const BLOCKED_MESSAGE =
  'Este plano de contas possui registros vinculados e não pode ser excluído. As contas podem ser desativadas ou um novo plano deve ser tratado sem apagar o histórico.';

const PLAN_EXISTS_MESSAGE = 'Esta empresa já possui um plano de contas.';

function planAccountIdsSql() {
  return 'SELECT id FROM accounts WHERE tenant_id=? AND plan_id=?';
}

function count(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return Number(row && (row.n != null ? row.n : row.count) || 0);
}

function collectPlanDependencies(db, tenantId, planId) {
  const ids = planAccountIdsSql();
  const deps = {
    entry_lines: count(
      db,
      `SELECT COUNT(*) n FROM entry_lines el
       JOIN accounts a ON a.id=el.account_id
       WHERE a.tenant_id=? AND a.plan_id=?`,
      tenantId,
      planId
    ),
    entry_reclassifications: count(
      db,
      `SELECT COUNT(*) n FROM entry_reclassifications er
       WHERE er.tenant_id=? AND er.account_id IN (${ids})`,
      tenantId,
      tenantId,
      planId
    ),
    entries_via_lines: count(
      db,
      `SELECT COUNT(DISTINCT el.entry_id) n FROM entry_lines el
       JOIN accounts a ON a.id=el.account_id
       WHERE a.tenant_id=? AND a.plan_id=?`,
      tenantId,
      planId
    ),
    categories: count(
      db,
      `SELECT COUNT(*) n FROM categories c
       WHERE c.tenant_id=? AND c.account_id IN (${ids})`,
      tenantId,
      tenantId,
      planId
    ),
    banks: count(
      db,
      `SELECT COUNT(*) n FROM banks b
       WHERE b.tenant_id=? AND b.account_id IN (${ids})`,
      tenantId,
      tenantId,
      planId
    ),
    accounting_rules: count(
      db,
      `SELECT COUNT(*) n FROM accounting_rules r
       WHERE r.tenant_id=? AND (
         r.debit_account_id IN (${ids})
         OR r.credit_account_id IN (${ids})
         OR r.settlement_account_id IN (${ids})
       )`,
      tenantId,
      tenantId,
      planId,
      tenantId,
      planId,
      tenantId,
      planId
    ),
    classification_runs: count(
      db,
      `SELECT COUNT(*) n FROM classification_runs cr
       WHERE cr.tenant_id=? AND (
         cr.chosen_debit_account_id IN (${ids})
         OR cr.chosen_credit_account_id IN (${ids})
       )`,
      tenantId,
      tenantId,
      planId,
      tenantId,
      planId
    ),
    account_external_mappings: 0,
    ai_classification_candidates: 0,
    ai_classification_decisions: 0,
    ai_classification_suggestions: 0
  };

  try {
    deps.account_external_mappings = count(
      db,
      `SELECT COUNT(*) n FROM account_external_mappings m
       WHERE m.tenant_id=? AND m.account_id IN (${ids})`,
      tenantId,
      tenantId,
      planId
    );
  } catch (_) {}

  try {
    deps.ai_classification_candidates = count(
      db,
      `SELECT COUNT(*) n FROM ai_classification_candidates c
       JOIN ai_classification_suggestions s ON s.id=c.suggestion_id
       WHERE s.tenant_id=? AND c.account_id IN (${ids})`,
      tenantId,
      tenantId,
      planId
    );
  } catch (_) {}

  try {
    deps.ai_classification_decisions = count(
      db,
      `SELECT COUNT(*) n FROM ai_classification_decisions d
       WHERE d.tenant_id=? AND (
         d.suggested_account_id IN (${ids})
         OR d.selected_account_id IN (${ids})
       )`,
      tenantId,
      tenantId,
      planId,
      tenantId,
      planId
    );
  } catch (_) {}

  try {
    deps.ai_classification_suggestions = count(
      db,
      `SELECT COUNT(*) n FROM ai_classification_suggestions s
       WHERE s.tenant_id=? AND s.primary_account_id IN (${ids})`,
      tenantId,
      tenantId,
      planId
    );
  } catch (_) {}

  const blocking = Object.entries(deps)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, count: n }));

  return {
    plan_id: planId,
    tenant_id: tenantId,
    blocked: blocking.length > 0,
    blocking,
    dependencies: deps,
    message: blocking.length ? BLOCKED_MESSAGE : null
  };
}

function getTenantActivePlan(db, tenantId) {
  return db
    .prepare(
      `SELECT p.*, COUNT(a.id) account_count
       FROM account_plans p
       LEFT JOIN accounts a ON a.plan_id=p.id
       WHERE p.tenant_id=?
       GROUP BY p.id
       HAVING COUNT(a.id)>0
       ORDER BY p.created_at DESC
       LIMIT 1`
    )
    .get(tenantId);
}

function getPlanForTenant(db, tenantId, planId) {
  return db
    .prepare('SELECT * FROM account_plans WHERE tenant_id=? AND id=?')
    .get(tenantId, planId);
}

function accountCount(db, tenantId, planId) {
  return count(
    db,
    'SELECT COUNT(*) n FROM accounts WHERE tenant_id=? AND plan_id=?',
    tenantId,
    planId
  );
}

function setAccountActive(db, { tenantId, accountId, active }) {
  const row = db
    .prepare('SELECT * FROM accounts WHERE tenant_id=? AND id=?')
    .get(tenantId, accountId);
  if (!row) {
    const err = new Error('Conta não encontrada.');
    err.code = 'NOT_FOUND';
    err.http = 404;
    throw err;
  }
  const next = active ? 1 : 0;
  if (Number(row.active) === next) {
    return row;
  }
  db.prepare('UPDATE accounts SET active=? WHERE tenant_id=? AND id=?').run(
    next,
    tenantId,
    accountId
  );
  return db
    .prepare('SELECT * FROM accounts WHERE tenant_id=? AND id=?')
    .get(tenantId, accountId);
}

function deletePlanSafe(db, { tenantId, planId }) {
  const plan = getPlanForTenant(db, tenantId, planId);
  if (!plan) {
    const err = new Error('Plano de contas não encontrado.');
    err.code = 'NOT_FOUND';
    err.http = 404;
    throw err;
  }
  const check = collectPlanDependencies(db, tenantId, planId);
  if (check.blocked) {
    const err = new Error(BLOCKED_MESSAGE);
    err.code = 'PLAN_DELETE_BLOCKED';
    err.http = 409;
    err.check = check;
    throw err;
  }
  const accounts = accountCount(db, tenantId, planId);
  const run = db.transaction(() => {
    db.prepare('UPDATE import_jobs SET plan_id=NULL WHERE tenant_id=? AND plan_id=?').run(
      tenantId,
      planId
    );
    try {
      db.prepare(
        'UPDATE ai_chart_previews SET imported_plan_id=NULL WHERE tenant_id=? AND imported_plan_id=?'
      ).run(tenantId, planId);
    } catch (_) {}
    db.prepare('DELETE FROM accounts WHERE tenant_id=? AND plan_id=?').run(tenantId, planId);
    db.prepare('DELETE FROM account_plans WHERE tenant_id=? AND id=?').run(tenantId, planId);
  });
  run();
  return { ok: true, plan_id: planId, deleted_accounts: accounts };
}

module.exports = {
  BLOCKED_MESSAGE,
  PLAN_EXISTS_MESSAGE,
  collectPlanDependencies,
  getTenantActivePlan,
  getPlanForTenant,
  accountCount,
  setAccountActive,
  deletePlanSafe
};
