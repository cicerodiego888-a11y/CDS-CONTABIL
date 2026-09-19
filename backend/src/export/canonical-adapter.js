'use strict';

function moneyFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

function createCanonicalAdapter() {
  function metadata() {
    return {
      system_key: 'canonical',
      label: 'CSV canônico CDS',
      format: 'CSV canônico configurável',
      layout: null,
      uses_external_mapping: false
    };
  }

  function validate() {
    return { ok: true, errors: [], preview: null };
  }

  function normalize(entries) {
    return entries || [];
  }

  function generate(entries, options) {
    const delimiter = options && options.delimiter != null ? String(options.delimiter) : ';';
    const rows = [['data', 'historico', 'contas_debito', 'valor_debito', 'contas_credito', 'valor_credito', 'origem', 'id_lancamento']];
    const esc = v => {
      const s = String(v ?? '');
      return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const e of entries || []) {
      const lines = e.lines || [];
      const ds = lines.filter(x => x.side === 'D');
      const cs = lines.filter(x => x.side === 'C');
      rows.push([
        e.occurred_on,
        e.description,
        ds.map(x => x.account_code).join('|'),
        moneyFromCents(ds.reduce((a, x) => a + Number(x.amount_cents || 0), 0)),
        cs.map(x => x.account_code).join('|'),
        moneyFromCents(cs.reduce((a, x) => a + Number(x.amount_cents || 0), 0)),
        e.source_type,
        e.id
      ].map(esc));
    }
    const text = '\ufeff' + rows.map(r => r.join(delimiter)).join('\r\n') + '\r\n';
    const systemKey = (options && options.system_key) || 'canonical';
    const companyId = (options && options.company_id) || 'empresa';
    const stamp = Date.now();
    return {
      text,
      encoding: 'utf8',
      fileName: `${systemKey}-${companyId}-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      lineCount: Math.max(0, rows.length - 1),
      meta: { format: 'canonical_csv', delimiter }
    };
  }

  return { metadata, validate, normalize, generate };
}

/** Adapters “placeholder” que ainda usam o CSV canônico até layout oficial. */
function createCanonicalBoundAdapter(systemKey, label) {
  const base = createCanonicalAdapter();
  return {
    metadata() {
      return Object.assign({}, base.metadata(), {
        system_key: systemKey,
        label,
        compatibility_notice: 'O layout oficial do software destino precisa ser configurado/homologado pelo escritório.'
      });
    },
    validate: base.validate,
    normalize: base.normalize,
    generate(entries, options) {
      return base.generate(entries, Object.assign({}, options, { system_key: systemKey }));
    }
  };
}

module.exports = { createCanonicalAdapter, createCanonicalBoundAdapter, moneyFromCents };
