'use strict';

const { parseFiscalXml, isLikelyXml } = require('./xml-parser');
const { fromExtractionFields, mergeNormalized, emptyNormalized, field } = require('./normalized-fields');
const { normalizeOperationType, OPERATION_TYPES, kindOf } = require('./operation-types');
const { detectContentType, PDF, JPEG, PNG } = require('../documents/access');

const EXTRACTION_MODES = Object.freeze({
  TEXT_EXTRACTION_AVAILABLE: 'TEXT_EXTRACTION_AVAILABLE',
  TEXT_EXTRACTION_INSUFFICIENT: 'TEXT_EXTRACTION_INSUFFICIENT',
  VISUAL_EXTRACTION_REQUIRED: 'VISUAL_EXTRACTION_REQUIRED',
  XML_STRUCTURED: 'XML_STRUCTURED'
});

/**
 * Camada única de interpretação documental (Audácia ponto 6).
 * Prioridade: XML estruturado > texto > visão IA > IA interpretativa.
 */
function createDocumentInterpretationService({
  db, storage, extractionService, auditSystem
}) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  function audit(tenantId, userId, action, entityId, payload) {
    if (auditSystem) auditSystem(tenantId, userId || null, action, 'DOCUMENT', entityId, payload);
  }

  function documentRow(tenantId, documentId) {
    return one(
      `SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      tenantId, documentId
    );
  }

  function waitForExtraction(tenantId, documentId, timeoutMs = 15000) {
    return new Promise(resolve => {
      const started = Date.now();
      const tick = () => {
        const extraction = extractionService.get(tenantId, documentId);
        if (!extraction) return resolve(null);
        if (!['PENDING', 'PROCESSING'].includes(extraction.status)) return resolve(extraction);
        if (Date.now() - started >= timeoutMs) return resolve(extraction);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  /**
   * Interpreta documento e retorna objeto normalizado + metadados.
   */
  async function interpret(tenantId, documentId, userId, { force = false } = {}) {
    const document = documentRow(tenantId, documentId);
    if (!document) {
      const err = new Error('Documento não encontrado.');
      err.code = 'DOCUMENT_NOT_FOUND';
      err.http = 404;
      throw err;
    }

    audit(tenantId, userId, 'DOCUMENT_EXTRACTION_STARTED', documentId, {
      company_id: document.company_id
    });

    const buffer = storage.readPlain(document.storage_path);
    if (!buffer) {
      const err = new Error('Arquivo do documento indisponível.');
      err.code = 'DOCUMENT_FILE_UNAVAILABLE';
      err.http = 404;
      throw err;
    }

    let normalized = emptyNormalized();
    let extractionMode = EXTRACTION_MODES.VISUAL_EXTRACTION_REQUIRED;
    let extraction = null;
    let xmlResult = null;

    // 1) XML estruturado tem prioridade absoluta
    if (isLikelyXml(buffer, document.mime_type, document.original_name)) {
      xmlResult = parseFiscalXml(buffer);
      if (xmlResult.ok) {
        normalized = mergeNormalized(normalized, xmlResult.fields);
        extractionMode = EXTRACTION_MODES.XML_STRUCTURED;
        audit(tenantId, userId, 'DOCUMENT_EXTRACTED', documentId, {
          mode: extractionMode, source: 'xml', document_type: xmlResult.document_type
        });
        // IA pode complementar campos faltantes via extração textual/visual — sem sobrescrever XML
      } else if (xmlResult.code === 'INVALID_XML' || xmlResult.code === 'INCOMPLETE_XML') {
        // Continue para OCR/texto; preserve partial XML fields if any
        if (xmlResult.fields) normalized = mergeNormalized(normalized, xmlResult.fields);
      }
    }

    const mime = detectContentType(buffer) || String(document.mime_type || '').toLowerCase();
    const isImage = mime === JPEG || mime === PNG || /image\/(jpeg|jpg|png)/.test(mime);
    const isPdf = mime === PDF || mime === 'application/pdf';

    // 2) Extração PDF/imagem — XML já suficiente não precisa chamar OCR
    if (extractionMode !== EXTRACTION_MODES.XML_STRUCTURED) {
      try {
        extractionService.request(tenantId, documentId, userId, { force: !!force });
        extraction = await waitForExtraction(tenantId, documentId);
      } catch (err) {
        throw err;
      }

      if (extraction && extraction.status === 'EXTRACTED') {
        const fromExt = fromExtractionFields(extraction.fields, extraction.extraction_method);
        normalized = mergeNormalized(normalized, fromExt);
        if (extraction.extraction_method === 'PDF_TEXT') {
          extractionMode = EXTRACTION_MODES.TEXT_EXTRACTION_AVAILABLE;
        } else if (extraction.extraction_method === 'AI_VISUAL') {
          extractionMode = isPdf
            ? EXTRACTION_MODES.TEXT_EXTRACTION_INSUFFICIENT
            : EXTRACTION_MODES.VISUAL_EXTRACTION_REQUIRED;
        }
      } else {
        if (isImage) extractionMode = EXTRACTION_MODES.VISUAL_EXTRACTION_REQUIRED;
        else if (isPdf) extractionMode = EXTRACTION_MODES.TEXT_EXTRACTION_INSUFFICIENT;
      }
    } else {
      // Complemento opcional: se XML incompleto em campos não fiscais, não força OCR
    }

    // Heurística de natureza se ainda vazia
    if (!normalized.operation_type.value) {
      const desc = `${normalized.description.value || ''} ${normalized.document_type.value || ''}`.toLowerCase();
      let op = OPERATION_TYPES.DESPESA;
      if (/energia|enel|cemig|agua|telefone|internet|aluguel/.test(desc)) op = OPERATION_TYPES.DESPESA;
      else if (/servi[cç]o|nfse|iss/.test(desc)) op = OPERATION_TYPES.SERVICO_TOMADO;
      else if (/folha|sal[aá]rio/.test(desc)) op = OPERATION_TYPES.FOLHA;
      else if (/pr[oó]-?labore/.test(desc)) op = OPERATION_TYPES.PRO_LABORE;
      else if (/imposto|das|gps|darf|issqn/.test(desc)) op = OPERATION_TYPES.IMPOSTO;
      else if (/tarif/.test(desc)) op = OPERATION_TYPES.TARIFA_BANCARIA;
      else if (/nf-?e|compra|mercadoria/.test(desc)) op = OPERATION_TYPES.COMPRA;
      const normalizedOp = normalizeOperationType(op);
      normalized.operation_type = field(normalizedOp, 0.55, 'ai');
    } else {
      const n = normalizeOperationType(normalized.operation_type.value);
      if (n) normalized.operation_type = field(n, normalized.operation_type.confidence, normalized.operation_type.source);
    }

    audit(tenantId, userId, 'DOCUMENT_AI_INTERPRETED', documentId, {
      company_id: document.company_id,
      extraction_mode: extractionMode,
      operation_type: normalized.operation_type.value,
      amount: normalized.amount.value
    });

    return {
      document_id: documentId,
      company_id: document.company_id,
      mime_type: document.mime_type,
      original_name: document.original_name,
      extraction_mode: extractionMode,
      extraction_status: extraction ? extraction.status : (xmlResult && xmlResult.ok ? 'EXTRACTED' : null),
      extraction_method: extractionMode === EXTRACTION_MODES.XML_STRUCTURED
        ? 'XML'
        : (extraction && extraction.extraction_method) || null,
      xml_ok: !!(xmlResult && xmlResult.ok),
      fields: normalized,
      source_type: kindOf(normalized.operation_type.value),
      EXTRACTION_MODES
    };
  }

  return {
    interpret,
    EXTRACTION_MODES,
    parseFiscalXml,
    isLikelyXml
  };
}

module.exports = {
  createDocumentInterpretationService,
  EXTRACTION_MODES
};
