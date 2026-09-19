'use strict';

/**
 * Domínio Thomson Reuters — Layout Excel (3.1) código 11758
 * "Lançamentos Contábeis em Lote com Filial e Centro de Custos"
 *
 * Campos (separador ; | decimal ,):
 * 1 Data DD/MM/AAAA
 * 2 Cód. Conta Débito
 * 3 Cód. Conta Crédito
 * 4 Valor
 * 5 Cód. Histórico
 * 6 Comp. Histórico
 * 7 Indicador de Início de Lote (XML: "1")
 * 8 Cód. Matriz/Filial
 * 9 Cód. Centro de Custo Débito
 * 10 Cód. Centro de Custo Crédito
 *
 * Nota: exemplos XLSX/CSV com "99"/"854" em Inicia Lote NÃO são regra do sistema.
 * Esta entrega segue o XML do layout (indicador = "1").
 */

const LAYOUT = {
  code: '11758',
  name: 'Excel (3.1)',
  description: 'Lançamentos Contábeis em Lote com Filial e Centro de Custos',
  separator: ';',
  decimal: ',',
  field_count: 10,
  version: '3.1',
  encoding: 'latin1'
};

function formatDateBr(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatAmount(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return '';
  return (n / 100).toFixed(2).replace('.', ',');
}

function sanitizeCell(v) {
  return String(v == null ? '' : v).replace(/[\r\n;]/g, ' ').trim();
}

function createDominioAdapter() {
  function metadata() {
    return {
      system_key: 'dominio',
      label: 'Domínio',
      format: 'texto delimitado (;)',
      layout: LAYOUT,
      uses_external_mapping: true,
      layout_label: `Layout: ${LAYOUT.name} — ${LAYOUT.description}`,
      homologation: 'Arquivo gerado conforme o layout fornecido do Domínio, pendente de validação no ambiente real do cliente.'
    };
  }

  function validate(context) {
    const errors = [];
    const unmapped = context && context.unmapped_accounts || [];
    const unbalanced = context && context.unbalanced_entries || [];
    const invalid = context && context.invalid_entries || [];
    if (unmapped.length) {
      errors.push({
        code: 'UNMAPPED_ACCOUNTS',
        message: `${unmapped.length} conta${unmapped.length === 1 ? '' : 's'} sem mapeamento para o Domínio.`,
        accounts: unmapped
      });
    }
    for (const e of unbalanced) {
      errors.push({
        code: 'UNBALANCED_ENTRY',
        message: 'Lançamento não balanceado. O arquivo para o Domínio não foi gerado.',
        entry_id: e.id
      });
    }
    for (const e of invalid) {
      errors.push({
        code: e.code || 'INVALID_ENTRY',
        message: e.message || 'Lançamento inválido para exportação Domínio.',
        entry_id: e.id
      });
    }
    return { ok: errors.length === 0, errors };
  }

  function normalize(entries) {
    return (entries || []).map(e => Object.assign({}, e, {
      lines: (e.lines || []).slice().sort((a, b) => {
        if (a.side !== b.side) return a.side === 'D' ? -1 : 1;
        return String(a.id || '').localeCompare(String(b.id || ''));
      })
    }));
  }

  function buildRows(entries) {
    const rows = [];
    for (const entry of entries) {
      const debits = (entry.lines || []).filter(l => l.side === 'D');
      const credits = (entry.lines || []).filter(l => l.side === 'C');
      const date = formatDateBr(entry.occurred_on);
      const hist = sanitizeCell(entry.description || '');
      const oneToOne = debits.length === 1 && credits.length === 1;

      if (oneToOne) {
        rows.push([
          date,
          sanitizeCell(debits[0].external_code),
          sanitizeCell(credits[0].external_code),
          formatAmount(debits[0].amount_cents),
          '',
          hist,
          '1',
          '',
          '',
          ''
        ]);
        continue;
      }

      // Vários para Vários — Lote: uma linha por conta; 1º registro inicia lote.
      const parts = [
        ...debits.map(l => ({ side: 'D', code: l.external_code, amount_cents: l.amount_cents })),
        ...credits.map(l => ({ side: 'C', code: l.external_code, amount_cents: l.amount_cents }))
      ];
      parts.forEach((p, idx) => {
        rows.push([
          date,
          p.side === 'D' ? sanitizeCell(p.code) : '',
          p.side === 'C' ? sanitizeCell(p.code) : '',
          formatAmount(p.amount_cents),
          '',
          hist,
          idx === 0 ? '1' : '',
          '',
          '',
          ''
        ]);
      });
    }
    return rows;
  }

  function generate(entries, options) {
    const normalized = normalize(entries);
    const rows = buildRows(normalized);
    for (const row of rows) {
      if (row.length !== LAYOUT.field_count) {
        throw Object.assign(new Error('Linha Domínio com quantidade de campos inválida.'), {
          code: 'DOMINIO_FIELD_COUNT', http: 422
        });
      }
    }
    const text = rows.map(r => r.join(LAYOUT.separator)).join('\r\n') + (rows.length ? '\r\n' : '');
    const companySlug = String((options && (options.company_slug || options.company_name)) || 'empresa')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'empresa';
    const start = (options && options.period_start) || 'inicio';
    const end = (options && options.period_end) || 'fim';
    return {
      text,
      encoding: LAYOUT.encoding,
      fileName: `dominio-${companySlug}-${start}-${end}.txt`,
      contentType: 'text/plain; charset=iso-8859-1',
      lineCount: rows.length,
      meta: {
        layout_code: LAYOUT.code,
        layout_name: LAYOUT.name,
        field_count: LAYOUT.field_count,
        separator: LAYOUT.separator,
        decimal: LAYOUT.decimal
      }
    };
  }

  return { metadata, validate, normalize, generate, formatDateBr, formatAmount, LAYOUT };
}

module.exports = { createDominioAdapter, LAYOUT, formatDateBr, formatAmount };
