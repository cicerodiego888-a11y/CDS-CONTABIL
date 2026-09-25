'use strict';

const { isLocalhostUrl } = require('./config');

function isPrivateHostname(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function isUnsafePublicUrl(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (isLocalhostUrl(s)) return true;
  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return true;
    return isPrivateHostname(u.hostname);
  } catch {
    return true;
  }
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

/**
 * Origem pública para links do Portal (convite, reset, etc.).
 * Produção: CDS_EMAIL_APP_URL (se válida) ou CDS_OFFICE_PUBLIC_URL — nunca localhost.
 */
function resolveAppPublicUrl(opts) {
  const env = opts.env || {};
  const isProd = !!opts.isProd;
  const officePublicUrl = stripTrailingSlash(
    opts.officePublicUrl || env.CDS_OFFICE_PUBLIC_URL || env.PUBLIC_OFFICE_URL || ''
  );
  const fromEnvUrl = stripTrailingSlash(env.CDS_EMAIL_APP_URL || env.PUBLIC_URL || '');

  if (isProd) {
    let base = '';
    if (fromEnvUrl && !isUnsafePublicUrl(fromEnvUrl)) base = fromEnvUrl;
    else if (officePublicUrl && !isUnsafePublicUrl(officePublicUrl)) base = officePublicUrl;
    else if (fromEnvUrl && isUnsafePublicUrl(fromEnvUrl) && !officePublicUrl) {
      throw new Error('CDS_EMAIL_APP_URL cannot use localhost or private hosts in production.');
    } else if (!officePublicUrl && !fromEnvUrl) {
      throw new Error('CDS_OFFICE_PUBLIC_URL is required for public links in production.');
    } else {
      throw new Error('CDS_OFFICE_PUBLIC_URL cannot use localhost or private hosts in production.');
    }
    return base;
  }

  if (fromEnvUrl) return fromEnvUrl;
  const office = Number(env.PORT || opts.port || 3333) || 3333;
  const rawClient = env.CLIENT_PORT !== undefined ? env.CLIENT_PORT : opts.clientPort;
  const client = rawClient === '' || rawClient === '0' || rawClient === 0
    ? 0
    : Number(rawClient || office + 1);
  const port = client > 0 && client !== office ? client : office;
  return 'http://localhost:' + port;
}

/**
 * Origem pública do escritório (onboarding /ativar-escritorio).
 */
function resolveOfficePublicUrl(opts) {
  const env = opts.env || {};
  const isProd = !!opts.isProd;
  const explicit = stripTrailingSlash(
    opts.officePublicUrl || env.CDS_OFFICE_PUBLIC_URL || env.PUBLIC_OFFICE_URL || ''
  );

  if (isProd) {
    if (!explicit) throw new Error('CDS_OFFICE_PUBLIC_URL is required for public links in production.');
    if (isUnsafePublicUrl(explicit)) {
      throw new Error('CDS_OFFICE_PUBLIC_URL cannot use localhost or private hosts in production.');
    }
    return explicit;
  }

  if (explicit) return explicit;
  const office = Number(env.PORT || opts.port || 3333) || 3333;
  return 'http://localhost:' + office;
}

function portalPathUrl(appBase, subPath) {
  const base = stripTrailingSlash(appBase);
  const p = String(subPath || '').replace(/^\//, '');
  return base + '/portal/' + (p ? p.replace(/^\//, '') : '');
}

function invitePathUrl(appBase, token) {
  return stripTrailingSlash(appBase) + '/convite/' + String(token || '');
}

module.exports = {
  resolveAppPublicUrl,
  resolveOfficePublicUrl,
  portalPathUrl,
  invitePathUrl,
  isUnsafePublicUrl,
  isPrivateHostname,
  stripTrailingSlash
};
