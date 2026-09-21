'use strict';

const pdfParse = require('pdf-parse');
const { extractSimplePdfText } = require('../document-intelligence/extraction');
const { PlanPreviewError } = require('./parser');

async function extractPlanText(buffer, ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.pdf') {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (buf.length < 5 || buf.slice(0, 5).toString('latin1').indexOf('%PDF') !== 0) {
      throw PlanPreviewError('Não foi possível processar o arquivo.', 'PDF_INVALID', 'extraction', 'pdf');
    }
    let text = '';
    try {
      const parsed = await pdfParse(buf);
      text = parsed && parsed.text ? String(parsed.text) : '';
    } catch (err) {
      throw PlanPreviewError('Não foi possível processar o arquivo.', 'PDF_INVALID', 'extraction', 'pdf');
    }
    if (!String(text).trim()) {
      text = extractSimplePdfText(buf) || '';
    }
    if (!String(text).trim()) {
      throw PlanPreviewError(
        'Não foi possível extrair texto do PDF.',
        'EXTRACTION_UNAVAILABLE',
        'extraction',
        'pdf'
      );
    }
    return { text, fileType: 'pdf' };
  }
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  return { text, fileType: e.replace('.', '') || 'txt' };
}

module.exports = { extractPlanText };
