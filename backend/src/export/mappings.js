'use strict';

function createMappingService({ db, id }) {
  function one(sql, ...p) { return db.prepare(sql).get(...p); }
  function qRows(sql, ...p) { return db.prepare(sql).all(...p); }
  function exec(sql, ...p) { return db.prepare(sql).run(...p); }

  function listAccountsWithMapping(tenantId, companyId, systemKey) {
    const key = String(systemKey || 'dominio');
    return qRows(
      `SELECT a.id AS account_id, a.account_code, a.description, a.is_postable, a.active,
              m.id AS mapping_id, m.external_code, m.active AS mapping_active, m.updated_at
       FROM accounts a
       LEFT JOIN account_external_mappings m
         ON m.account_id=a.id AND m.company_id=? AND m.tenant_id=? AND m.system_key=?
       WHERE a.tenant_id=? AND a.account_type='A' AND a.is_postable=1
       ORDER BY a.account_code`,
      companyId, tenantId, key, tenantId
    ).map(row => ({
      account_id: row.account_id,
      account_code: row.account_code,
      description: row.description,
      active: !!row.active,
      mapping_id: row.mapping_id || null,
      external_code: row.external_code || '',
      mapping_active: row.mapping_id ? !!row.mapping_active : false,
      updated_at: row.updated_at || null
    }));
  }

  function getMap(tenantId, companyId, systemKey) {
    const rows = qRows(
      `SELECT account_id, external_code FROM account_external_mappings
       WHERE tenant_id=? AND company_id=? AND system_key=? AND active=1`,
      tenantId, companyId, systemKey
    );
    const map = new Map();
    for (const r of rows) map.set(r.account_id, String(r.external_code || '').trim());
    return map;
  }

  function upsert(tenantId, companyId, systemKey, accountId, externalCode, actorUserId) {
    const code = String(externalCode || '').trim();
    if (!code) {
      throw Object.assign(new Error('Informe o código Domínio.'), { code: 'EXTERNAL_CODE_REQUIRED', http: 400 });
    }
    const account = one(
      `SELECT id FROM accounts WHERE id=? AND tenant_id=? AND account_type='A' AND is_postable=1 AND active=1`,
      accountId, tenantId
    );
    if (!account) {
      throw Object.assign(new Error('Conta não encontrada ou não postável.'), { code: 'ACCOUNT_NOT_FOUND', http: 404 });
    }
    const company = one(`SELECT id FROM companies WHERE id=? AND tenant_id=?`, companyId, tenantId);
    if (!company) {
      throw Object.assign(new Error('Empresa não encontrada.'), { code: 'COMPANY_NOT_FOUND', http: 404 });
    }
    const existing = one(
      `SELECT id FROM account_external_mappings WHERE company_id=? AND account_id=? AND system_key=?`,
      companyId, accountId, systemKey
    );
    const now = new Date().toISOString();
    if (existing) {
      exec(
        `UPDATE account_external_mappings SET external_code=?, active=1, updated_at=? WHERE id=? AND tenant_id=?`,
        code, now, existing.id, tenantId
      );
      return one(`SELECT * FROM account_external_mappings WHERE id=?`, existing.id);
    }
    const mid = id();
    exec(
      `INSERT INTO account_external_mappings(id,tenant_id,company_id,account_id,system_key,external_code,active,created_at,updated_at)
       VALUES(?,?,?,?,?,?,1,?,?)`,
      mid, tenantId, companyId, accountId, systemKey, code, now, now
    );
    return one(`SELECT * FROM account_external_mappings WHERE id=?`, mid);
  }

  function deactivate(tenantId, companyId, systemKey, accountId) {
    const row = one(
      `SELECT id FROM account_external_mappings WHERE tenant_id=? AND company_id=? AND account_id=? AND system_key=?`,
      tenantId, companyId, accountId, systemKey
    );
    if (!row) {
      throw Object.assign(new Error('Mapeamento não encontrado.'), { code: 'MAPPING_NOT_FOUND', http: 404 });
    }
    exec(
      `UPDATE account_external_mappings SET active=0, updated_at=? WHERE id=? AND tenant_id=?`,
      new Date().toISOString(), row.id, tenantId
    );
    return { ok: true };
  }

  return { listAccountsWithMapping, getMap, upsert, deactivate };
}

module.exports = { createMappingService };
