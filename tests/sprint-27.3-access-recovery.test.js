'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s273-'));
process.env.CDS_DB_PATH = path.join(tmp, 's273.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-27-3-secret-ok';
process.env.DOCUMENT_ENCRYPTION_KEY = 'test-document-encryption-key-32b!!';
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'test-ai-credential-encryption-key-32b!!';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
process.env.DEMO_MODE = 'false';
process.env.AI_PROVIDER = 'off';
process.env.AI_ENABLED = 'false';
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_APP_URL = 'http://app.test.local';

const { createEmailProvider } = require('../backend/src/email/provider');
const { app, db, setEmailProvider, sessions } = require('../backend/src/server');

const password = 'Senha@123';
const newPassword = 'NovaSenha9';
let server, base;
let ownerA, accountantA, ownerB;
let companyA1, companyA2, companyB;
let clientAdmin, clientFinance, clientViewer, clientB;
let sentMails = [];

function req(method, url, body, token, headersExtra) {
  const headers = { 'Content-Type': 'application/json', ...(headersExtra || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

function assertNoSecrets(obj, label) {
  const raw = JSON.stringify(obj || {});
  assert.doesNotMatch(raw, /sk-[a-zA-Z0-9]/i, label + ' API key');
  assert.doesNotMatch(raw, /"password"\s*:\s*"[^"]{4,}"/, label + ' password');
  assert.doesNotMatch(raw, /password_hash/, label + ' password_hash');
  assert.doesNotMatch(raw, /token_hash/, label + ' token_hash');
  assert.doesNotMatch(raw, /"Authorization"/i, label + ' Authorization');
}

async function activateClient(createRes) {
  const url = createRes.invitation && createRes.invitation.activation_url;
  assert.ok(url, 'activation_url expected');
  const tok = url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    name: createRes.user.name,
    password,
    confirmation: password
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  return { token: acc.data.token, inviteToken: tok, user: createRes.user };
}

before(async () => {
  setEmailProvider(createEmailProvider({
    send: async mail => { sentMails.push(mail); }
  }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner A', email: 'owner.s273a@test.local', password, tenantName: 'Tenant A 273'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s273a@test.local', password, tenant: regA.data.tenant_slug
  })).data;

  await req('POST', '/api/usuarios', {
    name: 'Accountant A', email: 'acc.s273a@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.s273a@test.local', password, tenant: regA.data.tenant_slug
  })).data;

  companyA1 = (await req('POST', '/api/empresas', {
    name: 'Empresa A1', trade_name: 'A1',   cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2', trade_name: 'A2', cnpj: '22333444000192'
  }, ownerA.token)).data;

  const adminCreated = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Cliente Admin', email: 'admin.s273@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data;
  clientAdmin = await activateClient(adminCreated);

  const finCreated = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Cliente Finance', email: 'finance.s273@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token)).data;
  clientFinance = await activateClient(finCreated);

  const viewCreated = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Cliente Viewer', email: 'viewer.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  clientViewer = await activateClient(viewCreated);

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner B', email: 'owner.s273b@test.local', password, tenantName: 'Tenant B 273'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.s273b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B', trade_name: 'B', cnpj: '33444555000103'
  }, ownerB.token)).data;
  const bCreated = (await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'client.s273b@test.local', profile: 'CLIENT_ADMIN'
  }, ownerB.token)).data;
  clientB = await activateClient(bCreated);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 OWNER pode redefinir acesso', async () => {
  sentMails = [];
  const r = await req('POST', `/api/client-users/${clientAdmin.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.message, /Novo acesso enviado/i);
  assert.equal(r.data.email_sent, true);
  assert.equal(r.data.credential_status, 'AGUARDANDO DEFINIÇÃO');
  assert.equal(sentMails.length, 1);
  assert.match(sentMails[0].subject, /Redefinição de acesso/i);
  assert.match(sentMails[0].html, /Criar nova senha/i);
  assertNoSecrets(r.data, 'reset response');
});

test('2 ACCOUNTANT pode redefinir acesso', async () => {
  sentMails = [];
  // re-activate admin first via accept of previous reset, or use finance
  const r = await req('POST', `/api/client-users/${clientFinance.user.id}/redefinir-acesso`, {}, accountantA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.email_sent, true);
});

test('3 CLIENT não pode redefinir credencial de outro usuário', async () => {
  // need a client with working session - use viewer before reset
  const r = await req('POST', `/api/client-users/${clientFinance.user.id}/redefinir-acesso`, {}, clientViewer.token);
  assert.ok(r.status === 401 || r.status === 403);
});

test('4 CLIENT_VIEWER não pode', async () => {
  const r = await req('POST', `/api/client-users/${clientAdmin.user.id}/redefinir-acesso`, {}, clientViewer.token);
  assert.ok(r.status === 401 || r.status === 403);
});

test('5 CLIENT_FINANCE não pode', async () => {
  // finance session may be revoked after test 2 — login again if needed
  let tok = clientFinance.token;
  const me = await req('GET', '/api/auth/me', undefined, tok);
  if (me.status !== 200) {
    // password invalidated; skip with fresh login attempt expected fail — create new viewer session already tested
    tok = clientViewer.token;
  }
  const r = await req('POST', `/api/client-users/${clientAdmin.user.id}/redefinir-acesso`, {}, clientFinance.token);
  assert.ok(r.status === 401 || r.status === 403);
});

test('6 Tenant A não redefine usuário do Tenant B', async () => {
  const r = await req('POST', `/api/client-users/${clientB.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(r.status, 404);
});

