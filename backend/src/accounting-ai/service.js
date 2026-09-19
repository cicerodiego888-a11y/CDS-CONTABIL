'use strict';

const crypto = require('crypto');

function createAccountingAIService({ db, id, provider, auditSystem, aiControl }) {
  let activeProvider = provider;
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function fail(message, code, http = 400) {
    const error = new Error(message);
    error.code = code;
    error.http = http;
    return error;
  }

  function hash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  function clamp(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }

  function text(value, max = 500) {
    return value == null ? null : String(value).replace(/\s+/g, ' ').trim().slice(0, max) || null;
  }

  function audit(tenantId, userId, action, type, entityId, payload) {
    if (auditSystem) auditSystem(tenantId, userId || null, action, type, entityId, payload);
  }

  function assertAiCallable(tenantId) {
    if (!aiControl) return;
    const gate = aiControl.availability(tenantId);
    if (gate.available) return;
    throw fail(
      gate.reason === 'AI_LIMIT_REACHED'
        ? 'O limite mensal de IA foi atingido. O CDS continuará funcionando normalmente utilizando os motores internos.'
        : 'Sugestão inteligente indisponível.',
      gate.reason || 'AI_DISABLED',
      gate.reason === 'AI_LIMIT_REACHED' ? 409 : 503
    );
  }

  function recordUsage(tenantId, companyId, operationType, status, referenceType, referenceId, usage, extra = {}) {
    if (aiControl) {
      return aiControl.recordUsage({
        tenant_id: tenantId,
        company_id: companyId || null,
        user_id: extra.user_id || null,
        document_id: extra.document_id || null,
        provider: activeProvider && activeProvider.name || 'off',
        model: activeProvider && activeProvider.model || null,
        operation_type: operationType,
        status,
        input_tokens: usage && usage.input_tokens,
        output_tokens: usage && usage.output_tokens,
        total_tokens: usage && usage.total_tokens,
        cached_input_tokens: usage && usage.cached_input_tokens,
        duration_ms: extra.duration_ms,
        error_code: extra.error_code || null,
        reference_type: referenceType,
        reference_id: referenceId
      });
    }
    run(
      `INSERT INTO ai_usage_records(
         id,tenant_id,company_id,provider,model,operation_type,status,
         input_tokens,output_tokens,total_tokens,estimated_cost_cents,
         reference_type,reference_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id(), tenantId, companyId || null,
      activeProvider && activeProvider.name || 'off',
      activeProvider && activeProvider.model || null,
      operationType, status,
      usage && Number(usage.input_tokens || 0) || null,
      usage && Number(usage.output_tokens || 0) || null,
      usage && Number(usage.total_tokens || 0) || null,
      null, referenceType, referenceId
    );
  }

  function setProvider(next) {
    activeProvider = next;
    return activeProvider;
  }

  function providerInfo() {
    return {
      configured: !!(activeProvider && activeProvider.isConfigured()),
      provider: activeProvider && activeProvider.name || 'off',
      model: activeProvider && activeProvider.model || null
    };
  }

  function accountContext(tenantId) {
    return rows(
      `SELECT a.id,a.account_code,a.classification_code,a.description,a.account_type,
              a.is_postable,a.active,a.plan_id
       FROM accounts a JOIN account_plans p ON p.id=a.plan_id
       WHERE a.tenant_id=? AND p.tenant_id=? AND a.active=1
         AND a.account_type='A' AND a.is_postable=1
       ORDER BY a.description,a.account_code LIMIT 1000`,
      tenantId, tenantId
    );
  }

  function visibleCategories(tenantId, companyId) {
    return rows(
      `SELECT c.id,c.name,c.kind,c.account_id
       FROM categories c
       WHERE c.tenant_id=? AND c.active=1 AND (c.company_id IS NULL OR c.company_id=?)
       ORDER BY c.name`,
      tenantId, companyId
    );
  }

  function visibleBanks(tenantId, companyId) {
    return rows(
      `SELECT b.id,b.name,b.account_id
       FROM banks b
       WHERE b.tenant_id=? AND b.active=1 AND (b.company_id IS NULL OR b.company_id=?)
       ORDER BY b.name`,
      tenantId, companyId
    );
  }

  function extractionContext(tenantId, documentId, allowUnreviewed = false) {
    const extraction = one(
      `SELECT e.*,d.original_name,c.name company_name,c.trade_name company_trade_name
       FROM document_extractions e
       JOIN documents d ON d.id=e.document_id
       JOIN companies c ON c.id=e.company_id
       WHERE e.tenant_id=? AND e.document_id=? AND d.deleted_at IS NULL`,
      tenantId, documentId
    );
    if (!extraction) throw fail('Extração não encontrada.', 'EXTRACTION_NOT_FOUND', 404);
    if (extraction.status !== 'REVIEWED' &&
        !(allowUnreviewed && extraction.status === 'EXTRACTED')) {
      throw fail('Confirme os dados documentais antes de solicitar a sugestão.', 'EXTRACTION_NOT_REVIEWED', 409);
    }
    const fieldRows = rows(
      `SELECT field_name,COALESCE(reviewed_value,normalized_value) value
       FROM document_extracted_fields WHERE extraction_id=?`,
      extraction.id
    );
    const fields = {};
    for (const field of fieldRows) fields[field.field_name] = field.value;
    return { extraction, fields };
  }

  function filterAccounts(accounts, fields) {
    const source = [
      fields.description, fields.supplier_name, fields.document_type, fields.payment_method
    ].filter(Boolean).join(' ').toLowerCase();
    const tokens = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/).filter(token => token.length >= 3);
    return accounts.map(account => {
      const description = String(account.description || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const relevance = tokens.reduce((score, token) =>
        score + (description.includes(token) ? 1 : 0), 0);
      return { ...account, relevance };
    }).sort((a, b) => b.relevance - a.relevance ||
      String(a.account_code).localeCompare(String(b.account_code))).slice(0, 200);
  }

  function suggestionRow(tenantId, documentId) {
    return one(
      `SELECT s.*,a.account_code primary_account_code,a.description primary_account_name,
              c.name category_name,b.name bank_name
       FROM ai_classification_suggestions s
       LEFT JOIN accounts a ON a.id=s.primary_account_id
       LEFT JOIN categories c ON c.id=s.suggested_category_id
       LEFT JOIN banks b ON b.id=s.suggested_bank_id
       WHERE s.tenant_id=? AND s.document_id=?`,
      tenantId, documentId
    );
  }

  function publicSuggestion(row) {
    if (!row) return null;
    const fieldRows = rows(
      `SELECT field_name,COALESCE(reviewed_value,normalized_value) value
       FROM document_extracted_fields WHERE extraction_id=?`,
      row.extraction_id
    );
    const documentFields = Object.fromEntries(
      fieldRows.map(field => [field.field_name, field.value])
    );
    const candidates = rows(
      `SELECT x.rank,x.account_id,x.confidence,x.reason,
              a.account_code,a.description account_name
       FROM ai_classification_candidates x
       JOIN accounts a ON a.id=x.account_id
       WHERE x.suggestion_id=? ORDER BY x.rank`,
      row.id
    );
    const decision = one(
      `SELECT d.*,a.account_code selected_account_code,a.description selected_account_name
       FROM ai_classification_decisions d
       LEFT JOIN accounts a ON a.id=d.selected_account_id
       WHERE d.suggestion_id=? ORDER BY d.created_at DESC LIMIT 1`,
      row.id
    );
    return {
      id: row.id,
      extraction_id: row.extraction_id,
      document_id: row.document_id,
      company_id: row.company_id,
      document: {
        supplier_name: documentFields.supplier_name || null,
        supplier_document: documentFields.supplier_document || null,
        issue_date: documentFields.issue_date || null,
        total_amount: documentFields.total_amount || null,
        description: documentFields.description || null,
        document_type: documentFields.document_type || null
      },
      status: row.status,
      available: row.status !== 'FAILED',
      provider: row.provider || null,
      model: row.model || null,
      operation_type: row.operation_type || null,
      history: row.suggested_history || null,
      category: row.suggested_category_id ? {
        id: row.suggested_category_id, name: row.category_name
      } : null,
      bank: row.suggested_bank_id ? {
        id: row.suggested_bank_id, name: row.bank_name
      } : null,
      primary_account: row.primary_account_id ? {
        id: row.primary_account_id,
        code: row.primary_account_code,
        name: row.primary_account_name
      } : null,
      confidence: Number(row.confidence || 0),
      reason: row.reason || null,
      error_code: row.error_code || null,
      message: row.status === 'FAILED' ? 'Sugestão inteligente indisponível.' : null,
      candidates,
      decision: decision || null,
      requested_at: row.requested_at,
      completed_at: row.completed_at || null
    };
  }

  function getSuggestion(tenantId, documentId) {
    return publicSuggestion(suggestionRow(tenantId, documentId));
  }

  function validateAccount(accountsById, accountId) {
    const account = accountsById.get(String(accountId || ''));
    if (!account) throw fail('A IA sugeriu uma conta inexistente ou indisponível.', 'AI_ACCOUNT_INVALID', 422);
    return account;
  }

  function visibleConfig(list, configId, kind) {
    if (!configId) return null;
    const item = list.find(entry => entry.id === configId);
    if (!item) throw fail(`A IA sugeriu ${kind} indisponível.`, 'AI_CONFIG_INVALID', 422);
    return item;
  }

  async function requestClassification(tenantId, documentId, userId, options = {}) {
    const { extraction, fields } = extractionContext(
      tenantId, documentId, !!options.allowUnreviewed
    );
    const existing = suggestionRow(tenantId, documentId);
    if (existing && !options.force) {
      return { suggestion: publicSuggestion(existing), created: false, already_exists: true };
    }
    if (!activeProvider || !activeProvider.isConfigured()) {
      const sid = existing ? existing.id : id();
      if (existing) {
        run(
          `UPDATE ai_classification_suggestions SET status='FAILED',provider=?,model=?,
           error_code='AI_NOT_CONFIGURED',requested_by=?,requested_at=CURRENT_TIMESTAMP,
           completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          activeProvider && activeProvider.name || 'off',
          activeProvider && activeProvider.model || null, userId, sid
        );
      } else {
        run(
          `INSERT INTO ai_classification_suggestions(
             id,extraction_id,document_id,tenant_id,company_id,status,provider,model,
             error_code,requested_by,completed_at
           ) VALUES(?,?,?,?,?,'FAILED',?,?,'AI_NOT_CONFIGURED',?,CURRENT_TIMESTAMP)`,
          sid, extraction.id, documentId, tenantId, extraction.company_id,
          activeProvider && activeProvider.name || 'off',
          activeProvider && activeProvider.model || null, userId
        );
      }
      audit(tenantId, userId, 'AI_CLASSIFICATION_REQUESTED', 'AI_SUGGESTION', sid, {
        document_id: documentId, company_id: extraction.company_id,
        provider: activeProvider && activeProvider.name || 'off',
        model: activeProvider && activeProvider.model || null,
        account_count: 0
      });
      audit(tenantId, userId, 'AI_CLASSIFICATION_FAILED', 'AI_SUGGESTION', sid, {
        document_id: documentId, company_id: extraction.company_id,
        provider: activeProvider && activeProvider.name || 'off',
        error_code: 'AI_NOT_CONFIGURED'
      });
      return { suggestion: getSuggestion(tenantId, documentId), created: !existing, fallback: true };
    }

    if (aiControl) {
      const gate = aiControl.availability(tenantId);
      if (!gate.available) {
        const sid = existing ? existing.id : id();
        const code = gate.reason || 'AI_DISABLED';
        if (existing) {
          run(
            `UPDATE ai_classification_suggestions SET status='FAILED',provider=?,model=?,
             error_code=?,requested_by=?,requested_at=CURRENT_TIMESTAMP,
             completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            activeProvider.name, activeProvider.model, code, userId, sid
          );
        } else {
          run(
            `INSERT INTO ai_classification_suggestions(
               id,extraction_id,document_id,tenant_id,company_id,status,provider,model,
               error_code,requested_by,completed_at
             ) VALUES(?,?,?,?,?,'FAILED',?,?,?,?,CURRENT_TIMESTAMP)`,
            sid, extraction.id, documentId, tenantId, extraction.company_id,
            activeProvider.name, activeProvider.model, code, userId
          );
        }
        audit(tenantId, userId, 'AI_CLASSIFICATION_FAILED', 'AI_SUGGESTION', sid, {
          document_id: documentId, company_id: extraction.company_id,
          provider: activeProvider.name, error_code: code
        });
        return { suggestion: getSuggestion(tenantId, documentId), created: !existing, fallback: true };
      }
    }

    const accounts = accountContext(tenantId);
    if (!accounts.length) throw fail('Não existem contas analíticas disponíveis.', 'NO_ACCOUNTS_AVAILABLE', 409);
    const categories = visibleCategories(tenantId, extraction.company_id);
    const banks = visibleBanks(tenantId, extraction.company_id);
    const context = {
      document: {
        supplier_name: fields.supplier_name || null,
        supplier_document: fields.supplier_document || null,
        issue_date: fields.issue_date || null,
        total_amount: fields.total_amount || null,
        description: fields.description || null,
        document_type: fields.document_type || null,
        payment_method: fields.payment_method || null,
        relevant_excerpt: text(extraction.extracted_text, 1500)
      },
      accounts: filterAccounts(accounts, fields).map(account => ({
        id: account.id,
        code: account.account_code,
        description: account.description
      })),
      categories: categories.map(category => ({
        id: category.id, name: category.name, kind: category.kind, account_id: category.account_id
      })),
      banks: banks.map(bank => ({
        id: bank.id, name: bank.name, account_id: bank.account_id
      }))
    };
    const contextHash = hash(context);
    const sid = existing ? existing.id : id();
    if (existing) {
      run(
        `UPDATE ai_classification_suggestions SET status='REQUESTED',provider=?,model=?,
         context_hash=?,error_code=NULL,requested_by=?,requested_at=CURRENT_TIMESTAMP,
         completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        activeProvider.name, activeProvider.model, contextHash, userId, sid
      );
      run('DELETE FROM ai_classification_candidates WHERE suggestion_id=?', sid);
    } else {
      run(
        `INSERT INTO ai_classification_suggestions(
           id,extraction_id,document_id,tenant_id,company_id,status,provider,model,
           context_hash,requested_by
         ) VALUES(?,?,?,?,?,'REQUESTED',?,?,?,?)`,
        sid, extraction.id, documentId, tenantId, extraction.company_id,
        activeProvider.name, activeProvider.model, contextHash, userId
      );
    }
    audit(tenantId, userId, 'AI_CLASSIFICATION_REQUESTED', 'AI_SUGGESTION', sid, {
      document_id: documentId, company_id: extraction.company_id,
      provider: activeProvider.name, model: activeProvider.model,
      account_count: context.accounts.length
    });

    let usage = null;
    try {
      const answer = await activeProvider.suggestClassification(context);
      usage = answer && answer.__usage || null;
      if (!answer || !Array.isArray(answer.candidates)) {
        throw fail('Resposta inválida do provedor de IA.', 'AI_INVALID_RESPONSE', 422);
      }
      const accountsById = new Map(accounts.map(account => [account.id, account]));
      const seen = new Set();
      const candidates = [];
      for (const proposed of answer.candidates.slice(0, 10)) {
        const accountId = String(proposed && proposed.account_id || '');
        if (!accountsById.has(accountId) || seen.has(accountId)) continue;
        seen.add(accountId);
        candidates.push({
          account: validateAccount(accountsById, accountId),
          confidence: clamp(proposed.confidence),
          reason: text(proposed.reason, 500)
        });
        if (candidates.length === 3) break;
      }
      if (!candidates.length) {
        throw fail('A IA não retornou conta contábil válida.', 'AI_ACCOUNT_INVALID', 422);
      }
      candidates.sort((a, b) => b.confidence - a.confidence);
      const category = visibleConfig(categories, answer.category_id, 'categoria');
      const bank = visibleConfig(banks, answer.bank_id, 'banco');
      const operation = ['EXPENSE', 'REVENUE', 'OTHER'].includes(String(answer.operation_type || '').toUpperCase())
        ? String(answer.operation_type).toUpperCase() : 'OTHER';
      db.transaction(() => {
        candidates.forEach((candidate, index) => run(
          `INSERT INTO ai_classification_candidates(
             id,suggestion_id,account_id,rank,confidence,reason
           ) VALUES(?,?,?,?,?,?)`,
          id(), sid, candidate.account.id, index + 1, candidate.confidence, candidate.reason
        ));
        run(
          `UPDATE ai_classification_suggestions SET status='COMPLETED',operation_type=?,
           suggested_history=?,suggested_category_id=?,suggested_bank_id=?,
           primary_account_id=?,confidence=?,reason=?,error_code=NULL,
           completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          operation, text(answer.history || fields.description || fields.supplier_name, 500),
          category && category.id, bank && bank.id, candidates[0].account.id,
          candidates[0].confidence, text(answer.reason || candidates[0].reason, 1000), sid
        );
      })();
      audit(tenantId, userId, 'AI_CLASSIFICATION_COMPLETED', 'AI_SUGGESTION', sid, {
        document_id: documentId, company_id: extraction.company_id,
        provider: activeProvider.name, model: activeProvider.model,
        candidate_count: candidates.length, result: 'COMPLETED'
      });
      recordUsage(
        tenantId, extraction.company_id, 'ACCOUNT_CLASSIFICATION', 'SUCCESS',
        'AI_SUGGESTION', sid, usage, { user_id: userId, document_id: documentId }
      );
      return { suggestion: getSuggestion(tenantId, documentId), created: !existing };
    } catch (error) {
      const code = error.code || 'AI_PROVIDER_ERROR';
      run(
        `UPDATE ai_classification_suggestions SET status='FAILED',error_code=?,
         completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        code, sid
      );
      audit(tenantId, userId, 'AI_CLASSIFICATION_FAILED', 'AI_SUGGESTION', sid, {
        document_id: documentId, company_id: extraction.company_id,
        provider: activeProvider.name, model: activeProvider.model, error_code: code
      });
      recordUsage(
        tenantId, extraction.company_id, 'ACCOUNT_CLASSIFICATION', 'FAILED',
        'AI_SUGGESTION', sid, usage, {
          user_id: userId, document_id: documentId, error_code: code
        }
      );
      return { suggestion: getSuggestion(tenantId, documentId), created: !existing, fallback: true };
    }
  }

  function preparation(suggestion, selected) {
    const extraction = one(
      'SELECT * FROM document_extractions WHERE id=? AND tenant_id=?',
      suggestion.extraction_id, suggestion.tenant_id
    );
    const fieldRows = rows(
      `SELECT field_name,COALESCE(reviewed_value,normalized_value) value
       FROM document_extracted_fields WHERE extraction_id=?`,
      suggestion.extraction_id
    );
    const fields = Object.fromEntries(fieldRows.map(field => [field.field_name, field.value]));
    const bank = selected.bank_id ? one(
      `SELECT b.*,a.id account_id_valid FROM banks b
       LEFT JOIN accounts a ON a.id=b.account_id AND a.tenant_id=b.tenant_id
         AND a.active=1 AND a.account_type='A' AND a.is_postable=1
       WHERE b.id=? AND b.tenant_id=? AND b.active=1
         AND (b.company_id IS NULL OR b.company_id=?)`,
      selected.bank_id, suggestion.tenant_id, suggestion.company_id
    ) : null;
    const amountCents = Math.round(Number(fields.total_amount || 0) * 100);
    const lines = [];
    if (bank && bank.account_id_valid && bank.account_id !== selected.account_id) {
      const expense = selected.operation_type !== 'REVENUE';
      lines.push(
        { side: 'D', account_id: expense ? selected.account_id : bank.account_id, amount_cents: amountCents },
        { side: 'C', account_id: expense ? bank.account_id : selected.account_id, amount_cents: amountCents }
      );
    }
    return {
      document_id: extraction.document_id,
      company_id: extraction.company_id,
      occurred_on: fields.issue_date || new Date().toISOString().slice(0, 10),
      description: selected.history || fields.description || fields.supplier_name || 'Documento analisado',
      amount_cents: amountCents,
      operation_type: selected.operation_type,
      category_id: selected.category_id || null,
      bank_id: selected.bank_id || null,
      selected_account_id: selected.account_id,
      lines
    };
  }

  function decide(tenantId, documentId, userId, input = {}) {
    const suggestion = suggestionRow(tenantId, documentId);
    if (!suggestion) throw fail('Sugestão não encontrada.', 'AI_SUGGESTION_NOT_FOUND', 404);
    if (suggestion.status !== 'COMPLETED') {
      throw fail('A sugestão não está disponível para decisão.', 'AI_SUGGESTION_NOT_READY', 409);
    }
    const decision = String(input.decision || '').toUpperCase();
    if (!['ACCEPTED', 'REJECTED', 'OVERRIDDEN'].includes(decision)) {
      throw fail('Decisão inválida.', 'INVALID_AI_DECISION', 400);
    }
    const accounts = accountContext(tenantId);
    const accountsById = new Map(accounts.map(account => [account.id, account]));
    let selectedAccount = null;
    let category = null;
    let bank = null;
    if (decision !== 'REJECTED') {
      const accountId = decision === 'ACCEPTED'
        ? suggestion.primary_account_id : input.account_id;
      selectedAccount = validateAccount(accountsById, accountId);
      category = visibleConfig(
        visibleCategories(tenantId, suggestion.company_id),
        input.category_id === undefined ? suggestion.suggested_category_id : input.category_id,
        'categoria'
      );
      bank = visibleConfig(
        visibleBanks(tenantId, suggestion.company_id),
        input.bank_id === undefined ? suggestion.suggested_bank_id : input.bank_id,
        'banco'
      );
    }
    const did = id();
    const selectedHistory = text(
      input.history === undefined ? suggestion.suggested_history : input.history, 500
    );
    run(
      `INSERT INTO ai_classification_decisions(
         id,suggestion_id,tenant_id,company_id,decision,suggested_account_id,
         selected_account_id,selected_category_id,selected_bank_id,selected_history,
         reason,decided_by
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      did, suggestion.id, tenantId, suggestion.company_id, decision,
      suggestion.primary_account_id, selectedAccount && selectedAccount.id,
      category && category.id, bank && bank.id, selectedHistory,
      text(input.reason, 1000), userId
    );
    run(
      'UPDATE ai_classification_suggestions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      decision, suggestion.id
    );
    const action = decision === 'ACCEPTED' ? 'AI_SUGGESTION_ACCEPTED' :
      decision === 'REJECTED' ? 'AI_SUGGESTION_REJECTED' : 'AI_SUGGESTION_OVERRIDDEN';
    audit(tenantId, userId, action, 'AI_SUGGESTION', suggestion.id, {
      document_id: documentId,
      company_id: suggestion.company_id,
      suggested_account_id: suggestion.primary_account_id,
      selected_account_id: selectedAccount && selectedAccount.id,
      decision
    });
    const selected = selectedAccount ? {
      account_id: selectedAccount.id,
      category_id: category && category.id,
      bank_id: bank && bank.id,
      history: selectedHistory,
      operation_type: suggestion.operation_type || 'OTHER'
    } : null;
    return {
      suggestion: getSuggestion(tenantId, documentId),
      preparation: selected ? preparation(suggestion, selected) : null
    };
  }

  function normalizeChartRow(raw) {
    const code = text(raw && (raw.code || raw.account_code), 80);
    const classification = text(
      raw && (raw.classification_code || raw.classification || code), 120
    );
    const description = text(raw && raw.description, 300);
    const type = String(raw && (raw.account_type || raw.type) || '').toUpperCase();
    let parent = text(raw && raw.parent_code, 120);
    if (!parent && classification && classification.includes('.')) {
      const parts = classification.split('.');
      if (parts.length > 1) parent = parts.slice(0, -1).join('.');
    }
    return {
      code, classification_code: classification, description,
      account_type: type, parent_code: parent,
      level: classification ? Math.max(0, classification.split('.').length - 1) : 0,
      is_postable: type === 'A'
    };
  }

  function validateChartRows(rawRows) {
    const normalized = Array.isArray(rawRows) ? rawRows.map(normalizeChartRow) : [];
    const issues = [];
    const codeSet = new Set();
    const classSet = new Set();
    normalized.forEach((row, index) => {
      if (!row.code || !/^[A-Za-z0-9._-]+$/.test(row.code)) {
        issues.push({ row: index + 1, reason: 'Código inválido' });
      }
      if (!row.description) issues.push({ row: index + 1, reason: 'Descrição ausente' });
      if (!['S', 'A'].includes(row.account_type)) {
        issues.push({ row: index + 1, reason: 'Tipo deve ser S ou A' });
      }
      if (codeSet.has(row.code)) issues.push({ row: index + 1, reason: `Código duplicado: ${row.code}` });
      else if (row.code) codeSet.add(row.code);
      if (classSet.has(row.classification_code)) {
        issues.push({ row: index + 1, reason: `Classificação duplicada: ${row.classification_code}` });
      } else if (row.classification_code) classSet.add(row.classification_code);
    });
    normalized.forEach((row, index) => {
      if (row.parent_code && !classSet.has(row.parent_code) && !codeSet.has(row.parent_code)) {
        issues.push({ row: index + 1, reason: `Conta pai ausente: ${row.parent_code}` });
      }
    });
    return { rows: normalized, issues };
  }

  async function requestChartPreview(tenantId, companyId, userId, input) {
    if (companyId && !one('SELECT id FROM companies WHERE tenant_id=? AND id=?', tenantId, companyId)) {
      throw fail('Empresa não encontrada.', 'COMPANY_NOT_FOUND', 404);
    }
    try { assertAiCallable(tenantId); } catch (error) {
      const previewId = id();
      const info = providerInfo();
      run(
        `INSERT INTO ai_chart_previews(
           id,tenant_id,company_id,status,provider,model,source_file,error_code,
           requested_by,completed_at
         ) VALUES(?,?,?,'FAILED',?,?,?,?,?,CURRENT_TIMESTAMP)`,
        previewId, tenantId, companyId || null, info.provider, info.model,
        text(input && input.fileName, 255), error.code || 'AI_DISABLED', userId
      );
      return getChartPreview(tenantId, previewId);
    }
    const previewId = id();
    const info = providerInfo();
    const sourceText = String(input && input.text || '').slice(0, 20000);
    run(
      `INSERT INTO ai_chart_previews(
         id,tenant_id,company_id,status,provider,model,source_file,context_hash,requested_by
       ) VALUES(?,?,?,'PROCESSING',?,?,?,?,?)`,
      previewId, tenantId, companyId || null, info.provider, info.model,
      text(input && input.fileName, 255), hash(sourceText), userId
    );
    audit(tenantId, userId, 'AI_CHART_IMPORT_REQUESTED', 'AI_CHART_PREVIEW', previewId, {
      company_id: companyId || null, provider: info.provider, model: info.model,
      source_file: text(input && input.fileName, 255)
    });
    let usage = null;
    try {
      if (!activeProvider || !activeProvider.isConfigured()) {
        throw fail('Sugestão inteligente indisponível.', 'AI_NOT_CONFIGURED', 503);
      }
      const answer = await activeProvider.suggestChart({ text: sourceText });
      usage = answer && answer.__usage || null;
      const validation = validateChartRows(answer && answer.rows);
      const status = validation.rows.length > 0 && validation.issues.length === 0
        ? 'READY' : 'INVALID';
      run(
        `UPDATE ai_chart_previews SET status=?,rows_json=?,issues_json=?,
         total_rows=?,valid_rows=?,completed_at=CURRENT_TIMESTAMP,
         updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        status, JSON.stringify(validation.rows), JSON.stringify(validation.issues),
        validation.rows.length,
        status === 'READY' ? validation.rows.length : 0,
        previewId
      );
      audit(tenantId, userId, 'AI_CHART_IMPORT_COMPLETED', 'AI_CHART_PREVIEW', previewId, {
        company_id: companyId || null, provider: info.provider, model: info.model,
        status, total_rows: validation.rows.length, issue_count: validation.issues.length
      });
      recordUsage(
        tenantId, companyId, 'PLAN_ACCOUNT_IMPORT', 'SUCCESS',
        'AI_CHART_PREVIEW', previewId, usage, { user_id: userId }
      );
    } catch (error) {
      const code = error.code || 'AI_PROVIDER_ERROR';
      run(
        `UPDATE ai_chart_previews SET status='FAILED',error_code=?,
         completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        code, previewId
      );
      audit(tenantId, userId, 'AI_CHART_IMPORT_FAILED', 'AI_CHART_PREVIEW', previewId, {
        company_id: companyId || null, provider: info.provider, model: info.model,
        error_code: code
      });
      recordUsage(
        tenantId, companyId, 'PLAN_ACCOUNT_IMPORT', 'FAILED',
        'AI_CHART_PREVIEW', previewId, usage, { user_id: userId, error_code: code }
      );
    }
    return getChartPreview(tenantId, previewId);
  }

  function getChartPreview(tenantId, previewId) {
    const row = one('SELECT * FROM ai_chart_previews WHERE tenant_id=? AND id=?', tenantId, previewId);
    if (!row) return null;
    let previewRows = [];
    let issues = [];
    try { previewRows = JSON.parse(row.rows_json || '[]'); } catch {}
    try { issues = JSON.parse(row.issues_json || '[]'); } catch {}
    return {
      id: row.id,
      company_id: row.company_id || null,
      status: row.status,
      provider: row.provider,
      model: row.model,
      source_file: row.source_file,
      total: row.total_rows,
      valid: row.valid_rows,
      rejected: issues.length,
      issues,
      sample: previewRows.slice(0, 100),
      error_code: row.error_code || null,
      message: row.status === 'FAILED' ? 'Sugestão inteligente indisponível.' : null,
      imported_plan_id: row.imported_plan_id || null
    };
  }

  function importChartPreview(tenantId, previewId, userId, name) {
    const preview = one(
      'SELECT * FROM ai_chart_previews WHERE tenant_id=? AND id=?',
      tenantId, previewId
    );
    if (!preview) throw fail('Prévia não encontrada.', 'AI_CHART_PREVIEW_NOT_FOUND', 404);
    if (preview.status !== 'READY' || Number(preview.valid_rows) <= 0) {
      throw fail('A prévia não possui contas válidas para importação.', 'AI_CHART_PREVIEW_INVALID', 409);
    }
    let chartRows;
    let issues;
    try { chartRows = JSON.parse(preview.rows_json || '[]'); } catch { chartRows = []; }
    try { issues = JSON.parse(preview.issues_json || '[]'); } catch { issues = []; }
    const validation = validateChartRows(chartRows);
    if (!validation.rows.length || validation.issues.length || issues.length) {
      throw fail('A prévia contém problemas e não pode ser importada.', 'AI_CHART_PREVIEW_INVALID', 409);
    }
    const planId = id();
    const jobId = id();
    db.transaction(() => {
      run(
        `INSERT INTO account_plans(id,tenant_id,name,status,source_file)
         VALUES(?,?,?,'ACTIVE',?)`,
        planId, tenantId, text(name || preview.source_file || 'Plano importado por IA', 255),
        preview.source_file
      );
      for (const account of validation.rows) {
        run(
          `INSERT INTO accounts(
             id,tenant_id,plan_id,source_id,account_code,classification_code,
             account_type,description,parent_code,level,is_postable,raw_data
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          id(), tenantId, planId, account.code, account.code,
          account.classification_code, account.account_type, account.description,
          account.parent_code, account.level, account.is_postable ? 1 : 0,
          JSON.stringify(account)
        );
      }
      run(
        `INSERT INTO import_jobs(
           id,tenant_id,plan_id,source_file,source_type,status,total_rows,
           imported_rows,rejected_rows,issues_json,created_by
         ) VALUES(?,?,?,?,?,'COMPLETED',?,?,0,'[]',?)`,
        jobId, tenantId, planId, preview.source_file, 'AI_PREVIEW',
        validation.rows.length, validation.rows.length, userId
      );
      run(
        `UPDATE ai_chart_previews SET status='IMPORTED',imported_plan_id=?,
         imported_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        planId, previewId
      );
    })();
    return { planId, jobId, total: validation.rows.length, imported: validation.rows.length, rejected: 0, issues: [] };
  }

  async function interpretVisual(input = {}) {
    const tenantId = input.tenant_id;
    const documentId = input.document_id;
    const companyId = input.company_id || null;
    const userId = input.user_id || null;
    if (!tenantId || !documentId) throw fail('Documento obrigatório.', 'DOCUMENT_REQUIRED');

    assertAiCallable(tenantId);
    if (!activeProvider || !activeProvider.isConfigured()) {
      throw fail('Sugestão inteligente indisponível.', 'AI_NOT_CONFIGURED', 503);
    }
    if (typeof activeProvider.interpretDocumentImage !== 'function') {
      throw fail('Interpretação visual indisponível.', 'AI_NOT_CONFIGURED', 503);
    }

    const mimeType = String(input.mime_type || '').toLowerCase();
    const imageBase64 = input.image_base64 ? String(input.image_base64) : '';
    const textExcerpt = input.text_excerpt ? String(input.text_excerpt).slice(0, 4000) : '';

    audit(tenantId, userId, 'DOCUMENT_AI_VISUAL_REQUESTED', 'DOCUMENT_EXTRACTION', documentId, {
      document_id: documentId,
      company_id: companyId,
      mime_type: mimeType || null,
      has_image: !!imageBase64,
      model: activeProvider.model || null
    });

    const started = Date.now();
    try {
      const raw = await activeProvider.interpretDocumentImage({
        documentId,
        mimeType,
        imageBase64,
        textExcerpt
      });
      const usage = raw && raw.__usage || null;
      recordUsage(
        tenantId, companyId, 'DOCUMENT_INTERPRETATION', 'SUCCESS',
        'DOCUMENT', documentId, usage, {
          user_id: userId,
          document_id: documentId,
          duration_ms: Date.now() - started
        }
      );
      audit(tenantId, userId, 'DOCUMENT_AI_VISUAL_COMPLETED', 'DOCUMENT_EXTRACTION', documentId, {
        document_id: documentId,
        company_id: companyId,
        model: activeProvider.model || null,
        result: 'OK'
      });
      return raw;
    } catch (error) {
      recordUsage(
        tenantId, companyId, 'DOCUMENT_INTERPRETATION', 'FAILED',
        'DOCUMENT', documentId, null, {
          user_id: userId,
          document_id: documentId,
          duration_ms: Date.now() - started,
          error_code: error.code || 'AI_PROVIDER_ERROR'
        }
      );
      audit(tenantId, userId, 'DOCUMENT_AI_VISUAL_FAILED', 'DOCUMENT_EXTRACTION', documentId, {
        document_id: documentId,
        company_id: companyId,
        error_code: error.code || 'AI_PROVIDER_ERROR',
        http: error.http != null ? error.http : null,
        provider_code: error.providerCode || null,
        provider_type: error.providerType || null,
        provider_param: error.providerParam || null,
        provider_message: error.providerMessage || null,
        provider_request_id: error.providerRequestId || null,
        endpoint: error.endpoint || null,
        model: error.model || (activeProvider && activeProvider.model) || null,
        result: 'FAILED'
      });
      throw error;
    }
  }

  return {
    setProvider,
    providerInfo,
    requestClassification,
    getSuggestion,
    decide,
    requestChartPreview,
    getChartPreview,
    importChartPreview,
    validateChartRows,
    interpretVisual
  };
}

module.exports = { createAccountingAIService };
