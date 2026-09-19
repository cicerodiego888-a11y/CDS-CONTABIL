'use strict';
const path = require('path');
const { passwordReset } = require('../backend/src/communications/email/templates');
const { invitationEmail } = require('../backend/src/email/template');

const base = 'http://localhost:3333';
const fakeTok = 'abc123TOKENPLACEHOLDERXYZ';
const url = base + '/convite/' + fakeTok;

const reset = passwordReset({
  name: 'Cliente',
  company: 'Empresa',
  url,
  branding: { office_name: 'Demo' }
});
const act = invitationEmail({ name: 'Cliente', company: 'Empresa', url });

function inspect(label, html) {
  const m = html.match(/<a\s+[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i);
  const href = m && m[1];
  console.log(JSON.stringify({
    label,
    hasAnchor: !!m,
    hrefEmpty: !href,
    hrefLen: href ? href.length : 0,
    startsWithBase: !!(href && href.startsWith(base + '/convite/')),
    hasPlaceholder: !!(href && href.includes(fakeTok)),
    cta: m && m[2],
    bad: !!(href && /undefined|null/i.test(href)),
    hrefRedacted: href ? href.replace(fakeTok, '[REDACTED]') : null
  }, null, 2));
}

inspect('PASSWORD_RESET', reset.html);
inspect('ACTIVATION', act.html);
console.log('subject', reset.subject);

const empty = passwordReset({ name: 'X', url: '', branding: {} });
const m2 = empty.html.match(/href="([^"]*)"/i);
console.log(JSON.stringify({
  emptyUrlHref: m2 && m2[1],
  emptyHrefLen: m2 && m2[1] ? m2[1].length : 0
}));
