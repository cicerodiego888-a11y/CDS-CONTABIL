'use strict';

const { resolveAutonomyPolicy, MODES } = require('../ai-control/autonomy-policy');

/**
 * DecisionEngine — orquestra tentativas de resolução conforme AutonomyPolicy.
 * Produz decisão estruturada para o Motor Contábil. Nunca posta/aprova.
 */
function createDecisionEngine({
  db,
  classify,
  accountingAIService,
  matchHistory,
  matchCategory,
  defaultBank,
  findSupplierPriorEntries
}) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);

  function fuzzyChartAccounts(tenantId, needle, limit = 8) {
    const hay = String(needle || '').trim().toLowerCase();
    if (hay.length < 3) return [];
    const tokens = hay.split(/\s+/).filter(t => t.length >= 3).slice(0, 4);
    const plan = one(
      `SELECT id FROM account_plans WHERE tenant_id=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      tenantId
    );
    if (!plan) return [];
    const accounts = rows(
      `SELECT id,account_code,description,account_type,is_postable,active
       FROM accounts WHERE tenant_id=? AND plan_id=? AND is_postable=1 AND active=1
       ORDER BY account_code LIMIT 400`,
      tenantId, plan.id
    );
    const scored = [];
    for (const a of accounts) {
      const desc = String(a.description || '').toLowerCase();
      const code = String(a.account_code || '');
      let score = 0;
      if (hay && desc.includes(hay)) score += 40;
      for (const t of tokens) {
        if (desc.includes(t)) score += 12;
      }
      if (hay.length >= 4 && desc.startsWith(hay.slice(0, 4))) score += 8;
      if (score > 0) scored.push({ ...a, score });
    }
    scored.sort((a, b) => b.score - a.score || a.account_code.localeCompare(b.account_code));
    return scored.slice(0, limit);
  }

  function priorSupplierAccounts(tenantId, companyId, supplier) {
    if (typeof findSupplierPriorEntries === 'function') {
      return findSupplierPriorEntries(tenantId, companyId, supplier) || null;
    }
    if (!supplier) return null;
    const like = `%${String(supplier).slice(0, 24)}%`;
    const expense = one(
      `SELECT e.id expense_id, en.id entry_id
       FROM expenses e
       JOIN entries en ON en.source_type='EXPENSE' AND en.source_id=e.id AND en.tenant_id=e.tenant_id
       WHERE e.tenant_id=? AND e.company_id=? AND e.supplier_name LIKE ?
         AND en.status IN('PENDING','POSTED')
       ORDER BY en.created_at DESC LIMIT 1`,
      tenantId, companyId, like
    );
    if (!expense) return null;
    const lines = rows(
      `SELECT side,account_id FROM entry_lines WHERE entry_id=?`,
      expense.entry_id
    );
    const debit = lines.find(l => l.side === 'D');
    const credit = lines.find(l => l.side === 'C');
    if (!debit || !credit) return null;
    return {
      debit_account_id: debit.account_id,
      credit_account_id: credit.account_id,
      source: 'supplier_prior_entry',
      expense_id: expense.expense_id,
      entry_id: expense.entry_id
    };
  }

  /**
   * @returns {{
   *   classification, nature, category, bank, aiSuggestion,
   *   attempts: Array, autonomy_mode, resolved_by
   * }}
   */
  async function resolve(ctx) {
    const policy = resolveAutonomyPolicy(ctx.autonomy_mode);
    const attempts = [];
    const tenantId = ctx.tenantId;
    const companyId = ctx.companyId;
    const documentId = ctx.documentId;
    const actorId = ctx.userId;
    const fields = ctx.fields;
    const supplier = fields.supplier_name && fields.supplier_name.value;
    const description = fields.description && fields.description.value;

    let ruleHit = matchHistory(tenantId, companyId, supplier);
    let historyHit = ruleHit && !ruleHit.rule ? ruleHit : null;
    if (ruleHit && ruleHit.rule) historyHit = null;

    let aiSuggestion = ctx.aiSuggestion || null;
    let nature = ctx.nature;
    let category = ctx.category;
    let bank = ctx.bank;
    let classification = ctx.classification;

    function pushAttempt(name, detail) {
      attempts.push({
        attempt: attempts.length + 1,
        name,
        at: new Date().toISOString(),
        ...detail
      });
    }

    // Tentativa 1 — regra conhecida (ambos os modos)
    if (ruleHit && ruleHit.rule && ruleHit.rule.debit_account_id && ruleHit.rule.credit_account_id) {
      classification = {
        status: 'CLASSIFIED',
        debit_account_id: ruleHit.rule.debit_account_id,
        credit_account_id: ruleHit.rule.credit_account_id,
        confidence: 0.97,
        origin: 'RULE',
        reason: `Regra "${ruleHit.rule.name}"`
      };
      pushAttempt('KNOWN_RULE', { ok: true, rule_id: ruleHit.rule.id, rule_name: ruleHit.rule.name });
    } else {
      pushAttempt('KNOWN_RULE', { ok: false, reason: 'Nenhuma regra determinística aplicável.' });
    }

    // Tentativa 2 — histórico do fornecedor / decisão do contador
    if (classification.status !== 'CLASSIFIED') {
      if (historyHit && historyHit.selected_account_debit && historyHit.selected_account_credit) {
        classification = {
          status: 'CLASSIFIED',
          debit_account_id: historyHit.selected_account_debit,
          credit_account_id: historyHit.selected_account_credit,
          confidence: 0.94,
          origin: 'HISTORY',
          reason: 'Histórico de decisão do contador'
        };
        pushAttempt('SUPPLIER_HISTORY', { ok: true, decision_id: historyHit.id });
      } else {
        pushAttempt('SUPPLIER_HISTORY', { ok: false, reason: 'Sem histórico utilizável.' });
      }
    }

    // Se regra/histórico não resolveram, no modo 98% tenta capacidades avançadas
    // mesmo quando o CDS já sugeriu algo — só se ainda não CLASSIFIED.
    // Se já CLASSIFIED por regra/histórico no 98%, registra e segue (sem loop).
    if (classification.status === 'CLASSIFIED' && policy.isAssisted()) {
      return {
        classification,
        nature,
        category,
        bank,
        aiSuggestion,
        attempts,
        autonomy_mode: policy.mode,
        resolved_by: classification.origin || 'ASSISTED',
        policy
      };
    }

    if (classification.status === 'CLASSIFIED' && policy.isAutonomous()) {
      pushAttempt('ADVANCED_NOT_REQUIRED', {
        ok: true,
        reason: 'Já classificado; resolução avançada desnecessária.',
        origin: classification.origin
      });
      return {
        classification,
        nature,
        category,
        bank,
        aiSuggestion,
        attempts,
        autonomy_mode: policy.mode,
        resolved_by: classification.origin || 'AUTONOMOUS',
        policy
      };
    }

    // ——— Capacidades exclusivas AUTONOMOUS_98 ———
    if (policy.allows('MULTI_ATTEMPT_RESOLUTION') && classification.status !== 'CLASSIFIED') {
      // Tentativa 3 — padrão do fornecedor em lançamentos anteriores + plano
      if (policy.allows('SUPPLIER_PATTERN_MATCH')) {
        const prior = priorSupplierAccounts(tenantId, companyId, supplier);
        if (prior) {
          classification = {
            status: 'CLASSIFIED',
            debit_account_id: prior.debit_account_id,
            credit_account_id: prior.credit_account_id,
            confidence: 0.92,
            origin: 'SUPPLIER_PATTERN',
            reason: 'Padrão de lançamentos anteriores do mesmo fornecedor.'
          };
          pushAttempt('SUPPLIER_PATTERN', { ok: true, entry_id: prior.entry_id });
        } else if (policy.allows('ALTERNATIVE_ACCOUNT_SEARCH')) {
          const needle = description || supplier || '';
          const candidates = fuzzyChartAccounts(tenantId, needle);
          const bankAcc = bank && bank.account_id;
          const debitCandidate = candidates[0];
          if (debitCandidate && bankAcc && debitCandidate.id !== bankAcc) {
            classification = {
              status: 'CLASSIFIED',
              debit_account_id: debitCandidate.id,
              credit_account_id: bankAcc,
              confidence: Math.min(0.88, 0.55 + debitCandidate.score / 100),
              origin: 'CHART_FUZZY',
              reason: `Conta candidata no plano: ${debitCandidate.account_code} — ${debitCandidate.description}`,
              candidates: candidates.slice(0, 5).map(c => ({
                account_id: c.id,
                account_code: c.account_code,
                description: c.description,
                score: c.score
              }))
            };
            pushAttempt('CHART_AND_CONTEXT', {
              ok: true,
              debit: debitCandidate.account_code,
              credit_bank: bank && bank.name
            });
          } else {
            pushAttempt('CHART_AND_CONTEXT', {
              ok: false,
              reason: 'Sem par débito/crédito confiável no plano.',
              candidates: candidates.slice(0, 3).map(c => c.account_code)
            });
          }
        } else {
          pushAttempt('SUPPLIER_PATTERN', { ok: false, reason: 'Sem padrão de fornecedor.' });
        }
      }

      // Tentativa 4 — IA com contexto ampliado
      if (classification.status !== 'CLASSIFIED' &&
          policy.allows('EXPANDED_AI_CONTEXT') &&
          accountingAIService &&
          typeof accountingAIService.requestClassification === 'function') {
        try {
          const sug = await accountingAIService.requestClassification(tenantId, documentId, actorId, {
            force: false,
            allowUnreviewed: true,
            expanded_context: true,
            autonomy_mode: MODES.AUTONOMOUS_98,
            context: {
              supplier,
              description,
              operation_type: nature && nature.operation_type,
              fields_summary: {
                amount: fields.amount && fields.amount.value,
                date: fields.document_date && fields.document_date.value,
                tax_id: fields.tax_id && fields.tax_id.value,
                number: fields.number && fields.number.value
              }
            }
          });
          if (sug && (sug.debit_account_id || sug.suggested_debit_account_id) &&
              (sug.credit_account_id || sug.suggested_credit_account_id)) {
            classification = {
              status: 'CLASSIFIED',
              debit_account_id: sug.debit_account_id || sug.suggested_debit_account_id,
              credit_account_id: sug.credit_account_id || sug.suggested_credit_account_id,
              confidence: Number(sug.confidence || 0.8),
              origin: 'AI_EXPANDED',
              reason: sug.reason || sug.explanation || 'IA com contexto ampliado.',
              candidates: sug.candidates || []
            };
            aiSuggestion = {
              operation_type: sug.operation_type || sug.suggested_operation_type || (nature && nature.operation_type),
              confidence: sug.confidence,
              reason: sug.reason || sug.explanation,
              candidates: sug.candidates || []
            };
            pushAttempt('EXPANDED_AI', { ok: true, confidence: classification.confidence });
          } else if (sug && (sug.operation_type || sug.suggested_operation_type)) {
            aiSuggestion = {
              operation_type: sug.operation_type || sug.suggested_operation_type,
              confidence: sug.confidence,
              reason: sug.reason || sug.explanation,
              candidates: sug.candidates || []
            };
            pushAttempt('EXPANDED_AI', {
              ok: false,
              reason: 'IA retornou natureza sem contas válidas do plano.'
            });
          } else {
            pushAttempt('EXPANDED_AI', { ok: false, reason: 'IA sem sugestão utilizável.' });
          }
        } catch (err) {
          pushAttempt('EXPANDED_AI', {
            ok: false,
            reason: err.code || err.message || 'IA indisponível'
          });
        }
      }
    } else if (policy.isAssisted() && classification.status !== 'CLASSIFIED') {
      // Modo 50%: não executa loop avançado — registra que capacidades exclusivas foram omitidas
      pushAttempt('ADVANCED_SKIPPED', {
        ok: false,
        reason: 'Modo ASSISTED_50 — resolução avançada não aplicada.',
        skipped: ['SUPPLIER_PATTERN', 'CHART_AND_CONTEXT', 'EXPANDED_AI']
      });
    }

    // Reconsulta categoria/banco se ainda faltarem
    if (!category && matchCategory) {
      category = matchCategory(
        tenantId, companyId, description, supplier,
        ctx.sourceKind || 'EXPENSE'
      );
    }
    if (!bank && defaultBank) {
      bank = defaultBank(tenantId, companyId);
    }

    // Se classificação base do motor CDS ainda for melhor e vazia
    if (classification.status !== 'CLASSIFIED' && typeof classify === 'function' && ctx.txLike) {
      const cds = classify(tenantId, companyId, ctx.txLike);
      if (cds && cds.status === 'CLASSIFIED' && cds.debit_account_id && cds.credit_account_id) {
        classification = {
          status: 'CLASSIFIED',
          debit_account_id: cds.debit_account_id,
          credit_account_id: cds.credit_account_id,
          confidence: cds.confidence || 0.85,
          origin: cds.origin || 'CDS',
          reason: 'Classificação do Motor CDS'
        };
        pushAttempt('CDS_CLASSIFY', { ok: true });
      }
    }

    const resolvedBy = classification.status === 'CLASSIFIED'
      ? (classification.origin || 'RESOLVED')
      : 'UNRESOLVED';

    // Hard cap de tentativas
    const trimmed = attempts.slice(0, policy.max_resolution_attempts + 2);

    return {
      classification,
      nature,
      category,
      bank,
      aiSuggestion,
      attempts: trimmed,
      autonomy_mode: policy.mode,
      resolved_by: resolvedBy,
      policy
    };
  }

  return { resolve, fuzzyChartAccounts, priorSupplierAccounts };
}

module.exports = { createDecisionEngine };
