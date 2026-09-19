'use strict';

const FIELD_KEYS = Object.freeze([
  'supplier_name',
  'occurred_on',
  'description',
  'amount',
  'category_id',
  'payment_method'
]);

const ORIGINS = Object.freeze({
  EXTRACTION_ENGINE: 'EXTRACTION_ENGINE',
  CLASSIFICATION_ENGINE: 'CLASSIFICATION_ENGINE',
  AI: 'AI',
  AI_VISUAL: 'AI_VISUAL',
  MANUAL: 'MANUAL'
});

function createSmartExpenseService({
  db, id, auditSystem, extractionService, accountingAIService, classify, config, aiControl
}) {
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

  function aiEnabled(tenantId) {
    if (aiControl) return !!aiControl.availability(tenantId).available;
    const row = one('SELECT enabled FROM tenant_ai_settings WHERE tenant_id=?', tenantId);
    if (row) return Number(row.enabled) === 1;
    return !!(config && config.AI_ENABLED && config.AI_PROVIDER === 'openai');
  }

  function aiGate(tenantId) {
    if (aiControl) return aiControl.availability(tenantId);
    return { available: aiEnabled(tenantId), reason: aiEnabled(tenantId) ? null : 'AI_DISABLED' };
  }

  function emptyFields() {
    const out = {};
    for (const key of FIELD_KEYS) {
      out[key] = {
        value: null,
        confidence: 0,
        origin: ORIGINS.MANUAL,
        needs_review: false,
        status: 'empty'
      };
    }
    return out;
  }

  function fieldState(value, confidence, origin) {
    let conf = Number(confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) conf = 0;
    const hasValue = value != null && String(value).trim() !== '';
    let status = 'empty';
    let needsReview = false;
    if (hasValue) {
      if (conf >= 0.85) status = 'identified';
      else if (conf >= 0.55) { status = 'confirm'; needsReview = true; }
      else { status = 'confirm'; needsReview = true; }
    }
    return {
      value: hasValue ? value : null,
      confidence: conf,
      origin: origin || ORIGINS.MANUAL,
      needs_review: needsReview,
      status
    };
  }

  function analysisRow(tenantId, documentId) {
    return one(
      `SELECT a.*,d.original_name,d.mime_type,d.size_bytes,c.name company_name,
              c.trade_name company_trade_name,cat.name suggested_category_name
       FROM expense_document_analyses a
       JOIN documents d ON d.id=a.document_id
       JOIN companies c ON c.id=a.company_id
       LEFT JOIN categories cat ON cat.id=a.suggested_category_id
       WHERE a.tenant_id=? AND a.document_id=? AND d.deleted_at IS NULL`,
      tenantId, documentId
    );
  }

  function publicAnalysis(row) {
    if (!row) return null;
    let fields = emptyFields();
    try {
      const parsed = JSON.parse(row.fields_json || '{}');
      fields = { ...fields, ...parsed };
    } catch { /* keep defaults */ }
    const visualUsed = Object.values(fields).some(f => f && f.origin === ORIGINS.AI_VISUAL);
    const aiUsed = row.classification_source === 'AI';
    const cdsUsed = row.classification_source === 'CLASSIFICATION_ENGINE';
    const aiSoftFail = !aiUsed && !visualUsed && row.error_code &&
      /^(AI_|EXTRACTION_|DOCUMENT_VISUAL_)/.test(String(row.error_code));
    let banner = 'Preenchido automaticamente';
    if (visualUsed && (aiUsed || cdsUsed)) banner = 'Documento analisado automaticamente';
    else if (visualUsed || aiUsed) banner = 'Analisado pela IA';
    else if (cdsUsed) banner = 'Classificação sugerida pelo CDS';
    else if (row.status === 'FAILED' || aiSoftFail) {
      banner = 'Não foi possível interpretar automaticamente este documento. Revise os dados manualmente.';
    }
    return {
      id: row.id,
      document_id: row.document_id,
      company_id: row.company_id,
      company_name: row.company_trade_name || row.company_name || null,
      document_name: row.original_name || null,
      mime_type: row.mime_type || null,
      size_bytes: row.size_bytes || 0,
      status: row.status,
      banner,
      analysis_label: visualUsed || aiUsed
        ? 'Analisado pela IA'
        : (cdsUsed ? 'Classificação sugerida pelo CDS' : 'Documento analisado'),
      classification_source: row.classification_source,
      classification_status: row.classification_status || null,
      classification_confidence: Number(row.classification_confidence || 0),
      classification_reason: row.classification_reason || null,
      suggested_category: row.suggested_category_id ? {
        id: row.suggested_category_id,
        name: row.suggested_category_name || null
      } : null,
      suggested_bank_id: row.suggested_bank_id || null,
      ai_enabled: aiEnabled(row.tenant_id),
      ai_used: aiUsed,
      visual_ai_used: visualUsed,
      error_code: row.error_code || null,
      expense_id: row.expense_id || null,
      attempt_count: Number(row.attempt_count || 1),
      fields,
      requested_at: row.requested_at,
      completed_at: row.completed_at || null
    };
  }

  function getAnalysis(tenantId, documentId) {
    return publicAnalysis(analysisRow(tenantId, documentId));
  }

  function mapExtractionFields(extraction) {
    const fields = emptyFields();
    if (!extraction || !extraction.fields) return fields;
    const visual = String(extraction.extraction_method || '') === 'AI_VISUAL';
    const origin = visual ? ORIGINS.AI_VISUAL : ORIGINS.EXTRACTION_ENGINE;
    const map = {
      supplier_name: 'supplier_name',
      occurred_on: 'issue_date',
      description: 'description',
      amount: 'total_amount',
      payment_method: 'payment_method'
    };
    for (const [target, source] of Object.entries(map)) {
      const f = extraction.fields[source];
      if (!f || f.value == null || String(f.value).trim() === '') continue;
      let value = f.value;
      if (target === 'payment_method') {
        const raw = String(value).toUpperCase();
        if (raw.includes('PIX')) value = 'PIX';
        else if (raw.includes('DINHEIRO') || raw.includes('CASH')) value = 'DINHEIRO';
        else if (raw.includes('DEBIT')) value = 'DEBITO';
        else if (raw.includes('CREDIT')) value = 'CREDITO';
        else if (raw.includes('BOLETO')) value = 'BOLETO';
        else if (raw.includes('TRANSFER')) value = 'TRANSFERENCIA';
        else value = 'OUTRO';
      }
      fields[target] = fieldState(value, f.confidence, origin);
    }
    if (!fields.description.value && fields.supplier_name.value) {
      fields.description = fieldState(
        fields.supplier_name.value, fields.supplier_name.confidence, origin
      );
    }
    return fields;
  }

  function matchCategory(tenantId, companyId, description, supplier) {
    const hay = `${description || ''} ${supplier || ''}`.toLowerCase();
    if (!hay.trim()) return null;
    const cats = rows(
      `SELECT id,name FROM categories
       WHERE tenant_id=? AND active=1 AND (company_id IS NULL OR company_id=?)
         AND kind IN('EXPENSE','BOTH')
       ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END, name`,
      tenantId, companyId
    );
    let best = null;
    for (const cat of cats) {
      const name = String(cat.name || '').toLowerCase();
      if (name.length < 3) continue;
      if (hay.includes(name) || name.split(/\s+/).some(t => t.length >= 4 && hay.includes(t))) {
        best = cat;
        break;
      }
    }
    return best;
  }

  function waitForExtraction(tenantId, documentId, timeoutMs = 8000) {
    return new Promise(resolve => {
      const started = Date.now();
      const tick = () => {
        const extraction = extractionService.get(tenantId, documentId);
        if (!extraction) return resolve(null);
        if (!['PENDING', 'PROCESSING'].includes(extraction.status)) return resolve(extraction);
        if (Date.now() - started >= timeoutMs) return resolve(extraction);
        setTimeout(tick, 40);
      };
      tick();
    });
  }

  async function runPipeline(tenantId, documentId, userId, analysisId, force) {
    const document = one(
      `SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      tenantId, documentId
    );
    if (!document) return;

    audit(tenantId, userId, force ? 'DOCUMENT_REANALYZED' : 'DOCUMENT_ANALYSIS_STARTED',
      'EXPENSE_ANALYSIS', analysisId, {
        document_id: documentId, company_id: document.company_id, force: !!force
      });

    let extraction;
    try {
      extractionService.request(tenantId, documentId, userId, { force: !!force });
      extraction = await waitForExtraction(tenantId, documentId);
    } catch (error) {
      run(
        `UPDATE expense_document_analyses SET status='FAILED',error_code=?,
         completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        error.code || 'DOCUMENT_ANALYSIS_FAILED', analysisId
      );
      audit(tenantId, userId, 'DOCUMENT_ANALYSIS_FAILED', 'EXPENSE_ANALYSIS', analysisId, {
        document_id: documentId, company_id: document.company_id,
        error_code: error.code || 'DOCUMENT_ANALYSIS_FAILED'
      });
      return;
    }

    const fields = mapExtractionFields(extraction);
    let classificationSource = 'NONE';
    let classificationStatus = null;
    let classificationConfidence = 0;
    let classificationReason = null;
    let suggestedCategoryId = null;
    let suggestedBankId = null;
    let aiSuggestionId = null;
    let status = 'PARTIAL';
    let errorCode = null;

    if (!extraction || extraction.status === 'FAILED') {
      status = 'PARTIAL';
      errorCode = extraction && extraction.error_code || 'EXTRACTION_FAILED';
    } else {
      const description = fields.description.value || fields.supplier_name.value || '';
      const payment = fields.payment_method.value || 'OUTRO';
      const matched = matchCategory(
        tenantId, document.company_id, description, fields.supplier_name.value
      );
      if (matched) {
        fields.category_id = fieldState(matched.id, 0.8, ORIGINS.CLASSIFICATION_ENGINE);
        suggestedCategoryId = matched.id;
      }

      const cls = classify(tenantId, document.company_id, {
        source_type: 'EXPENSE',
        description,
        payment_method: payment,
        category_id: fields.category_id.value || null,
        bank_id: null
      });

      if (cls && cls.status === 'CLASSIFIED') {
        classificationSource = 'CLASSIFICATION_ENGINE';
        classificationStatus = 'CLASSIFIED';
        classificationConfidence = Number(cls.confidence || 0);
        classificationReason = cls.reason || null;
        audit(tenantId, userId, 'CLASSIFICATION_ENGINE_USED', 'EXPENSE_ANALYSIS', analysisId, {
          document_id: documentId, company_id: document.company_id,
          score: cls.score || null, origin: cls.origin || null
        });
      } else if (aiGate(tenantId).available && accountingAIService &&
                 accountingAIService.providerInfo().configured) {
        try {
          const ai = await accountingAIService.requestClassification(
            tenantId, documentId, userId, { force: true, allowUnreviewed: true }
          );
          const suggestion = ai && ai.suggestion;
          if (suggestion && suggestion.status === 'COMPLETED') {
            classificationSource = 'AI';
            classificationStatus = 'AI_SUGGESTED';
            classificationConfidence = Number(suggestion.confidence || 0);
            classificationReason = suggestion.reason || null;
            aiSuggestionId = suggestion.id;
            if (suggestion.category && suggestion.category.id) {
              fields.category_id = fieldState(
                suggestion.category.id, classificationConfidence, ORIGINS.AI
              );
              suggestedCategoryId = suggestion.category.id;
            }
            if (suggestion.history && !fields.description.value) {
              fields.description = fieldState(
                suggestion.history, classificationConfidence, ORIGINS.AI
              );
            }
            if (suggestion.bank && suggestion.bank.id) {
              suggestedBankId = suggestion.bank.id;
            }
            audit(tenantId, userId, 'AI_CLASSIFICATION_USED', 'EXPENSE_ANALYSIS', analysisId, {
              document_id: documentId, company_id: document.company_id,
              suggestion_id: suggestion.id
            });
          } else {
            audit(tenantId, userId, 'AI_CLASSIFICATION_FAILED', 'EXPENSE_ANALYSIS', analysisId, {
              document_id: documentId, company_id: document.company_id,
              error_code: suggestion && suggestion.error_code || 'AI_UNAVAILABLE'
            });
            errorCode = suggestion && suggestion.error_code || 'AI_UNAVAILABLE';
          }
        } catch (error) {
          audit(tenantId, userId, 'AI_CLASSIFICATION_FAILED', 'EXPENSE_ANALYSIS', analysisId, {
            document_id: documentId, company_id: document.company_id,
            error_code: error.code || 'AI_PROVIDER_ERROR'
          });
          errorCode = error.code || 'AI_PROVIDER_ERROR';
        }
      } else {
        classificationStatus = cls && cls.status || 'NEEDS_CLASSIFICATION';
        classificationConfidence = Number(cls && cls.confidence || 0);
        classificationReason = cls && cls.reason || null;
      }

      const coreReady = !!(fields.supplier_name.value || fields.description.value) &&
        !!fields.occurred_on.value && !!fields.amount.value;
      status = coreReady ? 'READY' : 'PARTIAL';
    }

    run(
      `UPDATE expense_document_analyses SET
         status=?,extraction_id=?,classification_source=?,classification_status=?,
         classification_confidence=?,classification_reason=?,suggested_category_id=?,
         suggested_bank_id=?,ai_suggestion_id=?,fields_json=?,error_code=?,
         completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      status,
      extraction && extraction.id || null,
      classificationSource,
      classificationStatus,
      classificationConfidence,
      classificationReason,
      suggestedCategoryId,
      suggestedBankId,
      aiSuggestionId,
      JSON.stringify(fields),
      errorCode,
      analysisId
    );

    audit(tenantId, userId, 'DOCUMENT_ANALYSIS_COMPLETED', 'EXPENSE_ANALYSIS', analysisId, {
      document_id: documentId,
      company_id: document.company_id,
      status,
      classification_source: classificationSource,
      result: status
    });
  }

  async function analyze(tenantId, documentId, userId, options = {}) {
    const document = one(
      `SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      tenantId, documentId
    );
    if (!document) throw fail('Documento não encontrado.', 'NOT_FOUND', 404);

    const existing = analysisRow(tenantId, documentId);
    if (existing && !options.force && existing.status !== 'PROCESSING') {
      return { analysis: publicAnalysis(existing), created: false, already_exists: true };
    }
    if (existing && existing.status === 'PROCESSING' && !options.force) {
      return { analysis: publicAnalysis(existing), created: false, already_exists: true };
    }

    const analysisId = existing ? existing.id : id();
    if (existing) {
      run(
        `UPDATE expense_document_analyses SET
           status='PROCESSING',classification_source='NONE',classification_status=NULL,
           classification_confidence=0,classification_reason=NULL,suggested_category_id=NULL,
           suggested_bank_id=NULL,ai_suggestion_id=NULL,fields_json='{}',error_code=NULL,
           expense_id=NULL,requested_by=?,requested_at=CURRENT_TIMESTAMP,
           attempt_count=attempt_count+1,completed_at=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        userId, analysisId
      );
    } else {
      run(
        `INSERT INTO expense_document_analyses(
           id,document_id,tenant_id,company_id,status,requested_by
         ) VALUES(?,?,?,?,?,?)`,
        analysisId, documentId, tenantId, document.company_id, 'PROCESSING', userId
      );
    }

    // Process synchronously for predictable UX/tests; extraction itself may poll briefly.
    await runPipeline(tenantId, documentId, userId, analysisId, !!options.force);
    return {
      analysis: getAnalysis(tenantId, documentId),
      created: !existing,
      already_exists: !!existing
    };
  }

  function markSaved(tenantId, documentId, expenseId) {
    run(
      `UPDATE expense_document_analyses SET status='SAVED',expense_id=?,
       updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?`,
      expenseId, tenantId, documentId
    );
  }

  function setTenantAiEnabled(tenantId, enabled, userId) {
    if (aiControl) {
      return aiControl.updateSettings(tenantId, userId, { enabled: !!enabled });
    }
    run(
      `INSERT INTO tenant_ai_settings(tenant_id,enabled,updated_by,updated_at)
       VALUES(?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(tenant_id) DO UPDATE SET
         enabled=excluded.enabled,updated_by=excluded.updated_by,
         updated_at=CURRENT_TIMESTAMP`,
      tenantId, enabled ? 1 : 0, userId || null
    );
    return { enabled: !!enabled };
  }

  return {
    analyze,
    getAnalysis,
    markSaved,
    aiEnabled,
    setTenantAiEnabled,
    ORIGINS,
    FIELD_KEYS
  };
}

module.exports = { createSmartExpenseService, ORIGINS, FIELD_KEYS };
