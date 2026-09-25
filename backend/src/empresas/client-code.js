'use strict';

/**
 * Sprint 36.1 — código interno do cliente (CLI-000001) por tenant.
 * Ordenação do backfill: datetime(created_at) ASC, id ASC (determinística).
 */

const CODE_RE = /^CLI-\d{6}$/;

function formatClientCode(num) {
  const n = Number(num);
  if (!Number.isInteger(n) || n < 1 || n > 999999) {
    throw Object.assign(new Error('CLIENT_CODE_OUT_OF_RANGE'), { code: 'CLIENT_CODE_OUT_OF_RANGE' });
  }
  return 'CLI-' + String(n).padStart(6, '0');
}

function parseClientCodeNum(code) {
  const s = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(s)) return null;
  return Number(s.slice(4));
}

function isValidClientCode(code) {
  return CODE_RE.test(String(code || '').trim().toUpperCase());
}

function maxExistingClientCodeNum(db, tenantId) {
  const row = db.prepare(
    `SELECT MAX(CAST(substr(codigo_cliente, 5) AS INTEGER)) AS n
     FROM companies
     WHERE tenant_id = ?
       AND codigo_cliente GLOB 'CLI-[0-9][0-9][0-9][0-9][0-9][0-9]'`
  ).get(tenantId);
  return Number(row && row.n) || 0;
}

function ensureSeqRow(db, tenantId) {
  const max = maxExistingClientCodeNum(db, tenantId);
  const start = Math.max(1, max + 1);
  db.prepare(
    `INSERT INTO tenant_client_code_seq(tenant_id, next_num) VALUES(?, ?)
     ON CONFLICT(tenant_id) DO NOTHING`
  ).run(tenantId, start);
  const cur = db.prepare('SELECT next_num FROM tenant_client_code_seq WHERE tenant_id=?').get(tenantId);
  if (cur && Number(cur.next_num) <= max) {
    db.prepare('UPDATE tenant_client_code_seq SET next_num=? WHERE tenant_id=?').run(max + 1, tenantId);
  }
}

/**
 * Aloca o próximo CLI-###### para o tenant. Deve rodar dentro de transação IMMEDIATE.
 */
function allocateClientCode(db, tenantId) {
  ensureSeqRow(db, tenantId);
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = db.prepare(
      `UPDATE tenant_client_code_seq
       SET next_num = next_num + 1
       WHERE tenant_id = ?
       RETURNING next_num - 1 AS allocated`
    ).get(tenantId);
    const n = Number(row && row.allocated);
    if (!Number.isInteger(n) || n < 1) {
      throw Object.assign(new Error('CLIENT_CODE_ALLOC_FAILED'), { code: 'CLIENT_CODE_ALLOC_FAILED' });
    }
    const code = formatClientCode(n);
    const clash = db.prepare(
      'SELECT id FROM companies WHERE tenant_id=? AND codigo_cliente=? LIMIT 1'
    ).get(tenantId, code);
    if (!clash) return code;
  }
  throw Object.assign(new Error('CLIENT_CODE_CONFLICT'), { code: 'CLIENT_CODE_CONFLICT' });
}

/**
 * Backfill idempotente: só preenche codigo_cliente NULL/vazio.
 * Ordem por tenant: datetime(created_at) ASC, id ASC.
 */
function backfillClientCodes(db, { audit } = {}) {
  const tenants = db.prepare('SELECT id FROM tenants ORDER BY id').all();
  let assigned = 0;
  const assign = db.transaction((tenantId) => {
    ensureSeqRow(db, tenantId);
    const rows = db.prepare(
      `SELECT id FROM companies
       WHERE tenant_id = ?
         AND (codigo_cliente IS NULL OR TRIM(codigo_cliente) = '')
       ORDER BY datetime(created_at) ASC, id ASC`
    ).all(tenantId);
    for (const row of rows) {
      const code = allocateClientCode(db, tenantId);
      db.prepare('UPDATE companies SET codigo_cliente=? WHERE id=? AND tenant_id=? AND (codigo_cliente IS NULL OR TRIM(codigo_cliente)=\'\')')
        .run(code, row.id, tenantId);
      assigned += 1;
      if (typeof audit === 'function') {
        audit(tenantId, row.id, code, { context: 'backfill' });
      }
    }
  });
  for (const t of tenants) assign.immediate(t.id);
  return { assigned, tenants: tenants.length };
}

module.exports = {
  CODE_RE,
  formatClientCode,
  parseClientCodeNum,
  isValidClientCode,
  allocateClientCode,
  backfillClientCodes,
  maxExistingClientCodeNum,
  ensureSeqRow
};
