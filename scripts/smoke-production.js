'use strict';

/**
 * Sprint 40.3 — smoke test contra URL pública de produção.
 * Não altera banco. Não imprime segredos.
 *
 * Uso:
 *   PRODUCTION_BASE_URL=https://DOMINIO_REAL node scripts/smoke-production.js
 */

const base = String(process.env.PRODUCTION_BASE_URL || process.argv[2] || '').replace(/\/$/, '');

function fail(msg) {
  console.log('FAIL', msg);
  process.exitCode = 2;
}

function pass(msg) {
  console.log('PASS', msg);
}

function warn(msg) {
  console.log('WARN', msg);
}

async function main() {
  console.log('========================================');
  console.log('CDS CONTÁBIL CONNECT — SMOKE PRODUCTION');
  console.log('========================================');

  if (!base) {
    fail('PRODUCTION_BASE_URL ausente (ex.: https://contabil.exemplo.com)');
    console.log('STATUS: BLOCKED — domínio/servidor ainda não informado');
    return;
  }

  if (/localhost|127\.0\.0\.1/i.test(base)) {
    fail('URL pública não pode ser localhost');
    return;
  }

  if (!/^https:\/\//i.test(base)) {
    fail('URL pública deve ser https://');
    return;
  }

  pass('BASE_URL=' + base.replace(/^https:\/\//i, 'https://***'));

  // HTTP → HTTPS redirect
  try {
    const httpUrl = base.replace(/^https:/i, 'http:');
    const r = await fetch(httpUrl, { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    if ([301, 302, 307, 308].includes(r.status) && /^https:\/\//i.test(loc)) {
      pass('HTTP_REDIRECT → HTTPS');
    } else if (r.status === 200 && r.url && r.url.startsWith('https:')) {
      pass('HTTP_REDIRECT (seguido pelo cliente)');
    } else {
      warn('HTTP_REDIRECT não confirmado (status ' + r.status + ') — verifique o proxy');
    }
  } catch (e) {
    warn('HTTP_REDIRECT não testável: ' + (e && e.message));
  }

  // Health
  try {
    const r = await fetch(base + '/api/health', { redirect: 'follow' });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 200 || !j.ok) {
      fail('HEALTH status=' + r.status + ' ok=' + String(j.ok));
    } else {
      pass('HEALTH 200 ok=true');
    }
    const blob = JSON.stringify(j);
    if (/localhost|127\.0\.0\.1/i.test(blob)) fail('HEALTH revela localhost');
    else pass('HEALTH sem localhost');
    if (/JWT_SECRET|DOCUMENT_ENCRYPTION|password|BEGIN PRIVATE/i.test(blob)) fail('HEALTH vaza segredo');
    else pass('HEALTH sem segredos óbvios');
  } catch (e) {
    fail('HEALTH request: ' + (e && e.message));
  }

  // Front
  try {
    const r = await fetch(base + '/', { redirect: 'follow' });
    if (r.status === 200) pass('FRONT / HTTP 200');
    else fail('FRONT / status=' + r.status);
  } catch (e) {
    fail('FRONT /: ' + (e && e.message));
  }

  try {
    const r = await fetch(base + '/portal/', { redirect: 'follow' });
    if (r.status === 200) pass('PORTAL /portal/ HTTP 200');
    else fail('PORTAL status=' + r.status);
  } catch (e) {
    fail('PORTAL: ' + (e && e.message));
  }

  console.log('STATUS:', process.exitCode === 2 ? 'FAIL' : 'PASS');
  console.log('Nota: onboarding/login/SMTP/isolamento exigem smoke manual com conta real.');
}

main();
