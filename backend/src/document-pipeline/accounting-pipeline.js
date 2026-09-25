'use strict';

const { createDocumentInterpretationService } = require('./interpretation-service');
const { computeConfidence } = require('./confidence');
const { normalizeOperationType, kindOf, OPERATION_TYPES } = require('./operation-types');
const { field } = require('./normalized-fields');
const { createDecisionEngine } = require('./decision-engine');
const {
  resolveAutonomyPolicy,
  MODES: AUTONOMY_MODES,
  assertNeverPosts
} = require('../ai-control/autonomy-policy');

function fail(message, code, http, extra) {
  return Object.assign(new Error(message), { code: code || 'PIPELINE_ERROR', http: http || 400 }, extra || {});
}

function centsFromAmount(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function moneyLabel(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

/**
 * Pipeline Audácia:
 * interpret → nature → rules → chart → suggestion → validate → confidence → PENDING
 * Autonomia (50%/98%) controla o trabalho de preparação; NÃO a autoridade.
 * IA NÃO aprova / NÃO posta / NÃO fecha competência.
 */
function createDocumentAccountingPipeline({
  db, id, storage, extractionService, classify, assertPostableAccount,
  validateAccountingSemantics, auditSystem, emitEvent, EVENT_TYPES,
  accountingPeriodService, accountingAIService, aiControlService
}) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const interpretation = createDocumentInterpretationService({
    db, storage, extractionService, auditSystem
  });
  const decisionEngine = createDecisionEngine({
    db,
    classify,
    accountingAIService,
    matchHistory: (tenantId, companyId, supplier) => matchHistory(tenantId, companyId, supplier),
    matchCategory: (tenantId, companyId, description, supplier, kind) =>
      matchCategory(tenantId, companyId, description, supplier, kind),
    defaultBank: (tenantId, companyId) => defaultBank(tenantId, companyId)
  });

  function resolveTenantAutonomy(tenantId) {
    if (aiControlService && typeof aiControlService.getAutonomyPolicy === 'function') {
      return aiControlService.getAutonomyPolicy(tenantId);
    }
    if (aiControlService && typeof aiControlService.getSettings === 'function') {
      const s = aiControlService.getSettings(tenantId);
      return resolveAutonomyPolicy(s && s.autonomy_mode);
    }
    return resolveAutonomyPolicy(AUTONOMY_MODES.ASSISTED_50);
  }

  function audit(tenantId, userId, action, type, entityId, payload) {
    if (auditSystem) auditSystem(tenantId, userId || null, action, type, entityId, payload);
  }

  function getRun(tenantId, documentId) {
    return one(
      `SELECT * FROM document_pipeline_runs WHERE tenant_id=? AND document_id=?`,
      tenantId, documentId
    );
  }

  function publicRun(row) {
    if (!row) return null;
    let fields = null;
    let suggestion = null;
    try { fields = JSON.parse(row.fields_json || 'null'); } catch { fields = null; }
    try { suggestion = JSON.parse(row.suggestion_json || 'null'); } catch { suggestion = null; }
    return {
      id: row.id,
      document_id: row.document_id,
      company_id: row.company_id,
      status: row.status,
      extraction_mode: row.extraction_mode,
      operation_type: row.operation_type,
      confidence: row.confidence != null ? Number(row.confidence) : null,
      confidence_band: row.confidence_band,
      confidence_reason: row.confidence_reason,
      expense_id: row.expense_id,
      entry_id: row.entry_id,
      duplicate_of_document_id: row.duplicate_of_document_id,
      error_code: row.error_code,
      error_message: row.error_message,
      fields,
      suggestion,
      autonomy_mode: suggestion && suggestion.autonomy_mode || null,
      resolution_attempts: suggestion && suggestion.resolution_attempts || null,
      attempt_count: Number(row.attempt_count || 0),
      started_at: row.started_at,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function upsertRun(tenantId, companyId, documentId, userId, patch) {
    let row = getRun(tenantId, documentId);
    const now = new Date().toISOString();
    if (!row) {
      const rid = id();
      run(
        `INSERT INTO document_pipeline_runs(
           id,tenant_id,company_id,document_id,status,requested_by,attempt_count,created_at,updated_at,started_at
         ) VALUES(?,?,?,?,?,?,1,?,?,?)`,
        rid, tenantId, companyId, documentId, patch.status || 'QUEUED', userId || null, now, now, now
      );
      row = getRun(tenantId, documentId);
    }
    const sets = [];
    const params = [];
    const map = {
      status: 'status',
      extraction_mode: 'extraction_mode',
      operation_type: 'operation_type',
      confidence: 'confidence',
      confidence_band: 'confidence_band',
      confidence_reason: 'confidence_reason',
      expense_id: 'expense_id',
      entry_id: 'entry_id',
      duplicate_of_document_id: 'duplicate_of_document_id',
      error_code: 'error_code',
      error_message: 'error_message',
      fields_json: 'fields_json',
      suggestion_json: 'suggestion_json',
      completed_at: 'completed_at'
    };
    for (const [k, col] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        sets.push(`${col}=?`);
        params.push(patch[k]);
      }
    }
    sets.push('updated_at=?');
    params.push(now);
    if (patch.bumpAttempt) {
      sets.push('attempt_count=attempt_count+1');
    }
    params.push(row.id);
    run(`UPDATE document_pipeline_runs SET ${sets.join(',')} WHERE id=?`, ...params);
    return getRun(tenantId, documentId);
  }

  function findDuplicate(tenantId, companyId, document, fields) {
    // Hash exact
    if (document.sha256) {
      const byHash = one(
        `SELECT id,original_name,sha256,created_at FROM documents
         WHERE tenant_id=? AND company_id=? AND sha256=? AND id<>? AND deleted_at IS NULL
         LIMIT 1`,
        tenantId, companyId, document.sha256, document.id
      );
      if (byHash) {
        return { code: 'DUPLICATE_DOCUMENT', match: 'hash', document: byHash };
      }
    }
    const key = fields.document_key && fields.document_key.value;
    if (key) {
      const recent = rows(
        `SELECT d.id,d.original_name,r.fields_json FROM documents d
         JOIN document_pipeline_runs r ON r.document_id=d.id
         WHERE d.tenant_id=? AND d.company_id=? AND d.id<>? AND d.deleted_at IS NULL
         ORDER BY d.created_at DESC LIMIT 50`,
        tenantId, companyId, document.id
      );
      for (const r of recent) {
        try {
          const f = JSON.parse(r.fields_json || '{}');
          if (f.document_key && f.document_key.value === key) {
            return { code: 'DUPLICATE_DOCUMENT', match: 'document_key', document: { id: r.id, original_name: r.original_name } };
          }
        } catch { /* ignore */ }
      }
    }

    const number = fields.number && fields.number.value;
    const taxId = fields.tax_id && fields.tax_id.value;
    const amount = fields.amount && fields.amount.value;
    const date = fields.document_date && fields.document_date.value;
    if (number && taxId && amount && date) {
      const candidates = rows(
        `SELECT d.id,d.original_name,r.fields_json FROM documents d
         JOIN document_pipeline_runs r ON r.document_id=d.id
         WHERE d.tenant_id=? AND d.company_id=? AND d.id<>? AND d.deleted_at IS NULL
           AND r.status IN('PENDING','COMPLETED','NEEDS_CLASSIFICATION')
         ORDER BY d.created_at DESC LIMIT 80`,
        tenantId, companyId, document.id
      );
      for (const r of candidates) {
        try {
          const f = JSON.parse(r.fields_json || '{}');
          if (f.number && f.number.value === number &&
              f.tax_id && f.tax_id.value === taxId &&
              f.amount && String(f.amount.value) === String(amount) &&
              f.document_date && f.document_date.value === date) {
            return {
              code: 'DUPLICATE_DOCUMENT',
              match: 'number+tax+amount+date',
              document: { id: r.id, original_name: r.original_name }
            };
          }
        } catch { /* ignore */ }
      }
    }
    return null;
  }

  function matchHistory(tenantId, companyId, supplier) {
    if (!supplier) return null;
    const hay = String(supplier).toLowerCase();
    const rowsH = rows(
      `SELECT * FROM document_learning_decisions
       WHERE tenant_id=? AND company_id=? AND decision IN('ACCEPTED','OVERRIDDEN')
       ORDER BY created_at DESC LIMIT 40`,
      tenantId, companyId
    );
    for (const h of rowsH) {
      // Soft match via reason/operation stored; prefer supplier in reason if present
      if (h.selected_account_debit && h.selected_account_credit) {
        if (h.reason && String(h.reason).toLowerCase().includes(hay.slice(0, 8))) return h;
      }
    }
    // Match accounting rules by description containing supplier
    const rules = rows(
      `SELECT * FROM accounting_rules
       WHERE tenant_id=? AND active=1 AND (company_id IS NULL OR company_id=?)
       ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END, priority ASC`,
      tenantId, companyId
    );
    for (const r of rules) {
      let cond = {};
      try { cond = JSON.parse(r.conditions_json || '{}'); } catch { cond = {}; }
      const desc = String(cond.description || '').toLowerCase();
      if (desc && hay.includes(desc)) return { rule: r, from: 'rule' };
      if (desc && desc.includes(hay.slice(0, Math.min(12, hay.length)))) return { rule: r, from: 'rule' };
    }
    return null;
  }

  function matchCategory(tenantId, companyId, description, supplier, kind) {
    const hay = `${description || ''} ${supplier || ''}`.toLowerCase();
    if (!hay.trim()) return null;
    const kinds = kind === 'REVENUE' ? ['REVENUE', 'BOTH'] : ['EXPENSE', 'BOTH'];
    const cats = rows(
      `SELECT id,name,account_id FROM categories
       WHERE tenant_id=? AND active=1 AND (company_id IS NULL OR company_id=?)
         AND kind IN (${kinds.map(() => '?').join(',')})
       ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END, name`,
      tenantId, companyId, ...kinds
    );
    for (const cat of cats) {
      const name = String(cat.name || '').toLowerCase();
      if (name.length >= 3 && (hay.includes(name) || name.split(/\s+/).some(t => t.length >= 4 && hay.includes(t)))) {
        return cat;
      }
    }
    return null;
  }

  function defaultBank(tenantId, companyId) {
    return one(
      `SELECT id,account_id,name FROM banks
       WHERE tenant_id=? AND active=1 AND (company_id IS NULL OR company_id=?)
         AND account_id IS NOT NULL
       ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END, name LIMIT 1`,
      tenantId, companyId
    );
  }

  function classifyNature(fields, ruleHit, aiSuggestion) {
    if (ruleHit && ruleHit.rule) {
      // Nature from expense path
      return {
        operation_type: fields.operation_type.value || OPERATION_TYPES.DESPESA,
        confidence: 0.97,
        reason: `Regra contábil "${ruleHit.rule.name}" correspondente.`,
        candidates: [],
        source: 'rule'
      };
    }
    if (fields.operation_type && fields.operation_type.source === 'xml' && fields.operation_type.value) {
      return {
        operation_type: fields.operation_type.value,
        confidence: Number(fields.operation_type.confidence || 0.9),
        reason: 'Natureza inferida a partir do XML fiscal estruturado.',
        candidates: [],
        source: 'xml'
      };
    }
    if (aiSuggestion && aiSuggestion.operation_type) {
      const op = normalizeOperationType(aiSuggestion.operation_type) || OPERATION_TYPES.OUTROS;
      return {
        operation_type: op,
        confidence: Number(aiSuggestion.confidence || 0.7),
        reason: aiSuggestion.reason || 'Sugestão da IA.',
        candidates: aiSuggestion.candidates || [],
        source: 'ai'
      };
    }
    const op = normalizeOperationType(fields.operation_type && fields.operation_type.value) || OPERATION_TYPES.DESPESA;
    return {
      operation_type: op,
      confidence: Number(fields.operation_type && fields.operation_type.confidence || 0.55),
      reason: 'Natureza estimada a partir dos dados do documento.',
      candidates: [],
      source: 'heuristic'
    };
  }

  function buildSuggestion({ fields, nature, classification, category, bank }) {
    const amountCents = centsFromAmount(fields.amount && fields.amount.value);
    const occurredOn = fields.document_date && fields.document_date.value;
    const competence = (fields.competence && fields.competence.value) ||
      (occurredOn ? String(occurredOn).slice(0, 7) : null);
    const supplier = fields.supplier_name && fields.supplier_name.value;
    const description = (fields.description && fields.description.value) ||
      (supplier ? `Documento — ${supplier}` : 'Documento fiscal');
    const history = supplier
      ? `Despesa com ${supplier} referente à competência ${competence || occurredOn || ''}.`
      : `Lançamento referente à competência ${competence || occurredOn || ''}.`;

    const debit = classification && classification.debit_account_id;
    const credit = classification && classification.credit_account_id;
    return {
      occurred_on: occurredOn,
      competence,
      description,
      amount_cents: amountCents,
      amount_label: amountCents != null ? moneyLabel(amountCents) : null,
      payment_method: (fields.payment_method && fields.payment_method.value) || 'OUTRO',
      operation_type: nature.operation_type,
      debit_account_id: debit || null,
      credit_account_id: credit || null,
      category_id: category && category.id || null,
      bank_id: bank && bank.id || null,
      history,
      cost_center: null,
      classification_status: classification && classification.status || null,
      classification_confidence: classification && classification.confidence || null,
      classification_origin: classification && classification.origin || null
    };
  }

  function validateSuggestion(tenantId, suggestion, nature) {
    const issues = [];
    if (!suggestion.occurred_on) issues.push({ code: 'MISSING_DATE', message: 'Data do documento ausente.' });
    if (!suggestion.amount_cents || suggestion.amount_cents <= 0) {
      issues.push({ code: 'MISSING_AMOUNT', message: 'Valor inválido ou ausente.' });
    }
    if (!suggestion.debit_account_id || !suggestion.credit_account_id) {
      issues.push({ code: 'MISSING_ACCOUNTS', message: 'Contas de débito/crédito não definidas.' });
    }
    if (suggestion.debit_account_id && suggestion.credit_account_id &&
        suggestion.debit_account_id === suggestion.credit_account_id) {
      issues.push({ code: 'SAME_ACCOUNTS', message: 'Débito e crédito não podem ser a mesma conta.' });
    }

    let debitAcc = null;
    let creditAcc = null;
    try {
      if (suggestion.debit_account_id) debitAcc = assertPostableAccount(tenantId, suggestion.debit_account_id);
    } catch (e) {
      issues.push({ code: 'ACCOUNT_NOT_POSTABLE', message: e.message || 'Conta de débito inválida.' });
    }
    try {
      if (suggestion.credit_account_id) creditAcc = assertPostableAccount(tenantId, suggestion.credit_account_id);
    } catch (e) {
      issues.push({ code: 'ACCOUNT_NOT_POSTABLE', message: e.message || 'Conta de crédito inválida.' });
    }

    if (suggestion.debit_account_id && suggestion.credit_account_id && suggestion.amount_cents) {
      const lines = [
        { account_id: suggestion.debit_account_id, side: 'D', amount_cents: suggestion.amount_cents },
        { account_id: suggestion.credit_account_id, side: 'C', amount_cents: suggestion.amount_cents }
      ];
      try {
        validateAccountingSemantics({
          sourceType: kindOf(nature.operation_type),
          lines
        });
      } catch (e) {
        issues.push({ code: e.code || 'SEMANTICS_FAILED', message: e.message });
      }
      const sumD = lines.filter(l => l.side === 'D').reduce((a, l) => a + l.amount_cents, 0);
      const sumC = lines.filter(l => l.side === 'C').reduce((a, l) => a + l.amount_cents, 0);
      if (sumD !== sumC) {
        issues.push({ code: 'UNBALANCED_ENTRY', message: 'Débito diferente de crédito.' });
      }
    }

    if (accountingPeriodService && suggestion.occurred_on) {
      // Only warn/block if closed — pipeline shouldn't create into closed period
      try {
        // company checked later
      } catch { /* ignore */ }
    }

    return {
      ok: issues.length === 0,
      issues,
      debitAcc,
      creditAcc,
      code: issues.length ? 'ENTRY_VALIDATION_FAILED' : 'OK'
    };
  }

  function createPendingEntry(tenantId, userId, companyId, documentId, fields, suggestion, nature) {
    // Period guard
    if (accountingPeriodService) {
      accountingPeriodService.assertWritable(tenantId, companyId, suggestion.occurred_on);
    }

    const actorId = userId
      || (one(`SELECT uploaded_by FROM documents WHERE tenant_id=? AND id=?`, tenantId, documentId) || {}).uploaded_by
      || null;
    if (!actorId) {
      throw fail('Usuário responsável pelo lançamento não identificado.', 'ACTOR_REQUIRED', 422);
    }

    const existingExpense = one(
      `SELECT id FROM expenses WHERE tenant_id=? AND document_id=? LIMIT 1`,
      tenantId, documentId
    );
    if (existingExpense) {
      const existingEntry = one(
        `SELECT * FROM entries WHERE tenant_id=? AND source_type='EXPENSE' AND source_id=? ORDER BY created_at DESC LIMIT 1`,
        tenantId, existingExpense.id
      );
      if (existingEntry) {
        return { expense_id: existingExpense.id, entry_id: existingEntry.id, reused: true };
      }
    }

    const xid = id();
    const eid = id();
    const sourceType = kindOf(nature.operation_type);
    const table = sourceType === 'REVENUE' ? 'revenues' : 'expenses';
    const method = suggestion.payment_method || 'OUTRO';
    const notes = fields.document_key && fields.document_key.value
      ? `Chave: ${fields.document_key.value}`
      : null;

    db.transaction(() => {
      if (table === 'expenses') {
        run(
          `INSERT INTO expenses(
             id,tenant_id,company_id,occurred_on,description,amount_cents,payment_method,
             bank_id,category_id,document_id,notes,supplier_name,created_by,origin,status
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          xid, tenantId, companyId, suggestion.occurred_on, suggestion.description,
          suggestion.amount_cents, method, suggestion.bank_id || null, suggestion.category_id || null,
          documentId, notes, fields.supplier_name && fields.supplier_name.value || null,
          actorId, 'PORTAL_CLIENTE', 'PENDING'
        );
      } else {
        run(
          `INSERT INTO revenues(
             id,tenant_id,company_id,occurred_on,description,amount_cents,receipt_method,
             bank_id,category_id,document_id,notes,created_by,origin,status
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          xid, tenantId, companyId, suggestion.occurred_on, suggestion.description,
          suggestion.amount_cents, method, suggestion.bank_id || null, suggestion.category_id || null,
          documentId, notes, actorId, 'PORTAL_CLIENTE', 'PENDING'
        );
      }
      run(`UPDATE documents SET status='ACTIVE' WHERE id=? AND tenant_id=? AND company_id=?`,
        documentId, tenantId, companyId);

      run(
        `INSERT INTO entries(
           id,tenant_id,company_id,source_type,source_id,occurred_on,description,status,confidence,generated_by
         ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        eid, tenantId, companyId, sourceType === 'REVENUE' ? 'REVENUE' : 'EXPENSE',
        xid, suggestion.occurred_on, suggestion.description, 'PENDING',
        suggestion.classification_confidence || 0.9, actorId
      );
      run(
        `INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents,memo) VALUES(?,?,?,?,?,?)`,
        id(), eid, suggestion.debit_account_id, 'D', suggestion.amount_cents, suggestion.history
      );
      run(
        `INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents,memo) VALUES(?,?,?,?,?,?)`,
        id(), eid, suggestion.credit_account_id, 'C', suggestion.amount_cents, suggestion.history
      );
      run(
        `INSERT INTO classification_runs(
           id,tenant_id,company_id,source_type,source_id,entry_id,status,
           chosen_debit_account_id,chosen_credit_account_id,origin,score,reasons_json,candidates_json,decided_by,note
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id(), tenantId, companyId, sourceType === 'REVENUE' ? 'REVENUE' : 'EXPENSE', xid, eid,
        'CLASSIFIED', suggestion.debit_account_id, suggestion.credit_account_id,
        nature.source || 'PIPELINE', Math.round((suggestion.classification_confidence || 0.9) * 100),
        JSON.stringify([nature.reason || 'Pipeline Audácia']),
        JSON.stringify(nature.candidates || []),
        actorId, 'Pipeline automático Audácia'
      );
    })();

    return { expense_id: xid, entry_id: eid, reused: false, source_type: sourceType };
  }

  async function processDocument(tenantId, documentId, userId, { force = false } = {}) {
    const document = one(
      `SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      tenantId, documentId
    );
    if (!document) throw fail('Documento não encontrado.', 'DOCUMENT_NOT_FOUND', 404);

    const actorId = userId || document.uploaded_by || null;

    const existing = getRun(tenantId, documentId);
    if (existing && !force && ['PENDING', 'COMPLETED'].includes(existing.status) && existing.entry_id) {
      return publicRun(existing);
    }

    upsertRun(tenantId, document.company_id, documentId, actorId, {
      status: 'PROCESSING',
      bumpAttempt: true,
      error_code: null,
      error_message: null
    });
    audit(tenantId, actorId, 'DOCUMENT_RECEIVED', 'DOCUMENT', documentId, {
      company_id: document.company_id, pipeline: true
    });

    try {
      upsertRun(tenantId, document.company_id, documentId, actorId, { status: 'EXTRACTING' });
      const interpreted = await interpretation.interpret(tenantId, documentId, actorId, { force });
      const fields = interpreted.fields;

      const dup = findDuplicate(tenantId, document.company_id, document, fields);
      if (dup) {
        const row = upsertRun(tenantId, document.company_id, documentId, actorId, {
          status: 'DUPLICATE',
          duplicate_of_document_id: dup.document.id,
          fields_json: JSON.stringify(fields),
          extraction_mode: interpreted.extraction_mode,
          error_code: 'DUPLICATE_DOCUMENT',
          error_message: 'Documento duplicado detectado. Não foi gerado novo lançamento.',
          completed_at: new Date().toISOString()
        });
        audit(tenantId, actorId, 'DOCUMENT_EXTRACTED', 'DOCUMENT', documentId, {
          duplicate_of: dup.document.id, match: dup.match
        });
        return publicRun(row);
      }

      upsertRun(tenantId, document.company_id, documentId, actorId, {
        status: 'CLASSIFYING',
        fields_json: JSON.stringify(fields),
        extraction_mode: interpreted.extraction_mode
      });

      const autonomy = resolveTenantAutonomy(tenantId);
      audit(tenantId, actorId, 'AI_AUTONOMY_MODE', 'DOCUMENT', documentId, {
        autonomy_mode: autonomy.mode,
        autonomy_percent: autonomy.percent,
        may_approve: autonomy.mayApprove(),
        may_post: autonomy.mayPost()
      });

      const supplier = fields.supplier_name && fields.supplier_name.value;
      const description = fields.description && fields.description.value;

      // Passo assistido base: classificação CDS + regra/histórico + IA leve se necessário
      let ruleHit = matchHistory(tenantId, document.company_id, supplier);
      let historyHit = ruleHit && !ruleHit.rule ? ruleHit : null;
      if (ruleHit && ruleHit.rule) historyHit = null;
      if (!ruleHit || !ruleHit.rule) {
        const again = matchHistory(tenantId, document.company_id, supplier);
        if (again && again.rule) ruleHit = again;
        else if (again && !historyHit) historyHit = again;
      }

      let aiSuggestion = null;
      if ((!ruleHit || !ruleHit.rule) && autonomy.allows('CLASSIFY_OPERATION')) {
        if (accountingAIService && typeof accountingAIService.requestClassification === 'function') {
          try {
            const sug = await accountingAIService.requestClassification(tenantId, documentId, actorId, {
              force: false, allowUnreviewed: true
            });
            if (sug && (sug.operation_type || sug.suggested_operation_type)) {
              aiSuggestion = {
                operation_type: sug.operation_type || sug.suggested_operation_type,
                confidence: sug.confidence,
                reason: sug.reason || sug.explanation,
                candidates: sug.candidates || []
              };
            }
          } catch {
            // IA indisponível — continua com heurística/regras
          }
        }
      }

      let nature = classifyNature(fields, ruleHit, aiSuggestion);
      audit(tenantId, actorId, 'DOCUMENT_CLASSIFIED', 'DOCUMENT', documentId, {
        operation_type: nature.operation_type,
        source: nature.source,
        confidence: nature.confidence,
        autonomy_mode: autonomy.mode
      });

      const sourceKind = kindOf(nature.operation_type);
      let category = matchCategory(tenantId, document.company_id, description, supplier, sourceKind);
      let bank = defaultBank(tenantId, document.company_id);

      const txLike = {
        description: description || supplier || 'Documento',
        payment_method: (fields.payment_method && fields.payment_method.value) || 'OUTRO',
        receipt_method: (fields.payment_method && fields.payment_method.value) || 'OUTRO',
        category_id: category && category.id || null,
        bank_id: bank && bank.id || null,
        source_type: sourceKind,
        amount_cents: centsFromAmount(fields.amount && fields.amount.value)
      };

      let classification = classify(tenantId, document.company_id, txLike);

      // DecisionEngine: 50% = preparação; 98% = tentativas extras de resolução
      const decided = await decisionEngine.resolve({
        tenantId,
        companyId: document.company_id,
        documentId,
        userId: actorId,
        fields,
        nature,
        classification,
        category,
        bank,
        aiSuggestion,
        txLike,
        sourceKind,
        autonomy_mode: autonomy.mode
      });
      classification = decided.classification;
      category = decided.category || category;
      bank = decided.bank || bank;
      if (decided.aiSuggestion) aiSuggestion = decided.aiSuggestion;
      if (decided.nature) nature = decided.nature;

      audit(tenantId, actorId, 'AI_DECISION_ENGINE', 'DOCUMENT', documentId, {
        autonomy_mode: decided.autonomy_mode,
        resolved_by: decided.resolved_by,
        attempts: (decided.attempts || []).map(a => ({
          attempt: a.attempt, name: a.name, ok: a.ok
        })),
        classification_status: classification && classification.status,
        approved_by_ai: false,
        posted_by_ai: false
      });

      upsertRun(tenantId, document.company_id, documentId, actorId, { status: 'SUGGESTING' });
      const suggestion = buildSuggestion({ fields, nature, classification, category, bank });
      suggestion.autonomy_mode = autonomy.mode;
      suggestion.autonomy_percent = autonomy.percent;
      suggestion.resolution_attempts = decided.attempts || [];
      suggestion.resolved_by = decided.resolved_by;

      audit(tenantId, actorId, 'ACCOUNTING_SUGGESTION_CREATED', 'DOCUMENT', documentId, {
        operation_type: nature.operation_type,
        debit_account_id: suggestion.debit_account_id,
        credit_account_id: suggestion.credit_account_id,
        amount_cents: suggestion.amount_cents,
        autonomy_mode: autonomy.mode
      });

      upsertRun(tenantId, document.company_id, documentId, actorId, { status: 'VALIDATING' });
      const validation = validateSuggestion(tenantId, suggestion, nature);
      assertNeverPosts(autonomy, 'PENDING');
      audit(tenantId, actorId, 'ACCOUNTING_VALIDATION_COMPLETED', 'DOCUMENT', documentId, {
        ok: validation.ok, issues: validation.issues, autonomy_mode: autonomy.mode
      });

      const conf = computeConfidence({
        fields,
        ruleMatched: !!(ruleHit && ruleHit.rule) || classification.origin === 'RULE',
        historyMatched: classification.origin === 'HISTORY',
        accountsFound: !!(suggestion.debit_account_id && suggestion.credit_account_id),
        balanced: validation.ok,
        operationConsistent: !!nature.operation_type,
        documentQuality: interpreted.extraction_mode === 'XML_STRUCTURED' ||
          interpreted.extraction_mode === 'TEXT_EXTRACTION_AVAILABLE' ? 'high' : 'medium',
        aiOnly: nature.source === 'ai'
      });

      suggestion.confidence = conf.score;
      suggestion.confidence_band = conf.band;
      suggestion.confidence_reason = conf.reason;
      suggestion.nature = nature;
      suggestion.validation = { ok: validation.ok, issues: validation.issues };

      if (!validation.ok || classification.status !== 'CLASSIFIED') {
        const row = upsertRun(tenantId, document.company_id, documentId, actorId, {
          status: 'NEEDS_CLASSIFICATION',
          operation_type: nature.operation_type,
          confidence: conf.score,
          confidence_band: conf.band,
          confidence_reason: conf.reason,
          fields_json: JSON.stringify(fields),
          suggestion_json: JSON.stringify(suggestion),
          extraction_mode: interpreted.extraction_mode,
          error_code: validation.ok ? 'CLASSIFICATION_PENDING' : 'ENTRY_VALIDATION_FAILED',
          error_message: validation.ok
            ? 'Classificação incompleta — contas não encontradas no plano.'
            : 'Lançamento inválido — ' + (validation.issues[0] && validation.issues[0].message),
          completed_at: new Date().toISOString()
        });
        if (emitEvent && EVENT_TYPES) {
          emitEvent({
            tenantId,
            companyId: document.company_id,
            eventType: EVENT_TYPES.CLASSIFICATION_REQUIRED,
            actorUserId: actorId,
            entityType: 'document',
            entityId: documentId,
            payload: { description: suggestion.description, note: 'Pipeline Audácia' }
          });
        }
        audit(tenantId, actorId, 'CLASSIFICATION_PENDING', 'DOCUMENT', documentId, {
          confidence: conf.score, band: conf.band
        });
        return publicRun(row);
      }

      const created = createPendingEntry(
        tenantId, actorId, document.company_id, documentId, fields, suggestion, nature
      );
      audit(tenantId, actorId, 'ACCOUNTING_ENTRY_CREATED', 'ENTRY', created.entry_id, {
        document_id: documentId, expense_id: created.expense_id, status: 'PENDING'
      });
      audit(tenantId, actorId, 'AI_DECISION', 'DOCUMENT', documentId, {
        operation_type: nature.operation_type,
        confidence: conf.score,
        source: nature.source,
        autonomy_mode: autonomy.mode,
        approved_by_ai: false,
        posted_by_ai: false
      });

      // Fronteira obrigatória: PENDING — autonomia nunca produz POSTED
      assertNeverPosts(autonomy, 'PENDING');
      if (created && created.entry_id) {
        const postedCheck = one('SELECT status FROM entries WHERE id=? AND tenant_id=?', created.entry_id, tenantId);
        if (postedCheck && postedCheck.status === 'POSTED') {
          throw fail('IA não pode produzir POSTED.', 'AI_POST_FORBIDDEN', 500);
        }
      }

      const row = upsertRun(tenantId, document.company_id, documentId, actorId, {
        status: 'PENDING',
        operation_type: nature.operation_type,
        confidence: conf.score,
        confidence_band: conf.band,
        confidence_reason: conf.reason,
        fields_json: JSON.stringify(fields),
        suggestion_json: JSON.stringify(suggestion),
        extraction_mode: interpreted.extraction_mode,
        expense_id: created.expense_id,
        entry_id: created.entry_id,
        error_code: null,
        error_message: null,
        completed_at: new Date().toISOString()
      });

      if (emitEvent && EVENT_TYPES) {
        emitEvent({
          tenantId,
          companyId: document.company_id,
          eventType: EVENT_TYPES.ENTRY_CREATED,
          actorUserId: actorId,
          entityType: 'entry',
          entityId: created.entry_id,
          payload: {
            description: suggestion.description,
            amount_cents: suggestion.amount_cents,
            note: 'Novo lançamento aguardando aprovação.',
            status: 'PENDING'
          }
        });
        if (EVENT_TYPES.APPROVAL_REQUIRED) {
          emitEvent({
            tenantId,
            companyId: document.company_id,
            eventType: EVENT_TYPES.APPROVAL_REQUIRED,
            actorUserId: actorId,
            entityType: 'entry',
            entityId: created.entry_id,
            payload: {
              description: suggestion.description,
              note: 'Novo lançamento aguardando aprovação.'
            }
          });
        }
      }

      return publicRun(row);
    } catch (err) {
      const row = upsertRun(tenantId, document.company_id, documentId, actorId, {
        status: 'FAILED',
        error_code: err.code || 'PIPELINE_FAILED',
        error_message: err.message || 'Falha no processamento automático.',
        completed_at: new Date().toISOString()
      });
      return publicRun(row);
    }
  }

  function enqueue(tenantId, documentId, userId, opts) {
    const document = one(
      `SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      tenantId, documentId
    );
    if (!document) return null;
    upsertRun(tenantId, document.company_id, documentId, userId, { status: 'QUEUED' });
    setImmediate(() => {
      processDocument(tenantId, documentId, userId, opts || {}).catch(() => {});
    });
    return publicRun(getRun(tenantId, documentId));
  }

  function recordLearningDecision(tenantId, userId, input) {
    const lid = id();
    run(
      `INSERT INTO document_learning_decisions(
         id,tenant_id,company_id,document_id,entry_id,
         suggested_account_debit,suggested_account_credit,
         selected_account_debit,selected_account_credit,
         suggested_operation_type,selected_operation_type,
         decision,reason,user_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      lid, tenantId, input.company_id, input.document_id || null, input.entry_id || null,
      input.suggested_account_debit || null, input.suggested_account_credit || null,
      input.selected_account_debit || null, input.selected_account_credit || null,
      input.suggested_operation_type || null, input.selected_operation_type || null,
      input.decision, input.reason || null, userId || null
    );
    return one('SELECT * FROM document_learning_decisions WHERE id=?', lid);
  }

  return {
    interpret: interpretation.interpret,
    processDocument,
    enqueue,
    getRun: (tenantId, documentId) => publicRun(getRun(tenantId, documentId)),
    recordLearningDecision,
    findDuplicate,
    computeConfidence,
    interpretation
  };
}

module.exports = { createDocumentAccountingPipeline };
