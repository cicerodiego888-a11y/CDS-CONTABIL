'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAdapterRegistry } = require('./adapter');
const { createCanonicalBoundAdapter } = require('./canonical-adapter');
const { createDominioAdapter } = require('./dominio-adapter');
const { createMappingService } = require('./mappings');

const SYSTEM_LABELS = {
  dominio: 'Domínio',
  contaazul: 'Conta Azul',
  alterdata: 'Alterdata',
  fortes: 'Fortes',
  questor: 'Questor',
  sci: 'SCI'
};

function createExportService(deps) {
  const { db, id, exportDir, audit } = deps;
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const qRows = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);

  const registry = createAdapterRegistry();
  const dominio = createDominioAdapter();
  registry.register(dominio);
  for (const key of Object.keys(SYSTEM_LABELS)) {
    if (key === 'dominio') continue;
    registry.register(createCanonicalBoundAdapter(key, SYSTEM_LABELS[key]));
  }

  const mappings = createMappingService({ db, id });

  function loadPostedEntries(tenantId, companyId, periodStart, periodEnd) {
    const entries = qRows(
      `SELECT * FROM entries
       WHERE tenant_id=? AND company_id=? AND status='POSTED'
         AND date(occurred_on)>=date(?) AND date(occurred_on)<=date(?)
       ORDER BY occurred_on, id`,
      tenantId, companyId, periodStart, periodEnd
    );
    return entries.map(e => {
      const lines = qRows(
        `SELECT l.id, l.side, l.amount_cents, l.account_id, a.account_code, a.description AS account_description,
                a.account_type, a.is_postable, a.active
         FROM entry_lines l
         JOIN accounts a ON a.id=l.account_id
         WHERE l.entry_id=?
         ORDER BY l.side, l.id`,
        e.id
      );
      return Object.assign({}, e, { lines });
    });
  }

  function analyzeForDominio(tenantId, companyId, entries) {
    const map = mappings.getMap(tenantId, companyId, 'dominio');
    const unmappedMap = new Map();
    const unbalanced = [];
    const invalid = [];
    let debitTotal = 0;
    let creditTotal = 0;
    let mappedAccounts = 0;
    const seenMapped = new Set();
    const prepared = [];

    for (const entry of entries) {
      const lines = entry.lines || [];
      const debits = lines.filter(l => l.side === 'D');
      const credits = lines.filter(l => l.side === 'C');
      const sumD = debits.reduce((a, l) => a + Number(l.amount_cents || 0), 0);
      const sumC = credits.reduce((a, l) => a + Number(l.amount_cents || 0), 0);
      debitTotal += sumD;
      creditTotal += sumC;

      if (!debits.length || !credits.length) {
        invalid.push({ id: entry.id, code: 'MISSING_SIDES', message: 'Lançamento sem débito ou crédito.' });
        continue;
      }
      if (sumD !== sumC) {
        unbalanced.push({ id: entry.id, debit: sumD, credit: sumC });
        continue;
      }
      if (!entry.occurred_on || !/^\d{4}-\d{2}-\d{2}/.test(entry.occurred_on)) {
        invalid.push({ id: entry.id, code: 'INVALID_DATE', message: 'Data inválida.' });
        continue;
      }

      let entryOk = true;
      const enriched = [];
      for (const line of lines) {
        if (Number(line.amount_cents || 0) <= 0) {
          invalid.push({ id: entry.id, code: 'INVALID_AMOUNT', message: 'Valor deve ser maior que zero.' });
          entryOk = false;
          break;
        }
        if (line.account_type !== 'A' || !line.is_postable || !line.active) {
          invalid.push({
            id: entry.id,
            code: 'ACCOUNT_NOT_POSTABLE',
            message: `Conta ${line.account_code} não é analítica/postável.`
          });
          entryOk = false;
          break;
        }
        const external = map.get(line.account_id);
        if (!external) {
          const prev = unmappedMap.get(line.account_id) || {
            account_id: line.account_id,
            account_code: line.account_code,
            description: line.account_description,
            entry_count: 0
          };
          prev.entry_count += 1;
          unmappedMap.set(line.account_id, prev);
          entryOk = false;
          continue;
        }
        if (!seenMapped.has(line.account_id)) {
          seenMapped.add(line.account_id);
          mappedAccounts += 1;
        }
        enriched.push(Object.assign({}, line, { external_code: external }));
      }
      if (entryOk && enriched.length === lines.length) {
        prepared.push(Object.assign({}, entry, { lines: enriched }));
      }
    }

    const unmapped_accounts = [...unmappedMap.values()];
    const entries_with_errors = unbalanced.length + invalid.length + (unmapped_accounts.length ? entries.length - prepared.length : 0);
    const adapterCheck = dominio.validate({
      unmapped_accounts,
      unbalanced_entries: unbalanced,
      invalid_entries: invalid
    });

    let message = '';
    if (unmapped_accounts.length) {
      message = `${unmapped_accounts.length} conta${unmapped_accounts.length === 1 ? '' : 's'} sem mapeamento para o Domínio.`;
    } else if (unbalanced.length) {
      message = 'Lançamento não balanceado. O arquivo para o Domínio não foi gerado.';
    } else if (!entries.length) {
      message = 'Nenhum lançamento efetivado no período.';
    } else if (!adapterCheck.ok) {
      message = adapterCheck.errors[0] && adapterCheck.errors[0].message || 'Exportação Domínio bloqueada.';
    }

    return {
      prepared,
      preview: {
        system_key: 'dominio',
        layout: dominio.metadata().layout,
        layout_label: dominio.metadata().layout_label,
        entries_found: entries.length,
        debit_total_cents: debitTotal,
        credit_total_cents: creditTotal,
        mapped_accounts: mappedAccounts,
        unmapped_accounts,
        unmapped_count: unmapped_accounts.length,
        entries_with_errors: Math.max(entries_with_errors, unbalanced.length + invalid.length),
        unbalanced_count: unbalanced.length,
        invalid_count: invalid.length,
        can_generate: adapterCheck.ok && prepared.length > 0 && prepared.length === entries.length,
        message,
        errors: adapterCheck.errors,
        homologation: dominio.metadata().homologation
      }
    };
  }

  function preview(input) {
    const {
      tenantId, companyId, systemKey, periodStart, periodEnd, companyOk
    } = input;
    if (!SYSTEM_LABELS[systemKey]) {
      throw Object.assign(new Error('Sistema de exportação inválido.'), { code: 'INVALID_EXPORT', http: 400 });
    }
    if (!companyOk) {
      throw Object.assign(new Error('Empresa inválida.'), { code: 'INVALID_EXPORT', http: 400 });
    }
    const company = one('SELECT id,status,name,trade_name FROM companies WHERE tenant_id=? AND id=?', tenantId, companyId);
    if (!company) {
      throw Object.assign(new Error('Empresa não encontrada.'), { code: 'COMPANY_NOT_FOUND', http: 404 });
    }
    if (company.status !== 'ACTIVE') {
      throw Object.assign(new Error('Esta empresa está bloqueada ou indisponível.'), { code: 'COMPANY_UNAVAILABLE', http: 409 });
    }
    const entries = loadPostedEntries(tenantId, companyId, periodStart, periodEnd);
    if (systemKey === 'dominio') {
      return analyzeForDominio(tenantId, companyId, entries).preview;
    }
    const debit = entries.reduce((a, e) => a + (e.lines || []).filter(l => l.side === 'D').reduce((s, l) => s + l.amount_cents, 0), 0);
    const credit = entries.reduce((a, e) => a + (e.lines || []).filter(l => l.side === 'C').reduce((s, l) => s + l.amount_cents, 0), 0);
    return {
      system_key: systemKey,
      layout: null,
      layout_label: 'CSV canônico CDS Contábil Connect',
      entries_found: entries.length,
      debit_total_cents: debit,
      credit_total_cents: credit,
      mapped_accounts: null,
      unmapped_accounts: [],
      unmapped_count: 0,
      entries_with_errors: 0,
      can_generate: true,
      message: entries.length ? '' : 'Nenhum lançamento efetivado no período.',
      format: 'CSV canônico configurável',
      compatibility_notice: 'O layout oficial do software destino precisa ser configurado/homologado pelo escritório.'
    };
  }

  function generate(input) {
    const {
      tenantId, companyId, systemKey, periodStart, periodEnd, delimiter, userId, companyOk, req
    } = input;
    if (!SYSTEM_LABELS[systemKey]) {
      throw Object.assign(new Error('Sistema de exportação inválido.'), { code: 'INVALID_EXPORT', http: 400 });
    }
    if (!companyOk) {
      throw Object.assign(new Error('Empresa inválida.'), { code: 'INVALID_EXPORT', http: 400 });
    }
    const company = one('SELECT id,status,name,trade_name FROM companies WHERE tenant_id=? AND id=?', tenantId, companyId);
    if (!company) {
      throw Object.assign(new Error('Empresa não encontrada.'), { code: 'COMPANY_NOT_FOUND', http: 404 });
    }
    if (company.status !== 'ACTIVE') {
      throw Object.assign(new Error('Esta empresa está bloqueada ou indisponível.'), { code: 'COMPANY_UNAVAILABLE', http: 409 });
    }

    const adapter = registry.get(systemKey);
    if (!adapter) {
      throw Object.assign(new Error('Adapter de exportação não encontrado.'), { code: 'ADAPTER_NOT_FOUND', http: 500 });
    }

    const entries = loadPostedEntries(tenantId, companyId, periodStart, periodEnd);
    let toExport = entries;
    let previewInfo = null;

    if (systemKey === 'dominio') {
      const analysis = analyzeForDominio(tenantId, companyId, entries);
      previewInfo = analysis.preview;
      if (!analysis.preview.can_generate) {
        const err = Object.assign(new Error(analysis.preview.message || 'Exportação Domínio bloqueada.'), {
          code: analysis.preview.unmapped_count ? 'UNMAPPED_ACCOUNTS' : 'EXPORT_BLOCKED',
          http: 422,
          preview: analysis.preview
        });
        throw err;
      }
      toExport = analysis.prepared;
    }

    const generated = adapter.generate(toExport, {
      system_key: systemKey,
      company_id: companyId,
      company_name: company.trade_name || company.name,
      company_slug: company.trade_name || company.name,
      period_start: periodStart,
      period_end: periodEnd,
      delimiter: delimiter || ';'
    });

    const dir = path.join(exportDir, systemKey);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, generated.fileName);
    const buf = Buffer.from(generated.text, generated.encoding || 'utf8');
    fs.writeFileSync(file, buf);
    const checksum = crypto.createHash('sha256').update(buf).digest('hex');
    const x = id();
    db.transaction(() => {
      exec(
        'INSERT INTO exports(id,tenant_id,company_id,system_key,period_start,period_end,status,file_path,checksum,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
        x, tenantId, companyId, systemKey, periodStart, periodEnd, 'GENERATED', file, checksum, userId
      );
      for (const e of toExport) {
        exec('INSERT INTO export_items(id,export_id,entry_id) VALUES(?,?,?)', id(), x, e.id);
      }
    })();

    if (typeof audit === 'function' && req) {
      audit(req, 'CREATE', 'EXPORT', x, null, { system_key: systemKey, period_start: periodStart, period_end: periodEnd, count: toExport.length });
      audit(req, 'EXPORT_CREATED', 'EXPORT', x, null, { system_key: systemKey, period_start: periodStart, period_end: periodEnd, count: toExport.length });
    }

    const meta = adapter.metadata();
    return {
      id: x,
      file_name: generated.fileName,
      count: toExport.length,
      line_count: generated.lineCount,
      checksum,
      system: SYSTEM_LABELS[systemKey],
      system_key: systemKey,
      format: meta.format,
      layout: meta.layout || null,
      layout_label: meta.layout_label || null,
      compatibility_notice: meta.compatibility_notice || null,
      homologation: meta.homologation || null,
      preview: previewInfo
    };
  }

  return {
    SYSTEM_LABELS,
    registry,
    mappings,
    preview,
    generate,
    loadPostedEntries
  };
}

module.exports = { createExportService, SYSTEM_LABELS };
