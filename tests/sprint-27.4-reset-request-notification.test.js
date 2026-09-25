'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s274-'));
process.env.CDS_DB_PATH = path.join(tmp, 's274.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-sprint-27-4-secret-ok';
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
const { app, db, setEmailProvider, EVENT_TYPES } = require('../backend/src/server');

const password = 'Senha@123';
const newPassword = 'NovaSenha9';
const GENERIC = /Enviamos as instruções para o seu e-mail cadastrado/i;
let server, base;
let ownerA, accountantA, staffA, ownerB;
let companyA1, companyA2, companyB;
let clientAdmin, clientFinance, clientViewer, clientB;
let sentMails = [];
let slugA, slugB;

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
  assert.doesNotMatch(raw, /\/convite\/[a-f0-9]{32}/, label + ' invite token');
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
  return { token: acc.data.token, user: createRes.user };
}

before(async () => {
  setEmailProvider(createEmailProvider({
    send: async mail => { sentMails.push(mail); }
  }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await req('POST', '/api/auth/register', {
    name: 'Owner A', email: 'owner.s274a@test.local', password, tenantName: 'Tenant A 274'
  });
  ownerA = (await req('POST', '/api/auth/login', {
    email: 'owner.s274a@test.local', password, tenant: regA.data.tenant_slug
  })).data;
  slugA = regA.data.tenant_slug;

  await req('POST', '/api/usuarios', {
    name: 'Accountant A', email: 'acc.s274a@test.local', password, role: 'ACCOUNTANT'
  }, ownerA.token);
  accountantA = (await req('POST', '/api/auth/login', {
    email: 'acc.s274a@test.local', password, tenant: slugA
  })).data;

  await req('POST', '/api/usuarios', {
    name: 'Staff A', email: 'staff.s274a@test.local', password, role: 'STAFF'
  }, ownerA.token);
  staffA = (await req('POST', '/api/auth/login', {
    email: 'staff.s274a@test.local', password, tenant: slugA
  })).data;

  companyA1 = (await req('POST', '/api/empresas', {
    name: 'Empresa A1', trade_name: 'A1', cnpj: '11222333000181'
  }, ownerA.token)).data;
  companyA2 = (await req('POST', '/api/empresas', {
    name: 'Empresa A2', trade_name: 'A2', cnpj: '22333444000192'
  }, ownerA.token)).data;

  clientAdmin = await activateClient((await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'João Silva', email: 'joao.s274@test.local', profile: 'CLIENT_ADMIN'
  }, ownerA.token)).data);
  clientFinance = await activateClient((await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Financeiro', email: 'finance.s274@test.local', profile: 'CLIENT_FINANCE'
  }, ownerA.token)).data);
  clientViewer = await activateClient((await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Viewer', email: 'viewer.s274@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data);

  const regB = await req('POST', '/api/auth/register', {
    name: 'Owner B', email: 'owner.s274b@test.local', password, tenantName: 'Tenant B 274'
  });
  ownerB = (await req('POST', '/api/auth/login', {
    email: 'owner.s274b@test.local', password, tenant: regB.data.tenant_slug
  })).data;
  slugB = regB.data.tenant_slug;
  companyB = (await req('POST', '/api/empresas', {
    name: 'Empresa B', trade_name: 'B', cnpj: '33444555000103'
  }, ownerB.token)).data;
  clientB = await activateClient((await req('POST', `/api/empresas/${companyB.id}/users`, {
    name: 'Cliente B', email: 'client.s274b@test.local', profile: 'CLIENT_ADMIN'
  }, ownerB.token)).data);
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('1 Cliente solicita recuperação', async () => {
  sentMails = [];
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'joao.s274@test.local'
  });
  assert.equal(r.status, 200);
  assert.match(r.data.message, GENERIC);
  assert.equal(sentMails.length, 1);
});