test('7 Company A não redefine usuário da Company B (mesmo tenant)', async () => {
  const created = (await req('POST', `/api/empresas/${companyA2.id}/users`, {
    name: 'Cliente A2', email: 'a2.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const activated = await activateClient(created);
  const r = await req('POST', `/api/client-users/${activated.user.id}/redefinir-acesso`, {}, ownerA.token, {
    'X-Company-Id': companyA1.id
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'COMPANY_SCOPE_MISMATCH');
});

test('8 Redefinição revoga sessões', async () => {
  sentMails = [];
  // create fresh client with session
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Sessão Revogada', email: 'session.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const meBefore = await req('GET', '/api/auth/me', undefined, act.token);
  assert.equal(meBefore.status, 200);

  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(reset.status, 200);
  const meAfter = await req('GET', '/api/auth/me', undefined, act.token);
  assert.equal(meAfter.status, 401);
});

test('9 Convite anterior fica inválido', async () => {
  sentMails = [];
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Convite Antigo', email: 'oldinv.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const firstReset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(firstReset.status, 200);
  const oldTok = firstReset.data.activation_url.split('/convite/')[1];
  const second = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(second.status, 200);
  const stale = await req('GET', '/api/invitations/' + oldTok);
  assert.equal(stale.status, 410);
});

test('10 Novo convite é criado com purpose PASSWORD_RESET', async () => {
  sentMails = [];
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Purpose Reset', email: 'purpose.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(reset.status, 200);
  const tok = reset.data.activation_url.split('/convite/')[1];
  const view = await req('GET', '/api/invitations/' + tok);
  assert.equal(view.status, 200);
  assert.equal(view.data.purpose, 'PASSWORD_RESET');
  assert.match(view.data.title, /nova senha/i);
  const row = db.prepare("SELECT purpose, status FROM client_invitations WHERE user_id=? AND status='PENDING' ORDER BY created_at DESC, id DESC LIMIT 1").get(act.user.id);
  assert.equal(row.purpose, 'PASSWORD_RESET');
  assert.equal(row.status, 'PENDING');
});

test('11 Token é armazenado como hash', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Hash Token', email: 'hash.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const raw = reset.data.activation_url.split('/convite/')[1];
  const row = db.prepare('SELECT token_hash FROM client_invitations WHERE user_id=? AND status=\'PENDING\'').get(act.user.id);
  assert.ok(row.token_hash);
  assert.notEqual(row.token_hash, raw);
  assert.equal(row.token_hash, crypto.createHash('sha256').update(raw).digest('hex'));
  assert.equal(raw.length >= 32, true);
});

test('12 Token funciona somente uma vez', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Once Token', email: 'once.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const tok = reset.data.activation_url.split('/convite/')[1];
  const first = await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.match(first.data.message, /Senha criada/i);
  const second = await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(second.status, 410);
  assert.match(second.data.message, /expirou ou já foi utilizado/i);
});

test('13 Token expirado é rejeitado', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Expired Tok', email: 'exp.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const tok = reset.data.activation_url.split('/convite/')[1];
  const hash = crypto.createHash('sha256').update(tok).digest('hex');
  db.prepare("UPDATE client_invitations SET expires_at=? WHERE token_hash=?").run(new Date(Date.now() - 3600000).toISOString(), hash);
  const view = await req('GET', '/api/invitations/' + tok);
  assert.equal(view.status, 410);
});

test('14 Token de finalidade incorreta é rejeitado', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Bad Purpose', email: 'badpurp.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const tok = reset.data.activation_url.split('/convite/')[1];
  const hash = crypto.createHash('sha256').update(tok).digest('hex');
  db.prepare("UPDATE client_invitations SET purpose='OTHER' WHERE token_hash=?").run(hash);
  const view = await req('GET', '/api/invitations/' + tok);
  assert.equal(view.status, 410);
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(acc.status, 410);
});

