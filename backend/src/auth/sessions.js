'use strict';

function createSessionService({ jwt, secret, one, exec }) {
  function issueToken(u, profile) {
    const tv = Number(u.token_version || 1);
    return jwt.sign(
      { sub: u.id, tenant_id: u.tenant_id, role: u.role, company_id: u.company_id || null, profile: profile || null, tv },
      secret,
      { algorithm: 'HS256', expiresIn: '12h' }
    );
  }

  function verifyAccess(payload) {
    if (!payload || !payload.sub) return { ok: false, code: 'INVALID_TOKEN' };
    const u = one('SELECT id, token_version, active FROM users WHERE id=? AND tenant_id=?', payload.sub, payload.tenant_id);
    if (!u) return { ok: false, code: 'INVALID_TOKEN' };
    const tv = Number(u.token_version || 1);
    if (payload.tv != null && Number(payload.tv) !== tv) return { ok: false, code: 'TOKEN_REVOKED' };
    return { ok: true, user: u };
  }

  function revoke(userId, tenantId) {
    exec('UPDATE users SET token_version=IFNULL(token_version,1)+1 WHERE id=? AND tenant_id=?', userId, tenantId);
  }

  return { issueToken, verifyAccess, revoke };
}

module.exports = { createSessionService };