test('2 Solicitação gera convite PASSWORD_RESET (e-mail automático)', async () => {
  const invite = db.prepare(
    "SELECT purpose,status FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).get(clientAdmin.user.id);
  assert.ok(invite);
  assert.equal(invite.status, 'PENDING');
});

test('3 Convite pertence à empresa correta', async () => {
  const invite = db.prepare(
    "SELECT company_id FROM client_invitations WHERE user_id=? AND purpose='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).get(clientAdmin.user.id);
  assert.equal(invite.company_id, companyA1.id);
});

test('4 Conclusão gera PASSWORD_RESET_COMPLETED com contexto', async () => {
  const mail = sentMails[sentMails.length - 1];
  const raw = String((mail && (mail.html || mail.text)) || '');
  const m = raw.match(/\/convite\/([a-f0-9]{64})/i);
  assert.ok(m, 'token no e-mail');
  const acc = await req('POST', '/api/invitations/' + m[1] + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(acc.status, 200);
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED && x.entity_id === clientAdmin.user.id);
  assert.ok(hit);
  assert.equal(hit.entity_type, 'client_user');
  assert.equal(hit.target_user_id, clientAdmin.user.id);
  assert.equal(hit.company_id, companyA1.id);
});

test('5 Notification não contém senha', async () => {
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  assertNoSecrets(n.data, 'notif list');
});

test('6 Notification não contém token', async () => {
  const rows = db.prepare(
    "SELECT title,message,context,type FROM notifications WHERE type=? ORDER BY created_at DESC LIMIT 20"
  ).all(EVENT_TYPES.PASSWORD_RESET_COMPLETED);
  assertNoSecrets(rows, 'notif db');
});

test('7 OWNER recebe PASSWORD_RESET_COMPLETED', async () => {
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  assert.ok((n.data.items || []).some(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED));
});

test('8 ACCOUNTANT recebe', async () => {
  const n = await req('GET', '/api/notificacoes', undefined, accountantA.token);
  assert.ok((n.data.items || []).some(x => x.entity_id === clientAdmin.user.id));
});

test('9 CLIENT não recebe PASSWORD_RESET_COMPLETED', async () => {
  const n = await req('GET', '/api/client/notificacoes', undefined, clientAdmin.token);
  assert.equal(n.status, 200);
  const items = Array.isArray(n.data) ? n.data : (n.data.items || []);
  assert.equal(items.filter(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED).length, 0);
});

test('10 CLIENT_VIEWER não recebe', async () => {
  const n = await req('GET', '/api/client/notificacoes', undefined, clientViewer.token);
  const items = Array.isArray(n.data) ? n.data : (n.data.items || []);
  assert.equal(items.filter(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED).length, 0);
});

test('11 CLIENT_FINANCE não recebe', async () => {
  const n = await req('GET', '/api/client/notificacoes', undefined, clientFinance.token);
  const items = Array.isArray(n.data) ? n.data : (n.data.items || []);
  assert.equal(items.filter(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED).length, 0);
});

test('12 Tenant A não recebe evento do Tenant B no forgot', async () => {
  await req('POST', '/api/auth/forgot-password', { tenant: slugB, email: 'client.s274b@test.local' });
  const nA = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  assert.equal((nA.data.items || []).filter(x => x.entity_id === clientB.user.id).length, 0);
});

test('13 Company A não acessa usuário da Company B', async () => {
  const created = await activateClient((await req('POST', `/api/empresas/${companyA2.id}/users`, {
    name: 'User A2', email: 'a2.s274@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data);
  await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'a2.s274@test.local' });
  const detail = await req('GET', `/api/empresas/${companyA1.id}/users/${created.user.id}`, undefined, ownerA.token);
  assert.equal(detail.status, 404);
  const ok = await req('GET', `/api/empresas/${companyA2.id}/users/${created.user.id}`, undefined, ownerA.token);
  assert.equal(ok.status, 200);
  const resetWrong = await req('POST', `/api/client-users/${created.user.id}/redefinir-acesso`, {}, ownerA.token, {
    'X-Company-Id': companyA1.id
  });
  assert.equal(resetWrong.status, 403);
});

test('14 Clique na notification abre o usuário correto (API context)', async () => {
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED && x.entity_id === clientAdmin.user.id);
  assert.ok(hit);
  const user = await req('GET', `/api/empresas/${hit.company_id}/users/${hit.target_user_id}`, undefined, ownerA.token);
  assert.equal(user.status, 200);
  assert.equal(user.data.id, clientAdmin.user.id);
  assert.equal(user.data.email, 'joao.s274@test.local');
});

test('15 Clique marca notification como lida', async () => {
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const hit = (n.data.items || []).find(x => x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED && x.entity_id === clientAdmin.user.id && !x.read_at);
  assert.ok(hit);
  const mark = await req('POST', `/api/notificacoes/${hit.id}/lida`, {}, ownerA.token);
  assert.equal(mark.status, 200);
  const again = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  const updated = (again.data.items || []).find(x => x.id === hit.id);
  assert.ok(updated.read_at);
});

test('16 Resposta permanece neutra em cliques repetidos', async () => {
  const a = await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'finance.s274@test.local' });
  const b = await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'finance.s274@test.local' });
  assert.equal(a.data.message, b.data.message);
  assert.match(a.data.message, GENERIC);
});