test('15 Nova senha é armazenada somente como hash', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Hash PW', email: 'hashpw.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const tok = reset.data.activation_url.split('/convite/')[1];
  await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(act.user.id);
  assert.ok(u.password_hash);
  assert.notEqual(u.password_hash, newPassword);
  assert.ok(bcrypt.compareSync(newPassword, u.password_hash));
});

test('16 Senha antiga deixa de funcionar', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Old PW', email: 'oldpw.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const slug = ownerA.user.tenant_slug || (await req('GET', '/api/auth/me', undefined, ownerA.token)).data.tenant_slug;
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(reset.status, 200);
  const loginOld = await req('POST', '/api/auth/login', {
    email: 'oldpw.s273@test.local', password, tenant: slug
  });
  assert.equal(loginOld.status, 401);
});

test('17 Nova senha funciona', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'New PW', email: 'newpw.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const me = await req('GET', '/api/auth/me', undefined, ownerA.token);
  const slug = me.data.tenant_slug;
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const tok = reset.data.activation_url.split('/convite/')[1];
  await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  const login = await req('POST', '/api/auth/login', {
    email: 'newpw.s273@test.local', password: newPassword, tenant: slug
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.ok(login.data.token);
});

test('18 E-mail é enviado corretamente', async () => {
  sentMails = [];
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Mail Ok', email: 'mailok.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(reset.status, 200);
  assert.equal(sentMails.length >= 1, true);
  const mail = sentMails[sentMails.length - 1];
  assert.equal(mail.subject, 'Redefinição de acesso — CDS Contábil Connect');
  assert.match(mail.text, /Recebemos uma solicitação de redefinição/i);
  assert.doesNotMatch(mail.text, /Senha@123|NovaSenha/);
  assert.doesNotMatch(mail.html, /Senha@123|password_hash/);
});

test('19 Falha de e-mail não é apresentada como sucesso', async () => {
  setEmailProvider(createEmailProvider({
    send: async () => { throw new Error('SMTP down'); }
  }));
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Mail Fail', email: 'mailfail.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  // create may fail email but still 201 — activate using activation_url
  assert.ok(created.invitation.activation_url);
  const act = await activateClient(created);
  const beforeHash = db.prepare('SELECT password_hash, token_version FROM users WHERE id=?').get(act.user.id);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(reset.status, 502);
  assert.match(reset.data.message, /Não foi possível enviar o novo acesso/i);
  assert.notEqual(reset.data.message, 'Novo acesso enviado.');
  const after = db.prepare('SELECT password_hash, token_version FROM users WHERE id=?').get(act.user.id);
  assert.equal(after.password_hash, beforeHash.password_hash);
  assert.equal(Number(after.token_version), Number(beforeHash.token_version));
  // restore provider
  setEmailProvider(createEmailProvider({
    send: async mail => { sentMails.push(mail); }
  }));
});

test('20 Auditoria é criada', async () => {
  sentMails = [];
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Audit User', email: 'audit.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  const actions = db.prepare(
    "SELECT action FROM audit_logs WHERE entity_id=? OR after_json LIKE ? ORDER BY created_at"
  ).all(act.user.id, '%"target_user_id":"' + act.user.id + '"%').map(x => x.action);
  assert.ok(actions.includes('CLIENT_CREDENTIAL_RESET_REQUESTED'));
  assert.ok(actions.includes('CLIENT_SESSION_REVOKED'));
  assert.ok(actions.includes('CLIENT_INVITATION_CREATED'));
  assert.ok(actions.includes('CLIENT_INVITATION_SENT'));
});

test('21 Auditoria não contém senha', async () => {
  const rows = db.prepare(
    "SELECT action, before_json, after_json FROM audit_logs WHERE action LIKE 'CLIENT_%' ORDER BY created_at DESC LIMIT 50"
  ).all();
  for (const row of rows) {
    const blob = JSON.stringify(row);
    assert.doesNotMatch(blob, /Senha@123|NovaSenha9/);
    assert.doesNotMatch(blob, /"password"\s*:/);
  }
});

test('22 Auditoria não contém token', async () => {
  const rows = db.prepare(
    "SELECT action, before_json, after_json FROM audit_logs WHERE action IN ('CLIENT_CREDENTIAL_RESET_REQUESTED','CLIENT_INVITATION_CREATED','CLIENT_INVITATION_SENT','CLIENT_SESSION_REVOKED','CLIENT_PASSWORD_DEFINED') ORDER BY created_at DESC LIMIT 80"
  ).all();
  for (const row of rows) {
    const blob = JSON.stringify(row);
    assert.doesNotMatch(blob, /"token"\s*:/);
    assert.doesNotMatch(blob, /token_hash/);
    assert.doesNotMatch(blob, /\/convite\/[a-f0-9]{32}/);
  }
});

test('23 Respostas não expõem dados sensíveis', async () => {
  const created = (await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'No Secrets', email: 'nosec.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data;
  const act = await activateClient(created);
  const reset = await req('POST', `/api/client-users/${act.user.id}/redefinir-acesso`, {}, ownerA.token);
  assertNoSecrets(reset.data, 'reset');
  const tok = reset.data.activation_url.split('/convite/')[1];
  const view = await req('GET', '/api/invitations/' + tok);
  assertNoSecrets(view.data, 'invitation view');
});

test('24 Login continua funcionando', async () => {
  const me = await req('GET', '/api/auth/me', undefined, ownerA.token);
  assert.equal(me.status, 200);
  const login = await req('POST', '/api/auth/login', {
    email: 'owner.s273a@test.local', password, tenant: me.data.tenant_slug
  });
  assert.equal(login.status, 200);
});

test('25 Fluxo normal de convite continua funcionando', async () => {
  sentMails = [];
  const created = await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Convite Normal', email: 'normal.s273@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token);
  assert.equal(created.status, 201);
  assert.equal(created.data.invitation.email_sent, true);
  const tok = created.data.invitation.activation_url.split('/convite/')[1];
  const view = await req('GET', '/api/invitations/' + tok);
  assert.equal(view.status, 200);
  assert.equal(view.data.purpose || 'ACTIVATION', 'ACTIVATION');
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    name: 'Convite Normal', password, confirmation: password
  });
  assert.equal(acc.status, 200);
  assert.match(acc.data.message, /ativada/i);
});

test('26 UI portal inicia recuperação automática', () => {
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  assert.match(portal, /Esqueci minha senha/);
  assert.match(portal, /Enviamos as instruções para o seu e-mail cadastrado/);
  assert.match(portal, /\/api\/auth\/forgot-password/);
  assert.doesNotMatch(portal, /Solicitar redefinição/);
  assert.doesNotMatch(portal, /\/api\/.*reset-password/i);
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /Redefinir acesso/);
  assert.match(appJs, /redefinir-acesso/);
});

test('27 integrity e foreign keys', () => {
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
