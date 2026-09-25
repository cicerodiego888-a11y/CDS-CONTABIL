'use strict';

const BANDS = Object.freeze({
  HIGH: { min: 0.95, label: 'ALTA' },
  MEDIUM: { min: 0.80, label: 'MÉDIA' },
  LOW: { min: 0, label: 'BAIXA' }
});

function bandOf(score) {
  const s = Number(score) || 0;
  if (s >= BANDS.HIGH.min) return BANDS.HIGH.label;
  if (s >= BANDS.MEDIUM.min) return BANDS.MEDIUM.label;
  return BANDS.LOW.label;
}

/**
 * Score consolidado explicável (0–1).
 */
function computeConfidence(input) {
  const reasons = [];
  let score = 0.35;

  const fields = input.fields || {};
  const hasAmount = !!(fields.amount && fields.amount.value);
  const hasDate = !!(fields.document_date && fields.document_date.value);
  const hasSupplier = !!(fields.supplier_name && fields.supplier_name.value);
  const hasTax = !!(fields.tax_id && fields.tax_id.value);
  const xmlSource = fields.amount && fields.amount.source === 'xml';

  if (hasAmount) { score += 0.12; reasons.push('valor identificado'); }
  if (hasDate) { score += 0.08; reasons.push('data identificada'); }
  if (hasSupplier) { score += 0.1; reasons.push('fornecedor identificado'); }
  if (hasTax) { score += 0.05; reasons.push('CNPJ/CPF identificado'); }
  if (xmlSource) { score += 0.15; reasons.push('dados fiscais estruturados (XML)'); }

  if (input.ruleMatched) { score += 0.12; reasons.push('regra contábil existente'); }
  if (input.historyMatched) { score += 0.08; reasons.push('histórico de decisão da empresa'); }
  if (input.accountsFound) { score += 0.1; reasons.push('conta encontrada no plano'); }
  if (input.balanced) { score += 0.05; reasons.push('lançamento balanceado'); }
  if (input.operationConsistent) { score += 0.05; reasons.push('operação consistente'); }

  if (input.documentQuality === 'high') { score += 0.05; reasons.push('documento com boa qualidade'); }
  else if (input.documentQuality === 'low') { score -= 0.1; reasons.push('qualidade do documento baixa'); }

  if (input.aiOnly && !input.ruleMatched) {
    score = Math.min(score, 0.88);
    reasons.push('sugestão predominantemente por IA');
  }

  score = Math.max(0, Math.min(1, score));
  const pct = Math.round(score * 100);
  const band = bandOf(score);
  const reasonText = reasons.length
    ? `${pct}% — ${reasons.join(' + ')}.`
    : `${pct}% — dados insuficientes para alta confiança.`;

  return {
    score,
    percent: pct,
    band,
    reason: reasonText,
    factors: reasons
  };
}

module.exports = { computeConfidence, bandOf, BANDS };