test('17 Resposta pública não revela se usuário existe', async () => {
  const missing = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'naoexiste.s274@test.local'
  });
  const exists = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'viewer.s274@test.local'
  });
  assert.equal(missing.status, 200);
  assert.equal(exists.status, 200);
  assert.equal(missing.data.message, exists.data.message);
  assert.doesNotMatch(missing.data.message, /não encontrado|encontrado|cadastrado com sucesso/i);
});

test('18 E-mail É enviado pelo Esqueci minha senha', async () => {
  sentMails = [];
  await req('POST', '/api/auth/forgot-password', { tenant: slugA, email: 'viewer.s274@test.local' });
  assert.equal(sentMails.length, 1);
});

test('19 Contador continua podendo executar Redefinir acesso', async () => {
  sentMails = [];
  const r = await req('POST', `/api/client-users/${clientViewer.user.id}/redefinir-acesso`, {}, ownerA.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.email_sent, true);
  assert.equal(sentMails.length, 1);
});

test('20 Sprint 27.3 continua funcionando — token PASSWORD_RESET', async () => {
  const reset = await req('POST', `/api/client-users/${clientFinance.user.id}/redefinir-acesso`, {}, accountantA.token);
  assert.equal(reset.status, 200);
  const tok = reset.data.activation_url.split('/convite/')[1];
  const view = await req('GET', '/api/invitations/' + tok);
  assert.equal(view.status, 200);
  assert.equal(view.data.purpose, 'PASSWORD_RESET');
});

test('21 Token PASSWORD_RESET continua funcionando', async () => {
  const reset = await req('POST', `/api/client-users/${clientAdmin.user.id}/redefinir-acesso`, {}, ownerA.token);
  const tok = reset.data.activation_url.split('/convite/')[1];
  const acc = await req('POST', '/api/invitations/' + tok + '/accept', {
    password: newPassword, confirmation: newPassword
  });
  assert.equal(acc.status, 200);
  assert.match(acc.data.message, /Senha criada/i);
});

test('22 Nova senha continua funcionando', async () => {
  const login = await req('POST', '/api/auth/login', {
    email: 'joao.s274@test.local', password: newPassword, tenant: slugA
  });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);
});

test('23 Sessões continuam sendo revogadas', async () => {
  const created = await activateClient((await req('POST', `/api/empresas/${companyA1.id}/users`, {
    name: 'Sessão', email: 'sess.s274@test.local', profile: 'CLIENT_VIEWER'
  }, ownerA.token)).data);
  const meBefore = await req('GET', '/api/auth/me', undefined, created.token);
  assert.equal(meBefore.status, 200);
  await req('POST', `/api/client-users/${created.user.id}/redefinir-acesso`, {}, ownerA.token);
  const meAfter = await req('GET', '/api/auth/me', undefined, created.token);
  assert.equal(meAfter.status, 401);
});

test('24 Auditoria de envio é criada', async () => {
  const rows = db.prepare(
    "SELECT action, after_json FROM audit_logs WHERE action='PASSWORD_RESET_EMAIL_SENT' ORDER BY created_at DESC LIMIT 20"
  ).all();
  assert.ok(rows.length > 0);
  assert.ok(rows.some(r => {
    try { return JSON.parse(r.after_json || '{}').result === 'ok'; } catch { return false; }
  }));
});

test('25 Nenhum segredo aparece na resposta', async () => {
  const r = await req('POST', '/api/auth/forgot-password', {
    tenant: slugA, email: 'viewer.s274@test.local'
  });
  assertNoSecrets(r.data, 'forgot');
  const n = await req('GET', '/api/notificacoes', undefined, ownerA.token);
  assertNoSecrets(n.data, 'notifs');
});

test('26 UI deep-link e forgot-password', () => {
  const portal = fs.readFileSync(path.join(__dirname, '../frontend/public/portal/portal.js'), 'utf8');
  assert.match(portal, /\/api\/auth\/forgot-password/);
  assert.match(portal, /Enviamos as instruções para o seu e-mail cadastrado/);
  assert.doesNotMatch(portal, /Solicitar redefinição/);
  const appJs = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
  assert.match(appJs, /PASSWORD_RESET_COMPLETED/);
  assert.match(appJs, /focusClientUserId/);
  assert.match(appJs, /Solicitação de redefinição de acesso/);
});

test('27 STAFF não recebe notificação de reset', async () => {
  const n = await req('GET', '/api/notificacoes', undefined, staffA.token);
  assert.equal(n.status, 200);
  assert.equal((n.data.items || []).filter(x =>
    x.type === EVENT_TYPES.PASSWORD_RESET_COMPLETED || x.type === EVENT_TYPES.PASSWORD_RESET_FAILED
  ).length, 0);
});

test('28 integrity e foreign keys', () => {
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
