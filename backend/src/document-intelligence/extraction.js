'use strict';

const pdfParse = require('pdf-parse');
const { detectContentType, PDF, JPEG, PNG } = require('../documents/access');
const {
  isExtractionSufficient,
  isVisualMime,
  normalizeAiVisualResult,
  MAX_VISUAL_BYTES
} = require('./visual');

const FIELD_NAMES = Object.freeze([
  'document_type',
  'document_number',
  'issue_date',
  'supplier_name',
  'supplier_document',
  'description',
  'total_amount',
  'payment_method'
]);

function extractSimplePdfText(buffer) {
  const source = Buffer.from(buffer).toString('latin1');
  const values = [];
  const pattern = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let match;
  while ((match = pattern.exec(source))) {
    const value = match[1]
      .replace(/\\([\\()])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .trim();
    if (value) values.push(value);
  }
  return values.join('\n');
}

function createDocumentExtractionService({
  db, id, storage, normalization, interpreter, auditSystem
}) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const rows = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  let visualAi = null;

  function setVisualAi(deps) {
    const previous = visualAi;
    visualAi = deps || null;
    return previous;
  }

  function fail(message, code, http) {
    const error = new Error(message);
    error.code = code || 'DOCUMENT_EXTRACTION_ERROR';
    error.http = http || 400;
    return error;
  }

  function documentRow(tenantId, documentId) {
    return one(
      `SELECT d.*,c.name company_name,c.trade_name company_trade_name
       FROM documents d JOIN companies c ON c.id=d.company_id
       WHERE d.tenant_id=? AND d.id=? AND d.deleted_at IS NULL`,
      tenantId, documentId
    );
  }

  function mimeOf(document, buffer) {
    const sniffed = detectContentType(buffer);
    if (sniffed) return sniffed;
    const stored = String(document.mime_type || '').toLowerCase();
    if (stored === 'image/jpg' || stored === 'image/pjpeg') return JPEG;
    if (stored === PDF || stored === JPEG || stored === PNG) return stored;
    return stored;
  }

  function publicExtraction(row) {
    if (!row) return null;
    const fieldRows = rows(
      `SELECT field_name,raw_value,normalized_value,reviewed_value,confidence,updated_at
       FROM document_extracted_fields WHERE extraction_id=? ORDER BY field_name`,
      row.id
    );
    const fields = {};
    for (const name of FIELD_NAMES) {
      const current = fieldRows.find(item => item.field_name === name);
      fields[name] = current ? {
        value: current.reviewed_value != null ? current.reviewed_value : current.normalized_value,
        machine_value: current.normalized_value,
        raw_value: current.raw_value,
        confidence: Number(current.confidence || 0),
        reviewed: current.reviewed_value != null
      } : { value: null, machine_value: null, raw_value: null, confidence: 0, reviewed: false };
    }
    return {
      id: row.id,
      document_id: row.document_id,
      company_id: row.company_id,
      document_name: row.original_name || null,
      company_name: row.company_trade_name || row.company_name || null,
      status: row.status,
      extraction_method: row.extraction_method || null,
      extracted_text: row.extracted_text || null,
      error_code: row.error_code || null,
      error_message: row.error_message || null,
      attempt_count: Number(row.attempt_count || 0),
      requested_at: row.requested_at,
      extracted_at: row.extracted_at || null,
      reviewed_at: row.reviewed_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at || null,
      fields
    };
  }

  function get(tenantId, documentId) {
    return publicExtraction(one(
      `SELECT e.*,d.original_name,c.name company_name,c.trade_name company_trade_name
       FROM document_extractions e
       JOIN documents d ON d.id=e.document_id
       JOIN companies c ON c.id=e.company_id
       WHERE e.tenant_id=? AND e.document_id=? AND d.deleted_at IS NULL`,
      tenantId, documentId
    ));
  }

  function audit(tenantId, userId, action, extractionId, payload) {
    if (auditSystem) {
      auditSystem(tenantId, userId || null, action, 'DOCUMENT_EXTRACTION', extractionId, payload);
    }
  }

  function saveFields(extractionId, interpreted) {
    const insert = db.prepare(
      `INSERT INTO document_extracted_fields(
         id,extraction_id,field_name,raw_value,normalized_value,confidence
       ) VALUES(?,?,?,?,?,?)
       ON CONFLICT(extraction_id,field_name) DO UPDATE SET
         raw_value=excluded.raw_value,normalized_value=excluded.normalized_value,
         reviewed_value=NULL,confidence=excluded.confidence,updated_at=CURRENT_TIMESTAMP`
    );
    const clearMissing = db.prepare(
      'DELETE FROM document_extracted_fields WHERE extraction_id=? AND field_name=?'
    );
    for (const name of FIELD_NAMES) {
      const value = interpreted.fields[name];
      if (!value) clearMissing.run(extractionId, name);
      else insert.run(
        id(), extractionId, name, value.raw_value, value.normalized_value, value.confidence
      );
    }
  }

  function visualStatus(tenantId) {
    if (!visualAi) return { available: false, reason: 'AI_NOT_CONFIGURED' };
    if (typeof visualAi.status === 'function') {
      try {
        const status = visualAi.status(tenantId) || {};
        if (status.available) return { available: true, reason: null };
        const reason = String(status.reason || 'AI_NOT_CONFIGURED');
        return {
          available: false,
          reason: ['AI_DISABLED', 'AI_LIMIT_REACHED', 'AI_NOT_CONFIGURED'].includes(reason)
            ? reason
            : 'AI_NOT_CONFIGURED'
        };
      } catch {
        return { available: false, reason: 'AI_NOT_CONFIGURED' };
      }
    }
    if (typeof visualAi.available !== 'function') {
      return { available: false, reason: 'AI_NOT_CONFIGURED' };
    }
    try {
      return visualAi.available(tenantId)
        ? { available: true, reason: null }
        : { available: false, reason: 'AI_NOT_CONFIGURED' };
    } catch {
      return { available: false, reason: 'AI_NOT_CONFIGURED' };
    }
  }

  function visualAvailable(tenantId) {
    return visualStatus(tenantId).available;
  }

  function visualUnavailableError(tenantId) {
    const status = visualStatus(tenantId);
    const reason = status.reason || 'AI_NOT_CONFIGURED';
    if (reason === 'AI_DISABLED') {
      return fail(
        'A interpretação visual por IA está desligada neste escritório. Ative a IA em Configurações → Inteligência Artificial, ou preencha os dados manualmente.',
        'AI_DISABLED',
        503
      );
    }
    if (reason === 'AI_LIMIT_REACHED') {
      return fail(
        'O limite mensal de IA foi atingido. Revise o documento e preencha os dados manualmente.',
        'AI_LIMIT_REACHED',
        409
      );
    }
    return fail(
      'A interpretação visual por IA não está configurada neste servidor (credencial OpenAI ausente). Configure a chave em Configurações → IA ou no ambiente (AI_PROVIDER=openai + OPENAI_API_KEY), ou preencha os dados manualmente.',
      'AI_NOT_CONFIGURED',
      503
    );
  }

  async function runVisualInterpretation(extraction, document, mime, buffer, textExcerpt) {
    if (!visualAi || typeof visualAi.interpret !== 'function') {
      throw fail('Interpretação visual indisponível.', 'AI_NOT_CONFIGURED', 503);
    }
    if (!isVisualMime(mime) && !String(textExcerpt || '').trim()) {
      throw fail(
        'Formato visual não suportado para interpretação.',
        'DOCUMENT_VISUAL_FORMAT_UNSUPPORTED',
        422
      );
    }
    if (isVisualMime(mime) && buffer && buffer.length > MAX_VISUAL_BYTES) {
      throw fail(
        'Imagem muito grande para interpretação automática. Revise os dados manualmente.',
        'DOCUMENT_VISUAL_TOO_LARGE',
        413
      );
    }
    const imageBase64 = isVisualMime(mime) ? Buffer.from(buffer).toString('base64') : '';
    const raw = await visualAi.interpret({
      tenant_id: extraction.tenant_id,
      company_id: extraction.company_id,
      document_id: extraction.document_id,
      user_id: extraction.requested_by,
      mime_type: mime,
      image_base64: imageBase64,
      text_excerpt: textExcerpt || ''
    });
    return normalizeAiVisualResult(raw, normalization);
  }

  function completeExtracted(extractionId, extraction, interpreted, method, text) {
    db.transaction(() => {
      saveFields(extractionId, interpreted);
      run(
        `UPDATE document_extractions
         SET status='EXTRACTED',extraction_method=?,extracted_text=?,
             extracted_at=CURRENT_TIMESTAMP,error_code=NULL,error_message=NULL,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        method, text ? String(text).slice(0, 1000000) : null, extractionId
      );
    })();
    audit(extraction.tenant_id, extraction.requested_by, 'DOCUMENT_EXTRACTION_COMPLETED', extractionId, {
      document_id: extraction.document_id,
      company_id: extraction.company_id,
      extraction_method: method,
      field_count: Object.keys(interpreted.fields || {}).length,
      result: 'EXTRACTED'
    });
  }

  async function processExtraction(extractionId) {
    const extraction = one('SELECT * FROM document_extractions WHERE id=?', extractionId);
    if (!extraction || extraction.status !== 'PENDING') return null;
    const document = documentRow(extraction.tenant_id, extraction.document_id);
    if (!document) return null;
    run(
      `UPDATE document_extractions
       SET status='PROCESSING',updated_at=CURRENT_TIMESTAMP,error_code=NULL,error_message=NULL
       WHERE id=? AND status='PENDING'`,
      extractionId
    );
    try {
      const buffer = storage.readPlain(document.storage_path);
      if (!buffer) throw fail('Não foi possível ler o documento armazenado.', 'DOCUMENT_FILE_UNAVAILABLE', 404);
      const mime = mimeOf(document, buffer);

      if (mime === PNG || mime === JPEG) {
        // Sem OCR local: PNG/JPG usam exclusivamente a IA visual já existente no produto.
        if (!visualAvailable(extraction.tenant_id)) {
          throw visualUnavailableError(extraction.tenant_id);
        }
        try {
          const interpreted = await runVisualInterpretation(
            extraction, document, mime, buffer, ''
          );
          completeExtracted(extractionId, extraction, interpreted, 'AI_VISUAL', null);
        } catch (error) {
          if (error.code === 'DOCUMENT_VISUAL_FORMAT_UNSUPPORTED') throw error;
          if (['AI_NOT_CONFIGURED', 'AI_DISABLED', 'AI_LIMIT_REACHED'].includes(error.code)) {
            throw error;
          }
          throw fail(
            'Não foi possível interpretar automaticamente este documento. Revise os dados manualmente.',
            error.code || 'AI_VISUAL_FAILED',
            error.http || 422
          );
        }
        return get(extraction.tenant_id, extraction.document_id);
      }

      if (mime !== PDF) throw fail('Tipo de documento não suportado.', 'UNSUPPORTED_DOCUMENT_TYPE', 415);

      let parsedText = '';
      try {
        const parsed = await pdfParse(buffer);
        parsedText = String(parsed && parsed.text || '').trim();
      } catch {
        parsedText = '';
      }
      const simpleText = extractSimplePdfText(buffer).trim();
      // Prefer the richer extraction: pdf-parse can return sparse/noisy text on some buffers.
      let originalText = simpleText.length >= parsedText.length ? simpleText : parsedText;
      if (!originalText) originalText = parsedText || simpleText;

      if (originalText) {
        let interpreted = interpreter.interpret(originalText);
        if (!isExtractionSufficient(interpreted.fields) && simpleText && simpleText !== originalText) {
          const alt = interpreter.interpret(simpleText);
          if (Object.keys(alt.fields).length > Object.keys(interpreted.fields).length) {
            interpreted = alt;
            originalText = simpleText;
          }
        }
        if (isExtractionSufficient(interpreted.fields)) {
          completeExtracted(extractionId, extraction, interpreted, 'PDF_TEXT', originalText);
          return get(extraction.tenant_id, extraction.document_id);
        }
        if (visualAvailable(extraction.tenant_id)) {
          try {
            const visual = await runVisualInterpretation(
              extraction, document, mime, buffer, originalText
            );
            if (Object.keys(visual.fields).length) {
              completeExtracted(extractionId, extraction, visual, 'AI_VISUAL', originalText);
              return get(extraction.tenant_id, extraction.document_id);
            }
          } catch {
            // fallback: keep deterministic partial below
          }
        }
        // Persist partial deterministic result so CDS/manual can continue.
        if (Object.keys(interpreted.fields).length) {
          completeExtracted(extractionId, extraction, interpreted, 'PDF_TEXT', originalText);
          return get(extraction.tenant_id, extraction.document_id);
        }
      }

      if (visualAvailable(extraction.tenant_id)) {
        try {
          const visual = await runVisualInterpretation(
            extraction, document, mime, buffer, ''
          );
          if (Object.keys(visual.fields).length) {
            completeExtracted(extractionId, extraction, visual, 'AI_VISUAL', null);
            return get(extraction.tenant_id, extraction.document_id);
          }
        } catch (error) {
          throw fail(
            'Não foi possível interpretar automaticamente este documento. Revise os dados manualmente.',
            error.code || 'NO_TEXT_EXTRACTED',
            422
          );
        }
      }
      throw fail('O PDF não possui texto extraível.', 'NO_TEXT_EXTRACTED', 422);
    } catch (error) {
      const code = error.code || 'EXTRACTION_FAILED';
      const message = code === 'AI_DISABLED'
        ? (error.message || 'A interpretação visual por IA está desligada neste escritório. Ative a IA ou preencha os dados manualmente.')
        : code === 'AI_LIMIT_REACHED'
          ? (error.message || 'O limite mensal de IA foi atingido. Preencha os dados manualmente.')
          : code === 'AI_NOT_CONFIGURED'
            ? (error.message || 'A interpretação visual por IA não está configurada neste servidor. Configure a credencial OpenAI ou preencha os dados manualmente.')
            : code === 'NO_TEXT_EXTRACTED'
              ? 'O documento não tem texto selecionável para leitura automática. Visualize o original e preencha os campos manualmente, ou peça um PDF com texto.'
              : code === 'DOCUMENT_VISUAL_FORMAT_UNSUPPORTED'
                ? 'Este formato de imagem não é suportado pela interpretação visual automática. Revise e preencha os dados manualmente.'
                : code === 'EXTRACTION_UNAVAILABLE'
                  ? 'Não foi possível ler automaticamente esta imagem. O arquivo foi recebido e permanece pendente — preencha data, valor e fornecedor manualmente em Ver análise.'
                  : (error.message && /interpretar automaticamente|Revise os dados|interpretação visual/i.test(error.message)
                    ? error.message
                    : 'Não foi possível extrair o conteúdo do documento automaticamente. Revise o original e preencha os dados manualmente.');
      run(
        `UPDATE document_extractions
         SET status='FAILED',extraction_method=?,error_code=?,error_message=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        code === 'EXTRACTION_UNAVAILABLE' ? 'OCR_UNAVAILABLE'
          : (code.startsWith('AI_') || code === 'DOCUMENT_VISUAL_FORMAT_UNSUPPORTED' ? 'AI_VISUAL' : null),
        code, message, extractionId
      );
      audit(extraction.tenant_id, extraction.requested_by, 'DOCUMENT_EXTRACTION_FAILED', extractionId, {
        document_id: extraction.document_id,
        company_id: extraction.company_id,
        error_code: code,
        result: 'FAILED'
      });
    }
    return get(extraction.tenant_id, extraction.document_id);
  }

  function request(tenantId, documentId, userId, options = {}) {
    const document = documentRow(tenantId, documentId);
    if (!document) throw fail('Documento não encontrado.', 'NOT_FOUND', 404);
    const buffer = storage.readPlain(document.storage_path);
    if (!buffer) throw fail('Documento não encontrado.', 'DOCUMENT_FILE_UNAVAILABLE', 404);
    const mime = mimeOf(document, buffer);
    if (![PDF, PNG, JPEG].includes(mime)) {
      throw fail('Tipo de documento não suportado.', 'UNSUPPORTED_DOCUMENT_TYPE', 415);
    }
    const existing = one(
      'SELECT * FROM document_extractions WHERE tenant_id=? AND document_id=?',
      tenantId, documentId
    );
    if (existing && !options.force) {
      return { extraction: get(tenantId, documentId), created: false, already_exists: true };
    }
    if (existing && existing.status === 'PROCESSING') {
      throw fail('A extração já está em processamento.', 'EXTRACTION_IN_PROGRESS', 409);
    }
    const extractionId = existing ? existing.id : id();
    if (existing) {
      run(
        `UPDATE document_extractions SET
           status='PENDING',extraction_method=NULL,extracted_text=NULL,error_code=NULL,
           error_message=NULL,requested_by=?,reviewed_by=NULL,reviewed_at=NULL,
           requested_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        userId, extractionId
      );
      run('DELETE FROM document_extracted_fields WHERE extraction_id=?', extractionId);
    } else {
      run(
        `INSERT INTO document_extractions(
           id,document_id,tenant_id,company_id,status,requested_by
         ) VALUES(?,?,?,?,?,?)`,
        extractionId, document.id, tenantId, document.company_id, 'PENDING', userId
      );
    }
    audit(tenantId, userId, 'DOCUMENT_EXTRACTION_REQUESTED', extractionId, {
      document_id: document.id,
      company_id: document.company_id,
      reprocess: !!existing,
      result: 'PENDING'
    });
    setImmediate(() => {
      processExtraction(extractionId).catch(() => {});
    });
    return { extraction: get(tenantId, documentId), created: !existing, already_exists: false };
  }

  function normalizeReviewedValue(name, value) {
    if (value == null || String(value).trim() === '') return '';
    if (name === 'total_amount') return normalization.normalizeMoney(value);
    if (name === 'issue_date') return normalization.normalizeDate(value);
    if (name === 'supplier_document') return normalization.normalizeTaxDocument(value);
    if (name === 'document_number') return normalization.normalizeDocumentNumber(value);
    return String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function review(tenantId, documentId, userId, input = {}) {
    const extraction = one(
      'SELECT * FROM document_extractions WHERE tenant_id=? AND document_id=?',
      tenantId, documentId
    );
    if (!extraction) throw fail('Extração não encontrada.', 'EXTRACTION_NOT_FOUND', 404);
    if (!['EXTRACTED', 'REVIEWED'].includes(extraction.status)) {
      throw fail('A extração ainda não está pronta para conferência.', 'EXTRACTION_NOT_READY', 409);
    }
    const changes = input.fields && typeof input.fields === 'object' ? input.fields : {};
    for (const [name, raw] of Object.entries(changes)) {
      if (!FIELD_NAMES.includes(name)) continue;
      const value = normalizeReviewedValue(name, raw);
      if (raw != null && String(raw).trim() && value == null) {
        throw fail(`Valor inválido para ${name}.`, 'INVALID_EXTRACTED_FIELD', 422);
      }
      const current = one(
        'SELECT id FROM document_extracted_fields WHERE extraction_id=? AND field_name=?',
        extraction.id, name
      );
      if (current) {
        run(
          `UPDATE document_extracted_fields
           SET reviewed_value=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          value, current.id
        );
      } else {
        run(
          `INSERT INTO document_extracted_fields(
             id,extraction_id,field_name,reviewed_value,confidence
           ) VALUES(?,?,?,?,0)`,
          id(), extraction.id, name, value
        );
      }
    }
    if (input.confirm === true) {
      run(
        `UPDATE document_extractions SET status='REVIEWED',reviewed_by=?,
         reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        userId, extraction.id
      );
      audit(tenantId, userId, 'DOCUMENT_EXTRACTION_REVIEWED', extraction.id, {
        document_id: documentId,
        company_id: extraction.company_id,
        corrected_fields: Object.keys(changes).filter(x => FIELD_NAMES.includes(x)),
        result: 'REVIEWED'
      });
    }
    return get(tenantId, documentId);
  }

  return {
    request,
    process: processExtraction,
    get,
    review,
    setVisualAi,
    FIELD_NAMES,
    isExtractionSufficient
  };
}

module.exports = {
  createDocumentExtractionService,
  FIELD_NAMES,
  extractSimplePdfText,
  isExtractionSufficient
};
