'use strict';

class DocumentInterpreter {
  interpret() {
    throw new Error('DocumentInterpreter.interpret deve ser implementado.');
  }
}

function lineValue(text, labels) {
  const pattern = labels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(text).match(new RegExp(`(?:^|\\n)\\s*(?:${pattern})\\s*[:\\-]\\s*([^\\n]+)`, 'i'));
  return match ? match[1].trim() : null;
}

function field(rawValue, normalizedValue, confidence) {
  if (rawValue == null || normalizedValue == null || normalizedValue === '') return null;
  return { raw_value: String(rawValue), normalized_value: String(normalizedValue), confidence };
}

class LocalDocumentInterpreter extends DocumentInterpreter {
  constructor(normalization) {
    super();
    this.normalization = normalization;
  }

  interpret(extractedText) {
    const n = this.normalization;
    const text = n.normalizeText(extractedText);
    const fields = {};

    const typeMatch = text.match(/\b(NF[\s-]?e|NFe|nota fiscal|cupom fiscal|recibo|boleto|comprovante)\b/i);
    if (typeMatch) {
      const raw = typeMatch[1];
      const key = raw.toLowerCase().replace(/\s|-/g, '');
      const value = key === 'nfe' ? 'NF-e' :
        key.includes('notafiscal') ? 'NOTA_FISCAL' :
          key.includes('cupom') ? 'CUPOM_FISCAL' : raw.toUpperCase();
      fields.document_type = field(raw, value, 0.95);
    }

    const numberRaw = lineValue(text, ['número', 'numero', 'nº', 'n°', 'documento']);
    if (numberRaw) fields.document_number = field(numberRaw, n.normalizeDocumentNumber(numberRaw), 0.9);

    const dateRaw = lineValue(text, ['data de emissão', 'data de emissao', 'emissão', 'emissao', 'data']) ||
      (text.match(/\b\d{2}[\/.\-]\d{2}[\/.\-]\d{4}\b/) || [])[0];
    if (dateRaw) fields.issue_date = field(dateRaw, n.normalizeDate(dateRaw), 0.94);

    const supplierRaw = lineValue(text, [
      'fornecedor', 'emitente', 'razão social', 'razao social', 'estabelecimento'
    ]);
    if (supplierRaw) fields.supplier_name = field(supplierRaw, supplierRaw.replace(/\s+/g, ' ').trim(), 0.88);

    const taxRaw = lineValue(text, ['cnpj', 'cpf', 'cpf/cnpj']) ||
      (text.match(/\b(?:\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}|\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})\b/) || [])[0];
    if (taxRaw) fields.supplier_document = field(taxRaw, n.normalizeTaxDocument(taxRaw), 0.97);

    const descriptionRaw = lineValue(text, ['descrição', 'descricao', 'produto', 'serviço', 'servico']);
    if (descriptionRaw) fields.description = field(descriptionRaw, descriptionRaw.replace(/\s+/g, ' ').trim(), 0.82);

    const amountRaw = lineValue(text, ['valor total', 'total', 'valor']) ||
      (text.match(/R\$\s*-?\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})|R\$\s*-?\s*\d+(?:[.,]\d{2})/) || [])[0];
    if (amountRaw) fields.total_amount = field(amountRaw, n.normalizeMoney(amountRaw), 0.98);

    const paymentRaw = lineValue(text, ['forma de pagamento', 'pagamento', 'meio de pagamento']) ||
      (text.match(/\b(PIX|dinheiro|cart[aã]o(?: de)? (?:cr[eé]dito|d[eé]bito)|boleto|transfer[eê]ncia)\b/i) || [])[0];
    if (paymentRaw) {
      const upper = paymentRaw.toUpperCase();
      const value = /PIX/.test(upper) ? 'PIX' :
        /DINHEIRO/.test(upper) ? 'DINHEIRO' :
          /D[ÉE]BITO/.test(upper) ? 'DEBITO' :
            /CR[ÉE]DITO/.test(upper) ? 'CREDITO' :
              /BOLETO/.test(upper) ? 'BOLETO' :
                /TRANSFER/.test(upper) ? 'TRANSFERENCIA' : upper;
      fields.payment_method = field(paymentRaw, value, 0.9);
    }

    return { normalized_text: text, fields };
  }
}

module.exports = { DocumentInterpreter, LocalDocumentInterpreter };
