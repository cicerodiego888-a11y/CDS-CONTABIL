'use strict';

function resolveVapid(env = process.env) {
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.WEB_PUSH_VAPID_SUBJECT || 'mailto:suporte@cdscontabil.local').trim();
  return {
    configured: !!(publicKey && privateKey),
    publicKey,
    privateKey,
    subject
  };
}

module.exports = { resolveVapid };
