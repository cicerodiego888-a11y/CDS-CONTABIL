'use strict';

/**
 * Sprint 40.3.1 — hardening de produção (URLs, cookie, backup, gitignore, headers).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const cp = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

const {
  resolveAppPublicUrl,
  resolveOfficePublicUrl,
  portalPathUrl,
  invitePathUrl,
  isUnsafePublicUrl
} = require('../backend/src/public-urls');
const {
  loadConfig,
  assertProductionPublicUrl,
  isLocalhostUrl
} = require('../backend/src/config');

test('produção nunca gera link público localhost', () => {
  const base = resolveAppPublicUrl({
    isProd: true,
    env: {
      CDS_OFFICE_PUBLIC_URL: 'https://contabil.exemplo.com',
      CDS_EMAIL_APP_URL: ''
    },
    officePublicUrl: 'https://contabil.exemplo.com'
  });
  assert.equal(base, 'https://contabil.exemplo.com');
  const invite = invitePathUrl(base, 'abc');
  const portal = portalPathUrl(base, '');
  assert.equal(invite, 'https://contabil.exemplo.com/convite/abc');
  assert.equal(portal, 'https://contabil.exemplo.com/portal/');
  assert.doesNotMatch(invite, /localhost|127\.0\.0\.1/);
  assert.doesNotMatch(portal, /localhost|127\.0\.0\.1/);
  assert.match(portal, /\/portal\//);
});

test('produção: convite e recuperação usam origem CDS_OFFICE_PUBLIC_URL', () => {
  const office = 'https://contabil.exemplo.com';
  const base = resolveAppPublicUrl({
    isProd: true,
    env: { CDS_OFFICE_PUBLIC_URL: office },
    officePublicUrl: office
  });
  assert.equal(invitePathUrl(base, 'tok'), office + '/convite/tok');
  assert.equal(portalPathUrl(base, 'docs'), office + '/portal/docs');
  assert.equal(
    resolveOfficePublicUrl({ isProd: true, env: { CDS_OFFICE_PUBLIC_URL: office }, officePublicUrl: office }),
    office
  );
});

test('produção: CDS_EMAIL_APP_URL localhost é ignorado em favor de CDS_OFFICE_PUBLIC_URL', () => {
  const base = resolveAppPublicUrl({
    isProd: true,
    env: {
      CDS_EMAIL_APP_URL: 'http://localhost:3334',
      CDS_OFFICE_PUBLIC_URL: 'https://contabil.exemplo.com'
    },
    officePublicUrl: 'https://contabil.exemplo.com'
  });
  assert.equal(base, 'https://contabil.exemplo.com');
  assert.throws(
    () => resolveAppPublicUrl({
      isProd: true,
      env: { CDS_EMAIL_APP_URL: 'http://localhost:3334' },
      officePublicUrl: ''
    }),
    /localhost|CDS_EMAIL_APP_URL|CDS_OFFICE_PUBLIC_URL/
  );
});

test('produção: sem URL pública retorna erro explícito', () => {
  assert.throws(
    () => resolveAppPublicUrl({ isProd: true, env: {}, officePublicUrl: '' }),
    /CDS_OFFICE_PUBLIC_URL/
  );
  assert.throws(
    () => assertProductionPublicUrl({ CDS_OFFICE_PUBLIC_URL: 'http://localhost' }),
    /localhost/
  );
  assert.throws(
    () => assertProductionPublicUrl({ CDS_OFFICE_PUBLIC_URL: 'http://contabil.exemplo.com' }),
    /https/i
  );
});

test('desenvolvimento preserva CDS_EMAIL_APP_URL / localhost dual-port', () => {
  assert.equal(
    resolveAppPublicUrl({
      isProd: false,
      env: { CDS_EMAIL_APP_URL: 'http://app.test.local', PORT: '3333', CLIENT_PORT: '3334' }
    }),
    'http://app.test.local'
  );
  assert.equal(
    resolveAppPublicUrl({
      isProd: false,
      env: { PORT: '3333', CLIENT_PORT: '3334' }
    }),
    'http://localhost:3334'
  );
  assert.equal(
    resolveAppPublicUrl({
      isProd: false,
      env: { PORT: '3333', CLIENT_PORT: '0' }
    }),
    'http://localhost:3333'
  );
});

test('preflight valida URL pública HTTPS e rejeita localhost', () => {
  const script = path.join(root, 'scripts/preflight-production.js');
  const failEnv = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'strong-production-secret-40x',
    DOCUMENT_ENCRYPTION_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    CDS_OFFICE_PUBLIC_URL: 'http://localhost:3333',
    CDS_CORS_ORIGIN: 'https://contabil.exemplo.com',
    CDS_AUTH_COOKIE: 'true',
    CLIENT_PORT: '0',
    DEMO_MODE: 'false'
  };
  const r = cp.spawnSync(process.execPath, [script], { cwd: root, env: failEnv, encoding: 'utf8' });
  const out = String(r.stdout || '') + String(r.stderr || '');
  assert.match(out, /FAIL CDS_OFFICE_PUBLIC_URL/);
  assert.doesNotMatch(out, /strong-production-secret-40x/);

  const okEnv = {
    ...failEnv,
    CDS_OFFICE_PUBLIC_URL: 'https://contabil.exemplo.com',
    CDS_CORS_ORIGIN: 'https://contabil.exemplo.com',
    CDS_DB_PATH: path.join(os.tmpdir(), 'cds-preflight-s4031.db'),
    UPLOAD_DIR: path.join(os.tmpdir(), 'cds-up-s4031'),
    EXPORT_DIR: path.join(os.tmpdir(), 'cds-ex-s4031'),
    BACKUP_DIR: path.join(os.tmpdir(), 'cds-bk-s4031')
  };
  const r2 = cp.spawnSync(process.execPath, [script], { cwd: root, env: okEnv, encoding: 'utf8' });
  const out2 = String(r2.stdout || '') + String(r2.stderr || '');
  assert.match(out2, /PASS CDS_OFFICE_PUBLIC_URL/);
  assert.match(out2, /PASS BACKUP_DIR|PASS CDS_DB_PATH/);
});

test('gitignore protege databases em subdiretórios', () => {
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gi, /database\/\*\*\/\*\.db/);
  assert.match(gi, /database\/\*\*\/\*\.db-wal/);
  assert.match(gi, /database\/\*\*\/\*\.db-shm/);
  assert.match(gi, /test-output\.txt/);
});

test('BACKUP_DIR é configurável e fora de dist-production', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-bk-'));
  const cfg = loadConfig({
    NODE_ENV: 'development',
    CDS_DB_PATH: path.join(tmp, 'x.db'),
    BACKUP_DIR: path.join(tmp, 'offsite-backups'),
    JWT_SECRET: 'dev'
  });
  assert.equal(cfg.BACKUP_DIR, path.join(tmp, 'offsite-backups'));
  const backupSrc = fs.readFileSync(path.join(root, 'scripts/backup.js'), 'utf8');
  assert.match(backupSrc, /BACKUP_DIR/);
  assert.doesNotMatch(backupSrc, /dist-production/);
  const docs = fs.readFileSync(path.join(root, 'docs/BACKUP-PRODUCAO.md'), 'utf8');
  assert.match(docs, /BACKUP_DIR/);
  assert.match(docs, /offsite|externa/i);
  assert.match(docs, /DOCUMENT_ENCRYPTION_KEY/);
  assert.match(docs, /piloto/i);
});

test('código de produção não hardcoda URL pública localhost', () => {
  const files = [
    'backend/src/public-urls.js',
    'backend/src/config.js'
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /CDS_OFFICE_PUBLIC_URL\s*=\s*['\"]http:\/\/localhost/);
  }
  const urls = fs.readFileSync(path.join(root, 'backend/src/public-urls.js'), 'utf8');
  assert.match(urls, /isProd/);
  assert.match(urls, /localhost/);
});

test('security headers incluem Permissions-Policy e CSP compatível', () => {
  const src = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  assert.match(src, /Permissions-Policy/);
  assert.match(src, /Content-Security-Policy/);
  assert.match(src, /Strict-Transport-Security/);
  const nginx = fs.readFileSync(path.join(root, 'deploy/nginx/cds-contabil.conf.example'), 'utf8');
  assert.match(nginx, /Strict-Transport-Security/);
  assert.match(nginx, /database\|backups\|logs/);
});

test('frontend cookie mode não exige localStorage para sessão', () => {
  const appJs = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
  const portalJs = fs.readFileSync(path.join(root, 'frontend/public/portal/portal.js'), 'utf8');
  assert.match(appJs, /authCookieMode|auth_cookie/);
  assert.match(appJs, /credentials:\s*['\"]include['\"]/);
  assert.match(appJs, /localStorage\.removeItem\(['\"]ccc_office_token['\"]\)/);
  assert.match(portalJs, /authCookieMode|auth_cookie/);
  assert.match(portalJs, /credentials:\s*['\"]include['\"]/);
});

test('AUTH_COOKIE login define cookie HttpOnly e sessão via cookie', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s4031-auth-'));
  const dbPath = path.join(tmp, 'auth.db');
  const child = `
    const path=require('path');
    const http=require('http');
    const fs=require('fs');
    process.env.CDS_DB_PATH=${JSON.stringify(dbPath)};
    process.env.UPLOAD_DIR=${JSON.stringify(path.join(tmp, 'uploads'))};
    process.env.EXPORT_DIR=${JSON.stringify(path.join(tmp, 'exports'))};
    process.env.JWT_SECRET='test-s4031-cookie-secret!!';
    process.env.DOCUMENT_ENCRYPTION_KEY='test-document-encryption-key-32b!!';
    process.env.DEMO_MODE='false';
    process.env.CDS_COMMS_WORKER='off';
    process.env.CDS_AUTH_COOKIE='true';
    process.env.NODE_ENV='development';
    process.env.CDS_OFFICE_PUBLIC_URL='https://contabil.exemplo.com';
    const {app,db}=require('./backend/src/server');
    const server=http.createServer(app);
    server.listen(0,'127.0.0.1',async()=>{
      const base='http://127.0.0.1:'+server.address().port;
      const reg=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Own',email:'own.s4031@test.local',password:'Senha@123',tenantName:'S4031 Cookie Co'})});
      const regJ=await reg.json();
      if(reg.status!==201){console.error('REG',reg.status,regJ);process.exit(2)}
      const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'own.s4031@test.local',password:'Senha@123',tenant:regJ.tenant_slug})});
      const setCookie=login.headers.getSetCookie?login.headers.getSetCookie():[];
      const list=setCookie.length?setCookie:[String(login.headers.get('set-cookie')||'')];
      const sessionLine=list.find(c=>/cds_session=/.test(c))||'';
      if(!sessionLine){console.error('NO_COOKIE',list);process.exit(3)}
      if(!/HttpOnly/i.test(sessionLine)){console.error('NO_HTTPONLY',sessionLine);process.exit(4)}
      const cookiePair=sessionLine.split(';')[0];
      const health=await (await fetch(base+'/api/health')).json();
      if(!health.auth_cookie){console.error('HEALTH',health);process.exit(5)}
      const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookiePair}});
      if(me.status!==200){console.error('ME',me.status,await me.text());process.exit(6)}
      const hdrs=await fetch(base+'/api/health');
      const csp=hdrs.headers.get('content-security-policy')||'';
      const pp=hdrs.headers.get('permissions-policy')||'';
      if(!csp||!pp){console.error('HEADERS',csp,pp);process.exit(7)}
      console.log('PASS_COOKIE_AUTH');
      server.close();
      try{db.close()}catch{}
      process.exit(0);
    });
  `;
  const r = cp.spawnSync(process.execPath, ['-e', child], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  assert.equal(r.status, 0, out);
  assert.match(out, /PASS_COOKIE_AUTH/);
});

test('.env.production.example usa CDS_DB_PATH e BACKUP_DIR de produção', () => {
  const ex = fs.readFileSync(path.join(root, '.env.production.example'), 'utf8');
  assert.match(ex, /CDS_DB_PATH=\/opt\/cds-contabil\/database\/cds-contabil-connect\.db/);
  assert.match(ex, /BACKUP_DIR=\/opt\/cds-contabil\/backups/);
  assert.doesNotMatch(ex, /DB_FILE=/);
  assert.doesNotMatch(ex, /localhost/);
});
