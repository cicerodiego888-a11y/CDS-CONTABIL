'use strict';
const Database = require('better-sqlite3');
const db = new Database('database/cds-contabil-connect.db');

const rows = db.prepare(`
  SELECT id, template_key, event_type, status, created_at, payload_json
  FROM communication_jobs
  WHERE template_key IN ('password-reset','user-invite') OR event_type IN ('PASSWORD_RESET','USER_INVITE')
  ORDER BY created_at DESC
  LIMIT 8
`).all();

for (const r of rows) {
  let p = {};
  try { p = JSON.parse(r.payload_json || '{}'); } catch {}
  const keys = Object.keys(p).sort();
  const hasUrl = Object.prototype.hasOwnProperty.call(p, 'url');
  const hasHtml = Object.prototype.hasOwnProperty.call(p, 'html');
  const urlVal = typeof p.url === 'string' ? p.url : '';
  console.log(JSON.stringify({
    id: r.id.slice(0, 8),
    template_key: r.template_key,
    event_type: r.event_type,
    status: r.status,
    created_at: r.created_at,
    payload_keys: keys,
    has_url: hasUrl,
    has_html: hasHtml,
    url_empty: hasUrl ? !urlVal.trim() : null,
    url_has_convite: hasUrl ? /\/convite\//.test(urlVal) : null,
    // never print token
    url_host: hasUrl && urlVal ? (() => { try { return new URL(urlVal).origin; } catch { return 'invalid'; } })() : null
  }));
}
