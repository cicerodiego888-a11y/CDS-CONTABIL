const path=require('path');
const {loadConfig}=require('./config');
const {resolveAppPublicUrl,resolveOfficePublicUrl}=require('./public-urls');
const {listPrivateIPv4,listenHost,formatLanBanner}=require('./network-mode');
const config=loadConfig(process.env);
const express=require('express'),cors=require('cors'),fs=require('fs'),crypto=require('crypto'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),multer=require('multer');
const pdfParse=require('pdf-parse');
const cnpjNorm=require('./empresas/cnpj/normalize');
const clientCode=require('./empresas/client-code');
const {createCnpjProviderFromEnv}=require('./empresas/cnpj/provider');
const {createCepProviderFromEnv}=require('./empresas/cep/provider');
const {complementCnpjAddress,cepDigitsExact}=require('./empresas/cep/address');
const {createEmailProviderFromEnv,createEmailProvider,fromEnv,diagnose,resolveName,authFailMessage}=require('./email/provider');
const {createCommunicationService,createEmailResolver}=require('./communications');
const emailTemplates=require('./communications/email/templates');
const {createCdsEmailProvider}=require('./communications/email/cds-email-provider');
const {createSmtpEmailProvider}=require('./communications/email/smtp-email-provider');
const {normalizeResult}=require('./communications/communication-provider');
const documentsAccessLib=require('./documents/access');
const documentOwnership=require('./documents/ownership');
const {createDocumentCrypto}=require('./documents/crypto');
const {createDocumentStorage}=require('./documents/storage');
const {createDocumentMigrator}=require('./documents/migrate');
const {createSessionService}=require('./auth/sessions');
const pinAuth=require('./auth/pin');
const {validateAccountingSemantics}=require('./accounting/semantics');
const {createAccountingPeriodService}=require('./accounting/period-service');
const {mountAccountingPeriodRoutes}=require('./accounting/period-routes');
const {createMappingService}=require('./export/mappings');
const {mountProcessRoutes}=require('./processes/routes');
const {mountExportRoutes}=require('./export/routes');
const {mountDocumentPipelineRoutes}=require('./document-pipeline/routes');
const {mountDocumentIntelligenceRoutes}=require('./document-intelligence/routes');
const {mountAccountingAIRoutes}=require('./accounting-ai/routes');
const {OpenAIAccountingProvider}=require('./accounting-ai/openai-provider');
const {DisabledAccountingAIProvider}=require('./accounting-ai/provider');
const {mountAiControlRoutes}=require('./ai-control/routes');
const {mountAiCredentialRoutes}=require('./ai-credentials/routes');
const {testOpenAiConnection}=require('./ai-credentials/test-connection');
const {mountSmartExpenseRoutes}=require('./smart-expense/routes');
const {mountRequestRoutes}=require('./requests/routes');
const {mountPushRoutes}=require('./push/routes');
const {sendOfficeDashboard}=require('./dashboard/office');
const chartParser=require('./chart-of-accounts/parser');
const chartService=require('./chart-of-accounts/service');
let aiCredentialTestHook=testOpenAiConnection;
function setAiCredentialTestConnection(fn){aiCredentialTestHook=typeof fn==='function'?fn:testOpenAiConnection;return aiCredentialTestHook}
const {openDatabase}=require('./database');
const {encryptPassword,decryptPassword,hasStoredCredential}=require('./email/credential');
const {setSmtpHooks,normalizeSmtpPassword}=require('./email/smtp');
const ROOT=config.ROOT,DATA=config.CDS_DB_PATH,UPLOAD=config.UPLOAD_DIR,EXPORT=config.EXPORT_DIR,PUBLIC=config.PUBLIC_DIR;
const PORT=config.PORT;
const CLIENT_PORT=config.CLIENT_PORT;
const clientFrontPorts=new Set();
function markClientFrontPort(p){const n=Number(p);if(Number.isFinite(n)&&n>0)clientFrontPorts.add(n)}
function requestListenPort(req){
  const host=String((req&&req.headers&&req.headers.host)||'');
  const m=host.match(/:(\d+)\s*$/);
  if(m)return Number(m[1]);
  const local=Number(req&&req.socket&&req.socket.localPort);
  return Number.isFinite(local)&&local>0?local:0;
}
function isClientFront(req){return clientFrontPorts.has(requestListenPort(req))}
function publicFrontUrls(){
  const officePort=Number(PORT)||3333;
  const clientPort=CLIENT_PORT>0&&CLIENT_PORT!==officePort?CLIENT_PORT:null;
  if(config.IS_PROD){
    const base=String(config.OFFICE_PUBLIC_URL||process.env.CDS_OFFICE_PUBLIC_URL||'').replace(/\/$/,'');
    return {
      office_url:base?base+'/':null,
      client_portal_url:base?base+'/portal/':null,
      office_port:officePort,
      client_port:clientPort
    };
  }
  return {
    office_url:'http://localhost:'+officePort+'/',
    client_portal_url:clientPort?'http://localhost:'+clientPort+'/':('http://localhost:'+officePort+'/portal/'),
    office_port:officePort,
    client_port:clientPort
  };
}
const BRAND_DIR=path.join(UPLOAD,'branding');
const db=openDatabase({dbPath:DATA,schemaDir:path.join(ROOT,'database','schema'),uploads:[path.dirname(DATA),UPLOAD,path.join(UPLOAD,'documentos'),path.join(UPLOAD,'planos-contas'),path.join(UPLOAD,'documents'),path.join(UPLOAD,'.tmp'),BRAND_DIR,path.join(BRAND_DIR,'tmp'),EXPORT]});
function ensureColumn(table,name,ddl){const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);if(!cols.includes(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`)}
const SECRET=config.JWT_SECRET;
const IS_PROD=config.IS_PROD;
let sessions;
const app=express();app.disable('x-powered-by');
const corsOrigins=String(config.CORS_ORIGIN||process.env.CDS_CORS_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
if(IS_PROD&&corsOrigins.some(o=>o==='*'||o.includes('*')))throw new Error('CDS_CORS_ORIGIN cannot use wildcard (*) in production.');
app.use(cors(IS_PROD?{origin:corsOrigins.length?corsOrigins:false,credentials:true}:{origin:true}));
app.use((req,res,next)=>{
  const headers={
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'X-DNS-Prefetch-Control':'off',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
    'Cache-Control':req.path.startsWith('/api/')?'no-store':'no-store'
  };
  // CSP compatível com o frontend atual (scripts/CSS inline e same-origin). Hardening futuro: nonces.
  headers['Content-Security-Policy']=[
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'"
  ].join('; ');
  const xfProto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();
  const httpsOn=IS_PROD&&(xfProto==='https'||req.secure===true||/^https:\/\//i.test(String(config.OFFICE_PUBLIC_URL||'')));
  if(httpsOn)headers['Strict-Transport-Security']='max-age=15552000; includeSubDomains';
  res.set(headers);
  next();
});
app.use(express.json({limit:'10mb',verify:(req,res,buf)=>{if(String(req.originalUrl||req.url||'').startsWith('/api/webhooks/whatsapp'))req.rawBody=buf}}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{if(req.body&&typeof req.body==='object'&&!Array.isArray(req.body))delete req.body.tenant_id;next()});
ensureColumn('tenants','slug','TEXT');
function slugifyName(name){return String(name||'escritorio').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'escritorio'}
function uniqueTenantSlug(name,excludeId){let base=slugifyName(name),slug=base,n=2;while(one('SELECT id FROM tenants WHERE slug=? AND id<>?',slug,excludeId||'')){slug=base+'-'+n;n++}return slug}
function passwordPolicyError(password){const p=String(password||'');if(p.length<8||!/[A-Za-z]/.test(p)||!/\d/.test(p))return 'A senha deve ter no mínimo 8 caracteres, com letras e números.';return null}
function issueToken(u,profile){return sessions.issueToken(u,profile)}
function assignableOfficeRoles(actorRole){if(actorRole==='OWNER')return['OWNER','ACCOUNTANT','STAFF'];if(actorRole==='ACCOUNTANT')return['ACCOUNTANT','STAFF'];return[]}
const loginAttempts=new Map();
const FORGOT_GENERIC='Enviamos as instruções para o seu e-mail cadastrado. Verifique sua caixa de entrada para criar uma nova senha.';
function rateLogin(req,res,next){const max=Number(process.env.CDS_LOGIN_MAX)||(IS_PROD?8:200);const windowMs=15*60*1000,now=Date.now();const key=(req.ip||'')+'|'+String(req.body?.email||'').toLowerCase()+(req.body?.tenant||req.body?.tenant_slug?'|'+String(req.body.tenant||req.body.tenant_slug).toLowerCase():'|login');const cur=loginAttempts.get(key)||[];const fresh=cur.filter(t=>now-t<windowMs);if(fresh.length>=max)return res.status(429).json({error:'TOO_MANY_ATTEMPTS',message:'Credenciais inválidas.'});fresh.push(now);loginAttempts.set(key,fresh);next()}
const forgotAttempts=new Map();
function rateForgot(req,res,next){const max=Number(process.env.CDS_FORGOT_MAX)||(IS_PROD?8:200);const windowMs=15*60*1000,now=Date.now();const key=(req.ip||'')+'|forgot|'+String(req.body?.email||'').toLowerCase()+'|'+String(req.body?.tenant||req.body?.tenant_slug||'').toLowerCase();const cur=forgotAttempts.get(key)||[];const fresh=cur.filter(t=>now-t<windowMs);if(fresh.length>=max)return res.status(429).json({error:'TOO_MANY_ATTEMPTS',message:FORGOT_GENERIC});fresh.push(now);forgotAttempts.set(key,fresh);next()}
const signupAttempts=new Map();
function rateSignup(req,res,next){const max=Number(process.env.CDS_SIGNUP_MAX)||(IS_PROD?8:200);const windowMs=15*60*1000,now=Date.now();const key=(req.ip||'')+'|signup|'+String(req.body?.owner_email||req.body?.email||'').toLowerCase();const cur=signupAttempts.get(key)||[];const fresh=cur.filter(t=>now-t<windowMs);if(fresh.length>=max)return res.status(429).json({error:'TOO_MANY_ATTEMPTS',message:'Muitas tentativas. Aguarde e tente novamente.'});fresh.push(now);signupAttempts.set(key,fresh);next()}
function tenantCnpjTaken(cnpjKey){
  if(!cnpjKey)return false;
  const rows=qRows('SELECT id,cnpj FROM tenants WHERE IFNULL(cnpj,\'\')<>\'\'');
  return rows.some(r=>cnpjNorm.normalizeCnpjKey(r.cnpj)===cnpjKey);
}
function officeRegistrationByToken(raw){
  const token=String(raw||'').trim();
  if(!token||token.length<16)return null;
  return one('SELECT * FROM office_registrations WHERE token_hash=?',tokenHash(token));
}
function markExpiredOfficeRegistration(row){
  if(!row||row.status!=='PENDING')return row;
  if(new Date(row.expires_at).getTime()>Date.now())return row;
  exec("UPDATE office_registrations SET status='EXPIRED' WHERE id=? AND status='PENDING'",row.id);
  return one('SELECT * FROM office_registrations WHERE id=?',row.id)||Object.assign({},row,{status:'EXPIRED'});
}
const cnpjLookups=new Map();
function rateCnpjLookup(req,res,next){const max=Number(process.env.CDS_CNPJ_LOOKUP_MAX)||(IS_PROD?20:400);const windowMs=15*60*1000,now=Date.now();const key=(req.ip||'')+'|'+(req.user&&req.user.sub||'')+'|cnpj';const cur=cnpjLookups.get(key)||[];const fresh=cur.filter(t=>now-t<windowMs);if(fresh.length>=max)return res.status(429).json({error:'TOO_MANY_ATTEMPTS',message:'Não foi possível consultar o cadastro do CNPJ agora. Tente novamente.'});fresh.push(now);cnpjLookups.set(key,fresh);next()}
const cepLookups=new Map();
function rateCepLookup(req,res,next){const max=Number(process.env.CDS_CEP_LOOKUP_MAX)||(IS_PROD?40:400);const windowMs=15*60*1000,now=Date.now();const key=(req.ip||'')+'|'+(req.user&&req.user.sub||'')+'|cep';const cur=cepLookups.get(key)||[];const fresh=cur.filter(t=>now-t<windowMs);if(fresh.length>=max)return res.status(429).json({error:'TOO_MANY_ATTEMPTS',message:'Não foi possível consultar o CEP. Preencha o endereço manualmente.'});fresh.push(now);cepLookups.set(key,fresh);next()}
const webhookHits=new Map();
function rateWebhook(req,res,next){const max=Number(process.env.CDS_WHATSAPP_WEBHOOK_MAX)||(IS_PROD?120:2000);const windowMs=60*1000,now=Date.now();const key=(req.ip||'')+'|wa-hook';const cur=webhookHits.get(key)||[];const fresh=cur.filter(t=>now-t<windowMs);if(fresh.length>=max)return res.status(429).json({error:'TOO_MANY_ATTEMPTS',message:'Tente novamente.'});fresh.push(now);webhookHits.set(key,fresh);next()}
const DUMMY_HASH=bcrypt.hashSync('dummy-not-a-user',4);
const id=()=>crypto.randomUUID();const cents=v=>{const n=typeof v==='number'?v:Number(String(v).replace(/\./g,'').replace(',','.'));if(!Number.isFinite(n)||n<=0)throw Error('Valor inválido');return Math.round(n*100)};const money=c=>(Number(c||0)/100).toFixed(2);const today=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
function audit(req,action,type,eid,before,after){if(!req.user)return;db.prepare('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_json,after_json,ip) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),req.user.tenant_id,req.user.sub,action,type,eid,before?JSON.stringify(before):null,after?JSON.stringify(after):null,req.ip)}
function deny(res,status,message,code){const c=code||'ERROR';return res.status(status).json({error:c,message,error_info:{code:c,message}})}
const clientBlocked=['/api/empresas','/api/plano-contas','/api/categorias','/api/bancos','/api/regras-contabeis','/api/classificacao','/api/documentos','/api/despesas','/api/receitas','/api/lancamentos','/api/aprovacao','/api/pendencias','/api/notificacoes','/api/solicitacoes','/api/dashboard','/api/exportacoes','/api/auditoria','/api/usuarios','/api/tenant','/api/client-users','/api/comunicacoes','/api/configuracoes','/api/importacoes','/api/processos','/api/processo-ocorrencias','/api/ai','/api/ia'];
function isClientNotifApiAllowed(path){return path==='/api/notificacoes/nao-lidas'||path==='/api/notificacoes/read-all'||path==='/api/notificacoes/prefs-canais'||/^\/api\/notificacoes\/[^/]+\/read$/.test(path)}
function isClientBrandingApiAllowed(path){return path==='/api/client/branding'||path==='/api/client/branding/logo'}
function readAccessToken(req){const h=req.headers.authorization||'';if(h.startsWith('Bearer '))return h.slice(7);const cookie=String(req.headers.cookie||'');const m=cookie.match(/(?:^|;\s*)cds_session=([^;]+)/);return m?decodeURIComponent(m[1]):''}
function auth(req,res,next){try{const token=readAccessToken(req);if(!token)return deny(res,401,'Autenticação obrigatória.','AUTH_REQUIRED');req.user=jwt.verify(token,SECRET,{algorithms:['HS256']});const sess=sessions.verifyAccess(req.user);if(!sess.ok)return deny(res,401,sess.code==='TOKEN_REVOKED'?'Sessão inválida.':'Sessão inválida.',sess.code||'INVALID_TOKEN');if(req.user.role==='CLIENT'&&!req.path.startsWith('/api/client')&&!isClientNotifApiAllowed(req.path)&&!isClientBrandingApiAllowed(req.path)&&clientBlocked.some(prefix=>req.path===prefix||req.path.startsWith(prefix+'/')))return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PORTAL_ONLY');next()}catch(err){if(err&&err.name==='TokenExpiredError')return deny(res,401,'Sua sessão expirou. Entre novamente para continuar.','TOKEN_EXPIRED');return deny(res,401,'Sessão inválida.','INVALID_TOKEN')}}
function role(...roles){return(req,res,next)=>roles.includes(req.user.role)?next():deny(res,403,'Você não tem permissão para realizar esta operação.','FORBIDDEN')}
const officeRoles=['OWNER','ACCOUNTANT','STAFF'];const requireOffice=role(...officeRoles);
function staffAssignmentOn(req){if(!req||!req.user||req.user.role!=='STAFF')return false;const t=one('SELECT assign_staff_companies FROM tenants WHERE id=?',req.user.tenant_id);return !!(t&&Number(t.assign_staff_companies))}
function staffVisibleCompanySql(req,col){if(!staffAssignmentOn(req))return{sql:'',p:[]};return{sql:` AND (NOT EXISTS (SELECT 1 FROM company_assignees ca WHERE ca.company_id=${col}) OR EXISTS (SELECT 1 FROM company_assignees ca WHERE ca.company_id=${col} AND ca.user_id=?))`,p:[req.user.sub]}}
function companyVisibleToUser(req,companyId){if(!companyId)return false;if(req.user.role==='CLIENT')return req.companyScope===companyId;if(!one('SELECT id FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,companyId))return false;if(!staffAssignmentOn(req))return true;const vis=staffVisibleCompanySql(req,'c.id');return !!one(`SELECT c.id FROM companies c WHERE c.tenant_id=? AND c.id=?${vis.sql}`,req.user.tenant_id,companyId,...vis.p)}
function companyAssignees(companyId){return qRows("SELECT ca.user_id,u.name,u.email FROM company_assignees ca JOIN users u ON u.id=ca.user_id WHERE ca.company_id=? AND u.role='STAFF' ORDER BY u.name",companyId)}
function withCompanyAssignees(row){if(!row)return row;const assignees=companyAssignees(row.id);return{...row,assignees,assignee_ids:assignees.map(a=>a.user_id),assignee_names:assignees.map(a=>a.name).join(', ')}}
function scope(req,res,next){if(req.user.role==='CLIENT'){req.companyScope=req.user.company_id;return next()}if(!officeRoles.includes(req.user.role))return next();const cid=String(req.get('x-company-id')||'').trim();if(!cid)return next();const c=one('SELECT id,status FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,cid);if(!c||!companyVisibleToUser(req,c.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');req.companyScope=c.id;req.officeCompany=c;next()}
function companyOk(req,cid){if(!cid)return false;if(req.user.role==='CLIENT')return req.companyScope===cid;if(req.companyScope)return req.companyScope===cid;return companyVisibleToUser(req,cid)}
function companyActionReason(body){return String(body&&(body.reason||body.motivo||body.deletion_reason||body.archive_reason)||'').trim()}
function purgeCompanyData(tenantId,companyId){
  const docs=qRows('SELECT storage_path FROM documents WHERE tenant_id=? AND company_id=?',tenantId,companyId);
  const exportFiles=qRows('SELECT file_path FROM exports WHERE tenant_id=? AND company_id=?',tenantId,companyId);
  db.transaction(()=>{
    exec('DELETE FROM entry_reclassifications WHERE tenant_id=? AND entry_id IN (SELECT id FROM entries WHERE tenant_id=? AND company_id=?)',tenantId,tenantId,companyId);
    exec('DELETE FROM approvals WHERE tenant_id=? AND entry_id IN (SELECT id FROM entries WHERE tenant_id=? AND company_id=?)',tenantId,tenantId,companyId);
    exec('DELETE FROM classification_runs WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM export_items WHERE export_id IN (SELECT id FROM exports WHERE tenant_id=? AND company_id=?)',tenantId,companyId);
    exec('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE tenant_id=? AND company_id=?)',tenantId,companyId);
    exec('DELETE FROM entries WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM client_pendency_responses WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM client_request_responses WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM pendencies WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM requests WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM expenses WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM revenues WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM documents WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM movement_imports WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM exports WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM communication_jobs WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM domain_events WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM notifications WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    const clientUsers=qRows("SELECT id FROM users WHERE tenant_id=? AND company_id=? AND role='CLIENT'",tenantId,companyId);
    for(const u of clientUsers){
      exec('DELETE FROM notification_preferences WHERE user_id=?',u.id);
      exec('DELETE FROM client_user_permissions WHERE user_id=?',u.id);
      exec('DELETE FROM client_user_profiles WHERE user_id=?',u.id);
      exec('DELETE FROM communication_jobs WHERE recipient_user_id=?',u.id);
      exec('DELETE FROM notifications WHERE user_id=? OR recipient_user_id=?',u.id,u.id);
    }
    exec('DELETE FROM client_invitations WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec("DELETE FROM users WHERE tenant_id=? AND company_id=? AND role='CLIENT'",tenantId,companyId);
    exec("UPDATE users SET company_id=NULL WHERE tenant_id=? AND company_id=? AND role<>'CLIENT'",tenantId,companyId);
    exec('DELETE FROM categories WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM banks WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM accounting_rules WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM company_assignees WHERE company_id=?',companyId);
    exec('DELETE FROM process_occurrence_steps WHERE tenant_id=? AND occurrence_id IN (SELECT id FROM process_occurrences WHERE tenant_id=? AND company_id=?)',tenantId,tenantId,companyId);
    exec('DELETE FROM process_occurrences WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM process_steps WHERE tenant_id=? AND process_id IN (SELECT id FROM processes WHERE tenant_id=? AND company_id=?)',tenantId,tenantId,companyId);
    exec('DELETE FROM processes WHERE tenant_id=? AND company_id=?',tenantId,companyId);
    exec('DELETE FROM companies WHERE tenant_id=? AND id=?',tenantId,companyId);
  })();
  for(const d of docs){if(d.storage_path){try{documentStorage.removeFile(d.storage_path)}catch{}try{fs.unlinkSync(d.storage_path)}catch{}}}
  for(const e of exportFiles){if(e.file_path)try{fs.unlinkSync(e.file_path)}catch{}}
}
function clientRoutePermission(req){const p=req.path,m=req.method;if(p.includes('/despesas'))return m==='POST'?'client.expenses.create':(m==='PATCH'||m==='PUT')?'client.expenses.edit':'client.expenses.view';if(p.includes('/receitas'))return m==='POST'?'client.revenues.create':(m==='PATCH'||m==='PUT')?'client.revenues.edit':'client.revenues.view';if(p.includes('/documentos'))return m==='POST'?'client.documents.upload':(m==='DELETE'?'client.documents.delete':'client.documents.view');if(p.includes('/pendencias'))return m==='POST'?'client.pending.respond':'client.pending.view';if(p.includes('/solicitacoes'))return m==='POST'?'client.requests.respond':'client.requests.view';if(p.includes('/notificacoes'))return 'client.notifications.view';if(p.includes('/dashboard'))return 'client.dashboard.view';if(p.includes('/relatorios'))return 'client.reports.view';return null}
function requireClient(req,res,next){if(req.user.role!=='CLIENT')return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_ONLY');const permission=clientRoutePermission(req);if(permission&&!effectiveClientPermission(req.user.sub,permission)){if(req.method==='DELETE'&&String(req.path||'').includes('/documentos'))audit(req,'DOCUMENT_DELETE_DENIED','DOCUMENT',req.params&&req.params.id||null,null,{reason:'CLIENT_PERMISSION_REQUIRED',action_source:documentOwnership.ACTION_SOURCES.PORTAL_CLIENTE,user_role:req.user.role});return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PERMISSION_REQUIRED')}next()}
function requireClientCompany(req,res,next){const u=one('SELECT id,tenant_id,company_id,role,active FROM users WHERE id=? AND tenant_id=? AND role=\'CLIENT\' AND active=1',req.user.sub,req.user.tenant_id);if(!u||!u.company_id)return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_COMPANY_REQUIRED');const company=one('SELECT id,name,trade_name,status FROM companies WHERE tenant_id=? AND id=? AND status=\'ACTIVE\'',u.tenant_id,u.company_id);if(!company)return deny(res,403,'Esta empresa está bloqueada ou indisponível.','CLIENT_COMPANY_UNAVAILABLE');req.clientCompany=company;req.companyScope=company.id;next()}
const profileDefaults={CLIENT_ADMIN:['client.dashboard.view','client.expenses.view','client.expenses.create','client.expenses.edit','client.revenues.view','client.revenues.create','client.revenues.edit','client.documents.view','client.documents.upload','client.documents.delete','client.pending.view','client.pending.respond','client.requests.view','client.requests.respond','client.notifications.view','client.reports.view','client.users.view','client.users.create','client.users.edit','client.users.block'],CLIENT_FINANCE:['client.dashboard.view','client.expenses.view','client.expenses.create','client.expenses.edit','client.revenues.view','client.revenues.create','client.revenues.edit','client.documents.view','client.documents.upload','client.documents.delete','client.pending.view','client.pending.respond','client.requests.view','client.requests.respond','client.notifications.view','client.reports.view'],CLIENT_VIEWER:['client.dashboard.view','client.expenses.view','client.revenues.view','client.documents.view','client.pending.view','client.requests.view','client.notifications.view','client.reports.view']};
function effectiveClientPermission(userId,permission){const profile=one('SELECT profile FROM client_user_profiles WHERE user_id=?',userId)?.profile||'CLIENT_VIEWER';const override=one('SELECT allowed FROM client_user_permissions WHERE user_id=? AND permission_key=?',userId,permission);return override?!!override.allowed:profileDefaults[profile]?.includes(permission)||false}
function requireClientPermission(permission){return(req,res,next)=>{if(!effectiveClientPermission(req.user.sub,permission))return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PERMISSION_REQUIRED');next()}}
function clientPermissionList(userId){const keys=[];for(const arr of Object.values(profileDefaults))for(const k of arr)if(!keys.includes(k))keys.push(k);return keys.filter(k=>effectiveClientPermission(userId,k))}
function clientProfile(req){return one('SELECT profile FROM client_user_profiles WHERE user_id=?',req.user.sub)?.profile||'CLIENT_VIEWER'}
function upsertClientProfile(userId,profile){exec('INSERT INTO client_user_profiles(user_id,profile,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile,updated_at=CURRENT_TIMESTAMP',userId,profile)}
function resolveClientProfile(value){const raw=String(value||'').trim();if(!raw)return 'CLIENT_VIEWER';if(profileDefaults[raw])return raw;const key=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();const map={ADMINISTRADOR:'CLIENT_ADMIN',FINANCEIRO:'CLIENT_FINANCE',VISUALIZADOR:'CLIENT_VIEWER',CLIENT_ADMIN:'CLIENT_ADMIN',CLIENT_FINANCE:'CLIENT_FINANCE',CLIENT_VIEWER:'CLIENT_VIEWER'};return map[key]||null}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex')}
function normalizeCnpj(value){return cnpjNorm.normalizeCnpjKey(value)}
function normalizePhone(value){return String(value||'').replace(/\D/g,'')||null}
function invitationMessage(status,purpose){
  if(status!=='PENDING'&&purpose==='PASSWORD_RESET')return 'Este link de acesso expirou ou já foi utilizado.';
  return({EXPIRED:'Este convite expirou.',REVOKED:'Este convite não está mais disponível.',ACCEPTED:'Este convite já foi utilizado.',PENDING:'Ative seu acesso'}[status]||'Não foi possível validar este convite.');
}
function invitationView(inv){
  const purpose=inv.purpose||'ACTIVATION';
  return{status:inv.status,expires_at:inv.expires_at,company:inv.company_name,tenant:inv.tenant_name,name:inv.user_name,email:inv.email,purpose,title:invitationMessage(inv.status==='PENDING'?'PENDING':inv.status,purpose),message:invitationMessage(inv.status,purpose)};
}
function companyWrite(body,current={}){const pick=(a,b,c)=>a!==undefined?a:(b!==undefined?b:c);const cnpjRaw=body.cnpj===undefined?current.cnpj:body.cnpj;const cnpjKey=cnpjRaw===undefined||cnpjRaw===null||cnpjRaw===''?null:cnpjNorm.normalizeCnpjKey(cnpjRaw);const boolish=(v,fallback)=>{if(v===undefined)return fallback;if(v===null||v==='')return null;if(typeof v==='boolean')return v?1:0;if(v===1||v==='1'||v==='true')return 1;if(v===0||v==='0'||v==='false')return 0;return fallback};return{name:pick(body.name,body.legal_name,current.name),trade_name:pick(body.trade_name,body.fantasy_name,current.trade_name||null),cnpj:cnpjKey?cnpjNorm.formatCnpjDisplay(cnpjKey):null,cnpj_normalized:cnpjKey||null,email:body.email===undefined?current.email:(String(body.email||'').trim().toLowerCase()||null),phone:body.phone===undefined?current.phone:cnpjNorm.normalizePhone(body.phone),status:pick(body.status,current.status,'ACTIVE'),address:pick(body.address,body.endereco,body.logradouro,current.address||null),address_number:pick(body.address_number,body.numero,current.address_number||null),complement:pick(body.complement,body.complemento,current.complement||null),neighborhood:pick(body.neighborhood,body.bairro,current.neighborhood||null),city:pick(body.city,body.cidade,body.municipio,current.city||null),state:pick(body.state,body.uf,current.state||null)?cnpjNorm.normalizeUf(pick(body.state,body.uf,current.state))||pick(body.state,body.uf,current.state||null):null,zip:body.zip===undefined&&body.cep===undefined?current.zip:cnpjNorm.normalizeCep(body.zip||body.cep),cadastral_status:pick(body.cadastral_status,body.situacao_cadastral,current.cadastral_status||null),opened_on:pick(body.opened_on,body.data_abertura,current.opened_on||null),legal_nature:pick(body.legal_nature,body.natureza_juridica,current.legal_nature||null),main_cnae:pick(body.main_cnae,body.cnae_principal,current.main_cnae||null),company_size:pick(body.company_size,body.porte,current.company_size||null),share_capital:pick(body.share_capital,body.capital_social,current.share_capital||null),simples_nacional:boolish(body.simples_nacional,current.simples_nacional),mei:boolish(body.mei,current.mei)}}
function publicActivationUrl(invite){return process.env.NODE_ENV==='production'?undefined:invite.activation_url}
function credentialStatusFor(row){
  if(!row)return row;
  const purpose=row.invitation_purpose||'ACTIVATION';
  if(row.invitation_status==='PENDING'&&purpose==='PASSWORD_RESET'){
    return{credential_configured:false,credential_status:'AGUARDANDO DEFINIÇÃO'};
  }
  const configured=row.invitation_status==='ACCEPTED'||(!!row.active&&!!row.last_access_at);
  return{credential_configured:!!configured,credential_status:configured?'CONFIGURADA':'NÃO CONFIGURADA'};
}
function clientUserRow(userId){
  const row=one("SELECT u.id,u.tenant_id,u.company_id,u.name,u.email,u.role,u.active,u.created_at,u.last_access_at,COALESCE(p.profile,'CLIENT_VIEWER') profile,(SELECT status FROM client_invitations i WHERE i.user_id=u.id ORDER BY i.created_at DESC, i.id DESC LIMIT 1) invitation_status,(SELECT purpose FROM client_invitations i WHERE i.user_id=u.id ORDER BY i.created_at DESC, i.id DESC LIMIT 1) invitation_purpose FROM users u LEFT JOIN client_user_profiles p ON p.user_id=u.id WHERE u.id=?",userId);
  if(!row)return row;
  return Object.assign(row,credentialStatusFor(row));
}
function clientCompanyId(req){return req.clientCompany.id}
function clientStatus(status,needsInfo){if(needsInfo)return 'Precisa de informação';return({PENDING:'Pendente',NEEDS_CLASSIFICATION:'Pendente',POSTED:'Aprovada',REJECTED:'Reprovada',ACCOUNTED:'Aprovada',OPEN:'Precisa de informação',ACTIVE:'Disponível',PENDING_REVIEW:'Pendente de análise'}[status]||'-')}
function pageParams(req,fallback=25){const page=Math.max(1,parseInt(req.query.page,10)||1);const raw=parseInt(req.query.page_size||req.query.limit,10);const page_size=Math.min(100,Math.max(1,Number.isFinite(raw)?raw:fallback));return{page,page_size,offset:(page-1)*page_size}}
function paged(items,total,page,page_size){const pages=Math.max(1,Math.ceil((total||0)/page_size));return{items,total,page,page_size,pages,from:total?((page-1)*page_size)+1:0,to:Math.min(page*page_size,total),pagination:{page,page_size,total,total_pages:pages}}}
function scopedCompanyWhere(req,alias){const p=[req.user.tenant_id];let where=`${alias}.tenant_id=?`;if(req.companyScope){where+=` AND ${alias}.company_id=?`;p.push(req.companyScope)}else{const vis=staffVisibleCompanySql(req,`${alias}.company_id`);where+=vis.sql;p.push(...vis.p)}return{where,p}}
const CLIENT_UPLOAD_MAX=Number(process.env.CDS_CLIENT_UPLOAD_MAX||25*1024*1024);
const clientFileTypes={'.pdf':['application/pdf'],'.jpg':['image/jpeg','image/jpg'],'.jpeg':['image/jpeg'],'.png':['image/png'],'.xml':['application/xml','text/xml','application/octet-stream']};
function validateClientFile(file){if(!file)return 'Envie um arquivo.';const ext=path.extname(file.originalname||'').toLowerCase();const allowed=clientFileTypes[ext];if(!allowed)return 'Formato não autorizado. Envie JPG, JPEG, PNG, PDF ou XML.';if(file.size>CLIENT_UPLOAD_MAX)return 'O arquivo excede o tamanho máximo permitido.';const mime=String(file.mimetype||'').toLowerCase();if(mime&&!allowed.includes(mime)&&mime!=='application/octet-stream')return 'O tipo do arquivo não é permitido.';return null}
function documentWithUploader(doc){if(!doc)return doc;if(doc.uploaded_by_role)return doc;const u=doc.uploaded_by?one('SELECT role FROM users WHERE id=?',doc.uploaded_by):null;return Object.assign({},doc,{uploaded_by_role:u?u.role:null})}
function publicDocument(d,tenantId,req){if(!d||d.deleted_at)return null;d=documentWithUploader(d);const linked=one("SELECT id, 'EXPENSE' source_type, description FROM expenses WHERE tenant_id=? AND document_id=? UNION ALL SELECT id,'REVENUE',description FROM revenues WHERE tenant_id=? AND document_id=?",tenantId,d.id,tenantId,d.id);const source=documentOwnership.resolveSource(d);const action=req&&req.user?documentOwnership.actionSource(req.user):null;const decision=req&&req.user?documentOwnership.canDelete({user:req.user,document:d,hasClientPermission:p=>effectiveClientPermission(req.user.sub,p)}):{ok:false};return{id:d.id,original_name:d.original_name,mime_type:d.mime_type,size_bytes:d.size_bytes,sha256:d.sha256,status:d.status,notes:d.notes||null,created_at:d.created_at,origin:d.origin||null,origin_label:origens.label(d.origin),source,source_label:documentOwnership.sourceLabel(source,action),can_delete:!!decision.ok,linked:!!linked,movement:linked?{id:linked.id,source_type:linked.source_type,description:linked.description}:null,status_label:linked?'Associado':clientStatus(d.status==='ACTIVE'?'PENDING_REVIEW':d.status)}}
function stripTx(x){if(!x)return x;const{tenant_id,...rest}=x;return rest}
function qRows(sql,...p){return db.prepare(sql).all(...p)}
function one(sql,...p){return db.prepare(sql).get(...p)}
function exec(sql,...p){return db.prepare(sql).run(...p)}
sessions=createSessionService({jwt,secret:SECRET,one,exec});
const docCrypto=createDocumentCrypto({key:config.DOCUMENT_ENCRYPTION_KEY,kid:config.DOCUMENT_ENCRYPTION_KID});
const documentStorage=createDocumentStorage({uploadsRoot:UPLOAD,cryptoLayer:docCrypto});
try{createDocumentMigrator({db,storage:documentStorage,reportsDir:path.join(ROOT,'logs')}).migrateAll({encrypt:true})}catch(e){if(!IS_PROD)console.warn('document_migration_skipped',e.message)}
(function backfillMissingClientProfiles(){
  const missing=db.prepare("SELECT u.id, lower(u.email) email FROM users u LEFT JOIN client_user_profiles p ON p.user_id=u.id WHERE u.role='CLIENT' AND p.user_id IS NULL").all();
  const ins=db.prepare('INSERT INTO client_user_profiles(user_id,profile) VALUES(?,?)');
  for(const u of missing)ins.run(u.id,u.email==='cliente@cremolia.com.br'?'CLIENT_ADMIN':'CLIENT_VIEWER');
})();
const documentAccess=documentsAccessLib.createDocumentAccess({one,uploadsRoot:UPLOAD,storage:documentStorage});
let aiCredentialService=null;
let configuredAccountingAIProvider=new DisabledAccountingAIProvider();
function refreshAccountingAIProvider(){
  let apiKey='';
  try{
    if(aiCredentialService){
      const resolved=aiCredentialService.resolveApiKey();
      apiKey=resolved.apiKey||'';
    }else if(config.AI_PROVIDER==='openai'){
      apiKey=String(config.OPENAI_API_KEY||'');
    }
  }catch(e){
    if(config.IS_PROD)throw e;
    console.warn('ai_credential_resolve_failed',e&&e.message);
    apiKey='';
  }
  configuredAccountingAIProvider=apiKey
    ?new OpenAIAccountingProvider({apiKey,model:config.AI_MODEL,baseUrl:config.OPENAI_BASE_URL,timeoutMs:config.AI_TIMEOUT_MS})
    :new DisabledAccountingAIProvider();
  if(accountingAIService)accountingAIService.setProvider(configuredAccountingAIProvider);
  return configuredAccountingAIProvider;
}
let accountingAIService=null;
let smartExpenseService=null;
function setAccountingAIProvider(provider){if(provider&&accountingAIService)accountingAIService.setProvider(provider);return provider}
function deliverDocument(req,res,mode){const loaded=documentAccess.load(req.user.tenant_id,req.params.id);if(loaded.error)return deny(res,loaded.status,loaded.message,loaded.error);if(!companyOk(req,loaded.document.company_id))return deny(res,404,'Documento não encontrado.','NOT_FOUND');const sent=documentAccess.send(res,loaded.document,mode);if(sent.error)return deny(res,sent.status,sent.message,sent.error);audit(req,mode==='inline'?'DOCUMENT_VIEWED':'DOCUMENT_DOWNLOADED','DOCUMENT',loaded.document.id,null,{company_id:loaded.document.company_id,document_id:loaded.document.id,result:'ok'})}
function deliverClientDocument(req,res,mode){const loaded=documentAccess.load(req.user.tenant_id,req.params.id);if(loaded.error)return deny(res,404,'Documento não encontrado.','NOT_FOUND');if(loaded.document.company_id!==clientCompanyId(req))return deny(res,404,'Documento não encontrado.','NOT_FOUND');const sent=documentAccess.send(res,loaded.document,mode);if(sent.error)return deny(res,sent.status,sent.message,sent.error);audit(req,mode==='inline'?'DOCUMENT_VIEWED':'DOCUMENT_DOWNLOADED','DOCUMENT',loaded.document.id,null,{company_id:loaded.document.company_id,document_id:loaded.document.id,result:'ok'})}
function officeDocumentItem(row,req){row=documentWithUploader(row);const source=documentOwnership.resolveSource(row);const action=documentOwnership.actionSource(req.user);const decision=documentOwnership.canDelete({user:req.user,document:row,hasClientPermission:()=>false});return{id:row.id,original_name:row.original_name,mime_type:row.mime_type,size_bytes:row.size_bytes,sha256:row.sha256,status:row.status,notes:row.notes,created_at:row.created_at,company_id:row.company_id,company_name:row.company_name,company_trade_name:row.company_trade_name||null,company_cnpj:row.company_cnpj||null,uploaded_by_name:row.uploaded_by_name,origin:row.origin||null,origin_label:row.origin?origens.label(row.origin):null,source,source_label:documentOwnership.sourceLabel(source,action),extraction_status:row.extraction_status||null,extraction_method:row.extraction_method||null,extraction_error_code:row.extraction_error_code||null,extraction_error_message:row.extraction_error_message||null,can_delete:!!decision.ok}}
function handleDocumentDelete(req,res){if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.company_id;delete req.body.user_id;delete req.body.role;delete req.body.source;delete req.body.origin}const loaded=documentAccess.load(req.user.tenant_id,req.params.id,{includeDeleted:true});if(loaded.error)return deny(res,404,'Documento não encontrado.','NOT_FOUND');const doc=documentWithUploader(loaded.document);if(!companyOk(req,doc.company_id))return deny(res,404,'Documento não encontrado.','NOT_FOUND');if(req.user.role==='CLIENT'&&doc.company_id!==clientCompanyId(req))return deny(res,404,'Documento não encontrado.','NOT_FOUND');if(doc.deleted_at)return res.json({ok:true,already_deleted:true});const decision=documentOwnership.canDelete({user:req.user,document:doc,hasClientPermission:p=>effectiveClientPermission(req.user.sub,p)});if(!decision.ok){audit(req,'DOCUMENT_DELETE_DENIED','DOCUMENT',doc.id,null,{company_id:doc.company_id,document_id:doc.id,user_id:req.user.sub,user_role:req.user.role,document_source:decision.documentSource,action_source:decision.actionSource,original_filename:doc.original_name,reason:decision.code});return deny(res,403,decision.message,decision.code)}const now=new Date().toISOString();exec('UPDATE documents SET deleted_at=?,deleted_by=?,deleted_source=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL',now,req.user.sub,decision.actionSource,doc.id,req.user.tenant_id);audit(req,'DOCUMENT_DELETED','DOCUMENT',doc.id,null,{company_id:doc.company_id,document_id:doc.id,user_id:req.user.sub,user_role:req.user.role,document_source:decision.documentSource,action_source:decision.actionSource,original_filename:doc.original_name,timestamp:now});res.json({ok:true,id:doc.id})}
const origens=require('./origens');
const entryStates=require('./accounting/entry-states');
const {createPostingService}=require('./accounting/posting-service');
const {createEventBus,EVENT_TYPES}=require('./domain-events');
const {createNotificationService,mountNotificationRoutes}=require('./notifications');
const realtimeHub=require('./realtime/hub');
const {mountRealtimeRoutes}=require('./realtime/routes');
const {createCommunicationEngine}=require('./comunicacoes/engine');
const notificationCenter={service:null};
let cnpjProvider=createCnpjProviderFromEnv();
function setCnpjProvider(p){if(p)cnpjProvider=p;return cnpjProvider}
let cepProvider=createCepProviderFromEnv();
function setCepProvider(p){if(p)cepProvider=p;return cepProvider}
let emailProvider=createEmailProviderFromEnv();
let emailOverride=null;
function setEmailProvider(p){if(p){emailOverride=p;emailProvider=p}else{emailOverride=null;emailProvider=createEmailProviderFromEnv()}return emailProvider}
/** Provider de plataforma (onboarding sem tenant): override de teste → CDS SaaS → SMTP do .env. */
function resolvePlatformEmailProvider(){
  if(emailOverride)return createSmtpEmailProvider(emailOverride);
  const cds=createCdsEmailProvider();
  if(cds.available())return cds;
  return createSmtpEmailProvider(createEmailProviderFromEnv());
}
function emailSendSucceeded(result){
  return !!(result&&(result.accepted===true||result.email_sent===true||result.status==='sent'||result.status==='accepted'));
}
function logOfficeSignupEmailFailure(delivery){
  console.error('office_signup_email_failed',JSON.stringify({
    code:(delivery&&delivery.code)||'EMAIL_SEND_FAILED',
    status:(delivery&&delivery.status)||'failed',
    provider:(delivery&&delivery.provider)||null
  }));
}
function looksLikeSecretPlaceholder(v){const s=String(v??'');return !s.trim()||/^[•*]+$/.test(s)||s==='CREDENTIAL_SET'}
function persistedEmailCfg(tenantId){
  const row=one('SELECT * FROM tenant_email_settings WHERE tenant_id=?',tenantId);
  if(!row||!hasStoredCredential(row)||!row.host||!row.username||!row.email_from)return null;
  const password=decryptPassword(row);
  if(!password)return null;
  return {name:'smtp',host:row.host,port:Number(row.port||587)||587,user:row.username,password,from:row.email_from,fromName:row.from_name||'CDS Contábil',secure:Number(row.secure)===1,timeoutMs:Number(process.env.CDS_EMAIL_TIMEOUT_MS||10000)||10000};
}
const emailResolver=createEmailResolver({
  persistedEmailCfg,
  getRow:tenantId=>one('SELECT * FROM tenant_email_settings WHERE tenant_id=?',tenantId),
  getOverride:()=>emailOverride
});
function emailProviderForTenant(tenantId){return emailResolver.resolve(tenantId)}
function emailStatusLabel(status){return({not_configured:'Não configurado',configured_untested:'Configurado — não testado',configured_ok:'Configurado e funcionando',connection_error:'Erro de conexão'}[status]||'-')}
function publicEmailConfig(tenantId){return emailResolver.publicConfig(tenantId,emailStatusLabel)}
function smtpCfgFromInput(tenantId,body){
  const row=one('SELECT * FROM tenant_email_settings WHERE tenant_id=?',tenantId);
  const env=fromEnv();
  const host=String(body.host!==undefined?body.host:(row?row.host:env.host)||'').trim();
  const user=String(body.user!==undefined?body.user:(row?row.username:env.user)||'').trim();
  const from=String(body.from!==undefined?body.from:(row?row.email_from:env.from)||'').trim();
  const fromName=String(body.fromName!==undefined?body.fromName:(row?row.from_name:env.fromName)||'CDS Contábil').trim()||'CDS Contábil';
  const port=Number(body.port!==undefined?body.port:(row?row.port:env.port)||587)||587;
  const provider=String(body.provider!==undefined?body.provider:(row?row.provider:'smtp')||'smtp').trim().toLowerCase()||'smtp';
  const secure=body.secure!==undefined?!!body.secure:(row?Number(row.secure)===1:!!env.secure);
  let password='';
  if(body.password!==undefined&&!looksLikeSecretPlaceholder(body.password))password=String(body.password);
  else if(row)password=decryptPassword(row);
  password=normalizeSmtpPassword(password);
  return {name:provider,host,port,user,password,from,fromName,secure,timeoutMs:Number(process.env.CDS_EMAIL_TIMEOUT_MS||10000)||10000};
}
function appPublicUrl(){
  // Convites/PASSWORD_RESET: mesma origem pública do sistema; em prod nunca localhost.
  return resolveAppPublicUrl({
    env:process.env,
    isProd:IS_PROD,
    officePublicUrl:config.OFFICE_PUBLIC_URL,
    port:PORT,
    clientPort:CLIENT_PORT
  });
}
/** Links de onboarding do escritório (/ativar-escritorio) usam o front do contador, não o portal. */
function officePublicUrl(){
  return resolveOfficePublicUrl({
    env:process.env,
    isProd:IS_PROD,
    officePublicUrl:config.OFFICE_PUBLIC_URL,
    port:PORT
  });
}
function logCnpjAddress(payload){
  if(process.env.NODE_ENV==='production'&&process.env.CDS_CNPJ_DEBUG!=='1')return;
  console.log('cnpj_address',JSON.stringify(payload||{}));
}
const eventBus=createEventBus({
  db,id,one,qRows,exec,realtime:realtimeHub,
  notificationService:{
    deliverPushForDomainEvent(...args){
      if(notificationCenter.service)return notificationCenter.service.deliverPushForDomainEvent(...args);
      return Promise.resolve({skipped:'not_ready'});
    }
  }
});
function auditSystem(tenantId,userId,action,type,eid,after){exec('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_json,after_json,ip) VALUES(?,?,?,?,?,?,?,?,?)',id(),tenantId,userId||null,action,type,eid,null,after?JSON.stringify(after):null,null)}
const comms=createCommunicationEngine({db,id,one,qRows,exec,auditSystem,backoffMs:process.env.CDS_WHATSAPP_BACKOFF_MS==='0'?()=>0:undefined});
const communicationService=createCommunicationService({id,one,qRows,exec,auditSystem,resolveEmailProvider:emailProviderForTenant,appPublicUrl:()=>appPublicUrl()});
comms.setEmailJobProcessor(job=>communicationService.processEmailJob(job));
function setWhatsAppProvider(p){return comms.setProvider(p)}
function emitEvent(input){const event=eventBus.emitEvent(input);if(event){try{comms.enqueueForEvent(event)}catch{console.error('comms_enqueue_failed',JSON.stringify({event_type:input.eventType||null}))}try{communicationService.enqueueEmailForEvent(event)}catch{console.error('email_enqueue_failed',JSON.stringify({event_type:input.eventType||null}))}}return event}
function emitFromReq(req,eventType,fields){return emitEvent({tenantId:req.user.tenant_id,companyId:fields.companyId,eventType,actorUserId:req.user.sub,entityType:fields.entityType,entityId:fields.entityId,payload:fields.payload})}
function originFromReq(req,fallback){if(req.user.role==='CLIENT')return origens.CODES.PORTAL_CLIENTE;return origens.normalize(req.body&&req.body.origin,fallback||origens.CODES.PORTAL_CLIENTE)}
function withOriginLabel(row){if(!row||typeof row!=='object')return row;return{...row,origin_label:origens.label(row.origin)}}
function publicImport(row){if(!row)return row;const u=row.created_by?one('SELECT name FROM users WHERE id=?',row.created_by):null;let issues=[];try{issues=JSON.parse(row.issues_json||'[]')}catch{}return{id:row.id,company_id:row.company_id,company_name:row.company_name,origin:row.origin,origin_label:origens.label(row.origin),period_start:row.period_start,period_end:row.period_end,status:row.status,total_rows:row.total_rows,imported_rows:row.imported_rows,rejected_rows:row.rejected_rows,issues,source_file:row.source_file,created_by:row.created_by,created_by_name:u?u.name:null,created_at:row.created_at,completed_at:row.completed_at}}
function portfolioAggregates(req,companyId){
  const tenantId=req.user.tenant_id;
  const visC=staffVisibleCompanySql(req,'c.id');
  const visX=staffVisibleCompanySql(req,'company_id');
  const p=[tenantId];let cf='';if(companyId){cf=' AND company_id=?';p.push(companyId)}else{cf+=visX.sql;p.push(...visX.p)}
  const total_companies=companyId?1:one(`SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.status<>'ARCHIVED'${visC.sql}`,tenantId,...visC.p).n;
  const active_companies=companyId?one("SELECT COUNT(*) n FROM companies WHERE tenant_id=? AND id=? AND status='ACTIVE'",tenantId,companyId).n:one(`SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.status='ACTIVE'${visC.sql}`,tenantId,...visC.p).n;
  const companies_with_pendencies=companyId?one("SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.id=? AND EXISTS(SELECT 1 FROM pendencies pe WHERE pe.tenant_id=c.tenant_id AND pe.company_id=c.id AND pe.status='OPEN')",tenantId,companyId).n:one(`SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.status<>'ARCHIVED'${visC.sql} AND EXISTS(SELECT 1 FROM pendencies pe WHERE pe.tenant_id=c.tenant_id AND pe.company_id=c.id AND pe.status='OPEN')`,tenantId,...visC.p).n;
  const companies_with_activity=companyId?one("SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.id=? AND EXISTS(SELECT 1 FROM domain_events ev WHERE ev.tenant_id=c.tenant_id AND ev.company_id=c.id AND datetime(ev.created_at)>=datetime('now','-1 day'))",tenantId,companyId).n:one(`SELECT COUNT(*) n FROM companies c WHERE c.tenant_id=? AND c.status<>'ARCHIVED'${visC.sql} AND EXISTS(SELECT 1 FROM domain_events ev WHERE ev.tenant_id=c.tenant_id AND ev.company_id=c.id AND datetime(ev.created_at)>=datetime('now','-1 day'))`,tenantId,...visC.p).n;
  const expenses_awaiting_classification=one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='NEEDS_CLASSIFICATION'${cf}`,...p).n;
  const entries_awaiting_approval=one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='PENDING'${cf}`,...p).n;
  const entries_posted=one(`SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND status='POSTED'${cf}`,...p).n;
  const entries_awaiting_posting=0;
  const documents_received=one(`SELECT COUNT(*) n FROM documents WHERE tenant_id=? AND deleted_at IS NULL AND IFNULL(status,'')<>'DRAFT'${cf}`,...p).n;
  const open_requests=one(`SELECT COUNT(*) n FROM requests WHERE tenant_id=? AND status IN('OPEN','AGUARDANDO_CLIENTE','AGUARDANDO_ESCRITORIO','RESPONDED','PENDING')${cf}`,...p).n;
  const recent_imports=one(`SELECT COUNT(*) n FROM movement_imports WHERE tenant_id=? AND datetime(created_at)>=datetime('now','-30 day')${cf}`,...p).n;
  return{total_companies,active_companies,companies_with_activity,companies_with_pendencies,expenses_awaiting_classification,entries_awaiting_approval,entries_posted,entries_awaiting_posting,documents_received,open_requests,recent_imports};
}
for(const t of qRows('SELECT id,name,slug FROM tenants')){if(!t.slug)exec('UPDATE tenants SET slug=? WHERE id=?',uniqueTenantSlug(t.name,t.id),t.id)}
try{for(const row of qRows('SELECT id,cnpj,cnpj_normalized FROM companies')){const key=cnpjNorm.normalizeCnpjKey(row.cnpj);if(key&&key!==row.cnpj_normalized)exec('UPDATE companies SET cnpj_normalized=? WHERE id=?',key,row.id)}}catch{}
try{
  clientCode.backfillClientCodes(db,{
    audit:(tenantId,companyId,codigo,{context})=>{
      try{auditSystem(tenantId,null,'CLIENT_CODE_GENERATED','COMPANY',companyId,{tenant_id:tenantId,company_id:companyId,codigo_cliente:codigo,context:context||'backfill'})}catch{/* best-effort */}
    }
  });
}catch(err){console.error('client_code_backfill_failed',String(err&&err.message||err).slice(0,200))}
try{db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)')}catch{}
function accountName(a){return a?`${a.account_code} - ${a.description}`:null}
function parseDelimited(text){return chartParser.parseDelimited(text)}
function norm(h){return String(h).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function normalizeAccount(r){return chartParser.normalizeAccount(r)}
function parsePdfText(text){return chartParser.parsePdfText(text)}
function validateAccounts(rows){return chartParser.validateChartAccounts(rows)}
const MAX_ENTRY_LINES=100,SCORE_SAFE=70,SCORE_GAP=10,SCORE_AUTO_CONFLICT=80;
function lineFail(message,code,http=422){const e=new Error(message);e.code=code;e.http=http;return e}
function assertPostableAccount(tenantId,accountId){const a=one('SELECT id,tenant_id,account_code,description,account_type,is_postable,active FROM accounts WHERE id=?',accountId);if(!a)throw lineFail('Conta inexistente.','ACCOUNT_NOT_FOUND');if(a.tenant_id!==tenantId)throw lineFail('Conta não pertence a este escritório.','ACCOUNT_FORBIDDEN',403);if(!a.active)throw lineFail('Conta inativa.','ACCOUNT_INACTIVE');if(a.account_type==='S'||Number(a.is_postable)!==1)throw lineFail('Conta sintética não pode receber lançamento.','SYNTHETIC_ACCOUNT');return a}
function normalizeEntryLines(raw){if(!Array.isArray(raw)||raw.length<2)throw lineFail('Informe ao menos duas linhas.','INVALID_ENTRY',400);if(raw.length>MAX_ENTRY_LINES)throw lineFail('Limite de 100 linhas por lançamento.','TOO_MANY_LINES',400);return raw.map((l,i)=>{const side=String(l.side||l.type||'').toUpperCase();if(!['D','C'].includes(side))throw lineFail('Tipo D/C inválido na linha '+(i+1)+'.','INVALID_SIDE',400);let amount=l.amount_cents;if(amount===undefined||amount===null||amount===''){if(l.amount===undefined||l.amount===null||l.amount==='')throw lineFail('Valor inválido na linha '+(i+1)+'.','INVALID_AMOUNT',400);amount=typeof l.amount==='number'&&Number.isInteger(l.amount)?l.amount:cents(l.amount)}amount=Math.round(Number(amount));if(!Number.isFinite(amount)||amount<=0)throw lineFail('Valor deve ser maior que zero.','INVALID_AMOUNT',400);if(!l.account_id)throw lineFail('Conta obrigatória na linha '+(i+1)+'.','ACCOUNT_REQUIRED',400);return{account_id:l.account_id,side,amount_cents:amount,memo:l.memo||l.description||null}})}
function assertBalancedLines(lines){const d=lines.filter(l=>l.side==='D').reduce((a,l)=>a+l.amount_cents,0),c=lines.filter(l=>l.side==='C').reduce((a,l)=>a+l.amount_cents,0);if(d<=0||c<=0||d!==c)throw lineFail('Lançamento desbalanceado.','ENTRY_NOT_BALANCED');return{debit:d,credit:c}}
function persistEntryLines(eid,lines){for(const l of lines)exec('INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents,memo) VALUES(?,?,?,?,?,?)',id(),eid,l.account_id,l.side,l.amount_cents,l.memo||null)}
const postingService=createPostingService({id,one,exec,qRows,assertPostableAccount});
const accountMappings=createMappingService({db,id});
const accountingPeriodService=createAccountingPeriodService({db,id,audit,mappings:accountMappings});
let documentPipelineService=null;
function enqueueDocumentPipeline(tenantId,documentId,userId){
  if(process.env.CDS_DOCUMENT_PIPELINE==='off')return;
  try{if(documentPipelineService)documentPipelineService.enqueue(tenantId,documentId,userId)}catch{/* best-effort */}
}
function guardPeriodWritable(req,res,companyId,occurredOn){
  try{accountingPeriodService.assertWritable(req.user.tenant_id,companyId,occurredOn);return true}
  catch(err){deny(res,err.http||409,err.message,err.code||'ACCOUNTING_PERIOD_CLOSED');return false}
}
function saveClassificationRun(req,{companyId,sourceType,sourceId,entryId,cls,note}){exec('INSERT INTO classification_runs(id,tenant_id,company_id,source_type,source_id,entry_id,status,chosen_debit_account_id,chosen_credit_account_id,origin,score,reasons_json,candidates_json,decided_by,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id(),req.user.tenant_id,companyId,sourceType||'MANUAL',sourceId||null,entryId||null,cls.status,cls.debit_account_id||null,cls.credit_account_id||null,cls.origin||null,Number(cls.score||0),JSON.stringify(cls.reasons||[]),JSON.stringify((cls.candidates||[]).slice(0,20).map(c=>({source:c.source,score:c.score,debit_account_id:c.debit_account_id,credit_account_id:c.credit_account_id,reasons:c.reasons,rule_name:c.rule_name,priority:c.priority}))),req.user.sub,note||null)}
function parseRuleConditions(json){try{return JSON.parse(json||'{}')}catch{return{}}}
function ruleMatches(c,tx){if(c.description&&!String(tx.description||'').toLowerCase().includes(String(c.description).toLowerCase()))return false;if(c.payment_method&&c.payment_method!==tx.payment_method)return false;if(c.receipt_method&&c.receipt_method!==tx.receipt_method)return false;if(c.category_id&&c.category_id!==tx.category_id)return false;if(c.bank_id&&c.bank_id!==tx.bank_id)return false;if(c.source_type&&c.source_type!==tx.source_type)return false;return true}
function scoreRule(rule,c){let s=80;if(rule.company_id)s+=10;if(c.description)s+=5;if(c.payment_method||c.receipt_method)s+=2;if(c.category_id)s+=2;if(c.bank_id)s+=2;s-=Math.min(25,Math.floor(Number(rule.priority||100)/4));return Math.max(1,Math.min(100,Math.round(s)))}
function classificationDiagnosis(tenantId,companyId,tx){
  const cat=tx.category_id?one('SELECT c.id,c.name,c.account_id FROM categories c WHERE c.tenant_id=? AND c.id=? AND (c.company_id IS NULL OR c.company_id=?)',tenantId,tx.category_id,companyId):null;
  const bank=tx.bank_id?one('SELECT b.id,b.name,b.account_id FROM banks b WHERE b.tenant_id=? AND b.id=? AND (b.company_id IS NULL OR b.company_id=?)',tenantId,tx.bank_id,companyId):null;
  const catOk=!!(cat&&cat.account_id&&(()=>{try{return !!assertPostableAccount(tenantId,cat.account_id)}catch{return false}})());
  const bankOk=!!(bank&&bank.account_id&&(()=>{try{return !!assertPostableAccount(tenantId,bank.account_id)}catch{return false}})());
  const messages=[];
  if(!cat)messages.push('A despesa ainda não possui categoria contábil configurada.');
  else if(!catOk)messages.push('A categoria '+cat.name+' existe, mas ainda não possui conta contábil vinculada.');
  else messages.push('Conta contábil da categoria identificada.');
  if(!bank)messages.push('A despesa ainda não possui banco com conta contábil configurada.');
  else if(!bankOk)messages.push('O '+bank.name+' está cadastrado, mas ainda não possui conta contábil vinculada.');
  else messages.push('Conta contábil do banco identificada.');
  const complete=catOk&&bankOk;
  if(complete)messages.push('Categoria e banco possuem contas contábeis configuradas.');
  return{complete,category_ready:catOk,bank_ready:bankOk,category_name:cat?cat.name:null,bank_name:bank?bank.name:null,messages};
}
function classify(tenantId,companyId,tx){const accCache=new Map();const postable=accountId=>{if(!accountId)return null;if(accCache.has(accountId))return accCache.get(accountId);try{const a=assertPostableAccount(tenantId,accountId);accCache.set(accountId,a);return a}catch{accCache.set(accountId,null);return null}};const rules=qRows('SELECT r.* FROM accounting_rules r WHERE r.tenant_id=? AND r.active=1 AND (r.company_id IS NULL OR r.company_id=?) ORDER BY CASE WHEN r.company_id IS NULL THEN 1 ELSE 0 END, r.priority ASC, r.created_at ASC',tenantId,companyId);const candidates=[];for(const r of rules){const c=parseRuleConditions(r.conditions_json);if(!ruleMatches(c,tx)||!r.debit_account_id||!r.credit_account_id)continue;const reasons=['Regra "'+r.name+'" correspondeu'];if(c.description)reasons.push('descrição contém "'+c.description+'"');if(r.company_id)reasons.push('regra específica da empresa');else reasons.push('regra global do escritório');reasons.push('prioridade '+r.priority);const debit=postable(r.debit_account_id),credit=postable(r.credit_account_id);candidates.push({source:'RULE',rule_id:r.id,rule_name:r.name,priority:Number(r.priority||100),debit_account_id:r.debit_account_id,credit_account_id:r.credit_account_id,score:scoreRule(r,c),reasons,postable:!!(debit&&credit)})}
const cat=tx.category_id?one('SELECT c.account_id,c.name FROM categories c WHERE c.tenant_id=? AND c.id=? AND c.active=1 AND (c.company_id IS NULL OR c.company_id=?)',tenantId,tx.category_id,companyId):null;const bank=tx.bank_id?one('SELECT b.account_id,b.name FROM banks b WHERE b.tenant_id=? AND b.id=? AND b.active=1 AND (b.company_id IS NULL OR b.company_id=?)',tenantId,tx.bank_id,companyId):null;const expense=tx.source_type!=='REVENUE';if(cat?.account_id&&bank?.account_id){const debitId=expense?cat.account_id:bank.account_id,creditId=expense?bank.account_id:cat.account_id;candidates.push({source:'CATEGORY',priority:500,debit_account_id:debitId,credit_account_id:creditId,score:70,reasons:['Categoria vinculada a conta analítica','Banco/caixa vinculado a conta analítica'],postable:!!(postable(debitId)&&postable(creditId))})}else if(cat?.account_id){candidates.push({source:'CATEGORY',priority:600,debit_account_id:expense?cat.account_id:null,credit_account_id:expense?null:cat.account_id,score:55,reasons:['Somente categoria vinculada; falta contraparte'],incomplete:true})}else if(bank?.account_id){candidates.push({source:'BANK',priority:600,debit_account_id:expense?null:bank.account_id,credit_account_id:expense?bank.account_id:null,score:50,reasons:['Somente banco/caixa vinculado; falta contraparte'],incomplete:true})}
const usable=candidates.filter(x=>!x.incomplete&&x.postable&&x.debit_account_id&&x.credit_account_id);const groups=new Map();for(const c of usable){const key=c.debit_account_id+'|'+c.credit_account_id;const g=groups.get(key)||{debit_account_id:c.debit_account_id,credit_account_id:c.credit_account_id,score:0,priority:999,source:c.source,reasons:c.reasons,rule_id:c.rule_id,rule_name:c.rule_name,matches:[]};g.matches.push(c);if(c.score>g.score||(c.score===g.score&&c.priority<g.priority)){g.score=c.score;g.priority=c.priority;g.source=c.source;g.reasons=c.reasons;g.rule_id=c.rule_id;g.rule_name=c.rule_name}groups.set(key,g)}const ranked=[...groups.values()].sort((a,b)=>b.score-a.score||a.priority-b.priority);let safe=false,chosen=null;if(ranked.length===1&&ranked[0].score>=SCORE_SAFE){safe=true;chosen=ranked[0]}else if(ranked.length>1&&ranked[0].score>=SCORE_AUTO_CONFLICT&&ranked[0].score-ranked[1].score>=SCORE_GAP){safe=true;chosen=ranked[0]}
if(safe&&chosen&&chosen.debit_account_id!==chosen.credit_account_id){const debitAcc=postable(chosen.debit_account_id),creditAcc=postable(chosen.credit_account_id);return{status:'CLASSIFIED',ruleId:chosen.rule_id,debit_account_id:chosen.debit_account_id,credit_account_id:chosen.credit_account_id,confidence:chosen.score/100,score:chosen.score,origin:chosen.source,reason:chosen.reasons.join('; '),reasons:chosen.reasons,candidates:ranked,debit:accountName(debitAcc),credit:accountName(creditAcc),diagnosis:classificationDiagnosis(tenantId,companyId,tx)}}
const incomplete=candidates.filter(x=>x.incomplete);const dx=classificationDiagnosis(tenantId,companyId,tx);const reasons=ranked.length?['Há mais de uma possibilidade. Confira as contas e confirme o lançamento.']:(incomplete.length||dx.messages.length)?dx.messages.filter((m,i,a)=>a.indexOf(m)===i):['Não encontramos uma regra contábil para esta movimentação. Informe débito e crédito.'];return{status:'NEEDS_CLASSIFICATION',debit_account_id:null,credit_account_id:null,confidence:ranked[0]?ranked[0].score/100:0,score:ranked[0]?.score||0,origin:null,reason:reasons[0],reasons,candidates:ranked.concat(candidates.filter(x=>x.incomplete)),diagnosis:dx}}
function createEntry(req,{companyId,sourceType,sourceId,date,description,amountCents,classification}){let classified=classification&&classification.status==='CLASSIFIED'&&classification.debit_account_id&&classification.credit_account_id;const lines=classified?[{account_id:classification.debit_account_id,side:'D',amount_cents:amountCents,memo:description},{account_id:classification.credit_account_id,side:'C',amount_cents:amountCents,memo:description}]:[];if(classified){try{validateAccountingSemantics({sourceType,lines})}catch{classified=false;lines.length=0;if(classification)classification.status='NEEDS_CLASSIFICATION'}}if(sourceId){const existing=one('SELECT * FROM entries WHERE tenant_id=? AND source_type=? AND source_id=?',req.user.tenant_id,sourceType,sourceId);if(existing){if(entryStates.isLocked(existing.status))return existing.id;accountingPeriodService.assertWritable(req.user.tenant_id,companyId,date);db.transaction(()=>{exec('DELETE FROM entry_lines WHERE entry_id=?',existing.id);if(lines.length){for(const l of lines)assertPostableAccount(req.user.tenant_id,l.account_id);persistEntryLines(existing.id,lines);exec("UPDATE entries SET status='PENDING',confidence=?,rejected_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",classification.confidence||0,existing.id);exec("UPDATE pendencies SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND entity_type='ENTRY' AND entity_id=? AND status='OPEN'",req.user.tenant_id,existing.id)}else exec("UPDATE entries SET status='NEEDS_CLASSIFICATION',confidence=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",classification?.confidence||0,existing.id)})();saveClassificationRun(req,{companyId,sourceType,sourceId,entryId:existing.id,cls:classification||{status:'NEEDS_CLASSIFICATION',score:0,reasons:[]}});return existing.id}}
accountingPeriodService.assertWritable(req.user.tenant_id,companyId,date);const eid=id();db.transaction(()=>{exec('INSERT INTO entries(id,tenant_id,company_id,source_type,source_id,occurred_on,description,status,confidence,generated_by) VALUES(?,?,?,?,?,?,?,?,?,?)',eid,req.user.tenant_id,companyId,sourceType,sourceId,date,description,classified?'PENDING':'NEEDS_CLASSIFICATION',classification?.confidence||0,req.user.sub);if(lines.length){for(const l of lines)assertPostableAccount(req.user.tenant_id,l.account_id);persistEntryLines(eid,lines)}else exec('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason) VALUES(?,?,?,?,?,?)',id(),req.user.tenant_id,companyId,'ENTRY',eid,'Movimentação aguardando classificação')})();saveClassificationRun(req,{companyId,sourceType,sourceId,entryId:eid,cls:classification||{status:'NEEDS_CLASSIFICATION',score:0,reasons:[]}});return eid}
function entry(req,eid){const e=one('SELECT e.*,c.name company_name FROM entries e LEFT JOIN companies c ON c.id=e.company_id WHERE e.tenant_id=? AND e.id=?',req.user.tenant_id,eid);if(!e)return null;e.lines=qRows('SELECT l.*,a.account_code,a.description account_description,a.account_type FROM entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=? ORDER BY l.side,l.id',eid);const b=qRows("SELECT side,SUM(amount_cents) total FROM entry_lines WHERE entry_id=? GROUP BY side",eid);e.debit=b.find(x=>x.side==='D')?.total||0;e.credit=b.find(x=>x.side==='C')?.total||0;e.balanced=e.debit===e.credit&&e.debit>0;const run=one('SELECT * FROM classification_runs WHERE entry_id=? ORDER BY created_at DESC LIMIT 1',eid);if(run){try{run.reasons=JSON.parse(run.reasons_json||'[]');run.candidates=JSON.parse(run.candidates_json||'[]')}catch{run.reasons=[];run.candidates=[]}e.classification=run}if(e.source_id&&e.source_type==='EXPENSE'){e.movement=one('SELECT x.id,x.occurred_on,x.description,x.amount_cents,x.payment_method method,x.category_id,x.bank_id,x.status,x.origin,x.document_id,x.supplier_name,b.name bank_name,cat.name category_name FROM expenses x LEFT JOIN banks b ON b.id=x.bank_id LEFT JOIN categories cat ON cat.id=x.category_id WHERE x.tenant_id=? AND x.id=?',req.user.tenant_id,e.source_id);if(e.movement&&e.movement.origin)e.origin=e.movement.origin}if(e.source_id&&e.source_type==='REVENUE'){e.movement=one('SELECT x.id,x.occurred_on,x.description,x.amount_cents,x.receipt_method method,x.category_id,x.bank_id,x.status,x.origin,x.document_id,b.name bank_name,cat.name category_name FROM revenues x LEFT JOIN banks b ON b.id=x.bank_id LEFT JOIN categories cat ON cat.id=x.category_id WHERE x.tenant_id=? AND x.id=?',req.user.tenant_id,e.source_id);if(e.movement&&e.movement.origin)e.origin=e.movement.origin}if(e.movement&&e.movement.document_id){const d=one('SELECT id,original_name,mime_type,size_bytes FROM documents WHERE id=? AND tenant_id=? AND deleted_at IS NULL',e.movement.document_id,req.user.tenant_id);if(d)e.document=d;const pipe=one('SELECT status,operation_type,confidence,confidence_band,confidence_reason,suggestion_json,fields_json FROM document_pipeline_runs WHERE tenant_id=? AND document_id=?',req.user.tenant_id,e.movement.document_id);if(pipe){let suggestion=null,fields=null;try{suggestion=JSON.parse(pipe.suggestion_json||'null')}catch{}try{fields=JSON.parse(pipe.fields_json||'null')}catch{}e.pipeline={status:pipe.status,operation_type:pipe.operation_type,confidence:pipe.confidence,confidence_band:pipe.confidence_band,confidence_reason:pipe.confidence_reason,suggestion,fields}}}e.timeline=qRows('SELECT a.action,a.created_at,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? AND a.entity_id=? ORDER BY a.created_at LIMIT 12',req.user.tenant_id,eid);if(e.movement){e.classification=e.classification||{};e.classification.diagnosis=classificationDiagnosis(req.user.tenant_id,e.company_id,{category_id:e.movement.category_id,bank_id:e.movement.bank_id})}return e}
app.get('/api/health',(req,res)=>res.json({ok:true,product:'CDS Contábil Connect',version:'1.0.0',database:'sqlite',demo:!!config.DEMO_MODE,auth_cookie:!!config.AUTH_COOKIE,auth_cookie_ready:!!config.AUTH_COOKIE,...publicFrontUrls()}));
// AUTH
app.post('/api/auth/register',(req,res)=>{if(IS_PROD)return deny(res,403,'Registro público não está disponível.','REGISTER_DISABLED');const{name,email,password,tenantName,cnpj}=req.body;if(!name||!email||!password||!tenantName)return res.status(400).json({error:'FIELDS_REQUIRED'});const pw=passwordPolicyError(password);if(pw)return deny(res,400,pw,'INVALID_PASSWORD');const tid=id(),uid=id(),slug=uniqueTenantSlug(tenantName);try{db.transaction(()=>{exec('INSERT INTO tenants(id,name,cnpj,slug) VALUES(?,?,?,?)',tid,tenantName,cnpj||null,slug);exec('INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES(?,?,?,?,?,?)',uid,tid,name,email.toLowerCase(),bcrypt.hashSync(password,12),'OWNER')})();res.status(201).json({id:uid,tenant_id:tid,tenant_slug:slug})}catch(e){res.status(409).json({error:'REGISTER_FAILED',message:e.message})}});
app.post('/api/auth/signup',rateSignup,async(req,res)=>{
  if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.company_id;delete req.body.role;delete req.body.user_id}
  const officeName=String(req.body.office_name||req.body.tenantName||req.body.officeName||'').trim();
  const officeEmail=String(req.body.office_email||req.body.email_escritorio||'').trim().toLowerCase();
  const ownerName=String(req.body.owner_name||req.body.name||'').trim();
  const ownerEmail=String(req.body.owner_email||req.body.email||'').trim().toLowerCase();
  const password=String(req.body.password||'');
  const cnpjRaw=String(req.body.cnpj||req.body.office_cnpj||'').trim();
  if(!officeName||!officeEmail||!ownerName||!ownerEmail||!password||!cnpjRaw)return deny(res,400,'Informe os dados do escritório e do responsável.','FIELDS_REQUIRED');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(officeEmail)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail))return deny(res,400,'Informe um e-mail válido.','INVALID_EMAIL');
  if(!cnpjNorm.isPlausibleCnpj(cnpjRaw))return deny(res,400,'Informe um CNPJ válido.','CNPJ_INVALIDO');
  const pw=passwordPolicyError(password);if(pw)return deny(res,400,pw,'INVALID_PASSWORD');
  const cnpjKey=cnpjNorm.normalizeCnpjKey(cnpjRaw);
  const cnpjDisplay=cnpjNorm.formatCnpjDisplay(cnpjKey);
  if(tenantCnpjTaken(cnpjKey)||one("SELECT id FROM office_registrations WHERE office_cnpj_normalized=? AND status='PENDING'",cnpjKey)){
    return deny(res,409,'Já existe um escritório cadastrado com este CNPJ.','CNPJ_DUPLICATE');
  }
  if(one('SELECT id FROM users WHERE lower(email)=?',ownerEmail)||one("SELECT id FROM office_registrations WHERE lower(owner_email)=? AND status='PENDING'",ownerEmail)){
    return deny(res,409,'Já existe um usuário com este e-mail.','EMAIL_DUPLICATE');
  }
  const regId=id();
  const raw=crypto.randomBytes(32).toString('hex');
  const expires=new Date(Date.now()+48*60*60*1000).toISOString();
  const password_hash=bcrypt.hashSync(password,12);
  try{
    exec(
      'INSERT INTO office_registrations(id,token_hash,office_name,office_cnpj,office_cnpj_normalized,office_email,owner_name,owner_email,password_hash,status,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      regId,tokenHash(raw),officeName,cnpjDisplay,cnpjKey,officeEmail,ownerName,ownerEmail,password_hash,'PENDING',expires
    );
  }catch(e){
    if(String(e.message||e.code||'').includes('UNIQUE')||String(e.code||'').includes('CONSTRAINT')){
      return deny(res,409,'Já existe um cadastro pendente com estes dados.','SIGNUP_DUPLICATE');
    }
    throw e;
  }
  const activation_url=officePublicUrl()+'/ativar-escritorio/'+raw;
  const tpl=emailTemplates.render('office-signup',{name:ownerName,office_name:officeName,url:activation_url});
  const provider=resolvePlatformEmailProvider();
  let delivery;
  try{
    const rawResult=await provider.send({to:ownerEmail,subject:tpl.subject,text:tpl.text,html:tpl.html});
    delivery=normalizeResult(rawResult,provider.name||'smtp');
  }catch(err){
    delivery={accepted:false,status:'failed',code:'EMAIL_SEND_FAILED',provider:provider&&provider.name||null};
  }
  if(!emailSendSucceeded(delivery)){
    exec("UPDATE office_registrations SET status='REVOKED' WHERE id=? AND status='PENDING'",regId);
    logOfficeSignupEmailFailure(delivery);
    const code=(delivery&&delivery.code)||'EMAIL_SEND_FAILED';
    const notCfg=code==='EMAIL_NOT_CONFIGURED'||(delivery&&delivery.status==='not_configured');
    const authFail=code==='EMAIL_AUTH_FAILED';
    let message='Não foi possível enviar o e-mail de confirmação. Verifique a configuração de envio e tente novamente.';
    let errorCode='SIGNUP_EMAIL_FAILED';
    if(notCfg){
      message='O envio de e-mail ainda não está configurado neste ambiente. Configure o SMTP da plataforma (CDS_EMAIL_*) ou a infraestrutura CDS e tente novamente.';
      errorCode='SIGNUP_EMAIL_NOT_CONFIGURED';
    }else if(authFail){
      message=authFailMessage(fromEnv());
      errorCode='SIGNUP_EMAIL_AUTH_FAILED';
    }
    return deny(res,502,message,errorCode);
  }
  const safe={ok:true,message:'Cadastro recebido. Verifique seu e-mail para confirmar e ativar a conta.',expires_at:expires};
  if(!IS_PROD||process.env.CDS_EMAIL_DEBUG==='1')safe.activation_url=activation_url;
  res.status(201).json(safe);
});
app.get('/api/auth/signup/:token',(req,res)=>{
  let row=officeRegistrationByToken(req.params.token);
  if(!row)return deny(res,404,'Não foi possível validar este cadastro.','SIGNUP_NOT_FOUND');
  row=markExpiredOfficeRegistration(row);
  const messages={PENDING:'Confirme seu e-mail para ativar o escritório.',COMPLETED:'Esta conta já foi ativada.',EXPIRED:'Este link de ativação expirou.',REVOKED:'Este cadastro não está mais disponível.'};
  res.json({
    status:row.status,
    office_name:row.office_name,
    owner_name:row.owner_name,
    owner_email:row.owner_email,
    expires_at:row.expires_at,
    message:messages[row.status]||'Não foi possível validar este cadastro.'
  });
});
app.post('/api/auth/signup/:token/confirm',(req,res)=>{
  if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.company_id;delete req.body.role;delete req.body.user_id}
  let row=officeRegistrationByToken(req.params.token);
  if(!row)return deny(res,404,'Não foi possível validar este cadastro.','SIGNUP_NOT_FOUND');
  row=markExpiredOfficeRegistration(row);
  if(row.status==='COMPLETED')return deny(res,409,'Esta conta já foi ativada.','SIGNUP_ALREADY_COMPLETED');
  if(row.status==='EXPIRED')return deny(res,410,'Este link de ativação expirou.','SIGNUP_EXPIRED');
  if(row.status==='REVOKED')return deny(res,410,'Este cadastro não está mais disponível.','SIGNUP_REVOKED');
  if(row.status!=='PENDING')return deny(res,409,'Não foi possível ativar este cadastro.','SIGNUP_INVALID');
  if(tenantCnpjTaken(row.office_cnpj_normalized))return deny(res,409,'Já existe um escritório cadastrado com este CNPJ.','CNPJ_DUPLICATE');
  if(one('SELECT id FROM users WHERE lower(email)=?',String(row.owner_email||'').toLowerCase()))return deny(res,409,'Já existe um usuário com este e-mail.','EMAIL_DUPLICATE');
  const tid=id(),uid=id(),slug=uniqueTenantSlug(row.office_name);
  const completedAt=new Date().toISOString();
  try{
    db.transaction(()=>{
      const claimed=db.prepare("UPDATE office_registrations SET status='COMPLETED',completed_at=? WHERE id=? AND status='PENDING'").run(completedAt,row.id);
      if(!claimed.changes)throw Object.assign(new Error('SIGNUP_CONFLICT'),{code:'SIGNUP_CONFLICT'});
      exec('INSERT INTO tenants(id,name,cnpj,slug) VALUES(?,?,?,?)',tid,row.office_name,row.office_cnpj||null,slug);
      exec('INSERT INTO users(id,tenant_id,name,email,password_hash,role,active,pin_setup_required) VALUES(?,?,?,?,?,?,1,1)',uid,tid,row.owner_name,String(row.owner_email).toLowerCase(),row.password_hash,'OWNER');
      exec('UPDATE office_registrations SET tenant_id=? WHERE id=?',tid,row.id);
    })();
  }catch(e){
    if(e&&e.code==='SIGNUP_CONFLICT')return deny(res,409,'Este cadastro já foi processado.','SIGNUP_CONFLICT');
    if(String(e.message||e.code||'').includes('UNIQUE')||String(e.code||'').includes('CONSTRAINT')){
      return deny(res,409,'Não foi possível concluir o cadastro.','SIGNUP_CONFLICT');
    }
    throw e;
  }
  auditSystem(tid,uid,'ACCOUNT_REGISTRATION_REQUESTED','OFFICE_REGISTRATION',row.id,{registration_id:row.id,office_name:row.office_name,owner_email:row.owner_email});
  auditSystem(tid,uid,'EMAIL_VERIFIED','OFFICE_REGISTRATION',row.id,{registration_id:row.id,owner_email:row.owner_email});
  auditSystem(tid,uid,'TENANT_CREATED','TENANT',tid,{tenant_id:tid,slug,name:row.office_name,cnpj:row.office_cnpj});
  auditSystem(tid,uid,'OWNER_CREATED','USER',uid,{user_id:uid,tenant_id:tid,email:row.owner_email,role:'OWNER'});
  auditSystem(tid,uid,'ACCOUNT_ACTIVATED','USER',uid,{user_id:uid,tenant_id:tid,registration_id:row.id,role:'OWNER'});
  res.json({ok:true,message:'E-mail confirmado. Conta ativada com sucesso.',tenant_id:tid,tenant_slug:slug,user_id:uid,role:'OWNER',redirect:'/',requires_pin_setup:true,pin_configured:false});
});
function officePublicIdentity(tenantId){
  const tenant=one('SELECT id,name,cnpj,slug FROM tenants WHERE id=?',tenantId);
  if(!tenant)return{name:null,cnpj:null,logo_url:null};
  const row=one('SELECT * FROM tenant_branding WHERE tenant_id=?',tenantId);
  const office_name=(row&&row.office_name)||tenant.name||null;
  let logo_url=null;
  try{
    const abs=typeof resolveBrandFile==='function'&&row?resolveBrandFile(tenantId,row.logo_path):null;
    const has_logo=!!(abs&&fs.existsSync(abs));
    if(has_logo&&tenant.slug){
      const v=encodeURIComponent((row&&(row.logo_updated_at||row.updated_at))||'');
      logo_url='/api/public/branding/logo?tenant='+encodeURIComponent(tenant.slug)+'&v='+v;
    }
  }catch{/* ignore branding resolution errors */}
  const cnpjKey=tenant.cnpj?cnpjNorm.normalizeCnpjKey(tenant.cnpj):null;
  const cnpj=cnpjKey?(cnpjNorm.formatCnpjDisplay(cnpjKey)||tenant.cnpj):null;
  return{name:office_name,cnpj,logo_url};
}
function userLoginEligible(u){
  if(!u||!u.active)return false;
  if(u.role==='CLIENT'){
    const company=u.company_id?one('SELECT status FROM companies WHERE tenant_id=? AND id=?',u.tenant_id,u.company_id):null;
    if(!company||company.status!=='ACTIVE')return false;
  }
  return true;
}
function finishLoginResponse(req,res,u){
  exec('UPDATE users SET last_access_at=CURRENT_TIMESTAMP WHERE id=?',u.id);
  const profile=u.role==='CLIENT'?clientProfile({user:{sub:u.id}}):null;
  const fresh=one('SELECT * FROM users WHERE id=?',u.id);
  const token=issueToken(fresh,profile);
  audit({user:{tenant_id:u.tenant_id,sub:u.id},ip:req.ip},'LOGIN','USER',u.id,null,{role:u.role,result:'ok'});
  const tenantSlug=one('SELECT slug FROM tenants WHERE id=?',u.tenant_id)?.slug||null;
  const office=officePublicIdentity(u.tenant_id);
  if(config.AUTH_COOKIE){
    const secureCookie=IS_PROD||/^https:\/\//i.test(String(config.OFFICE_PUBLIC_URL||process.env.CDS_OFFICE_PUBLIC_URL||''));
    res.cookie('cds_session',token,{httpOnly:true,secure:secureCookie,sameSite:'lax',path:'/',maxAge:12*60*60*1000});
  }
  const pinState=pinAuth.publicPinState(fresh);
  return res.json({
    token,
    redirect:u.role==='CLIENT'?'/portal/':'/',
    office,
    pin_configured:pinState.pin_configured,
    requires_pin_setup:pinState.requires_pin_setup,
    user:{
      id:u.id,name:u.name,email:u.email,role:u.role,
      tenant_id:u.tenant_id,tenant_slug:tenantSlug,tenant_name:office.name||null,
      company_id:u.company_id,profile,
      permissions:u.role==='CLIENT'?clientPermissionList(u.id):null,
      pin_configured:pinState.pin_configured,
      requires_pin_setup:pinState.requires_pin_setup
    }
  });
}
function environmentChoicePayload(matches){
  const picks=matches.map(u=>{
    const key=crypto.randomBytes(12).toString('hex');
    const office=officePublicIdentity(u.tenant_id);
    return{key,uid:u.id,env:{key,name:office.name,cnpj:office.cnpj,logo_url:office.logo_url}};
  });
  const choice_token=jwt.sign(
    {purpose:'LOGIN_CHOICE',picks:picks.map(p=>({k:p.key,uid:p.uid}))},
    SECRET,
    {algorithm:'HS256',expiresIn:'5m'}
  );
  return{needs_environment_choice:true,choice_token,environments:picks.map(p=>p.env)};
}
function passwordMatches(u,password){
  let ok=false;
  try{ok=bcrypt.compareSync(password,u?.password_hash||DUMMY_HASH)}catch{ok=false}
  return ok;
}
app.post('/api/auth/login',rateLogin,(req,res)=>{
  const email=String(req.body.email||'').trim();
  const password=String(req.body.password||'');
  const tenantKey=String(req.body.tenant||req.body.tenant_slug||req.body.office||'').trim().toLowerCase();
  if(!email||!password)return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');

  // Compatibilidade: tenant explícito (Portal / clientes legados) continua resolvendo um único ambiente.
  if(tenantKey){
    let tenant=one('SELECT * FROM tenants WHERE lower(IFNULL(slug,\'\'))=? OR id=?',tenantKey,tenantKey);
    if(!tenant&&tenantKey==='demo')tenant=one("SELECT * FROM tenants WHERE lower(IFNULL(slug,''))='escritorio-demonstracao'");
    const u=tenant?one('SELECT * FROM users WHERE tenant_id=? AND lower(email)=lower(?)',tenant.id,email):null;
    const ok=passwordMatches(u,password);
    if(!tenant||!u||!ok||!userLoginEligible(u)){
      if(u&&ok&&u.role==='CLIENT'&&!userLoginEligible(u))return deny(res,401,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');
      return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
    }
    return finishLoginResponse(req,res,u);
  }

  // Login V2: e-mail + senha; tenant identificado automaticamente após autenticação.
  const candidates=qRows('SELECT * FROM users WHERE lower(email)=lower(?)',email);
  if(!candidates.length){passwordMatches(null,password);return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS')}
  const matches=[];
  let matchedButBlocked=false;
  for(const u of candidates){
    if(!passwordMatches(u,password))continue;
    if(!userLoginEligible(u)){matchedButBlocked=true;continue}
    matches.push(u);
  }
  if(!matches.length){
    if(matchedButBlocked)return deny(res,401,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');
    return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
  }
  if(matches.length===1)return finishLoginResponse(req,res,matches[0]);
  return res.json(environmentChoicePayload(matches));
});
app.post('/api/auth/login/choose',rateLogin,(req,res)=>{
  const choiceToken=String(req.body.choice_token||req.body.token||'').trim();
  const key=String(req.body.key||req.body.environment_key||'').trim();
  if(!choiceToken||!key)return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
  let payload;
  try{payload=jwt.verify(choiceToken,SECRET,{algorithms:['HS256']})}catch{return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS')}
  if(!payload||payload.purpose!=='LOGIN_CHOICE'||!Array.isArray(payload.picks))return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
  const hit=payload.picks.find(p=>p&&p.k===key);
  if(!hit||!hit.uid)return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
  const u=one('SELECT * FROM users WHERE id=?',hit.uid);
  if(!u||!userLoginEligible(u))return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
  return finishLoginResponse(req,res,u);
});
function markPasswordResetRequestNotifications(tenantId,userId,{read=true}={}){
  if(read){
    exec(
      "UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND type=? AND entity_id=? AND read_at IS NULL",
      tenantId,EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED,userId
    );
  }
}
function passwordResetRequestStatus(invite){
  if(!invite||invite.purpose!=='PASSWORD_RESET')return null;
  if(invite.status==='ACCEPTED')return 'CONCLUIDA';
  if(invite.status==='REVOKED'||invite.status==='EXPIRED')return 'FALHA';
  if(invite.status==='PENDING')return 'PENDENTE';
  return null;
}
app.post('/api/auth/forgot-password',rateForgot,async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const tenantKey=String(req.body.tenant||req.body.tenant_slug||req.body.office||'').trim().toLowerCase();
  const respond=()=>res.json({ok:true,message:FORGOT_GENERIC});
  if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return respond();
  let tenant=null;
  let u=null;
  if(tenantKey){
    tenant=one('SELECT * FROM tenants WHERE lower(IFNULL(slug,\'\'))=? OR id=?',tenantKey,tenantKey);
    if(!tenant&&tenantKey==='demo')tenant=one("SELECT * FROM tenants WHERE lower(IFNULL(slug,''))='escritorio-demonstracao'");
    if(!tenant)return respond();
    u=one("SELECT * FROM users WHERE tenant_id=? AND lower(email)=? AND role='CLIENT'",tenant.id,email);
  }else{
    const candidates=qRows("SELECT u.* FROM users u JOIN companies c ON c.id=u.company_id AND c.tenant_id=u.tenant_id WHERE lower(u.email)=? AND u.role='CLIENT' AND IFNULL(u.active,1)=1 AND c.status='ACTIVE'",email);
    if(candidates.length!==1)return respond();
    u=candidates[0];
    tenant=one('SELECT * FROM tenants WHERE id=?',u.tenant_id);
  }
  if(!tenant||!u||!u.company_id)return respond();
  const company=one("SELECT id,name,trade_name,status FROM companies WHERE tenant_id=? AND id=? AND status='ACTIVE'",tenant.id,u.company_id);
  if(!company)return respond();
  const sysReq={user:{tenant_id:tenant.id,sub:u.id},ip:req.ip};
  const payloadBase={
    user_name:u.name,
    user_email:u.email,
    target_user_id:u.id,
    reference_type:'CLIENT_USER',
    title:company.trade_name||company.name,
    method:'EMAIL'
  };
  try{
    const invite=await invitationRecord(sysReq,company.id,u.id,u.email,{purpose:'PASSWORD_RESET',expiresHours:24});
    if(!invite.email_sent){
      exec("UPDATE client_invitations SET status='REVOKED' WHERE id=?",invite.id);
      markPasswordResetRequestNotifications(tenant.id,u.id,{read:true});
      auditSystem(tenant.id,u.id,'PASSWORD_RESET_FAILED','USER',u.id,{
        company_id:company.id,tenant_id:tenant.id,client_user_id:u.id,user_id:u.id,
        invitation_id:invite.id,method:'EMAIL',status:'FALHA',result:'failed',
        requested_at:invite.created_at||new Date().toISOString(),completed_at:new Date().toISOString(),
        email_status:invite.email_status
      });
      emitEvent({
        tenantId:tenant.id,
        companyId:company.id,
        eventType:EVENT_TYPES.PASSWORD_RESET_FAILED,
        actorUserId:u.id,
        entityType:'client_user',
        entityId:u.id,
        payload:{...payloadBase,note:'Falha no envio do e-mail',status:'FALHA',invitation_id:invite.id}
      });
      return respond();
    }
    const inviteRow=one('SELECT id,created_at,status,purpose FROM client_invitations WHERE id=?',invite.id);
    const existingUnread=one(
      "SELECT id FROM notifications WHERE tenant_id=? AND type=? AND entity_id=? AND read_at IS NULL LIMIT 1",
      tenant.id,EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED,u.id
    );
    if(!existingUnread){
      emitEvent({
        tenantId:tenant.id,
        companyId:company.id,
        eventType:EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED,
        actorUserId:u.id,
        entityType:'client_user',
        entityId:u.id,
        payload:{...payloadBase,status:'PENDENTE',invitation_id:invite.id}
      });
    }
    const requestedAt=(inviteRow&&inviteRow.created_at)||new Date().toISOString();
    auditSystem(tenant.id,u.id,'PASSWORD_RESET_EMAIL_SENT','USER',u.id,{
      company_id:company.id,tenant_id:tenant.id,client_user_id:u.id,user_id:u.id,
      invitation_id:invite.id,method:'EMAIL',status:'PENDENTE',result:'ok',
      requested_at:requestedAt
    });
    auditSystem(tenant.id,u.id,'CLIENT_PASSWORD_RESET_REQUESTED','USER',u.id,{
      company_id:company.id,tenant_id:tenant.id,client_user_id:u.id,user_id:u.id,
      invitation_id:invite.id,method:'EMAIL',status:'PENDENTE',
      requested_at:requestedAt,deduped:!!existingUnread
    });
  }catch(err){
    console.error('forgot_password_failed',String(err&&err.message||err).slice(0,200));
    auditSystem(tenant.id,u.id,'PASSWORD_RESET_FAILED','USER',u.id,{
      company_id:company.id,tenant_id:tenant.id,client_user_id:u.id,user_id:u.id,
      method:'EMAIL',status:'FALHA',result:'error'
    });
    emitEvent({
      tenantId:tenant.id,
      companyId:company.id,
      eventType:EVENT_TYPES.PASSWORD_RESET_FAILED,
      actorUserId:u.id,
      entityType:'client_user',
      entityId:u.id,
      payload:{...payloadBase,note:'Erro ao gerar redefinição',status:'FALHA'}
    });
  }
  return respond();
});
app.post('/api/auth/logout',(req,res)=>{try{const token=readAccessToken(req);if(token){const payload=jwt.verify(token,SECRET,{algorithms:['HS256']});if(req.body&&req.body.revoke)sessions.revoke(payload.sub,payload.tenant_id);audit({user:{tenant_id:payload.tenant_id,sub:payload.sub},ip:req.ip},'LOGOUT','USER',payload.sub,null,{result:'ok',revoked:!!(req.body&&req.body.revoke)})}}catch{}res.clearCookie('cds_session',{path:'/'});res.json({ok:true})});
app.post('/api/auth/password',auth,(req,res)=>{const u=one('SELECT * FROM users WHERE id=? AND tenant_id=?',req.user.sub,req.user.tenant_id);if(!u)return deny(res,401,'Sessão inválida.','INVALID_TOKEN');let currentOk=false;try{currentOk=bcrypt.compareSync(String(req.body.current||req.body.current_password||''),u.password_hash)}catch{currentOk=false}if(!currentOk)return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');const next=req.body.password||req.body.new_password;const pw=passwordPolicyError(next);if(pw)return deny(res,400,pw,'INVALID_PASSWORD');exec('UPDATE users SET password_hash=? WHERE id=? AND tenant_id=?',bcrypt.hashSync(next,12),u.id,u.tenant_id);audit(req,'PASSWORD_RESET','USER',u.id,null,{result:'ok'});res.json({ok:true})});
app.post('/api/auth/pin',auth,(req,res)=>{
  const u=one('SELECT * FROM users WHERE id=? AND tenant_id=?',req.user.sub,req.user.tenant_id);
  if(!u)return deny(res,401,'Sessão inválida.','INVALID_TOKEN');
  const pin=req.body.pin??req.body.new_pin;
  const confirmation=req.body.confirmation??req.body.pin_confirmation??req.body.confirm_pin;
  const invalid=pinAuth.pinValidationError(pin,confirmation);
  if(invalid)return deny(res,400,invalid.message,invalid.code);
  const configured=pinAuth.isPinConfigured(u);
  if(configured){
    const current=req.body.current_pin??req.body.current??req.body.old_pin;
    if(!pinAuth.isValidPin(current)||!pinAuth.pinMatches(u.pin_hash,current)){
      return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');
    }
    const hash=pinAuth.hashPin(pin);
    const now=new Date().toISOString();
    exec('UPDATE users SET pin_hash=?,pin_configured_at=?,pin_setup_required=0 WHERE id=? AND tenant_id=?',hash,now,u.id,u.tenant_id);
    audit(req,'PIN_CHANGED','USER',u.id,null,{result:'ok'});
    return res.json({ok:true,message:'PIN atualizado com sucesso.',pin_configured:true,requires_pin_setup:false});
  }
  const hash=pinAuth.hashPin(pin);
  const now=new Date().toISOString();
  exec('UPDATE users SET pin_hash=?,pin_configured_at=?,pin_setup_required=0 WHERE id=? AND tenant_id=?',hash,now,u.id,u.tenant_id);
  audit(req,'PIN_CREATED','USER',u.id,null,{result:'ok'});
  res.status(201).json({ok:true,message:'PIN cadastrado com sucesso.',pin_configured:true,requires_pin_setup:false});
});
app.post('/api/auth/pin/reset-request',auth,(req,res)=>{
  // Esqueci meu PIN → orientação para recuperação segura (sem revelar PIN)
  const u=one('SELECT id,role,email FROM users WHERE id=? AND tenant_id=?',req.user.sub,req.user.tenant_id);
  if(!u)return deny(res,401,'Sessão inválida.','INVALID_TOKEN');
  audit(req,'PIN_RESET','USER',u.id,null,{result:'requested',method:'ACCOUNT_RECOVERY'});
  res.json({
    ok:true,
    message:u.role==='CLIENT'
      ?'Para redefinir o PIN, use "Esqueci minha senha". Após criar a nova senha, você cadastrará um novo PIN.'
      :'Para redefinir o PIN, solicite a recuperação de acesso ao administrador do escritório ou use a recuperação de conta. O PIN antigo não pode ser recuperado.',
    recovery:'password_reset'
  });
});
app.post('/api/auth/elevate',auth,(req,res)=>{const u=one('SELECT * FROM users WHERE id=? AND tenant_id=?',req.user.sub,req.user.tenant_id);if(!u)return deny(res,401,'Sessão inválida.','INVALID_TOKEN');let ok=false;try{ok=bcrypt.compareSync(String(req.body.password||req.body.current||''),u.password_hash)}catch{ok=false}if(!ok)return deny(res,401,'Credenciais inválidas.','INVALID_CREDENTIALS');if(!['OWNER','ACCOUNTANT'].includes(u.role))return deny(res,403,'Você não tem permissão para realizar esta operação.','FORBIDDEN');const token=jwt.sign({sub:u.id,tenant_id:u.tenant_id,role:u.role,elevated:1},SECRET,{algorithm:'HS256',expiresIn:'10m'});audit(req,'SENSITIVE_DATA_ACCESSED','USER',u.id,null,{result:'elevated'});res.json({elevated:true,expires_in:600,elevate_token:token})});
app.get('/api/auth/me',auth,(req,res)=>{const raw=one('SELECT id,name,email,role,tenant_id,company_id,active,created_at,last_access_at,pin_hash,pin_setup_required,pin_configured_at FROM users WHERE id=? AND tenant_id=?',req.user.sub,req.user.tenant_id);if(!raw)return deny(res,401,'Sessão inválida.','INVALID_TOKEN');const pinState=pinAuth.publicPinState(raw);const user={id:raw.id,name:raw.name,email:raw.email,role:raw.role,tenant_id:raw.tenant_id,company_id:raw.company_id,active:raw.active,created_at:raw.created_at,last_access_at:raw.last_access_at,tenant_slug:one('SELECT slug FROM tenants WHERE id=?',raw.tenant_id)?.slug||null,...pinState};if(user.role==='CLIENT'){user.profile=clientProfile(req);user.permissions=clientPermissionList(user.id)}res.json(user)});
// TENANT / COMPANIES / USERS
app.get('/api/tenant',auth,(req,res)=>{const t=one('SELECT id,name,cnpj,status,slug,created_at,assign_staff_companies FROM tenants WHERE id=?',req.user.tenant_id);res.json({...t,assign_staff_companies:Number(t.assign_staff_companies||0)})});
app.patch('/api/tenant',auth,role('OWNER'),(req,res)=>{const before=one('SELECT * FROM tenants WHERE id=?',req.user.tenant_id);const name=req.body.name!==undefined?req.body.name:before.name;const cnpj=req.body.cnpj!==undefined?(req.body.cnpj||null):before.cnpj;const flag=req.body.assign_staff_companies===undefined?Number(before.assign_staff_companies||0):(req.body.assign_staff_companies===true||req.body.assign_staff_companies===1||req.body.assign_staff_companies==='1'||req.body.assign_staff_companies==='on'?1:0);exec('UPDATE tenants SET name=?,cnpj=?,assign_staff_companies=? WHERE id=?',name,cnpj,flag,req.user.tenant_id);const after=one('SELECT * FROM tenants WHERE id=?',req.user.tenant_id);audit(req,'UPDATE','TENANT',req.user.tenant_id,before,{...after,assign_staff_companies:Number(after.assign_staff_companies||0)});res.json({...after,assign_staff_companies:Number(after.assign_staff_companies||0)})});
function inspectBrandImage(buf,originalname){if(!buf||buf.length<12)return null;const ext=path.extname(originalname||'').toLowerCase();if(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47)return ext==='.png'?{mime:'image/png',ext:'.png'}:null;if(buf[0]===0xFF&&buf[1]===0xD8&&buf[2]===0xFF)return(ext==='.jpg'||ext==='.jpeg')?{mime:'image/jpeg',ext:'.jpg'}:null;if(buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return ext==='.webp'?{mime:'image/webp',ext:'.webp'}:null;return null}
function resolveBrandFile(tenantId,stored){if(!stored||!tenantId)return null;const parts=String(stored).replace(/\\/g,'/').split('/').filter(Boolean);if(parts.length!==2||parts[0]!==tenantId||parts[1].includes('..'))return null;const abs=path.resolve(BRAND_DIR,parts[0],parts[1]);if(!abs.startsWith(path.resolve(BRAND_DIR,tenantId)+path.sep)&&abs!==path.resolve(BRAND_DIR,tenantId))return null;return abs}
function brandingPayloadForTenant(tenantId,{publicMode=false}={}){const tenant=one('SELECT id,name,slug FROM tenants WHERE id=?',tenantId);if(!tenant)return{configured:false,has_logo:false,logo_url:null,office_name:null,updated_at:null};const row=one('SELECT * FROM tenant_branding WHERE tenant_id=?',tenantId);const abs=row?resolveBrandFile(tenantId,row.logo_path):null;const has_logo=!!(abs&&fs.existsSync(abs));const v=encodeURIComponent((row&&(row.logo_updated_at||row.updated_at))||'');const logo_url=has_logo?(publicMode?`/api/public/branding/logo?tenant=${encodeURIComponent(tenant.slug||'')}&v=${v}`:`/api/tenant/branding/logo?v=${v}`):null;const payload={configured:has_logo,has_logo,office_name:(row&&row.office_name)||tenant.name,slogan:(row&&row.slogan)||null,logo_url,updated_at:row&&(row.logo_updated_at||row.updated_at)||null};if(!publicMode)payload.logo_size=row&&row.logo_size!=null?Number(row.logo_size):null;return payload}
function brandingPayload(req){return brandingPayloadForTenant(req.user.tenant_id)}
function upsertBranding(tenantId,fields){const row=one('SELECT * FROM tenant_branding WHERE tenant_id=?',tenantId);if(!row){exec('INSERT INTO tenant_branding(id,tenant_id,office_name,slogan,logo_path,logo_mime,logo_size,logo_updated_at) VALUES(?,?,?,?,?,?,?,?)',id(),tenantId,fields.office_name||null,fields.slogan||null,fields.logo_path||null,fields.logo_mime||null,fields.logo_size!=null?fields.logo_size:null,fields.logo_path?new Date().toISOString():null);return}const office=fields.office_name!==undefined?fields.office_name:row.office_name;const slogan=fields.slogan!==undefined?fields.slogan:row.slogan;const logo_path=fields.logo_path!==undefined?fields.logo_path:row.logo_path;const logo_mime=fields.logo_mime!==undefined?fields.logo_mime:row.logo_mime;const logo_size=fields.logo_size!==undefined?fields.logo_size:row.logo_size;const logo_updated_at=fields.logo_path!==undefined?(fields.logo_path?new Date().toISOString():null):(row.logo_updated_at||null);exec('UPDATE tenant_branding SET office_name=?,slogan=?,logo_path=?,logo_mime=?,logo_size=?,logo_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?',office,slogan,logo_path,logo_mime,logo_size,logo_updated_at,tenantId)}
function clearTenantBrandFiles(tenantId){const dir=path.join(BRAND_DIR,tenantId);try{if(!fs.existsSync(dir))return;for(const name of fs.readdirSync(dir)){if(name==='..'||name==='.')continue;try{fs.unlinkSync(path.join(dir,name))}catch{}}}catch{}}
const BRAND_MAX_BYTES=5*1024*1024;
const brandUpload=multer({dest:path.join(BRAND_DIR,'tmp'),limits:{fileSize:BRAND_MAX_BYTES}});
function findTenantByLoginCode(code){let slug=String(code||'').trim().toLowerCase();if(!slug||slug.length>80||!/^[a-z0-9][a-z0-9_-]*$/.test(slug))return null;if(slug==='demo')slug='escritorio-demonstracao';return one('SELECT id,name,slug,status FROM tenants WHERE lower(IFNULL(slug,\'\'))=? LIMIT 1',slug)}
app.get('/api/public/branding',(req,res)=>{
  const tenant=findTenantByLoginCode(req.query.tenant||req.query.slug||req.query.code);
  if(!tenant||tenant.status==='INACTIVE')return res.json({configured:false,has_logo:false,logo_url:null,office_name:null,updated_at:null});
  res.json(brandingPayloadForTenant(tenant.id,{publicMode:true}));
});
app.get('/api/public/branding/logo',(req,res)=>{
  const tenant=findTenantByLoginCode(req.query.tenant||req.query.slug||req.query.code);
  if(!tenant||tenant.status==='INACTIVE')return deny(res,404,'Logo não configurada.','NOT_FOUND');
  const row=one('SELECT * FROM tenant_branding WHERE tenant_id=?',tenant.id);
  const abs=row?resolveBrandFile(tenant.id,row.logo_path):null;
  if(!abs||!fs.existsSync(abs))return deny(res,404,'Logo não configurada.','NOT_FOUND');
  res.set({'Content-Type':row.logo_mime||'image/png','Cache-Control':'public, max-age=120','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(abs).pipe(res);
});
app.get('/api/tenant/branding',auth,requireOffice,(req,res)=>res.json(brandingPayload(req)));
app.patch('/api/tenant/branding',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{
  const before=one('SELECT * FROM tenant_branding WHERE tenant_id=?',req.user.tenant_id);
  const office_name=req.body.office_name!==undefined?String(req.body.office_name||'').trim()||null:undefined;
  const slogan=req.body.slogan!==undefined?String(req.body.slogan||'').trim()||null:undefined;
  upsertBranding(req.user.tenant_id,{office_name,slogan});
  if(office_name&&req.user.role==='OWNER')exec('UPDATE tenants SET name=? WHERE id=?',office_name,req.user.tenant_id);
  audit(req,before?'TENANT_BRANDING_UPDATED':'TENANT_BRANDING_CREATED','TENANT_BRANDING',req.user.tenant_id,null,{office_name,slogan});
  res.json(brandingPayload(req));
});
app.post('/api/tenant/branding/logo',auth,role('OWNER','ACCOUNTANT'),(req,res,next)=>{
  brandUpload.single('file')(req,res,(err)=>{
    if(err&&err.code==='LIMIT_FILE_SIZE')return deny(res,413,'Arquivo muito grande. O tamanho máximo permitido é 5 MB.','FILE_TOO_LARGE');
    if(err)return next(err);
    const file=req.file;
    if(!file)return deny(res,422,'Envie uma logo em PNG, JPG ou WEBP.','INVALID_FILE');
    let buf;
    try{buf=fs.readFileSync(file.path)}catch{return deny(res,422,'Envie uma logo em PNG, JPG ou WEBP.','INVALID_FILE')}
    const kind=inspectBrandImage(buf,file.originalname);
    try{fs.unlinkSync(file.path)}catch{}
    if(!kind)return deny(res,422,'Formato não autorizado. Envie PNG, JPG ou WEBP.','INVALID_FILE');
    if(buf.length>BRAND_MAX_BYTES)return deny(res,413,'Arquivo muito grande. O tamanho máximo permitido é 5 MB.','FILE_TOO_LARGE');
    const before=one('SELECT * FROM tenant_branding WHERE tenant_id=?',req.user.tenant_id);
    fs.mkdirSync(path.join(BRAND_DIR,req.user.tenant_id),{recursive:true});
    clearTenantBrandFiles(req.user.tenant_id);
    const rel=req.user.tenant_id+'/logo'+kind.ext;
    fs.writeFileSync(path.join(BRAND_DIR,rel),buf);
    upsertBranding(req.user.tenant_id,{logo_path:rel,logo_mime:kind.mime,logo_size:buf.length});
    audit(req,before&&before.logo_path?'TENANT_BRANDING_UPDATED':'TENANT_BRANDING_CREATED','TENANT_BRANDING',req.user.tenant_id,null,{logo_mime:kind.mime,logo_size:buf.length});
    res.json(brandingPayload(req));
  });
});
app.delete('/api/tenant/branding/logo',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{
  const prev=one('SELECT * FROM tenant_branding WHERE tenant_id=?',req.user.tenant_id);
  clearTenantBrandFiles(req.user.tenant_id);
  upsertBranding(req.user.tenant_id,{logo_path:null,logo_mime:null,logo_size:null});
  audit(req,'TENANT_BRANDING_DELETED','TENANT_BRANDING',req.user.tenant_id,prev?{logo_mime:prev.logo_mime,logo_size:prev.logo_size}:null,null);
  res.json(brandingPayload(req));
});
app.get('/api/tenant/branding/logo',auth,requireOffice,(req,res)=>{
  const row=one('SELECT * FROM tenant_branding WHERE tenant_id=?',req.user.tenant_id);
  const abs=row?resolveBrandFile(req.user.tenant_id,row.logo_path):null;
  if(!abs||!fs.existsSync(abs))return deny(res,404,'Logo não configurada.','NOT_FOUND');
  res.set({'Content-Type':row.logo_mime||'application/octet-stream','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(abs).pipe(res);
});
app.get('/api/client/branding',auth,requireClient,requireClientCompany,(req,res)=>{
  const payload=brandingPayloadForTenant(req.user.tenant_id,{publicMode:false});
  if(payload.logo_url)payload.logo_url='/api/client/branding/logo?v='+encodeURIComponent(payload.updated_at||'');
  res.json(payload);
});
app.get('/api/client/branding/logo',auth,requireClient,requireClientCompany,(req,res)=>{
  const row=one('SELECT * FROM tenant_branding WHERE tenant_id=?',req.user.tenant_id);
  const abs=row?resolveBrandFile(req.user.tenant_id,row.logo_path):null;
  if(!abs||!fs.existsSync(abs))return deny(res,404,'Logo não configurada.','NOT_FOUND');
  res.set({'Content-Type':row.logo_mime||'application/octet-stream','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(abs).pipe(res);
});
app.post('/api/client/branding/logo',auth,requireClient,(req,res)=>deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PORTAL_ONLY'));
app.delete('/api/client/branding/logo',auth,requireClient,(req,res)=>deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PORTAL_ONLY'));
app.patch('/api/client/branding',auth,requireClient,(req,res)=>deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PORTAL_ONLY'));
app.get('/api/empresas',auth,scope,(req,res)=>{
  const q=String(req.query.q||req.query.search||'').trim();
  const status=String(req.query.status||'').toUpperCase();
  const sort=String(req.query.sort||'name');
  const dir=String(req.query.dir||'asc').toLowerCase()==='desc'?'DESC':'ASC';
  const order=({name:'c.name',trade_name:'c.trade_name',cnpj:'c.cnpj',created_at:'c.created_at',status:'c.status'}[sort]||'c.name')+' '+dir;
  const p=[req.user.tenant_id];
  let where='c.tenant_id=?';
  if(req.user.role==='CLIENT'){where+=' AND c.id=?';p.push(req.companyScope)}
  else{const vis=staffVisibleCompanySql(req,'c.id');where+=vis.sql;p.push(...vis.p)}
  if(q){where+=' AND (c.name LIKE ? OR IFNULL(c.trade_name,\'\') LIKE ? OR replace(IFNULL(c.cnpj,\'\'),\'.\',\'\') LIKE ? OR IFNULL(c.cnpj,\'\') LIKE ? OR IFNULL(c.cnpj_normalized,\'\') LIKE ?)';const like=`%${q}%`,digits=q.replace(/\D/g,''),key=cnpjNorm.stripCnpj(q);p.push(like,like,`%${digits||q}%`,like,`%${key||q}%`)}
  if(['ACTIVE','BLOCKED','ARCHIVED'].includes(status)){where+=' AND c.status=?';p.push(status)}
  else where+=" AND c.status<>'ARCHIVED'"
  const total=one(`SELECT COUNT(*) n FROM companies c WHERE ${where}`,...p).n;
  const {page,page_size,offset}=pageParams(req,25);
  const items=qRows(`SELECT c.*,(SELECT COUNT(*) FROM users u WHERE u.tenant_id=c.tenant_id AND u.company_id=c.id AND u.role='CLIENT') user_count,(SELECT COUNT(*) FROM pendencies pe WHERE pe.tenant_id=c.tenant_id AND pe.company_id=c.id AND pe.status='OPEN') pending_count,(SELECT COUNT(*) FROM requests rq WHERE rq.tenant_id=c.tenant_id AND rq.company_id=c.id AND rq.status IN('OPEN','AGUARDANDO_CLIENTE','AGUARDANDO_ESCRITORIO','RESPONDED','PENDING')) open_requests,(SELECT COUNT(*) FROM entries en WHERE en.tenant_id=c.tenant_id AND en.company_id=c.id AND en.status='NEEDS_CLASSIFICATION') classifications_pending,(SELECT COUNT(*) FROM entries en WHERE en.tenant_id=c.tenant_id AND en.company_id=c.id AND en.status='PENDING') approvals_pending,(SELECT COUNT(*) FROM expenses e WHERE e.tenant_id=c.tenant_id AND e.company_id=c.id AND EXISTS(SELECT 1 FROM entries en WHERE en.source_id=e.id AND en.tenant_id=e.tenant_id AND en.status='NEEDS_CLASSIFICATION')) expenses_pending,(SELECT COUNT(*) FROM documents d WHERE d.tenant_id=c.tenant_id AND d.company_id=c.id AND d.status='PENDING_REVIEW' AND d.deleted_at IS NULL) documents_new,(SELECT MAX(occurred_on) FROM (SELECT e.occurred_on FROM expenses e WHERE e.tenant_id=c.tenant_id AND e.company_id=c.id UNION ALL SELECT r.occurred_on FROM revenues r WHERE r.tenant_id=c.tenant_id AND r.company_id=c.id)) last_movement,(SELECT MAX(ts) FROM (SELECT e.created_at ts FROM expenses e WHERE e.tenant_id=c.tenant_id AND e.company_id=c.id UNION ALL SELECT r.created_at FROM revenues r WHERE r.tenant_id=c.tenant_id AND r.company_id=c.id UNION ALL SELECT d.created_at FROM documents d WHERE d.tenant_id=c.tenant_id AND d.company_id=c.id AND d.deleted_at IS NULL UNION ALL SELECT mi.created_at FROM movement_imports mi WHERE mi.tenant_id=c.tenant_id AND mi.company_id=c.id UNION ALL SELECT ev.created_at FROM domain_events ev WHERE ev.tenant_id=c.tenant_id AND ev.company_id=c.id)) last_activity_at,(SELECT origin FROM (SELECT e.origin,e.created_at FROM expenses e WHERE e.tenant_id=c.tenant_id AND e.company_id=c.id UNION ALL SELECT r.origin,r.created_at FROM revenues r WHERE r.tenant_id=c.tenant_id AND r.company_id=c.id ORDER BY created_at DESC LIMIT 1)) last_origin,(SELECT created_at FROM movement_imports mi WHERE mi.tenant_id=c.tenant_id AND mi.company_id=c.id ORDER BY created_at DESC LIMIT 1) last_import_at,(SELECT imported_rows FROM movement_imports mi WHERE mi.tenant_id=c.tenant_id AND mi.company_id=c.id ORDER BY created_at DESC LIMIT 1) last_import_rows,(SELECT origin FROM movement_imports mi WHERE mi.tenant_id=c.tenant_id AND mi.company_id=c.id ORDER BY created_at DESC LIMIT 1) last_import_origin FROM companies c WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,...p,page_size,offset).map(x=>{const assignees=companyAssignees(x.id);return{...x,last_origin_label:origens.label(x.last_origin),last_import_origin_label:x.last_import_origin?origens.label(x.last_import_origin):null,cds_systems_enabled:Number(x.cds_systems_enabled||0),assignees,assignee_ids:assignees.map(a=>a.user_id),assignee_names:assignees.map(a=>a.name).join(', ')}});
  res.json(paged(items,total,page,page_size));
});
app.get('/api/empresas/:id/operacional',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{
  const c=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);
  if(!c||!companyVisibleToUser(req,c.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');
  const tenantId=req.user.tenant_id,companyId=c.id;
  const expenses=one('SELECT COUNT(*) n FROM expenses WHERE tenant_id=? AND company_id=?',tenantId,companyId).n;
  const documents=one("SELECT COUNT(*) n FROM documents WHERE tenant_id=? AND company_id=? AND deleted_at IS NULL AND IFNULL(status,'')<>'DRAFT'",tenantId,companyId).n;
  const pendencies=one("SELECT COUNT(*) n FROM pendencies WHERE tenant_id=? AND company_id=? AND status='OPEN'",tenantId,companyId).n;
  const requests=one("SELECT COUNT(*) n FROM requests WHERE tenant_id=? AND company_id=? AND status IN('OPEN','AGUARDANDO_CLIENTE','AGUARDANDO_ESCRITORIO','RESPONDED','PENDING')",tenantId,companyId).n;
  const classifications=one("SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND company_id=? AND status='NEEDS_CLASSIFICATION'",tenantId,companyId).n;
  const approvals=one("SELECT COUNT(*) n FROM entries WHERE tenant_id=? AND company_id=? AND status='PENDING'",tenantId,companyId).n;
  const origins=qRows('SELECT origin,COUNT(*) n FROM (SELECT origin FROM expenses WHERE tenant_id=? AND company_id=? UNION ALL SELECT origin FROM revenues WHERE tenant_id=? AND company_id=?) t GROUP BY origin',tenantId,companyId,tenantId,companyId).map(x=>({origin:x.origin,count:x.n,origin_label:origens.label(x.origin)}));
  const imports=qRows('SELECT m.*,c.name company_name FROM movement_imports m JOIN companies c ON c.id=m.company_id WHERE m.tenant_id=? AND m.company_id=? ORDER BY m.created_at DESC LIMIT 10',tenantId,companyId).map(publicImport);
  const activity=qRows('SELECT event_type,payload_json,created_at,entity_type,entity_id FROM domain_events WHERE tenant_id=? AND company_id=? ORDER BY created_at DESC LIMIT 30',tenantId,companyId).map(ev=>{let payload={};try{payload=JSON.parse(ev.payload_json||'{}')}catch{}return{event_type:ev.event_type,created_at:ev.created_at,entity_type:ev.entity_type,entity_id:ev.entity_id,payload}});
  res.json({company:{id:c.id,name:c.name,trade_name:c.trade_name,cnpj:c.cnpj,status:c.status,cds_systems_enabled:Number(c.cds_systems_enabled||0)},expenses,documents,pendencies,requests,classifications,approvals,origins,imports,activity});
});
app.get('/api/empresas/:id',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const a=one("SELECT c.*,(SELECT COUNT(*) FROM users u WHERE u.tenant_id=c.tenant_id AND u.company_id=c.id AND u.role='CLIENT') user_count FROM companies c WHERE c.tenant_id=? AND c.id=?",req.user.tenant_id,req.params.id);if(!a||!companyVisibleToUser(req,a.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');res.json(withCompanyAssignees(a))});
app.get('/api/empresas/:id/responsaveis',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const c=one('SELECT id FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!c||!companyVisibleToUser(req,c.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');res.json({company_id:c.id,assignees:companyAssignees(c.id)})});
app.put('/api/empresas/:id/responsaveis',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{
  const c=one('SELECT id FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);
  if(!c)return deny(res,404,'Empresa não encontrada.','NOT_FOUND');
  const ids=Array.isArray(req.body&&req.body.user_ids)?req.body.user_ids:[];
  const uniq=[...new Set(ids.map(x=>String(x||'').trim()).filter(Boolean))];
  const staff=[];
  for(const uid of uniq){
    const u=one("SELECT id FROM users WHERE id=? AND tenant_id=? AND role='STAFF' AND active=1",uid,req.user.tenant_id);
    if(!u)return deny(res,400,'Só é possível designar usuários da equipe do escritório.','INVALID_ASSIGNEE');
    staff.push(u.id);
  }
  db.transaction(()=>{exec('DELETE FROM company_assignees WHERE company_id=?',c.id);for(const uid of staff)exec('INSERT INTO company_assignees(id,tenant_id,company_id,user_id,assigned_by) VALUES(?,?,?,?,?)',id(),req.user.tenant_id,c.id,uid,req.user.sub)})();
  audit(req,'UPDATE','COMPANY_ASSIGNEES',c.id,null,{user_ids:staff});
  res.json({company_id:c.id,assignees:companyAssignees(c.id)});
});
function lookupFailMessage(){return 'Não foi possível consultar o cadastro do CNPJ agora. Tente novamente.'}
function logCnpjLookup(result){
  if(!result||result.status==='ok')return;
  console.error('cnpj_lookup_failed',JSON.stringify({code:result.code||null,status:result.status||null,httpStatus:result.httpStatus||null,provider:cnpjProvider&&cnpjProvider.name||null}));
}
app.post('/api/empresas/consulta-cnpj',auth,role('OWNER','ACCOUNTANT','STAFF'),rateCnpjLookup,async(req,res)=>{
  delete req.body.tenant_id;
  const raw=req.body.cnpj||req.body.cnpj_key||req.params.cnpj;
  if(!cnpjNorm.isPlausibleCnpj(raw))return deny(res,400,'Informe um CNPJ válido.','CNPJ_INVALIDO');
  const key=cnpjNorm.normalizeCnpjKey(raw);
  const existing=one('SELECT id,name,trade_name,cnpj,status FROM companies WHERE tenant_id=? AND cnpj_normalized=?',req.user.tenant_id,key);
  if(existing)return res.status(409).json({error:'EMPRESA_JA_CADASTRADA',message:'Esta empresa já está cadastrada na carteira deste escritório.',company:{id:existing.id,name:existing.name,trade_name:existing.trade_name,cnpj:existing.cnpj,status:existing.status}});
  let result;
  try{result=await cnpjProvider.consultarCnpj(key)}catch{
    console.error('cnpj_lookup_failed',JSON.stringify({code:'ERRO_INTERNO',provider:cnpjProvider&&cnpjProvider.name||null}));
    return deny(res,500,lookupFailMessage(),'ERRO_INTERNO');
  }
  if(!result||result.status==='invalid')return deny(res,400,'Informe um CNPJ válido.','CNPJ_INVALIDO');
  if(result.status==='not_found')return deny(res,404,'CNPJ não encontrado.','CNPJ_NAO_ENCONTRADO');
  if(result.status==='timeout'||result.status==='unavailable'){logCnpjLookup(result);return deny(res,502,lookupFailMessage(),'PROVIDER_INDISPONIVEL')}
  if(result.status!=='ok'||!result.data){logCnpjLookup(result);return deny(res,502,lookupFailMessage(),'ERRO_PROVIDER')}
  const complemented=await complementCnpjAddress(result.data,cepProvider&&cepProvider.consultarCep?cep=>cepProvider.consultarCep(cep):null,logCnpjAddress);
  const cadastro=complemented.cadastro;
  const alerta=cnpjNorm.inactiveCadastral(cadastro.situacao_cadastral)?('A empresa foi encontrada, mas a situação cadastral informada pela fonte é: '+cadastro.situacao_cadastral+'.'):null;
  res.json({status:'EMPRESA_ENCONTRADA',message:'Empresa encontrada',cadastro,alerta,company_fields:cnpjNorm.toCompanyFields(cadastro),cep_fallback:!!complemented.cep_fallback});
});
app.post('/api/empresas/consulta-cep',auth,role('OWNER','ACCOUNTANT','STAFF'),rateCepLookup,async(req,res)=>{
  delete req.body.tenant_id;
  const key=cepDigitsExact(req.body&&(req.body.cep||req.body.zip));
  if(!key)return deny(res,400,'Informe um CEP válido.','CEP_INVALIDO');
  if(!cepProvider||typeof cepProvider.consultarCep!=='function')return deny(res,502,'Não foi possível consultar o CEP. Preencha o endereço manualmente.','PROVIDER_INDISPONIVEL');
  let result;
  try{result=await cepProvider.consultarCep(key)}catch{
    return deny(res,502,'Não foi possível consultar o CEP. Preencha o endereço manualmente.','PROVIDER_INDISPONIVEL');
  }
  if(!result||result.status==='invalid')return deny(res,400,'Informe um CEP válido.','CEP_INVALIDO');
  if(result.status==='not_found')return deny(res,404,'CEP não encontrado.','CEP_NAO_ENCONTRADO');
  if(result.status==='timeout'||result.status==='unavailable'||result.status==='error'||result.status!=='ok'||!result.data){
    return deny(res,502,'Não foi possível consultar o CEP. Preencha o endereço manualmente.','PROVIDER_INDISPONIVEL');
  }
  const d=result.data;
  res.json({status:'CEP_ENCONTRADO',message:'Endereço preenchido automaticamente',endereco:{cep:d.cep||cnpjNorm.formatCepDisplay(key),logradouro:d.logradouro||null,bairro:d.bairro||null,municipio:d.municipio||null,uf:d.uf||null}});
});
app.post('/api/empresas',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.codigo_cliente;delete req.body.client_code;delete req.body.company_id}const c=companyWrite(req.body);if(!c.name)return deny(res,400,'Informe a razão social.','NAME_REQUIRED');if(c.status&&!['ACTIVE','BLOCKED','ARCHIVED'].includes(c.status))return deny(res,400,'Situação da empresa inválida.','INVALID_COMPANY_STATUS');if(c.cnpj_normalized&&!cnpjNorm.isPlausibleCnpj(c.cnpj_normalized))return deny(res,400,'Informe um CNPJ válido.','CNPJ_INVALIDO');if(c.cnpj_normalized&&one('SELECT id FROM companies WHERE tenant_id=? AND cnpj_normalized=?',req.user.tenant_id,c.cnpj_normalized))return deny(res,409,'Esta empresa já está cadastrada na carteira deste escritório.','EMPRESA_JA_CADASTRADA');const x=id();let codigoCliente=null;try{const tx=db.transaction(()=>{codigoCliente=clientCode.allocateClientCode(db,req.user.tenant_id);exec('INSERT INTO companies(id,tenant_id,name,trade_name,cnpj,cnpj_normalized,email,phone,status,address,address_number,complement,neighborhood,city,state,zip,cadastral_status,opened_on,legal_nature,main_cnae,company_size,share_capital,simples_nacional,mei,codigo_cliente) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',x,req.user.tenant_id,c.name,c.trade_name,c.cnpj,c.cnpj_normalized,c.email,c.phone,c.status||'ACTIVE',c.address,c.address_number,c.complement,c.neighborhood,c.city,c.state,c.zip,c.cadastral_status,c.opened_on,c.legal_nature,c.main_cnae,c.company_size,c.share_capital,c.simples_nacional,c.mei,codigoCliente);emitFromReq(req,EVENT_TYPES.COMPANY_CREATED,{companyId:x,entityType:'company',entityId:x,payload:{title:c.name,status:c.status||'ACTIVE',codigo_cliente:codigoCliente}})});tx.immediate()}catch(e){if(String(e.message||e.code||'').includes('UNIQUE')||String(e.code||'').includes('CONSTRAINT'))return deny(res,409,'Esta empresa já está cadastrada na carteira deste escritório.','EMPRESA_JA_CADASTRADA');throw e}const a=one('SELECT * FROM companies WHERE id=? AND tenant_id=?',x,req.user.tenant_id);audit(req,'COMPANY_CREATED','COMPANY',x,null,{id:x,name:a.name,cnpj:a.cnpj,status:a.status,codigo_cliente:a.codigo_cliente});audit(req,'CLIENT_CODE_GENERATED','COMPANY',x,null,{tenant_id:req.user.tenant_id,company_id:x,codigo_cliente:a.codigo_cliente,context:'create'});res.status(201).json(a)});
app.patch('/api/empresas/:id',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.codigo_cliente;delete req.body.client_code;delete req.body.company_id;delete req.body.id}const b=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b||!companyVisibleToUser(req,b.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');const c=companyWrite(req.body,b);if(!['ACTIVE','BLOCKED','ARCHIVED'].includes(c.status))return deny(res,400,'Situação da empresa inválida.','INVALID_COMPANY_STATUS');if(c.cnpj_normalized&&!cnpjNorm.isPlausibleCnpj(c.cnpj_normalized))return deny(res,400,'Informe um CNPJ válido.','CNPJ_INVALIDO');if(c.cnpj_normalized&&one('SELECT id FROM companies WHERE tenant_id=? AND cnpj_normalized=? AND id<>?',req.user.tenant_id,c.cnpj_normalized,b.id))return deny(res,409,'Esta empresa já está cadastrada na carteira deste escritório.','EMPRESA_JA_CADASTRADA');try{exec('UPDATE companies SET name=?,trade_name=?,cnpj=?,cnpj_normalized=?,email=?,phone=?,status=?,address=?,address_number=?,complement=?,neighborhood=?,city=?,state=?,zip=?,cadastral_status=?,opened_on=?,legal_nature=?,main_cnae=?,company_size=?,share_capital=?,simples_nacional=?,mei=? WHERE id=? AND tenant_id=?',c.name,c.trade_name,c.cnpj,c.cnpj_normalized,c.email,c.phone,c.status,c.address,c.address_number,c.complement,c.neighborhood,c.city,c.state,c.zip,c.cadastral_status,c.opened_on,c.legal_nature,c.main_cnae,c.company_size,c.share_capital,c.simples_nacional,c.mei,b.id,req.user.tenant_id)}catch(e){if(String(e.message||e.code||'').includes('UNIQUE')||String(e.code||'').includes('CONSTRAINT'))return deny(res,409,'Esta empresa já está cadastrada na carteira deste escritório.','EMPRESA_JA_CADASTRADA');throw e}const a=one('SELECT * FROM companies WHERE id=?',b.id);const action=c.status==='BLOCKED'&&b.status!=='BLOCKED'?'COMPANY_BLOCKED':c.status==='ACTIVE'&&b.status==='BLOCKED'?'COMPANY_UNBLOCKED':'COMPANY_UPDATED';audit(req,action,'COMPANY',b.id,{id:b.id,status:b.status,name:b.name},{id:a.id,status:a.status,name:a.name});res.json(a)});
app.post('/api/empresas/:id/bloquear',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const b=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b||!companyVisibleToUser(req,b.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');exec("UPDATE companies SET status='BLOCKED' WHERE id=? AND tenant_id=?",b.id,req.user.tenant_id);const a=one('SELECT * FROM companies WHERE id=?',b.id);audit(req,'COMPANY_BLOCKED','COMPANY',b.id,{status:b.status},{status:a.status});res.json(a)});
app.post('/api/empresas/:id/desbloquear',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const b=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b||!companyVisibleToUser(req,b.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');exec("UPDATE companies SET status='ACTIVE' WHERE id=? AND tenant_id=?",b.id,req.user.tenant_id);const a=one('SELECT * FROM companies WHERE id=?',b.id);audit(req,'COMPANY_UNBLOCKED','COMPANY',b.id,{status:b.status},{status:a.status});res.json(a)});
app.post('/api/empresas/:id/arquivar',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.user_id;delete req.body.role;delete req.body.company_id}const b=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Empresa não encontrada.','NOT_FOUND');if(b.status==='ARCHIVED')return res.json({ok:true,already_archived:true,id:b.id,status:b.status});const reason=companyActionReason(req.body);if(reason.length<3)return deny(res,400,'Informe o motivo do arquivamento.','ARCHIVE_REASON_REQUIRED');const now=new Date().toISOString();exec("UPDATE companies SET status='ARCHIVED',archived_at=?,archived_by=?,archive_reason=? WHERE id=? AND tenant_id=?",now,req.user.sub,reason,b.id,req.user.tenant_id);const a=one('SELECT * FROM companies WHERE id=?',b.id);audit(req,'COMPANY_ARCHIVED','COMPANY',b.id,{status:b.status,name:b.name},{status:a.status,company_id:b.id,user_id:req.user.sub,user_role:req.user.role,reason,timestamp:now,original_name:b.trade_name||b.name});res.json({ok:true,id:a.id,status:a.status,archived_at:a.archived_at})});
app.post('/api/empresas/:id/desarquivar',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{const b=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Empresa não encontrada.','NOT_FOUND');exec("UPDATE companies SET status='ACTIVE',archived_at=NULL,archived_by=NULL,archive_reason=NULL,deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL WHERE id=? AND tenant_id=?",b.id,req.user.tenant_id);const a=one('SELECT * FROM companies WHERE id=?',b.id);audit(req,'COMPANY_RESTORED','COMPANY',b.id,{status:b.status,name:b.name},{status:a.status,company_id:b.id,user_id:req.user.sub,user_role:req.user.role});res.json(a)});
app.delete('/api/empresas/:id',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{if(req.body&&typeof req.body==='object'){delete req.body.tenant_id;delete req.body.user_id;delete req.body.role;delete req.body.company_id}const b=one('SELECT * FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Empresa não encontrada.','NOT_FOUND');const reason=companyActionReason(req.body);if(reason.length<3)return deny(res,400,'Informe o motivo da exclusão.','DELETION_REASON_REQUIRED');const now=new Date().toISOString();audit(req,'COMPANY_DELETED','COMPANY',b.id,{status:b.status,name:b.name,cnpj:b.cnpj},{status:'DELETED',company_id:b.id,user_id:req.user.sub,user_role:req.user.role,reason,timestamp:now,original_name:b.trade_name||b.name});try{purgeCompanyData(req.user.tenant_id,b.id)}catch(e){return deny(res,409,'Não foi possível excluir a empresa.','COMPANY_DELETE_FAILED')}res.json({ok:true,id:b.id,deleted:true})});
app.get('/api/usuarios',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const p=[req.user.tenant_id];let where="u.tenant_id=? AND u.role IN('OWNER','ACCOUNTANT','STAFF')";const q=String(req.query.q||req.query.search||'').trim();if(q){where+=' AND (u.name LIKE ? OR u.email LIKE ?)';p.push(`%${q}%`,`%${q}%`)}const total=one(`SELECT COUNT(*) n FROM users u WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT u.id,u.name,u.email,u.role,u.company_id,u.active,u.created_at,u.whatsapp_phone,c.name company_name FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE ${where} ORDER BY u.name LIMIT ? OFFSET ?`,...p,page_size,offset);res.json(paged(items,total,page,page_size))});
app.post('/api/usuarios',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{if(!req.body.name||!req.body.email||!req.body.password)return res.status(400).json({error:'FIELDS_REQUIRED'});const pw=passwordPolicyError(req.body.password);if(pw)return deny(res,400,pw,'INVALID_PASSWORD');const nextRole=req.body.role||'STAFF';if(nextRole==='CLIENT'||String(nextRole).startsWith('CLIENT_'))return deny(res,400,'Usuários do portal do cliente são criados pelo cadastro da empresa.','CLIENT_VIA_COMPANY');if(!assignableOfficeRoles(req.user.role).includes(nextRole))return deny(res,403,'Você não tem permissão para atribuir este perfil.','ROLE_ELEVATION_FORBIDDEN');if(req.body.company_id&&!one('SELECT id FROM companies WHERE tenant_id=? AND id=? AND status=\'ACTIVE\'',req.user.tenant_id,req.body.company_id))return res.status(400).json({error:'COMPANY_NOT_FOUND'});const x=id();try{exec('INSERT INTO users(id,tenant_id,company_id,name,email,password_hash,role,pin_setup_required) VALUES(?,?,?,?,?,?,?,1)',x,req.user.tenant_id,null,req.body.name,req.body.email.toLowerCase(),bcrypt.hashSync(req.body.password,12),nextRole);audit(req,'CREATE','USER',x,null,{name:req.body.name,email:req.body.email,role:nextRole});res.status(201).json(one('SELECT id,name,email,role,company_id,active FROM users WHERE id=?',x))}catch(e){res.status(409).json({error:'USER_EXISTS_OR_INVALID',message:e.message})}});
app.patch('/api/usuarios/:id',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{const b=one('SELECT * FROM users WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');if(b.role==='CLIENT')return deny(res,400,'Altere usuários do cliente pelo cadastro da empresa.','CLIENT_VIA_COMPANY');const nextRole=req.body.role??b.role;if(req.body.role!==undefined){if(nextRole==='CLIENT'||String(nextRole).startsWith('CLIENT_'))return deny(res,400,'Usuários do portal do cliente são criados pelo cadastro da empresa.','CLIENT_VIA_COMPANY');if(!assignableOfficeRoles(req.user.role).includes(nextRole))return deny(res,403,'Você não tem permissão para atribuir este perfil.','ROLE_ELEVATION_FORBIDDEN');if(b.role==='OWNER'&&req.user.role!=='OWNER')return deny(res,403,'Você não tem permissão para alterar este perfil.','ROLE_ELEVATION_FORBIDDEN')}const nextName=req.body.name??b.name;let nextEmail=b.email;if(req.body.email!==undefined){nextEmail=String(req.body.email||'').trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail))return deny(res,400,'Informe um e-mail válido.','INVALID_EMAIL');if(one('SELECT id FROM users WHERE tenant_id=? AND lower(email)=? AND id<>?',req.user.tenant_id,nextEmail,b.id))return deny(res,409,'Já existe um usuário com este e-mail.','USER_EXISTS')}if(req.body.password){const pw=passwordPolicyError(req.body.password);if(pw)return deny(res,400,pw,'INVALID_PASSWORD');exec('UPDATE users SET password_hash=? WHERE id=? AND tenant_id=?',bcrypt.hashSync(req.body.password,12),b.id,req.user.tenant_id)}const nextActive=req.body.active===undefined?b.active:(req.body.active?1:0);let nextPhone=b.whatsapp_phone;if(req.body.whatsapp_phone!==undefined){nextPhone=req.body.whatsapp_phone?require('./comunicacoes/phone').normalizeWhatsAppPhone(req.body.whatsapp_phone):null;if(req.body.whatsapp_phone&&!nextPhone)return deny(res,400,'Informe um telefone WhatsApp válido.','INVALID_PHONE')}exec('UPDATE users SET name=?,email=?,role=?,active=?,whatsapp_phone=? WHERE id=? AND tenant_id=?',nextName,nextEmail,nextRole,nextActive,nextPhone,b.id,req.user.tenant_id);audit(req,req.body.active===false?'USER_BLOCKED':'USER_UPDATED','USER',b.id,{role:b.role,name:b.name,email:b.email,active:b.active},{role:nextRole,name:nextName,email:nextEmail,active:nextActive});res.json(one('SELECT id,name,email,role,company_id,active,whatsapp_phone FROM users WHERE id=? AND tenant_id=?',b.id,req.user.tenant_id))});
async function invitationRecord(req,companyId,userId,email,opts={}){
  const purpose=opts.purpose==='PASSWORD_RESET'?'PASSWORD_RESET':'ACTIVATION';
  const hours=Number(opts.expiresHours)|| (purpose==='PASSWORD_RESET'?24:72);
  const raw=crypto.randomBytes(32).toString('hex');
  const expires=new Date(Date.now()+hours*60*60*1000).toISOString();
  const inviteId=id();
  exec('UPDATE client_invitations SET status=\'REVOKED\' WHERE user_id=? AND status=\'PENDING\'',userId);
  exec('INSERT INTO client_invitations(id,tenant_id,company_id,user_id,email,token_hash,expires_at,created_by,purpose) VALUES(?,?,?,?,?,?,?,?,?)',inviteId,req.user.tenant_id,companyId,userId,email,tokenHash(raw),expires,req.user.sub,purpose);
  audit(req,opts.resend?'INVITATION_RESENT':'INVITATION_CREATED','INVITATION',inviteId,null,{user_id:userId,company_id:companyId,purpose});
  if(process.env.NODE_ENV!=='production'||process.env.CDS_EMAIL_DEBUG==='1')console.log('Convite criado');
  const company=one('SELECT name,trade_name FROM companies WHERE id=?',companyId);
  const user=one('SELECT name FROM users WHERE id=?',userId);
  const activation_url=appPublicUrl()+'/convite/'+raw;
  let delivery={status:'not_configured',email_sent:false,message:opts.resend?'Convite recriado, mas o envio de e-mail não está configurado neste ambiente.':'Convite criado, mas o envio de e-mail não está configurado neste ambiente.'};
  try{
    delivery=await communicationService.deliverInvite({tenantId:req.user.tenant_id,companyId,userId,to:email,name:user&&user.name,company:(company&&(company.trade_name||company.name))||'',url:activation_url,resend:!!opts.resend,actorUserId:req.user.sub,purpose});
  }catch(err){
    console.error('email_send_failed',JSON.stringify({code:'EMAIL_SEND_FAILED',reason:String(err&&err.message||'send_failed').slice(0,200)}));
    delivery={status:'failed',email_sent:false,message:opts.resend?'Convite recriado, mas não foi possível enviar o e-mail. Verifique a configuração de envio.':'Convite criado, mas não foi possível enviar o e-mail. Verifique a configuração de envio.'};
  }
  if(delivery.email_sent)audit(req,opts.resend?'INVITATION_RESENT':'INVITATION_SENT','INVITATION',inviteId,null,{user_id:userId,email_status:'sent',purpose});
  return{id:inviteId,token:raw,expires_at:expires,activation_url,email_sent:!!delivery.email_sent,email_status:delivery.status,message:delivery.message,purpose};
}
function withCredentialStatus(x){if(!x)return x;return{...x,...credentialStatusFor(x)}}
function canManageClientAdmin(req,profile){if(profile!=='CLIENT_ADMIN')return true;return['OWNER','ACCOUNTANT'].includes(req.user.role)}
app.get('/api/empresas/:id/users',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const company=one('SELECT id FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!company||!companyVisibleToUser(req,company.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');res.json(qRows("SELECT u.id,u.tenant_id,u.company_id,u.name,u.email,u.role,u.active,u.created_at,u.last_access_at,COALESCE(p.profile,'CLIENT_VIEWER') profile,(SELECT status FROM client_invitations i WHERE i.user_id=u.id ORDER BY datetime(i.created_at) DESC, i.id DESC LIMIT 1) invitation_status,(SELECT purpose FROM client_invitations i WHERE i.user_id=u.id ORDER BY datetime(i.created_at) DESC, i.id DESC LIMIT 1) invitation_purpose,(SELECT created_at FROM client_invitations i WHERE i.user_id=u.id ORDER BY datetime(i.created_at) DESC, i.id DESC LIMIT 1) invitation_created_at,(SELECT accepted_at FROM client_invitations i WHERE i.user_id=u.id ORDER BY datetime(i.created_at) DESC, i.id DESC LIMIT 1) invitation_accepted_at FROM users u LEFT JOIN client_user_profiles p ON p.user_id=u.id WHERE u.tenant_id=? AND u.company_id=? AND u.role='CLIENT' ORDER BY u.name",req.user.tenant_id,req.params.id).map(x=>{const row=withCredentialStatus(x);const resetStatus=passwordResetRequestStatus({purpose:row.invitation_purpose,status:row.invitation_status});if(resetStatus){row.password_reset_status=resetStatus;row.password_reset_method='EMAIL';row.password_reset_requested_at=row.invitation_created_at||null;row.password_reset_completed_at=resetStatus==='CONCLUIDA'?(row.invitation_accepted_at||null):null}return row}))});
app.get('/api/empresas/:id/users/:userId',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const company=one('SELECT id FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!company||!companyVisibleToUser(req,company.id))return deny(res,404,'Empresa não encontrada.','NOT_FOUND');const u=clientUserRow(req.params.userId);if(!u||u.tenant_id!==req.user.tenant_id||u.company_id!==company.id)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');res.json(u)});
app.post('/api/empresas/:id/users',auth,role('OWNER','ACCOUNTANT','STAFF'),async(req,res)=>{const company=one("SELECT id,status FROM companies WHERE tenant_id=? AND id=?",req.user.tenant_id,req.params.id);if(!company||!companyVisibleToUser(req,company.id))return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');if(req.companyScope&&req.companyScope!==company.id)return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_SCOPE_MISMATCH');if(company.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');const email=String(req.body.email||'').trim().toLowerCase(),profile=resolveClientProfile(req.body.profile||req.body.perfil);if(!req.body.name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!profile)return deny(res,400,'Informe nome, e-mail válido e perfil.','INVALID_CLIENT_USER');if(!canManageClientAdmin(req,profile))return deny(res,403,'Você não tem permissão para administrar credenciais de administrador.','FORBIDDEN');if(req.body.password||req.body.senha)return deny(res,400,'A senha é definida pelo usuário na ativação.','PASSWORD_NOT_ALLOWED');if(one('SELECT id FROM users WHERE tenant_id=? AND lower(email)=?',req.user.tenant_id,email))return deny(res,409,'Já existe um usuário com este e-mail.','USER_EXISTS');const userId=id();try{exec('INSERT INTO users(id,tenant_id,company_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?,?,0)',userId,req.user.tenant_id,company.id,req.body.name,email,bcrypt.hashSync(crypto.randomBytes(32).toString('hex'),12),'CLIENT');exec('INSERT INTO client_user_profiles(user_id,profile) VALUES(?,?)',userId,profile);for(const key of req.body.permissions||[]){if(!one('SELECT key FROM client_permissions WHERE key=?',key))throw Error('INVALID_PERMISSION');exec('INSERT INTO client_user_permissions(user_id,permission_key,allowed) VALUES(?,?,1)',userId,key)}const invite=await invitationRecord(req,company.id,userId,email);audit(req,'USER_CREATED','USER',userId,null,{user_id:userId,company_id:company.id,email,profile,role:'CLIENT'});audit(req,'CLIENT_USER_CREATED','USER',userId,null,{user_id:userId,company_id:company.id,email,profile,role:'CLIENT'});audit(req,'CLIENT_INVITATION_CREATED','INVITATION',invite.id,null,{user_id:userId,company_id:company.id,email});const user=clientUserRow(userId);res.status(201).json({user,profile:user.profile,invitation:{id:invite.id,status:'PENDING',expires_at:invite.expires_at,activation_url:publicActivationUrl(invite),email_sent:invite.email_sent,email_status:invite.email_status,message:invite.message},message:invite.message})}catch(e){console.error(e.stack||e);if(!res.headersSent)deny(res,409,'Não foi possível criar o usuário.','CLIENT_USER_CREATE_FAILED')}});
app.patch('/api/client-users/:id',auth,role('OWNER','ACCOUNTANT','STAFF'),async(req,res)=>{const b=one("SELECT u.*,p.profile FROM users u LEFT JOIN client_user_profiles p ON p.user_id=u.id WHERE u.tenant_id=? AND u.id=? AND u.role='CLIENT'",req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');if(!canManageClientAdmin(req,b.profile||'CLIENT_VIEWER'))return deny(res,403,'Você não tem permissão para administrar credenciais de administrador.','FORBIDDEN');if(req.body.password||req.body.senha)return deny(res,400,'A senha é definida pelo usuário na ativação.','PASSWORD_NOT_ALLOWED');const profile=req.body.profile===undefined&&req.body.perfil===undefined?b.profile:resolveClientProfile(req.body.profile||req.body.perfil);if(req.body.profile!==undefined||req.body.perfil!==undefined){if(!profile)return deny(res,400,'Perfil inválido.','INVALID_PROFILE');if(!canManageClientAdmin(req,profile))return deny(res,403,'Você não tem permissão para administrar credenciais de administrador.','FORBIDDEN');upsertClientProfile(b.id,profile)}const name=req.body.name??b.name,email=req.body.email===undefined?b.email:String(req.body.email).trim().toLowerCase();if(email!==b.email&&one('SELECT id FROM users WHERE tenant_id=? AND lower(email)=? AND id<>?',req.user.tenant_id,email,b.id))return deny(res,409,'Já existe um usuário com este e-mail.','USER_EXISTS');const nextActive=req.body.active===undefined?b.active:(req.body.active===false||req.body.active==='0'||req.body.active===0?0:1);exec('UPDATE users SET name=?,email=?,active=? WHERE id=? AND tenant_id=?',name,email,nextActive,b.id,req.user.tenant_id);if(Array.isArray(req.body.permissions)){for(const key of req.body.permissions){if(!one('SELECT key FROM client_permissions WHERE key=?',key))return deny(res,400,'Permissão inválida.','INVALID_PERMISSION');exec('INSERT INTO client_user_permissions(user_id,permission_key,allowed,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,permission_key) DO UPDATE SET allowed=1,updated_at=CURRENT_TIMESTAMP',b.id,key)}}const action=profile&&profile!==b.profile?'CLIENT_PROFILE_UPDATED':'USER_UPDATED';audit(req,action,'USER',b.id,{profile:b.profile,name:b.name,email:b.email,active:b.active},{profile:profile||b.profile,name,email,active:nextActive});const inviteStatus=one("SELECT status FROM client_invitations WHERE user_id=? ORDER BY created_at DESC LIMIT 1",b.id);const emailChanged=email!==b.email;const pendingInvite=!inviteStatus||inviteStatus.status!=='ACCEPTED';let invitation=null;if(emailChanged||(pendingInvite&&!b.last_access_at)){try{const invite=await invitationRecord(req,b.company_id,b.id,email,{resend:true});audit(req,'CLIENT_INVITATION_RESENT','INVITATION',invite.id,null,{user_id:b.id,company_id:b.company_id,email,reason:emailChanged?'EMAIL_CHANGED':'PENDING_SAVE'});invitation={id:invite.id,status:'PENDING',expires_at:invite.expires_at,activation_url:publicActivationUrl(invite),email_sent:invite.email_sent,email_status:invite.email_status,message:invite.message}}catch(err){console.error('invite_on_save_failed',String(err&&err.message||err).slice(0,200))}}const user=clientUserRow(b.id);res.json(invitation?{...user,invitation,message:invitation.message}:user)});

app.post('/api/client-users/:id/password',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{const u=clientUserRow(req.params.id);if(!u||u.tenant_id!==req.user.tenant_id)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');audit(req,'SENSITIVE_DATA_ACCESSED','USER',u.id,null,{result:'denied',reason:'password_not_recoverable'});return deny(res,403,'A senha do cliente não pode ser visualizada. Utilize o convite para redefinição.','PASSWORD_NOT_RECOVERABLE')});
app.post('/api/client-users/:id/redefinir-acesso',auth,scope,role('OWNER','ACCOUNTANT'),async(req,res)=>{
  const u=one("SELECT * FROM users WHERE tenant_id=? AND id=? AND role='CLIENT'",req.user.tenant_id,req.params.id);
  if(!u)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');
  if(!companyVisibleToUser(req,u.company_id))return deny(res,404,'Usuário não encontrado.','NOT_FOUND');
  if(req.companyScope&&req.companyScope!==u.company_id)return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_SCOPE_MISMATCH');
  const company=one("SELECT id,status FROM companies WHERE tenant_id=? AND id=?",u.tenant_id,u.company_id);
  if(!company)return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');
  if(company.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');
  const prof=one('SELECT profile FROM client_user_profiles WHERE user_id=?',u.id)?.profile||'CLIENT_VIEWER';
  if(!canManageClientAdmin(req,prof))return deny(res,403,'Você não tem permissão para administrar credenciais de administrador.','FORBIDDEN');
  audit(req,'CLIENT_CREDENTIAL_RESET_REQUESTED','USER',u.id,null,{target_user_id:u.id,company_id:u.company_id,result:'requested'});
  const invite=await invitationRecord(req,u.company_id,u.id,u.email,{purpose:'PASSWORD_RESET',expiresHours:24});
  if(!invite.email_sent){
    exec("UPDATE client_invitations SET status='REVOKED' WHERE id=?",invite.id);
    audit(req,'CLIENT_INVITATION_SEND_FAILED','INVITATION',invite.id,null,{target_user_id:u.id,company_id:u.company_id,result:'failed',email_status:invite.email_status});
    return deny(res,502,'Não foi possível enviar o novo acesso. Verifique a configuração de e-mail e tente novamente.','INVITATION_SEND_FAILED');
  }
  sessions.revoke(u.id,u.tenant_id);
  exec('UPDATE users SET password_hash=?,pin_hash=NULL,pin_configured_at=NULL,pin_setup_required=1 WHERE id=? AND tenant_id=?',bcrypt.hashSync(crypto.randomBytes(32).toString('hex'),12),u.id,u.tenant_id);
  audit(req,'CLIENT_SESSION_REVOKED','USER',u.id,null,{target_user_id:u.id,company_id:u.company_id,result:'ok'});
  audit(req,'CLIENT_INVITATION_CREATED','INVITATION',invite.id,null,{target_user_id:u.id,company_id:u.company_id,purpose:'PASSWORD_RESET',result:'ok'});
  audit(req,'CLIENT_INVITATION_SENT','INVITATION',invite.id,null,{target_user_id:u.id,company_id:u.company_id,result:'ok'});
  const user=clientUserRow(u.id);
  res.json({
    message:'Novo acesso enviado. Um e-mail foi enviado para o cliente criar uma nova senha.',
    email_sent:true,
    expires_at:invite.expires_at,
    activation_url:publicActivationUrl(invite),
    credential_status:user.credential_status,
    user
  });
});
app.post('/api/client-users/:id/resend-invitation',auth,role('OWNER','ACCOUNTANT','STAFF'),async(req,res)=>{const u=one("SELECT * FROM users WHERE tenant_id=? AND id=? AND role='CLIENT'",req.user.tenant_id,req.params.id);if(!u)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');const prof=one('SELECT profile FROM client_user_profiles WHERE user_id=?',u.id)?.profile||'CLIENT_VIEWER';if(!canManageClientAdmin(req,prof))return deny(res,403,'Você não tem permissão para administrar credenciais de administrador.','FORBIDDEN');const invite=await invitationRecord(req,u.company_id,u.id,u.email,{resend:true});audit(req,'CLIENT_INVITATION_RESENT','INVITATION',invite.id,null,{user_id:u.id});res.json({status:'PENDING',expires_at:invite.expires_at,activation_url:publicActivationUrl(invite),email_sent:invite.email_sent,email_status:invite.email_status,message:invite.message})});
app.post('/api/client-users/:id/revoke-invitation',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const i=one("SELECT * FROM client_invitations WHERE tenant_id=? AND user_id=? AND status='PENDING' ORDER BY created_at DESC LIMIT 1",req.user.tenant_id,req.params.id);if(!i)return deny(res,404,'Convite não encontrado.','INVITATION_NOT_FOUND');exec("UPDATE client_invitations SET status='REVOKED' WHERE id=?",i.id);audit(req,'CLIENT_INVITATION_REVOKED','INVITATION',i.id,null,{user_id:i.user_id});res.json({ok:true})});
app.post('/api/client-users/:id/block',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const u=one("SELECT * FROM users WHERE tenant_id=? AND id=? AND role='CLIENT'",req.user.tenant_id,req.params.id);if(!u)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');exec('UPDATE users SET active=0 WHERE id=?',u.id);audit(req,'CLIENT_USER_BLOCKED','USER',u.id,{active:u.active},{active:0});res.json(clientUserRow(u.id))});
app.post('/api/client-users/:id/unblock',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const u=one("SELECT * FROM users WHERE tenant_id=? AND id=? AND role='CLIENT'",req.user.tenant_id,req.params.id);if(!u)return deny(res,404,'Usuário não encontrado.','NOT_FOUND');const c=one("SELECT status FROM companies WHERE tenant_id=? AND id=?",u.tenant_id,u.company_id);if(c?.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');exec('UPDATE users SET active=1 WHERE id=?',u.id);audit(req,'CLIENT_USER_UNBLOCKED','USER',u.id,{active:u.active},{active:1});res.json(clientUserRow(u.id))});
// PLANO DE CONTAS
const planUpload=multer({dest:path.join(UPLOAD,'planos-contas'),limits:{fileSize:25*1024*1024}});
app.get('/api/plano-contas',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>res.json(qRows('SELECT p.*,COUNT(a.id) account_count FROM account_plans p LEFT JOIN accounts a ON a.plan_id=p.id WHERE p.tenant_id=? GROUP BY p.id ORDER BY p.created_at DESC',req.user.tenant_id)));
app.get('/api/plano-contas/analiticas',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const q=String(req.query.q||req.query.search||'').trim();const p=[req.user.tenant_id];let where="tenant_id=? AND account_type='A' AND is_postable=1 AND IFNULL(active,1)=1";if(q){where+=' AND (account_code LIKE ? OR classification_code LIKE ? OR description LIKE ?)';p.push('%'+q+'%','%'+q+'%','%'+q+'%')}const total=one(`SELECT COUNT(*) n FROM accounts WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT id,account_code,classification_code,description,account_type,is_postable,active FROM accounts WHERE ${where} ORDER BY classification_code,account_code LIMIT ? OFFSET ?`,...p,page_size,offset);res.json(paged(items,total,page,page_size))});
app.get('/api/plano-contas/:id/accounts',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const p=[req.user.tenant_id,req.params.id],s=String(req.query.search||'').trim();let sql='SELECT * FROM accounts WHERE tenant_id=? AND plan_id=?';if(s){sql+=' AND (description LIKE ? OR account_code LIKE ? OR classification_code LIKE ?)';p.push(`%${s}%`,`%${s}%`,`%${s}%`)}sql+=' ORDER BY classification_code,account_code LIMIT 10000';res.json(qRows(sql,...p))});
app.post('/api/plano-contas/preview',auth,role('OWNER','ACCOUNTANT','STAFF'),planUpload.single('file'),async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'FILE_REQUIRED',message:'Envie um arquivo.'});if(req.body&&req.body.company_id&&!companyOk(req,req.body.company_id))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');const preview=await chartService.previewPlanFile(req.file);res.json(preview)}catch(e){const fileType=req.file&&path.extname(req.file.originalname||'').replace('.','').toLowerCase();if(e.http&&e.http<500)return res.status(e.http).json(chartService.previewErrorPayload(e,fileType));console.error('plan_accounts_preview',{stage:e.stage||'preview',code:e.code,message:e.message,stack:e.stack});res.status(500).json({error:'PLAN_ACCOUNTS_PREVIEW_INVALID',message:'Não foi possível processar o arquivo.',details:{stage:'preview',code:e.code||'INTERNAL_ERROR',reason:'Erro técnico interno.',fileType:fileType||null}})}finally{if(req.file)try{fs.unlinkSync(req.file.path)}catch{}}});
async function importPlan(req,file,name){return chartService.importPlanFile({id,exec,db,audit},req,file,name)}
app.post('/api/plano-contas/import',auth,role('OWNER','ACCOUNTANT','STAFF'),planUpload.single('file'),async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'FILE_REQUIRED',message:'Envie um arquivo.'});if(req.body&&req.body.company_id&&!companyOk(req,req.body.company_id))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');res.status(201).json(await importPlan(req,req.file,req.body.name||req.file.originalname))}catch(e){const fileType=req.file&&path.extname(req.file.originalname||'').replace('.','').toLowerCase();if(e.http&&e.http<500)return res.status(e.http).json({...chartService.previewErrorPayload(e,fileType),error:e.error||'IMPORT_FAILED'});console.error('plan_accounts_import',{stage:e.stage||'import',code:e.code,message:e.message,stack:e.stack});res.status(500).json({error:'IMPORT_FAILED',message:'Não foi possível processar o arquivo.',details:{stage:'import',code:e.code||'INTERNAL_ERROR',reason:'Erro técnico interno.',fileType:fileType||null}})}finally{if(req.file)try{fs.unlinkSync(req.file.path)}catch{}}});
app.post('/api/plano-contas/accounts',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{const x=id();const a=req.body;exec('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable) VALUES(?,?,?,?,?,?,?,?,?,?,?)',x,req.user.tenant_id,a.plan_id,a.source_id||null,a.account_code,a.classification_code||a.account_code,a.account_type||'A',a.description,a.parent_code||null,a.level||0,a.is_postable===undefined?(a.account_type||'A')==='A':a.is_postable?1:0);res.status(201).json(one('SELECT * FROM accounts WHERE id=?',x))});
// CATEGORIES/BANKS/RULES
function configCompanyId(req){if(req.companyScope)return req.companyScope;const cid=req.body&&req.body.company_id||null;if(cid&&!companyOk(req,cid)){const e=new Error('Você não tem permissão para realizar esta operação.');e.code='COMPANY_FORBIDDEN';e.http=403;throw e}return cid||null}
function assertConfigAccount(tenantId,accountId){if(!accountId){const e=new Error('Selecione uma conta contábil analítica.');e.code='ACCOUNT_REQUIRED';e.http=400;throw e}try{return assertPostableAccount(tenantId,accountId)}catch(err){if(err.code==='SYNTHETIC_ACCOUNT'){err.message='Essa conta é sintética e não pode receber lançamentos.'}throw err}}
function publicCategory(row){if(!row)return row;return{...row,accounting_account_id:row.account_id,status:row.active?'ACTIVE':'INACTIVE'}}
function publicBank(row){if(!row)return row;return{...row,accounting_account_id:row.account_id,status:row.active?'ACTIVE':'INACTIVE'}}
function loadCategory(tenantId,id){return one('SELECT x.*,a.account_code,a.description account_description,c.name company_name FROM categories x LEFT JOIN accounts a ON a.id=x.account_id LEFT JOIN companies c ON c.id=x.company_id WHERE x.tenant_id=? AND x.id=?',tenantId,id)}
function loadBank(tenantId,id){return one('SELECT x.*,a.account_code,a.description account_description,c.name company_name FROM banks x LEFT JOIN accounts a ON a.id=x.account_id LEFT JOIN companies c ON c.id=x.company_id WHERE x.tenant_id=? AND x.id=?',tenantId,id)}
function categoryNameTaken(tenantId,companyId,name,excludeId){const n=String(name||'').trim().toLowerCase();if(!n)return false;const row=one("SELECT id FROM categories WHERE tenant_id=? AND lower(name)=? AND ifnull(company_id,'')=ifnull(?,'') AND (? IS NULL OR id<>?)",tenantId,n,companyId||null,excludeId||null,excludeId||null);return !!row}
function bankNameTaken(tenantId,companyId,name,excludeId){const n=String(name||'').trim().toLowerCase();if(!n)return false;return !!one("SELECT id FROM banks WHERE tenant_id=? AND lower(name)=? AND ifnull(company_id,'')=ifnull(?,'') AND (? IS NULL OR id<>?)",tenantId,n,companyId||null,excludeId||null,excludeId||null)}
app.get('/api/categorias',auth,requireOffice,scope,(req,res)=>{const p=[req.user.tenant_id];let sql=`SELECT x.*,a.account_code,a.description account_description,c.name company_name FROM categories x LEFT JOIN accounts a ON a.id=x.account_id LEFT JOIN companies c ON c.id=x.company_id WHERE x.tenant_id=?`;if(req.companyScope){sql+=' AND (x.company_id IS NULL OR x.company_id=?)';p.push(req.companyScope)}sql+=' ORDER BY x.name';res.json(qRows(sql,...p).map(publicCategory))});
app.post('/api/categorias',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{try{const name=String(req.body.name||'').trim();if(!name)return deny(res,400,'Informe o nome da categoria.','NAME_REQUIRED');const companyId=configCompanyId(req);const accountId=req.body.accounting_account_id||req.body.account_id||null;assertConfigAccount(req.user.tenant_id,accountId);if(categoryNameTaken(req.user.tenant_id,companyId,name))return deny(res,409,'Já existe uma categoria com este nome neste contexto.','DUPLICATE_CATEGORY');const x=id();exec('INSERT INTO categories(id,tenant_id,company_id,name,kind,account_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',x,req.user.tenant_id,companyId,name,req.body.kind||'EXPENSE',accountId);const row=loadCategory(req.user.tenant_id,x);audit(req,'CATEGORY_CREATED','CATEGORY',x,null,{name,company_id:companyId,account_id:accountId});res.status(201).json(publicCategory(row))}catch(e){return deny(res,e.http||400,e.message,e.code||'INVALID_CATEGORY')}});
app.patch('/api/categorias/:id',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{try{const b=one('SELECT * FROM categories WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Categoria não encontrada.','NOT_FOUND');if(req.companyScope&&b.company_id&&b.company_id!==req.companyScope)return deny(res,404,'Categoria não encontrada.','NOT_FOUND');const name=req.body.name!==undefined?String(req.body.name||'').trim():b.name;if(!name)return deny(res,400,'Informe o nome da categoria.','NAME_REQUIRED');let companyId=b.company_id;if(req.body.company_id!==undefined&&!req.companyScope)companyId=req.body.company_id||null;if(req.companyScope)companyId=req.companyScope;if(companyId&&!companyOk(req,companyId))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');let accountId=b.account_id;if(req.body.accounting_account_id!==undefined||req.body.account_id!==undefined)accountId=req.body.accounting_account_id||req.body.account_id||null;if(accountId)assertConfigAccount(req.user.tenant_id,accountId);if(categoryNameTaken(req.user.tenant_id,companyId,name,b.id))return deny(res,409,'Já existe uma categoria com este nome neste contexto.','DUPLICATE_CATEGORY');const active=req.body.active===false||req.body.active===0?0:(req.body.active===true||req.body.active===1?1:b.active);exec('UPDATE categories SET name=?,kind=?,account_id=?,company_id=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?',name,req.body.kind??b.kind,accountId,companyId,active,b.id,req.user.tenant_id);const row=loadCategory(req.user.tenant_id,b.id);const action=b.active!==active?(active?'CATEGORY_ACTIVATED':'CATEGORY_DEACTIVATED'):'CATEGORY_UPDATED';audit(req,action,'CATEGORY',b.id,{name:b.name,active:b.active,account_id:b.account_id},{name,active,account_id:accountId,company_id:companyId});res.json(publicCategory(row))}catch(e){return deny(res,e.http||400,e.message,e.code||'INVALID_CATEGORY')}});
app.get('/api/bancos',auth,requireOffice,scope,(req,res)=>{const p=[req.user.tenant_id];let sql=`SELECT x.*,a.account_code,a.description account_description,c.name company_name FROM banks x LEFT JOIN accounts a ON a.id=x.account_id LEFT JOIN companies c ON c.id=x.company_id WHERE x.tenant_id=?`;if(req.companyScope){sql+=' AND (x.company_id IS NULL OR x.company_id=?)';p.push(req.companyScope)}sql+=' ORDER BY x.name';res.json(qRows(sql,...p).map(publicBank))});
app.post('/api/bancos',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{try{const name=String(req.body.name||'').trim();if(!name)return deny(res,400,'Informe o nome do banco.','NAME_REQUIRED');const companyId=configCompanyId(req);const accountId=req.body.accounting_account_id||req.body.account_id||null;assertConfigAccount(req.user.tenant_id,accountId);if(bankNameTaken(req.user.tenant_id,companyId,name))return deny(res,409,'Já existe um banco com este nome neste contexto.','DUPLICATE_BANK');const x=id();exec('INSERT INTO banks(id,tenant_id,company_id,name,account_id,identifier,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',x,req.user.tenant_id,companyId,name,accountId,req.body.identifier||null);const row=loadBank(req.user.tenant_id,x);audit(req,'BANK_ACCOUNT_CREATED','BANK',x,null,{name,company_id:companyId,account_id:accountId});res.status(201).json(publicBank(row))}catch(e){return deny(res,e.http||400,e.message,e.code||'INVALID_BANK')}});
app.patch('/api/bancos/:id',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{try{const b=one('SELECT * FROM banks WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return deny(res,404,'Banco não encontrado.','NOT_FOUND');if(req.companyScope&&b.company_id&&b.company_id!==req.companyScope)return deny(res,404,'Banco não encontrado.','NOT_FOUND');const name=req.body.name!==undefined?String(req.body.name||'').trim():b.name;if(!name)return deny(res,400,'Informe o nome do banco.','NAME_REQUIRED');let companyId=b.company_id;if(req.body.company_id!==undefined&&!req.companyScope)companyId=req.body.company_id||null;if(req.companyScope)companyId=req.companyScope;if(companyId&&!companyOk(req,companyId))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');let accountId=b.account_id;if(req.body.accounting_account_id!==undefined||req.body.account_id!==undefined)accountId=req.body.accounting_account_id||req.body.account_id||null;if(accountId)assertConfigAccount(req.user.tenant_id,accountId);if(bankNameTaken(req.user.tenant_id,companyId,name,b.id))return deny(res,409,'Já existe um banco com este nome neste contexto.','DUPLICATE_BANK');const active=req.body.active===false||req.body.active===0?0:(req.body.active===true||req.body.active===1?1:b.active);exec('UPDATE banks SET name=?,account_id=?,company_id=?,identifier=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?',name,accountId,companyId,req.body.identifier!==undefined?req.body.identifier:b.identifier,active,b.id,req.user.tenant_id);const row=loadBank(req.user.tenant_id,b.id);const action=b.active!==active?(active?'BANK_ACCOUNT_ACTIVATED':'BANK_ACCOUNT_DEACTIVATED'):'BANK_ACCOUNT_UPDATED';audit(req,action,'BANK',b.id,{name:b.name,active:b.active,account_id:b.account_id},{name,active,account_id:accountId,company_id:companyId});res.json(publicBank(row))}catch(e){return deny(res,e.http||400,e.message,e.code||'INVALID_BANK')}});
app.get('/api/classificacao/diagnostico',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{const companyId=req.companyScope||null;res.json(classificationDiagnosis(req.user.tenant_id,companyId,{category_id:req.query.category_id,bank_id:req.query.bank_id}))});
app.post('/api/classificacao/diagnostico',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{const companyId=req.companyScope||null;res.json(classificationDiagnosis(req.user.tenant_id,companyId,{category_id:req.body.category_id,bank_id:req.body.bank_id}))});
app.get('/api/regras-contabeis',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{const p=[req.user.tenant_id];let sql=`SELECT r.*,d.account_code debit_code,d.description debit_description,c.account_code credit_code,c.description credit_description FROM accounting_rules r LEFT JOIN accounts d ON d.id=r.debit_account_id LEFT JOIN accounts c ON c.id=r.credit_account_id WHERE r.tenant_id=?`;if(req.companyScope){sql+=' AND (r.company_id IS NULL OR r.company_id=?)';p.push(req.companyScope)}sql+=' ORDER BY r.priority,r.name';res.json(qRows(sql,...p))});
app.post('/api/regras-contabeis',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{if(!req.body.name)return res.status(400).json({error:'NAME_REQUIRED'});const debitId=req.body.debit_account_id||null;const creditId=req.body.credit_account_id||null;if(!debitId||!creditId)return deny(res,400,'Informe as contas de débito e crédito.','ACCOUNTS_REQUIRED');if(debitId===creditId)return deny(res,422,'Débito e crédito não podem ser a mesma conta.','SAME_ACCOUNTS');try{assertPostableAccount(req.user.tenant_id,debitId);assertPostableAccount(req.user.tenant_id,creditId)}catch(e){return deny(res,e.http||422,e.message,e.code||'INVALID_ACCOUNT')}const x=id();exec('INSERT INTO accounting_rules(id,tenant_id,company_id,name,priority,conditions_json,debit_account_id,credit_account_id,settlement_account_id,confidence) VALUES(?,?,?,?,?,?,?,?,?,?)',x,req.user.tenant_id,req.body.company_id||null,req.body.name,Number(req.body.priority||100),JSON.stringify(req.body.conditions||{}),debitId,creditId,req.body.settlement_account_id||null,Number(req.body.confidence??1));res.status(201).json(one('SELECT * FROM accounting_rules WHERE id=?',x))});
app.patch('/api/regras-contabeis/:id',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{const b=one('SELECT * FROM accounting_rules WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!b)return res.status(404).json({error:'NOT_FOUND'});const debitId=req.body.debit_account_id!==undefined?req.body.debit_account_id||null:b.debit_account_id;const creditId=req.body.credit_account_id!==undefined?req.body.credit_account_id||null:b.credit_account_id;if(debitId&&creditId&&debitId===creditId)return deny(res,422,'Débito e crédito não podem ser a mesma conta.','SAME_ACCOUNTS');if(debitId){try{assertPostableAccount(req.user.tenant_id,debitId)}catch(e){return deny(res,e.http||422,e.message,e.code||'INVALID_ACCOUNT')}}if(creditId){try{assertPostableAccount(req.user.tenant_id,creditId)}catch(e){return deny(res,e.http||422,e.message,e.code||'INVALID_ACCOUNT')}}exec('UPDATE accounting_rules SET name=?,company_id=?,priority=?,conditions_json=?,debit_account_id=?,credit_account_id=?,settlement_account_id=?,confidence=?,active=? WHERE id=? AND tenant_id=?',req.body.name??b.name,req.body.company_id===undefined?b.company_id:req.body.company_id||null,req.body.priority??b.priority,JSON.stringify(req.body.conditions??JSON.parse(b.conditions_json||'{}')),debitId,creditId,req.body.settlement_account_id??b.settlement_account_id,req.body.confidence??b.confidence,req.body.active===false?0:1,b.id,req.user.tenant_id);res.json({ok:true})});
app.post('/api/regras-contabeis/simulate',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>res.json(classify(req.user.tenant_id,req.body.company_id,req.body)));
// DOCUMENTS
const docUpload=multer({dest:path.join(UPLOAD,'.tmp'),limits:{fileSize:25*1024*1024}});
const clientUpload=multer({dest:path.join(UPLOAD,'.tmp'),limits:{fileSize:CLIENT_UPLOAD_MAX}});
app.get('/api/documentos',auth,scope,(req,res)=>{const sc=scopedCompanyWhere(req,'d');let{where,p}=sc;where+=" AND d.deleted_at IS NULL AND IFNULL(d.status,'')<>'DRAFT'";const filterCompany=String(req.query.company_id||'').trim();if(filterCompany){if(!companyOk(req,filterCompany))return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');where+=' AND d.company_id=?';p.push(filterCompany)}if(req.query.status){where+=' AND d.status=?';p.push(req.query.status)}const src=String(req.query.source||'').toUpperCase();if(src==='CLIENT'||src==='OFFICE'||src==='IMPORT'){where+=' AND d.source=?';p.push(src)}if(req.query.origin){where+=' AND d.origin=?';p.push(req.query.origin)}if(req.query.from){where+=' AND date(d.created_at)>=date(?)';p.push(req.query.from)}if(req.query.to){where+=' AND date(d.created_at)<=date(?)';p.push(req.query.to)}if(req.query.type==='pdf')where+=" AND lower(IFNULL(d.mime_type,'')) LIKE '%pdf%'";if(req.query.type==='image')where+=" AND lower(IFNULL(d.mime_type,'')) LIKE 'image/%'";const q=String(req.query.q||req.query.search||'').trim();if(q){where+=' AND d.original_name LIKE ?';p.push(`%${q}%`)}const ex=String(req.query.extraction_status||'').toUpperCase();if(ex==='NONE'||ex==='UNANALYZED')where+=' AND NOT EXISTS(SELECT 1 FROM document_extractions de WHERE de.document_id=d.id)';else if(['PENDING','PROCESSING','EXTRACTED','FAILED','REVIEWED'].includes(ex)){where+=' AND EXISTS(SELECT 1 FROM document_extractions de WHERE de.document_id=d.id AND de.status=?)';p.push(ex)}const total=one(`SELECT COUNT(*) n FROM documents d WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT d.id,d.original_name,d.mime_type,d.size_bytes,d.sha256,d.status,d.notes,d.created_at,d.company_id,d.origin,d.source,d.uploaded_by,c.name company_name,c.trade_name company_trade_name,c.cnpj company_cnpj,u.name uploaded_by_name,u.role uploaded_by_role,(SELECT status FROM document_extractions de WHERE de.document_id=d.id) extraction_status,(SELECT extraction_method FROM document_extractions de WHERE de.document_id=d.id) extraction_method,(SELECT error_code FROM document_extractions de WHERE de.document_id=d.id) extraction_error_code,(SELECT error_message FROM document_extractions de WHERE de.document_id=d.id) extraction_error_message FROM documents d JOIN companies c ON c.id=d.company_id JOIN users u ON u.id=d.uploaded_by WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,...p,page_size,offset).map(row=>officeDocumentItem(row,req));res.json(paged(items,total,page,page_size))});
app.post('/api/documentos/upload',auth,scope,docUpload.single('file'),(req,res)=>{try{if(req.companyScope)req.body.company_id=req.companyScope;if(!req.file)return deny(res,400,'Envie um arquivo.','FILE_REQUIRED');if(!req.body.company_id)return deny(res,400,'Informe a empresa.','COMPANY_REQUIRED');if(!companyOk(req,req.body.company_id))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');const uploadCompany=one('SELECT id,status FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.body.company_id);if(!uploadCompany)return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');if(uploadCompany.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');const invalid=validateClientFile(req.file);if(invalid){try{fs.unlinkSync(req.file.path)}catch{}return deny(res,422,invalid,'INVALID_FILE')}const draft=isDraftDocumentFlag(req.body&&(req.body.draft||req.body.temporary||req.body.temp));const x=id();const stored=documentStorage.ingestUpload(req.file,x);const origin=documentOwnership.originForActor(req.user,origens),source=documentOwnership.sourceForActor(req.user);const status=draft?'DRAFT':'ACTIVE';exec('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,notes,status,origin,source,encrypted,encryption_kid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',x,req.user.tenant_id,req.body.company_id,req.file.originalname,stored.storage_path,req.file.mimetype,stored.size_bytes,stored.sha256,req.user.sub,req.body.notes||null,status,origin,source,stored.encrypted?1:0,stored.encryption_kid);audit(req,draft?'DRAFT_DOCUMENT':'CREATE','DOCUMENT',x,null,{original_name:req.file.originalname,sha256:stored.sha256,source,origin,storage_path:stored.storage_path,draft:!!draft});if(!draft){emitFromReq(req,EVENT_TYPES.DOCUMENT_UPLOADED,{companyId:req.body.company_id,entityType:'document',entityId:x,payload:{original_name:req.file.originalname}});enqueueDocumentPipeline(req.user.tenant_id,x,req.user.sub)}const row=one('SELECT d.id,d.original_name,d.mime_type,d.size_bytes,d.sha256,d.status,d.notes,d.created_at,d.company_id,d.origin,d.source FROM documents d WHERE d.id=?',x);res.status(201).json(officeDocumentItem({...row,company_name:null,uploaded_by_name:null},req))}catch(e){if(req.file)try{fs.unlinkSync(req.file.path)}catch{}res.status(422).json({error:'UPLOAD_FAILED',message:e.message})}});
app.delete('/api/documentos/:id',auth,requireOffice,scope,(req,res)=>handleDocumentDelete(req,res));
app.get('/api/documentos/:id/view',auth,scope,(req,res)=>deliverDocument(req,res,'inline'));
app.get('/api/documentos/:id/download',auth,scope,(req,res)=>deliverDocument(req,res,'attachment'));
function isDraftDocumentFlag(v){return v===true||v===1||v==='1'||String(v||'').toLowerCase()==='true'||String(v||'').toLowerCase()==='draft'}
function publishClientDocument(req,doc){
  if(!doc||!doc.id)return;
  emitFromReq(req,EVENT_TYPES.DOCUMENT_UPLOADED,{companyId:doc.company_id,entityType:'document',entityId:doc.id,payload:{original_name:doc.original_name}});
  enqueueDocumentPipeline(req.user.tenant_id,doc.id,req.user.sub);
}
function storeClientDocument(req,file,notes,{draft=false}={}){
  const err=validateClientFile(file);
  if(err){try{fs.unlinkSync(file.path)}catch{}throw Object.assign(new Error(err),{http:422})}
  const x=id(),companyId=clientCompanyId(req);
  const stored=documentStorage.ingestUpload(file,x);
  const origin=documentOwnership.originForActor(req.user,origens),source=documentOwnership.sourceForActor(req.user);
  const status=draft?'DRAFT':'PENDING_REVIEW';
  exec('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,notes,status,origin,source,encrypted,encryption_kid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',x,req.user.tenant_id,companyId,file.originalname,stored.storage_path,file.mimetype,stored.size_bytes,stored.sha256,req.user.sub,notes||null,status,origin,source,stored.encrypted?1:0,stored.encryption_kid);
  audit(req,draft?'CLIENT_DRAFT_DOCUMENT':'CLIENT_UPLOADED_DOCUMENT','DOCUMENT',x,null,{original_name:file.originalname,sha256:stored.sha256,source,origin,storage_path:stored.storage_path,draft:!!draft});
  if(!draft)publishClientDocument(req,{id:x,company_id:companyId,original_name:file.originalname});
  return publicDocument(one('SELECT * FROM documents WHERE id=?',x),req.user.tenant_id,req);
}
app.get('/api/client/documentos',auth,requireClient,requireClientCompany,(req,res)=>{const companyId=clientCompanyId(req),p=[req.user.tenant_id,companyId];let sql="SELECT * FROM documents WHERE tenant_id=? AND company_id=? AND deleted_at IS NULL AND IFNULL(status,'')<>'DRAFT'";if(req.query.from){sql+=' AND date(created_at)>=date(?)';p.push(req.query.from)}if(req.query.to){sql+=' AND date(created_at)<=date(?)';p.push(req.query.to)}if(req.query.status){sql+=' AND status=?';p.push(req.query.status)}if(req.query.type==='pdf')sql+=" AND lower(IFNULL(mime_type,'')) LIKE '%pdf%'";if(req.query.type==='image')sql+=" AND lower(IFNULL(mime_type,'')) LIKE 'image/%'";sql+=' ORDER BY created_at DESC';let rows=qRows(sql,...p).map(d=>publicDocument(d,req.user.tenant_id,req)).filter(Boolean);if(req.query.linked==='1')rows=rows.filter(x=>x.linked);if(req.query.linked==='0')rows=rows.filter(x=>!x.linked);res.json(rows)});
app.post('/api/client/documentos',auth,requireClient,requireClientCompany,clientUpload.single('file'),(req,res)=>{try{if(!req.file)return deny(res,400,'Envie um arquivo.','FILE_REQUIRED');const draft=isDraftDocumentFlag(req.body&&(req.body.draft||req.body.temporary||req.body.temp));res.status(201).json(storeClientDocument(req,req.file,req.body.notes||req.body.observacao,{draft}))}catch(e){if(req.file)try{fs.unlinkSync(req.file.path)}catch{}res.status(e.http||422).json({error:'UPLOAD_FAILED',message:e.message})}});
app.delete('/api/client/documentos/:id',auth,requireClient,requireClientCompany,(req,res)=>handleDocumentDelete(req,res));
app.get('/api/client/documentos/:id',auth,requireClient,requireClientCompany,(req,res)=>{const d=one('SELECT * FROM documents WHERE tenant_id=? AND company_id=? AND id=? AND deleted_at IS NULL',req.user.tenant_id,clientCompanyId(req),req.params.id);if(!d)return deny(res,404,'Documento não encontrado.','NOT_FOUND');res.json(publicDocument(d,req.user.tenant_id,req))});
app.get('/api/client/documentos/:id/view',auth,requireClient,requireClientCompany,(req,res)=>deliverClientDocument(req,res,'inline'));
app.get('/api/client/documentos/:id/download',auth,requireClient,requireClientCompany,(req,res)=>deliverClientDocument(req,res,'attachment'));
// TRANSACTIONS
function txWhere(req,table){const sc=scopedCompanyWhere(req,'x');let{where,p}=sc;if(req.query.status){where+=' AND x.status=?';p.push(req.query.status)}if(req.query.category_id){where+=' AND x.category_id=?';p.push(req.query.category_id)}if(req.query.payment_method&&table==='expenses'){where+=' AND x.payment_method=?';p.push(req.query.payment_method)}if(req.query.receipt_method&&table==='revenues'){where+=' AND x.receipt_method=?';p.push(req.query.receipt_method)}if(req.query.from){where+=' AND date(x.occurred_on)>=date(?)';p.push(req.query.from)}if(req.query.to){where+=' AND date(x.occurred_on)<=date(?)';p.push(req.query.to)}const q=String(req.query.q||req.query.search||'').trim();if(q){where+=' AND x.description LIKE ?';p.push(`%${q}%`)}return{where,p}}
function listTx(req,table){const {where,p}=txWhere(req,table);return qRows(`SELECT x.*,c.name company_name,cat.name category_name,b.name bank_name FROM ${table} x JOIN companies c ON c.id=x.company_id LEFT JOIN categories cat ON cat.id=x.category_id LEFT JOIN banks b ON b.id=x.bank_id WHERE ${where} ORDER BY x.occurred_on DESC,x.created_at DESC`,...p)}
function pageTx(req,table){const {where,p}=txWhere(req,table);const total=one(`SELECT COUNT(*) n FROM ${table} x WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT x.*,c.name company_name,cat.name category_name,b.name bank_name,(SELECT status FROM entries e WHERE e.tenant_id=x.tenant_id AND e.source_id=x.id ORDER BY e.created_at DESC LIMIT 1) workflow_status FROM ${table} x JOIN companies c ON c.id=x.company_id LEFT JOIN categories cat ON cat.id=x.category_id LEFT JOIN banks b ON b.id=x.bank_id WHERE ${where} ORDER BY x.occurred_on DESC,x.created_at DESC LIMIT ? OFFSET ?`,...p,page_size,offset);return paged(items,total,page,page_size)}
app.get('/api/despesas',auth,scope,(req,res)=>res.json(pageTx(req,'expenses')));app.get('/api/receitas',auth,scope,(req,res)=>res.json(pageTx(req,'revenues')));
function createTx(req,res,type){const b={...req.body};delete b.debit_account_id;delete b.credit_account_id;delete b.account_id;delete b.classification_code;if(req.user.role==='CLIENT')b.company_id=clientCompanyId(req);else if(req.companyScope)b.company_id=req.companyScope;if(!b.occurred_on&&b.date)b.occurred_on=b.date;if(!b.company_id||!today(b.occurred_on)||!b.description||!b.amount||type==='EXPENSE'&&!b.payment_method||type==='REVENUE'&&!b.receipt_method)return deny(res,400,'Preencha data, descrição, valor e a forma de pagamento ou recebimento.','INVALID_FIELDS');const companyRow=one('SELECT id,status FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,b.company_id);if(!companyRow)return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');if(!companyOk(req,b.company_id))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');if(companyRow.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');if(!guardPeriodWritable(req,res,b.company_id,b.occurred_on))return;if(b.bank_id&&!one('SELECT id FROM banks WHERE tenant_id=? AND id=? AND active=1 AND (company_id IS NULL OR company_id=?)',req.user.tenant_id,b.bank_id,b.company_id))return deny(res,400,'Banco / caixa inválido para esta empresa.','INVALID_BANK');if(b.category_id&&!one('SELECT id FROM categories WHERE tenant_id=? AND id=? AND active=1 AND (company_id IS NULL OR company_id=?)',req.user.tenant_id,b.category_id,b.company_id))return deny(res,400,'Categoria inválida para esta empresa.','INVALID_CATEGORY');if(b.document_id&&!one('SELECT id FROM documents WHERE id=? AND tenant_id=? AND company_id=? AND deleted_at IS NULL',b.document_id,req.user.tenant_id,b.company_id))return deny(res,400,'Documento inválido para esta empresa.','INVALID_DOCUMENT');let value;try{value=cents(b.amount)}catch(e){return deny(res,400,e.message||'Valor inválido.','INVALID_AMOUNT')}const xid=id(),notes=String(b.notes||b.note||b.observacao||'').trim()||null,supplierName=type==='EXPENSE'?String(b.supplier_name||b.fornecedor||'').trim()||null:null,origin=originFromReq(req),importId=req.user.role==='CLIENT'?null:(b.import_id||null);let classified=false,cls=null,eid=null,promoteDraft=null;db.transaction(()=>{if(type==='EXPENSE')exec('INSERT INTO expenses(id,tenant_id,company_id,occurred_on,description,amount_cents,payment_method,bank_id,category_id,document_id,notes,supplier_name,created_by,origin,import_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',xid,req.user.tenant_id,b.company_id,b.occurred_on,b.description,value,b.payment_method,b.bank_id||null,b.category_id||null,b.document_id||null,notes,supplierName,req.user.sub,origin,importId);else exec('INSERT INTO revenues(id,tenant_id,company_id,occurred_on,description,amount_cents,receipt_method,bank_id,category_id,document_id,notes,created_by,origin,import_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',xid,req.user.tenant_id,b.company_id,b.occurred_on,b.description,value,b.receipt_method,b.bank_id||null,b.category_id||null,b.document_id||null,notes,req.user.sub,origin,importId);if(b.document_id){const drow=one('SELECT id,status,original_name,company_id FROM documents WHERE id=? AND tenant_id=? AND company_id=? AND deleted_at IS NULL',b.document_id,req.user.tenant_id,b.company_id);if(drow&&String(drow.status||'')==='DRAFT')promoteDraft={id:drow.id,company_id:drow.company_id,original_name:drow.original_name};exec("UPDATE documents SET status='ACTIVE' WHERE id=? AND tenant_id=? AND company_id=?",b.document_id,req.user.tenant_id,b.company_id)}cls=classify(req.user.tenant_id,b.company_id,{...b,source_type:type,amount_cents:value});classified=cls.status==='CLASSIFIED';eid=createEntry(req,{companyId:b.company_id,sourceType:type,sourceId:xid,date:b.occurred_on,description:b.description,amountCents:value,classification:cls});const method=type==='EXPENSE'?b.payment_method:b.receipt_method;emitFromReq(req,type==='EXPENSE'?EVENT_TYPES.EXPENSE_CREATED:EVENT_TYPES.REVENUE_CREATED,{companyId:b.company_id,entityType:type==='EXPENSE'?'expense':'revenue',entityId:xid,payload:{amount_cents:value,description:b.description,payment_method:type==='EXPENSE'?method:undefined,receipt_method:type==='REVENUE'?method:undefined,method}});if(!classified)emitFromReq(req,EVENT_TYPES.CLASSIFICATION_REQUIRED,{companyId:b.company_id,entityType:'entry',entityId:eid,payload:{amount_cents:value,description:b.description,method}});else emitFromReq(req,EVENT_TYPES.ENTRY_CREATED,{companyId:b.company_id,entityType:'entry',entityId:eid,payload:{amount_cents:value,description:b.description}})})();if(promoteDraft)publishClientDocument(req,promoteDraft);if(type==='EXPENSE'&&b.document_id&&smartExpenseService)try{smartExpenseService.markSaved(req.user.tenant_id,b.document_id,xid)}catch{}audit(req,type==='EXPENSE'?'EXPENSE_CREATED':'REVENUE_CREATED',type,xid,null,{id:xid,description:b.description,amount_cents:value,company_id:b.company_id,document_id:b.document_id||null,origin});const payload={id:xid,company_id:b.company_id,entry_id:eid,status:classified?'PENDING':'NEEDS_CLASSIFICATION',status_label:clientStatus(classified?'PENDING':'NEEDS_CLASSIFICATION'),amount_cents:value,occurred_on:b.occurred_on,description:b.description,notes,supplier_name:supplierName,document_id:b.document_id||null,origin,origin_label:origens.label(origin)};if(req.user.role!=='CLIENT')payload.classification=cls;res.status(201).json(payload)}
app.post('/api/despesas',auth,scope,(req,res)=>createTx(req,res,'EXPENSE'));app.post('/api/receitas',auth,scope,(req,res)=>createTx(req,res,'REVENUE'));
app.get('/api/client/dashboard',auth,requireClient,requireClientCompany,(req,res)=>{const companyId=clientCompanyId(req),tenantId=req.user.tenant_id;const exp=one('SELECT COALESCE(SUM(amount_cents),0) n FROM expenses WHERE tenant_id=? AND company_id=?',tenantId,companyId).n;const rev=one('SELECT COALESCE(SUM(amount_cents),0) n FROM revenues WHERE tenant_id=? AND company_id=?',tenantId,companyId).n;const pending=one("SELECT COUNT(*) n FROM pendencies WHERE tenant_id=? AND company_id=? AND status='OPEN'",tenantId,companyId).n;const docs=one("SELECT COUNT(*) n FROM documents WHERE tenant_id=? AND company_id=? AND deleted_at IS NULL AND IFNULL(status,'')<>'DRAFT'",tenantId,companyId).n;const recent=qRows("SELECT * FROM (SELECT id,'EXPENSE' source_type,occurred_on,description,amount_cents,payment_method method,status,document_id FROM expenses WHERE tenant_id=? AND company_id=? UNION ALL SELECT id,'REVENUE',occurred_on,description,amount_cents,receipt_method,status,document_id FROM revenues WHERE tenant_id=? AND company_id=?) t ORDER BY occurred_on DESC,id DESC LIMIT 8",tenantId,companyId,tenantId,companyId).map(x=>{const e=one('SELECT status FROM entries WHERE tenant_id=? AND company_id=? AND source_id=? ORDER BY created_at DESC LIMIT 1',tenantId,companyId,x.id);const open=one("SELECT id FROM pendencies WHERE tenant_id=? AND company_id=? AND status='OPEN' AND entity_id=?",tenantId,companyId,x.id);const status=e?.status||x.status;return{id:x.id,source_type:x.source_type,occurred_on:x.occurred_on,description:x.description,amount_cents:x.amount_cents,method:x.method,document_id:x.document_id,status,status_label:clientStatus(status,!!open)}});res.json({company:req.clientCompany,expenses_cents:exp,revenue_cents:rev,pending,documents:docs,recent})});
app.get('/api/client/categorias',auth,requireClient,requireClientCompany,(req,res)=>res.json(qRows("SELECT id,name,kind FROM categories WHERE tenant_id=? AND active=1 AND (company_id IS NULL OR company_id=?) ORDER BY name",req.user.tenant_id,clientCompanyId(req))));
app.get('/api/client/bancos',auth,requireClient,requireClientCompany,(req,res)=>res.json(qRows("SELECT id,name FROM banks WHERE tenant_id=? AND active=1 AND (company_id IS NULL OR company_id=?) ORDER BY name",req.user.tenant_id,clientCompanyId(req))));
function clientTransactions(req,table){return listTx(req,table).map(x=>{const e=one('SELECT status FROM entries WHERE tenant_id=? AND company_id=? AND source_id=? ORDER BY created_at DESC LIMIT 1',req.user.tenant_id,clientCompanyId(req),x.id);const open=one("SELECT id FROM pendencies WHERE tenant_id=? AND company_id=? AND status='OPEN' AND entity_id=?",req.user.tenant_id,clientCompanyId(req),x.id);const status=e?.status||x.status;const{tenant_id,...rest}=x;return {...rest,status,status_label:clientStatus(status,!!open),has_document:!!x.document_id}})}
app.get('/api/client/despesas',auth,requireClient,requireClientCompany,(req,res)=>res.json(clientTransactions(req,'expenses')));
app.get('/api/client/receitas',auth,requireClient,requireClientCompany,(req,res)=>res.json(clientTransactions(req,'revenues')));
app.post('/api/client/despesas',auth,requireClient,requireClientCompany,(req,res)=>{req.body.company_id=clientCompanyId(req);createTx(req,res,'EXPENSE')});
app.post('/api/client/receitas',auth,requireClient,requireClientCompany,(req,res)=>deny(res,403,'Receitas não são cadastradas pelo Portal do Cliente. Elas chegam por importação ou integração.','REVENUE_NOT_AVAILABLE_FOR_CLIENT'));
app.get('/api/client/transacoes/:id',auth,requireClient,requireClientCompany,(req,res)=>{const companyId=clientCompanyId(req);const x=one("SELECT 'EXPENSE' source_type,e.* FROM expenses e WHERE e.tenant_id=? AND e.company_id=? AND e.id=? UNION ALL SELECT 'REVENUE',r.* FROM revenues r WHERE r.tenant_id=? AND r.company_id=? AND r.id=?",req.user.tenant_id,companyId,req.params.id,req.user.tenant_id,companyId,req.params.id);if(!x)return deny(res,404,'Movimentação não encontrada.','NOT_FOUND');const history=qRows('SELECT occurred_on,description,status FROM entries WHERE tenant_id=? AND company_id=? AND source_id=? ORDER BY created_at',req.user.tenant_id,companyId,req.params.id);const status=history.at(-1)?.status||x.status;const open=one("SELECT id,reason FROM pendencies WHERE tenant_id=? AND company_id=? AND status='OPEN' AND entity_id=?",req.user.tenant_id,companyId,x.id);const doc=x.document_id?publicDocument(one('SELECT * FROM documents WHERE id=? AND tenant_id=? AND company_id=? AND deleted_at IS NULL',x.document_id,req.user.tenant_id,companyId),req.user.tenant_id,req):null;const cat=x.category_id?one('SELECT name FROM categories WHERE id=?',x.category_id):null;const bank=x.bank_id?one('SELECT name FROM banks WHERE id=?',x.bank_id):null;const{tenant_id,...rest}=x;res.json({...rest,category_name:cat?.name,bank_name:bank?.name,status,status_label:clientStatus(status,!!open),document:doc,history:history.map(h=>({...h,status_label:clientStatus(h.status)}))})});
function updateTx(req,res,table,method){const b=one(`SELECT * FROM ${table} WHERE tenant_id=? AND id=?`,req.user.tenant_id,req.params.id);if(!b||!companyOk(req,b.company_id))return deny(res,404,'Movimentação não encontrada.','NOT_FOUND');if(req.user.role==='CLIENT'&&b.company_id!==clientCompanyId(req))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');const entry=one('SELECT status FROM entries WHERE tenant_id=? AND source_id=? ORDER BY created_at DESC LIMIT 1',req.user.tenant_id,b.id);if(entry&&entryStates.isLocked(entry.status))return deny(res,403,'Movimentação lançada não pode ser alterada. Utilize uma solicitação.','TX_LOCKED');if(!guardPeriodWritable(req,res,b.company_id,b.occurred_on))return;const nextOccurred=req.body.occurred_on??b.occurred_on;if(nextOccurred!==b.occurred_on&&!guardPeriodWritable(req,res,b.company_id,nextOccurred))return;if(req.user.role==='CLIENT'){delete req.body.company_id;delete req.body.debit_account_id;delete req.body.credit_account_id}const amount=b.amount_cents;const notes=req.body.notes??req.body.note??req.body.observacao??b.notes;exec(`UPDATE ${table} SET occurred_on=?,description=?,amount_cents=?,${method}=?,bank_id=?,category_id=?,document_id=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,req.body.occurred_on??b.occurred_on,req.body.description??b.description,req.body.amount===undefined?amount:cents(req.body.amount),req.body[method]??b[method],req.body.bank_id===undefined?b.bank_id:req.body.bank_id||null,req.body.category_id===undefined?b.category_id:req.body.category_id||null,req.body.document_id===undefined?b.document_id:req.body.document_id||null,notes,b.id,req.user.tenant_id);const a=one(`SELECT * FROM ${table} WHERE id=?`,b.id);audit(req,'UPDATE',table,b.id,{id:b.id,status:b.status},{id:a.id});res.json(a)}
app.patch('/api/despesas/:id',auth,scope,(req,res)=>updateTx(req,res,'expenses','payment_method'));
app.patch('/api/receitas/:id',auth,scope,(req,res)=>updateTx(req,res,'revenues','receipt_method'));
app.patch('/api/client/despesas/:id',auth,requireClient,requireClientCompany,(req,res)=>updateTx(req,res,'expenses','payment_method'));
app.patch('/api/client/receitas/:id',auth,requireClient,requireClientCompany,(req,res)=>updateTx(req,res,'revenues','receipt_method'));
// ENTRIES
app.get('/api/lancamentos',auth,scope,(req,res)=>{const sc=scopedCompanyWhere(req,'e');let{where,p}=sc;const st=String(req.query.status||'').trim();if(!st){where+=" AND e.status='POSTED'"}else if(st==='PENDING_APPROVAL'){where+=" AND e.status='PENDING'"}else if(st!=='ALL'){const allowed=['NEEDS_CLASSIFICATION','PENDING','POSTED','REJECTED'];if(allowed.includes(st)){where+=' AND e.status=?';p.push(st)}else{where+=' AND 1=0'}}const q=String(req.query.q||req.query.search||'').trim();if(q){where+=' AND e.description LIKE ?';p.push(`%${q}%`)}if(today(req.query.from)){where+=' AND date(e.occurred_on)>=date(?)';p.push(req.query.from)}if(today(req.query.to)){where+=' AND date(e.occurred_on)<=date(?)';p.push(req.query.to)}if(req.query.source_type){where+=' AND e.source_type=?';p.push(req.query.source_type)}if(req.query.origin){where+=" AND EXISTS(SELECT 1 FROM expenses x WHERE x.id=e.source_id AND x.origin=? UNION ALL SELECT 1 FROM revenues r WHERE r.id=e.source_id AND r.origin=?)";p.push(req.query.origin,req.query.origin)}const total=one(`SELECT COUNT(*) n FROM entries e WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT e.*,c.name company_name,u.name posted_by_name,COALESCE((SELECT SUM(amount_cents) FROM entry_lines WHERE entry_id=e.id AND side='D'),0) debit_cents,COALESCE((SELECT amount_cents FROM expenses WHERE id=e.source_id),(SELECT amount_cents FROM revenues WHERE id=e.source_id),0) source_cents,(SELECT original_name FROM(SELECT d.original_name FROM documents d JOIN expenses x ON x.document_id=d.id WHERE x.id=e.source_id AND d.deleted_at IS NULL UNION ALL SELECT d.original_name FROM documents d JOIN revenues r ON r.document_id=d.id WHERE r.id=e.source_id AND d.deleted_at IS NULL) LIMIT 1) document_name,(SELECT a.description FROM entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=e.id AND l.side='D' ORDER BY l.id LIMIT 1) classification_label FROM entries e JOIN companies c ON c.id=e.company_id LEFT JOIN users u ON u.id=COALESCE(e.posted_by,e.approved_by,e.generated_by) WHERE ${where} ORDER BY e.occurred_on DESC,e.created_at DESC LIMIT ? OFFSET ?`,...p,page_size,offset).map(x=>({...x,amount:money(x.debit_cents||x.source_cents)}));res.json(paged(items,total,page,page_size))});
app.get('/api/lancamentos/:id',auth,scope,(req,res)=>{const e=entry(req,req.params.id);if(!e||!companyOk(req,e.company_id))return res.status(404).json({error:'NOT_FOUND'});res.json(e)});
app.post('/api/lancamentos',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{if(req.companyScope)req.body.company_id=req.companyScope;if(!companyOk(req,req.body.company_id))return res.status(403).json({error:'COMPANY_FORBIDDEN'});if(!req.body.company_id||!today(req.body.occurred_on)||!req.body.description)return res.status(400).json({error:'INVALID_ENTRY'});const writable=one('SELECT status FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.body.company_id);if(!writable)return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');if(writable.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');if(!guardPeriodWritable(req,res,req.body.company_id,req.body.occurred_on))return;let lines;try{lines=normalizeEntryLines(req.body.lines);assertBalancedLines(lines);validateAccountingSemantics({sourceType:req.body.source_type||'MANUAL',entryKind:req.body.entry_kind,lines})}catch(e){return deny(res,e.http||422,e.message,e.code||'INVALID_ENTRY')}if(req.body.source_id){const existing=one('SELECT id FROM entries WHERE tenant_id=? AND source_type=? AND source_id=?',req.user.tenant_id,req.body.source_type||'MANUAL',req.body.source_id);if(existing)return deny(res,409,'Já existe lançamento para esta movimentação.','ENTRY_EXISTS')}const eid=id();try{db.transaction(()=>{exec('INSERT INTO entries(id,tenant_id,company_id,source_type,source_id,occurred_on,description,status,confidence,generated_by) VALUES(?,?,?,?,?,?,?,?,?,?)',eid,req.user.tenant_id,req.body.company_id,req.body.source_type||'MANUAL',req.body.source_id||null,req.body.occurred_on,req.body.description,'PENDING',1,req.user.sub);for(const l of lines){assertPostableAccount(req.user.tenant_id,l.account_id);exec('INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents,memo) VALUES(?,?,?,?,?,?)',id(),eid,l.account_id,l.side,l.amount_cents,l.memo||null)}})()}catch(e){return deny(res,e.http||422,e.message||'Falha ao gravar lançamento.',e.code||'ENTRY_WRITE_FAILED')}saveClassificationRun(req,{companyId:req.body.company_id,sourceType:req.body.source_type||'MANUAL',sourceId:req.body.source_id||null,entryId:eid,cls:{status:'CLASSIFIED',origin:'MANUAL',score:100,reasons:['Lançamento manual do escritório'],debit_account_id:lines.find(x=>x.side==='D')?.account_id,credit_account_id:lines.find(x=>x.side==='C')?.account_id,candidates:[]},note:req.body.note||null});audit(req,'CREATE','ENTRY',eid,null,{description:req.body.description,lines:lines.length});emitFromReq(req,EVENT_TYPES.ENTRY_CREATED,{companyId:req.body.company_id,entityType:'entry',entityId:eid,payload:{description:req.body.description}});res.status(201).json(entry(req,eid))});
app.post('/api/lancamentos/:id/reclassificar',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{const e=entry(req,req.params.id);if(!e||!companyOk(req,e.company_id))return res.status(404).json({error:'NOT_FOUND'});if(!entryStates.canReclassify(e.status))return deny(res,409,'Lançamento efetivado não pode ser alterado.','ENTRY_POSTED');if(!guardPeriodWritable(req,res,e.company_id,e.occurred_on))return;let lines;try{lines=normalizeEntryLines(req.body.lines);assertBalancedLines(lines);validateAccountingSemantics({sourceType:e.source_type,entryKind:req.body.entry_kind||null,lines})}catch(err){return deny(res,err.http||422,err.message,err.code||'ENTRY_NOT_BALANCED')}try{db.transaction(()=>{exec('DELETE FROM entry_lines WHERE entry_id=?',e.id);for(const l of lines){assertPostableAccount(req.user.tenant_id,l.account_id);exec('INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents,memo) VALUES(?,?,?,?,?,?)',id(),e.id,l.account_id,l.side,l.amount_cents,l.memo||null)}exec("UPDATE entries SET status='PENDING',confidence=1,rejected_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",e.id);exec('INSERT INTO entry_reclassifications(id,tenant_id,entry_id,account_id,side,amount_cents,reason,user_id) VALUES(?,?,?,?,?,?,?,?)',id(),req.user.tenant_id,e.id,lines[0].account_id,lines[0].side,lines[0].amount_cents,req.body.reason||req.body.note||'Reclassificação manual',req.user.sub);exec("UPDATE pendencies SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND entity_type='ENTRY' AND entity_id=? AND status='OPEN'",req.user.tenant_id,e.id)})()}catch(err){return deny(res,err.http||422,err.message||'Falha ao reclassificar.',err.code||'ENTRY_WRITE_FAILED')}const cls={status:'CLASSIFIED',origin:'MANUAL',score:100,reasons:['Decisão manual do contador'],debit_account_id:lines.find(x=>x.side==='D')?.account_id,credit_account_id:lines.find(x=>x.side==='C')?.account_id,candidates:(e.classification&&e.classification.candidates)||[]};saveClassificationRun(req,{companyId:e.company_id,sourceType:e.source_type,sourceId:e.source_id,entryId:e.id,cls,note:req.body.reason||req.body.note||null});audit(req,'RECLASSIFY','ENTRY',e.id,{status:e.status,lines:(e.lines||[]).length},{status:'PENDING',lines:lines.length,note:req.body.reason||req.body.note||null});audit(req,'CLASSIFICATION_COMPLETED','ENTRY',e.id,{status:e.status},{status:'PENDING',user_id:req.user.sub,company_id:e.company_id,reason:req.body.reason||req.body.note||null,confidence:1,accounts:lines.map(l=>({side:l.side,account_id:l.account_id,amount_cents:l.amount_cents}))});emitFromReq(req,EVENT_TYPES.CLASSIFICATION_COMPLETED,{companyId:e.company_id,entityType:'entry',entityId:e.id,payload:{description:e.description,note:req.body.reason||req.body.note||null}});res.json(entry(req,e.id))});
// APPROVAL
// APPROVAL
app.get('/api/aprovacao/pendentes',auth,requireOffice,scope,(req,res)=>{const sc=scopedCompanyWhere(req,'e');let{where,p}=sc;where+=" AND e.status='PENDING'";const q=String(req.query.q||req.query.search||'').trim();if(q){where+=' AND e.description LIKE ?';p.push(`%${q}%`)}if(today(req.query.from)){where+=' AND date(e.occurred_on)>=date(?)';p.push(req.query.from)}if(today(req.query.to)){where+=' AND date(e.occurred_on)<=date(?)';p.push(req.query.to)}const total=one(`SELECT COUNT(*) n FROM entries e WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT e.*,c.name company_name,COALESCE((SELECT SUM(amount_cents) FROM entry_lines WHERE entry_id=e.id AND side='D'),0) debit,COALESCE((SELECT SUM(amount_cents) FROM entry_lines WHERE entry_id=e.id AND side='C'),0) credit,(SELECT group_concat(a.account_code||' — '||a.description,' | ') FROM entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=e.id AND l.side='D') debit_accounts,(SELECT group_concat(a.account_code||' — '||a.description,' | ') FROM entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=e.id AND l.side='C') credit_accounts,(SELECT d.original_name FROM documents d JOIN expenses x ON x.document_id=d.id WHERE x.id=e.source_id UNION ALL SELECT d.original_name FROM documents d JOIN revenues r ON r.document_id=d.id WHERE r.id=e.source_id) document_name,COALESCE((SELECT origin FROM expenses WHERE id=e.source_id),(SELECT origin FROM revenues WHERE id=e.source_id),e.source_type) movement_origin FROM entries e JOIN companies c ON c.id=e.company_id WHERE ${where} ORDER BY e.occurred_on,e.created_at LIMIT ? OFFSET ?`,...p,page_size,offset).map(e=>({...e,origin:e.movement_origin,origin_label:origens.isValid(e.movement_origin)?origens.label(e.movement_origin):(e.source_type==='MANUAL'?'Lançamento manual':String(e.movement_origin||'-')),entry:{balanced:e.debit===e.credit&&e.debit>0}}));res.json(paged(items,total,page,page_size))});
app.post('/api/aprovacao/:id/aprovar',auth,role('OWNER','ACCOUNTANT'),scope,(req,res)=>{const e=entry(req,req.params.id);if(!e||!companyOk(req,e.company_id))return res.status(404).json({error:'NOT_FOUND'});if(!guardPeriodWritable(req,res,e.company_id,e.occurred_on))return;let posted;try{posted=db.transaction(()=>postingService.postFromApproval({entry:e,userId:req.user.sub,generatedByWorkflow:true}))()}catch(err){return deny(res,err.http||422,err.message,err.code||'POSTING_FAILED')}const after=entry(req,e.id);if(!posted.alreadyPosted){audit(req,'ENTRY_APPROVED','ENTRY',e.id,{status:e.status},{status:'POSTED',approved:true,generated_by_workflow:true});audit(req,'ENTRY_POSTED','ENTRY',e.id,{status:e.status},{status:'POSTED',posted_by:req.user.sub,company_id:e.company_id,entry_id:e.id,user_id:req.user.sub,line_count:posted.lineCount,debit:posted.debit,credit:posted.credit,source_type:e.source_type,source_id:e.source_id,generated_by_workflow:true,accounts:(posted.lines||[]).map(l=>({side:l.side,account_code:l.account_code,amount_cents:l.amount_cents}))});emitFromReq(req,EVENT_TYPES.ENTRY_APPROVED,{companyId:e.company_id,entityType:'entry',entityId:e.id,payload:{description:e.description,status:'POSTED',approved:true}});emitFromReq(req,EVENT_TYPES.ENTRY_POSTED,{companyId:e.company_id,entityType:'entry',entityId:e.id,payload:{description:e.description,status:'POSTED',amount_cents:posted.debit}});try{if(documentPipelineService&&e.movement&&e.movement.document_id){const sug=e.pipeline&&e.pipeline.suggestion;const debitLine=(e.lines||[]).find(l=>l.side==='D');const creditLine=(e.lines||[]).find(l=>l.side==='C');documentPipelineService.recordLearningDecision(req.user.tenant_id,req.user.sub,{company_id:e.company_id,document_id:e.movement.document_id,entry_id:e.id,suggested_account_debit:sug&&sug.debit_account_id||null,suggested_account_credit:sug&&sug.credit_account_id||null,selected_account_debit:debitLine&&debitLine.account_id||null,selected_account_credit:creditLine&&creditLine.account_id||null,suggested_operation_type:e.pipeline&&e.pipeline.operation_type||null,selected_operation_type:e.pipeline&&e.pipeline.operation_type||null,decision:'ACCEPTED',reason:e.movement.supplier_name||e.description||null})}}catch{/* best-effort */}}res.json(after)});
app.post('/api/aprovacao/:id/rejeitar',auth,role('OWNER','ACCOUNTANT'),scope,(req,res)=>{const e=entry(req,req.params.id);if(!e||!companyOk(req,e.company_id))return res.status(404).json({error:'NOT_FOUND'});if(!guardPeriodWritable(req,res,e.company_id,e.occurred_on))return;const reason=String(req.body.reason||req.body.motivo||'').trim();if(!reason)return deny(res,400,'Informe o motivo da rejeição.','REASON_REQUIRED');if(!entryStates.canReject(e.status))return deny(res,409,'Somente classificações aguardando aprovação podem ser rejeitadas.','INVALID_TRANSITION');try{db.transaction(()=>{exec("UPDATE entries SET status='REJECTED',rejected_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='PENDING'",reason,e.id,req.user.tenant_id);exec('INSERT INTO approvals(id,tenant_id,entry_id,action,reason,user_id) VALUES(?,?,?,?,?,?)',id(),req.user.tenant_id,e.id,'REJECT',reason,req.user.sub);exec("UPDATE entries SET status='NEEDS_CLASSIFICATION',updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?",e.id,req.user.tenant_id)})()}catch(err){return deny(res,err.http||422,err.message,err.code||'REJECT_FAILED')}audit(req,'ENTRY_REJECTED','ENTRY',e.id,{status:e.status},{status:'REJECTED',reason,company_id:e.company_id,user_id:req.user.sub});audit(req,'CLASSIFICATION_REQUIRED','ENTRY',e.id,{status:'REJECTED'},{status:'NEEDS_CLASSIFICATION',reason});emitFromReq(req,EVENT_TYPES.ENTRY_REJECTED,{companyId:e.company_id,entityType:'entry',entityId:e.id,payload:{description:e.description,note:reason}});res.json({ok:true,status:'NEEDS_CLASSIFICATION',id:e.id})});
// PENDENCIES / REQUESTS / NOTIFICATIONS / AUDIT
app.get('/api/pendencias',auth,scope,(req,res)=>{const sc=scopedCompanyWhere(req,'p');let{where,p}=sc;const status=String(req.query.status||'OPEN').toUpperCase();if(status&&status!=='ALL'){where+=' AND p.status=?';p.push(status)}if(req.query.type){where+=' AND p.entity_type=?';p.push(req.query.type)}if(req.query.from){where+=' AND date(p.created_at)>=date(?)';p.push(req.query.from)}if(req.query.to){where+=' AND date(p.created_at)<=date(?)';p.push(req.query.to)}const total=one(`SELECT COUNT(*) n FROM pendencies p WHERE ${where}`,...p).n;const {page,page_size,offset}=pageParams(req,25);const items=qRows(`SELECT p.*,c.name company_name,(SELECT status FROM entries e WHERE e.tenant_id=p.tenant_id AND (e.id=p.entity_id OR e.source_id=p.entity_id) ORDER BY e.created_at DESC LIMIT 1) entry_status FROM pendencies p LEFT JOIN companies c ON c.id=p.company_id WHERE ${where} ORDER BY p.created_at LIMIT ? OFFSET ?`,...p,page_size,offset);res.json(paged(items,total,page,page_size))});
function relatedMovement(tenantId,companyId,entityId){return one("SELECT id,description,amount_cents,document_id,occurred_on FROM expenses WHERE tenant_id=? AND company_id=? AND id=? UNION ALL SELECT id,description,amount_cents,document_id,occurred_on FROM revenues WHERE tenant_id=? AND company_id=? AND id=?",tenantId,companyId,entityId,tenantId,companyId,entityId)||one("SELECT x.id,x.description,x.amount_cents,x.document_id,x.occurred_on FROM expenses x JOIN entries e ON e.source_id=x.id AND e.tenant_id=x.tenant_id WHERE e.tenant_id=? AND e.company_id=? AND e.id=? UNION ALL SELECT x.id,x.description,x.amount_cents,x.document_id,x.occurred_on FROM revenues x JOIN entries e ON e.source_id=x.id AND e.tenant_id=x.tenant_id WHERE e.tenant_id=? AND e.company_id=? AND e.id=?",tenantId,companyId,entityId,tenantId,companyId,entityId)}
app.get('/api/client/pendencias',auth,requireClient,requireClientCompany,(req,res)=>{const rows=qRows("SELECT p.id,p.entity_type,p.entity_id,p.reason,p.status,p.created_at FROM pendencies p WHERE p.tenant_id=? AND p.company_id=? AND p.status='OPEN' ORDER BY p.created_at",req.user.tenant_id,clientCompanyId(req));res.json(rows.map(p=>{const movement=relatedMovement(req.user.tenant_id,clientCompanyId(req),p.entity_id);const document=movement?.document_id?publicDocument(one('SELECT * FROM documents WHERE id=? AND tenant_id=? AND company_id=? AND deleted_at IS NULL',movement.document_id,req.user.tenant_id,clientCompanyId(req)),req.user.tenant_id,req):null;return{...p,title:'Precisamos de uma informação.',movement,document,responses:qRows('SELECT message,created_at FROM client_pendency_responses WHERE tenant_id=? AND company_id=? AND pendency_id=? ORDER BY created_at',req.user.tenant_id,clientCompanyId(req),p.id)}}))});app.post('/api/client/pendencias/:id/resposta',auth,requireClient,requireClientCompany,(req,res)=>{const p=one("SELECT * FROM pendencies WHERE tenant_id=? AND company_id=? AND id=? AND status='OPEN'",req.user.tenant_id,clientCompanyId(req),req.params.id);if(!p)return res.status(404).json({error:'NOT_FOUND'});if(!String(req.body.message||'').trim())return res.status(400).json({error:'MESSAGE_REQUIRED'});const x=id();exec('INSERT INTO client_pendency_responses(id,tenant_id,company_id,pendency_id,user_id,message) VALUES(?,?,?,?,?,?)',x,req.user.tenant_id,clientCompanyId(req),p.id,req.user.sub,String(req.body.message).trim());audit(req,'CLIENT_RESPONDED_PENDING','PENDENCY',p.id,null,{response_id:x});emitFromReq(req,EVENT_TYPES.PENDENCY_RESPONSE,{companyId:clientCompanyId(req),entityType:'pendency',entityId:p.id,payload:{description:p.reason}});res.status(201).json(one('SELECT * FROM client_pendency_responses WHERE id=?',x))});
app.get('/api/pendencias/:id/respostas',auth,requireOffice,(req,res)=>{const p=one('SELECT id,company_id FROM pendencies WHERE tenant_id=? AND id=?',req.user.tenant_id,req.params.id);if(!p)return res.status(404).json({error:'NOT_FOUND'});res.json(qRows('SELECT r.*,u.name user_name FROM client_pendency_responses r JOIN users u ON u.id=r.user_id WHERE r.tenant_id=? AND r.pendency_id=? ORDER BY r.created_at',req.user.tenant_id,p.id))});
function notificationWhere(req,forClient){
  const recipient=req.user.sub;
  const p=[req.user.tenant_id,recipient];
  let where='n.tenant_id=? AND COALESCE(n.recipient_user_id,n.user_id)=? AND COALESCE(n.recipient_user_id,n.user_id) IS NOT NULL';
  if(forClient){where+=' AND n.company_id=?';p.push(clientCompanyId(req))}
  else{
    // Inbox do escritório é pessoal do destinatário: não filtrar por X-Company-Id.
    // STAFF continua limitado às empresas visíveis (assignees) quando o flag estiver ativo.
    const vis=staffVisibleCompanySql(req,'n.company_id');
    where+=vis.sql;p.push(...vis.p);
  }
  if(req.query.unread==='1'||req.query.unread==='true')where+=' AND n.read_at IS NULL';
  if(req.query.since){where+=' AND n.created_at>?';p.push(String(req.query.since))}
  return{where,p}
}
function mapNotification(n){
  let reference={};try{reference=JSON.parse(n.event_payload_json||'{}')}catch{}
  const occurrenceId=reference.occurrence_id||(n.entity_type==='process_occurrence'?n.entity_id:null);
  const targetUserId=reference.target_user_id||(n.entity_type==='client_user'?n.entity_id:null);
  const preview=n.preview||n.context||null;
  const url=n.url||null;
  return{
    id:n.id,event_id:n.event_id||null,type:n.type,event_type:n.type,title:n.title,message:n.message,body:n.message,context:n.context||null,
    preview,url,
    company_id:n.company_id||null,company_name:n.company_name||null,entity_type:n.entity_type||null,entity_id:n.entity_id||null,
    process_id:reference.process_id||null,occurrence_id:occurrenceId||null,step_id:reference.step_id||null,
    target_user_id:targetUserId||null,
    reference_type:reference.reference_type||(n.entity_type==='client_user'?'CLIENT_USER':null),
    reference_id:targetUserId||n.entity_id||null,
    reference:occurrenceId?{process_id:reference.process_id||null,occurrence_id:occurrenceId,step_id:reference.step_id||null}:(targetUserId?{type:'CLIENT_USER',user_id:targetUserId,company_id:n.company_id||null}:null),
    read_at:n.read_at||null,created_at:n.created_at,unread:!n.read_at
  }
}
function listNotifications(req,forClient){
  const {where,p}=notificationWhere(req,forClient);
  const unreadReq={user:req.user,companyScope:req.companyScope,clientCompany:req.clientCompany,query:{}};
  const unreadScope=notificationWhere(unreadReq,forClient);
  const unread=one(`SELECT COUNT(*) n FROM notifications n WHERE ${unreadScope.where} AND n.read_at IS NULL`,...unreadScope.p).n;
  const total=one(`SELECT COUNT(*) n FROM notifications n WHERE ${where}`,...p).n;
  const {page,page_size,offset}=pageParams(req,25);
  const items=qRows(`SELECT n.*,c.name company_name,c.trade_name company_trade,ev.payload_json event_payload_json FROM notifications n LEFT JOIN companies c ON c.id=n.company_id LEFT JOIN domain_events ev ON ev.id=n.event_id WHERE ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,...p,page_size,offset).map(x=>({...mapNotification(x),company_name:x.company_trade||x.company_name||null}));
  return{...paged(items,total,page,page_size),unread}
}
app.get('/api/notificacoes',auth,requireOffice,scope,(req,res)=>res.json(listNotifications(req,false)));
app.get('/api/notificacoes/preferencias',auth,(req,res)=>{
  const rows=qRows('SELECT event_type,in_app_enabled FROM notification_preferences WHERE tenant_id=? AND user_id=?',req.user.tenant_id,req.user.sub);
  const map={};for(const r of rows)map[r.event_type]=!!r.in_app_enabled;
  res.json({in_app:true,defaults:true,items:Object.values(EVENT_TYPES).map(event_type=>({event_type,in_app_enabled:map[event_type]===undefined?true:map[event_type]}))});
});
app.put('/api/notificacoes/preferencias',auth,(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items:[{event_type:req.body.event_type,in_app_enabled:req.body.in_app_enabled}];
  for(const it of items){
    if(!Object.values(EVENT_TYPES).includes(it.event_type))continue;
    const enabled=it.in_app_enabled===false||it.in_app_enabled===0?0:1;
    const emailOn=it.email_enabled===false||it.email_enabled===0?0:(it.email_enabled===undefined?null:1);
    const existing=one('SELECT id FROM notification_preferences WHERE user_id=? AND event_type=?',req.user.sub,it.event_type);
    if(existing){
      if(emailOn===null)exec('UPDATE notification_preferences SET in_app_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',enabled,existing.id);
      else exec('UPDATE notification_preferences SET in_app_enabled=?,email_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',enabled,emailOn,existing.id);
    }else exec('INSERT INTO notification_preferences(id,tenant_id,user_id,event_type,in_app_enabled,email_enabled) VALUES(?,?,?,?,?,?)',id(),req.user.tenant_id,req.user.sub,it.event_type,enabled,emailOn===null?1:emailOn);
  }
  res.json({ok:true});
});
app.post('/api/notificacoes/lidas',auth,(req,res)=>{
  if(req.user.role==='CLIENT')return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PORTAL_ONLY');
  const processItems=qRows("SELECT id,type,entity_id,event_id FROM notifications WHERE tenant_id=? AND COALESCE(recipient_user_id,user_id)=? AND read_at IS NULL AND type LIKE 'PROCESS_%'",req.user.tenant_id,req.user.sub);
  exec("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND COALESCE(recipient_user_id,user_id)=? AND read_at IS NULL",req.user.tenant_id,req.user.sub);
  for(const item of processItems)audit(req,'PROCESS_NOTIFICATION_READ','NOTIFICATION',item.id,null,{recipient_user_id:req.user.sub,event_type:item.type,occurrence_id:item.entity_id,event_id:item.event_id});
  res.json({ok:true});
});
app.post('/api/notificacoes/:id/lida',auth,(req,res)=>{
  if(req.user.role==='CLIENT')return deny(res,403,'Você não tem permissão para realizar esta operação.','CLIENT_PORTAL_ONLY');
  const before=one("SELECT id,type,entity_id,event_id,read_at FROM notifications WHERE id=? AND tenant_id=? AND COALESCE(recipient_user_id,user_id)=?",req.params.id,req.user.tenant_id,req.user.sub);
  const result=exec("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND COALESCE(recipient_user_id,user_id)=?",req.params.id,req.user.tenant_id,req.user.sub);
  if(!result.changes)return res.status(404).json({error:'NOT_FOUND'});
  if(before&&!before.read_at&&String(before.type||'').startsWith('PROCESS_'))audit(req,'PROCESS_NOTIFICATION_READ','NOTIFICATION',before.id,null,{recipient_user_id:req.user.sub,event_type:before.type,occurrence_id:before.entity_id,event_id:before.event_id});
  res.json({ok:true});
});
app.get('/api/client/notificacoes',auth,requireClient,requireClientCompany,(req,res)=>{const data=listNotifications(req,true);res.json(data.items)});
app.patch('/api/client/notificacoes/:id/lida',auth,requireClient,requireClientCompany,(req,res)=>{const result=exec("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND company_id=? AND COALESCE(recipient_user_id,user_id)=?",req.params.id,req.user.tenant_id,clientCompanyId(req),req.user.sub);if(!result.changes)return res.status(404).json({error:'NOT_FOUND'});res.json({ok:true})});
app.get('/api/auditoria',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>res.json(qRows('SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 500',req.user.tenant_id)));
app.get('/api/webhooks/whatsapp',(req,res)=>{const challenge=comms.verifyChallenge(req.query);if(challenge==null)return res.status(403).json({error:'FORBIDDEN'});res.status(200).type('text/plain').send(challenge)});
app.post('/api/webhooks/whatsapp',rateWebhook,(req,res)=>{
  const raw=req.rawBody||Buffer.from(JSON.stringify(req.body||{}));
  if(!comms.verifyWebhookSignature(raw,req.get('x-hub-signature-256')))return deny(res,401,'Assinatura inválida.','INVALID_SIGNATURE');
  for(const st of comms.parseWebhookPayload(req.body||{}))comms.applyWebhookStatus(st);
  res.json({ok:true});
});
app.get('/api/comunicacoes/config',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>res.json(comms.publicConfig(req.user.tenant_id)));
app.get('/api/comunicacoes/status',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>res.json({status:comms.integrationStatus(req.user.tenant_id),channel:'WHATSAPP',in_app:true}));
app.patch('/api/comunicacoes/config',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{
  delete req.body.tenant_id;
  if(req.body.api_token||req.body.token||req.body.CDS_WHATSAPP_API_TOKEN)return deny(res,400,'O token do WhatsApp é configurado somente no ambiente do servidor.','TOKEN_NOT_ACCEPTED');
  res.json(comms.patchConfig(req.user.tenant_id,req.body,req.user.sub));
});
app.get('/api/configuracoes/comunicacoes/email',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>res.json(publicEmailConfig(req.user.tenant_id)));
app.put('/api/configuracoes/comunicacoes/email',auth,role('OWNER','ACCOUNTANT'),(req,res)=>{
  delete req.body.tenant_id;delete req.body.company_id;
  const tenantId=req.user.tenant_id;
  const requested=String((req.body&&req.body.provider)||'').trim().toLowerCase();
  if(requested==='cds'||requested==='off'){
    const existing=one('SELECT * FROM tenant_email_settings WHERE tenant_id=?',tenantId);
    if(existing)exec('UPDATE tenant_email_settings SET provider=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?',requested,tenantId);
    else exec('INSERT INTO tenant_email_settings(tenant_id,provider,port,from_name,secure) VALUES(?,?,?,?,?)',tenantId,requested,587,'CDS Contábil',0);
    audit(req,existing?'EMAIL_CONFIG_UPDATED':'EMAIL_CONFIG_CREATED','EMAIL_CONFIG',tenantId,null,{provider:requested});
    return res.status(existing?200:201).json(publicEmailConfig(tenantId));
  }
  const cfg=smtpCfgFromInput(tenantId,req.body||{});
  if(!cfg.host||!cfg.user||!cfg.from)return deny(res,400,'Informe servidor, usuário e e-mail remetente.','INVALID_FIELDS');
  if(!Number.isInteger(cfg.port)||cfg.port<1||cfg.port>65535)return deny(res,400,'Informe uma porta SMTP válida.','INVALID_FIELDS');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.from))return deny(res,400,'Informe um e-mail remetente válido.','INVALID_EMAIL');
  const existing=one('SELECT * FROM tenant_email_settings WHERE tenant_id=?',tenantId);
  if(!cfg.password)return deny(res,400,'Informe a credencial SMTP.','CREDENTIAL_REQUIRED');
  const enc=encryptPassword(cfg.password);
  const created=!existing;
  if(existing){
    exec('UPDATE tenant_email_settings SET provider=?,host=?,port=?,username=?,email_from=?,from_name=?,secure=?,password_cipher=?,password_iv=?,password_tag=?,password_salt=?,last_test_status=NULL,last_tested_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?',
      'smtp',cfg.host,cfg.port,cfg.user,cfg.from,cfg.fromName,cfg.secure?1:0,enc.password_cipher,enc.password_iv,enc.password_tag,enc.password_salt,tenantId);
  }else{
    exec('INSERT INTO tenant_email_settings(tenant_id,provider,host,port,username,email_from,from_name,secure,password_cipher,password_iv,password_tag,password_salt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      tenantId,'smtp',cfg.host,cfg.port,cfg.user,cfg.from,cfg.fromName,cfg.secure?1:0,enc.password_cipher,enc.password_iv,enc.password_tag,enc.password_salt);
  }
  audit(req,created?'EMAIL_CONFIG_CREATED':'EMAIL_CONFIG_UPDATED','EMAIL_CONFIG',tenantId,null,{host:cfg.host,port:cfg.port,user:cfg.user,from:cfg.from,fromName:cfg.fromName,hasCredential:true,provider:'smtp'});
  res.status(created?201:200).json(publicEmailConfig(tenantId));
});
app.post('/api/configuracoes/comunicacoes/email/testar',auth,role('OWNER','ACCOUNTANT'),async(req,res)=>{
  delete req.body.tenant_id;
  const cfg=smtpCfgFromInput(req.user.tenant_id,req.body||{});
  const live=cfg.name==='smtp'&&cfg.host&&cfg.password?createEmailProvider(cfg):emailProviderForTenant(req.user.tenant_id);
  const result=await communicationService.verifyEmail(req.user.tenant_id,live);
  const row=one('SELECT tenant_id FROM tenant_email_settings WHERE tenant_id=?',req.user.tenant_id);
  if(row)exec("UPDATE tenant_email_settings SET last_test_status=?,last_tested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?",result.ok?'ok':'failed',req.user.tenant_id);
  audit(req,'EMAIL_CONFIG_TESTED','EMAIL_CONFIG',req.user.tenant_id,null,{ok:!!result.ok,status:result.status});
  if(result.ok)return res.json({ok:true,message:'Conexão com o servidor de e-mail realizada com sucesso.',...publicEmailConfig(req.user.tenant_id)});
  if(result.code==='EMAIL_AUTH_FAILED')return deny(res,422,result.message||'A credencial SMTP foi recusada. Verifique usuário e senha.','EMAIL_AUTH_FAILED');
  return deny(res,422,result.message||'Não foi possível conectar ao servidor de e-mail. Verifique as configurações.','EMAIL_VERIFY_FAILED');
});
app.post('/api/configuracoes/comunicacoes/email/teste',auth,role('OWNER','ACCOUNTANT'),async(req,res)=>{
  delete req.body.tenant_id;
  const to=String(req.body.to||req.body.email||'').trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))return deny(res,400,'Informe um destinatário válido.','INVALID_EMAIL');
  const result=await communicationService.sendTestEmail({tenantId:req.user.tenant_id,userId:req.user.sub,to,provider:emailProviderForTenant(req.user.tenant_id)});
  audit(req,'EMAIL_TEST_SENT','EMAIL_CONFIG',req.user.tenant_id,null,{ok:!!result.email_sent,to_domain:to.split('@')[1]||null});
  if(result.email_sent)return res.json({ok:true,message:result.message});
  if(result.status==='not_configured')return deny(res,400,result.message||'Salve a configuração de e-mail antes de enviar um teste.','EMAIL_NOT_CONFIGURED');
  return deny(res,422,result.message||'Não foi possível enviar o e-mail de teste. Verifique a configuração de envio.','EMAIL_TEST_FAILED');
});
app.get('/api/comunicacoes/jobs',auth,role('OWNER','ACCOUNTANT','STAFF'),(req,res)=>{
  const p=[req.user.tenant_id];
  let where='j.tenant_id=?';
  if(req.query.status){where+=' AND j.status=?';p.push(String(req.query.status).toUpperCase())}
  const total=one(`SELECT COUNT(*) n FROM communication_jobs j WHERE ${where}`,...p).n;
  const {page,page_size,offset}=pageParams(req,25);
  const items=qRows(`SELECT j.id,j.tenant_id,j.company_id,j.event_id,j.recipient_user_id,j.channel,j.destination,j.template_key,j.event_type,j.provider,j.status,j.attempts,j.last_error,j.provider_message_id,j.created_at,j.sent_at,j.delivered_at,j.failed_at,u.name recipient_name,u.email recipient_email FROM communication_jobs j LEFT JOIN users u ON u.id=j.recipient_user_id WHERE ${where} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,...p,page_size,offset);
  res.json(paged(items,total,page,page_size));
});
function captureCreateTx(req,type){let captured=null;const fake={status(s){this._s=s;return this},json(p){captured={status:this._s||200,data:p};return captured}};createTx(req,fake,type);return captured||{status:500,data:{error:'IMPORT_FAILED'}}}
app.get('/api/importacoes',auth,requireOffice,scope,(req,res)=>{
  const sc=scopedCompanyWhere(req,'m');let{where,p}=sc;
  if(req.query.status){where+=' AND m.status=?';p.push(String(req.query.status).toUpperCase())}
  if(req.query.origin){where+=' AND m.origin=?';p.push(String(req.query.origin).toUpperCase())}
  const total=one(`SELECT COUNT(*) n FROM movement_imports m WHERE ${where}`,...p).n;
  const {page,page_size,offset}=pageParams(req,25);
  const items=qRows(`SELECT m.*,c.name company_name FROM movement_imports m JOIN companies c ON c.id=m.company_id WHERE ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,...p,page_size,offset).map(publicImport);
  res.json(paged(items,total,page,page_size));
});
app.post('/api/importacoes',auth,role('OWNER','ACCOUNTANT','STAFF'),scope,(req,res)=>{
  delete req.body.tenant_id;
  if(req.companyScope)req.body.company_id=req.companyScope;
  const companyId=req.body.company_id;
  const origin=origens.normalize(req.body.origin,'');
  if(!origens.IMPORT_ORIGINS.has(origin))return deny(res,400,'Informe a origem da importação (Importação Contábil, Importação Fiscal ou CDS Sistemas).','INVALID_ORIGIN');
  if(!companyId)return deny(res,400,'Informe a empresa.','COMPANY_REQUIRED');
  const companyRow=one('SELECT id,status FROM companies WHERE tenant_id=? AND id=?',req.user.tenant_id,companyId);
  if(!companyRow)return deny(res,404,'Empresa não encontrada.','COMPANY_NOT_FOUND');
  if(!companyOk(req,companyId))return deny(res,403,'Você não tem permissão para realizar esta operação.','COMPANY_FORBIDDEN');
  if(companyRow.status!=='ACTIVE')return deny(res,409,'Esta empresa está bloqueada ou indisponível.','COMPANY_UNAVAILABLE');
  const movements=Array.isArray(req.body.movements)?req.body.movements:[];
  if(!movements.length)return deny(res,400,'Informe as movimentações a importar.','INVALID_FIELDS');
  if(movements.length>500)return deny(res,400,'Limite de 500 movimentações por importação.','TOO_MANY_ROWS');
  const period_start=today(req.body.period_start)?req.body.period_start:null;
  const period_end=today(req.body.period_end)?req.body.period_end:null;
  const jobId=id();
  exec('INSERT INTO movement_imports(id,tenant_id,company_id,origin,period_start,period_end,status,total_rows,imported_rows,rejected_rows,issues_json,source_file,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',jobId,req.user.tenant_id,companyId,origin,period_start,period_end,origens.IMPORT_STATUS.PROCESSANDO,movements.length,0,0,'[]',req.body.source_file||null,req.user.sub);
  audit(req,'IMPORT_CREATED','IMPORT',jobId,null,{origin,company_id:companyId,total_rows:movements.length});
  emitFromReq(req,EVENT_TYPES.IMPORT_CREATED,{companyId,entityType:'import',entityId:jobId,payload:{description:origens.label(origin)+' · '+movements.length+' registros',status:origens.IMPORT_STATUS.PROCESSANDO,total_rows:movements.length}});
  const issues=[];let imported=0;
  const prevBody=req.body;
  for(const [i,mv] of movements.entries()){
    const type=String(mv.type||mv.source_type||'').toUpperCase()==='REVENUE'?'REVENUE':'EXPENSE';
    req.body={company_id:companyId,occurred_on:mv.occurred_on,description:mv.description,amount:mv.amount,payment_method:mv.payment_method,receipt_method:mv.receipt_method,bank_id:mv.bank_id||null,category_id:mv.category_id||null,notes:mv.notes||null,document_id:mv.document_id||null,origin,import_id:jobId};
    const result=captureCreateTx(req,type);
    if(!result||result.status>=400){issues.push({row:i+1,reason:(result&&result.data&&(result.data.message||result.data.error))||'Falha ao importar'});continue}
    imported++;
  }
  req.body=prevBody;
  const rejected=movements.length-imported;
  const status=!imported&&rejected?origens.IMPORT_STATUS.ERRO:(rejected?origens.IMPORT_STATUS.CONCLUIDA_COM_ERROS:origens.IMPORT_STATUS.CONCLUIDA);
  exec('UPDATE movement_imports SET status=?,imported_rows=?,rejected_rows=?,issues_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?',status,imported,rejected,JSON.stringify(issues.slice(0,200)),jobId,req.user.tenant_id);
  audit(req,status===origens.IMPORT_STATUS.ERRO?'IMPORT_FAILED':'IMPORT_COMPLETED','IMPORT',jobId,null,{status,imported_rows:imported,rejected_rows:rejected});
  emitFromReq(req,status===origens.IMPORT_STATUS.ERRO?EVENT_TYPES.IMPORT_FAILED:EVENT_TYPES.IMPORT_COMPLETED,{companyId,entityType:'import',entityId:jobId,payload:{description:imported+' movimentações',status,imported_rows:imported,total_rows:movements.length,note:issues[0]&&issues[0].reason}});
  const row=one('SELECT m.*,c.name company_name FROM movement_imports m JOIN companies c ON c.id=m.company_id WHERE m.id=? AND m.tenant_id=?',jobId,req.user.tenant_id);
  res.status(status===origens.IMPORT_STATUS.ERRO?422:201).json(publicImport(row));
});
// DASHBOARD
app.get('/api/dashboard',auth,scope,(req,res)=>sendOfficeDashboard(req,res,{one,qRows,today,origens,staffVisibleCompanySql,portfolioAggregates}));
// EXPORTS — adapters (Domínio layout 11758 + CSV canônico para demais destinos)
const exportRouteDeps={db,id,auth,role,scope,deny,audit,companyOk,today,pageParams,paged,scopedCompanyWhere,exportDir:EXPORT,periodService:accountingPeriodService};
const exportService=mountExportRoutes(app,exportRouteDeps);
mountAccountingPeriodRoutes(app,{db,id,auth,role,scope,deny,audit,companyOk,pageParams,paged,mappings:exportService.mappings||accountMappings});
app.get('/api/client/relatorios',auth,requireClient,requireClientCompany,(req,res)=>{const companyId=clientCompanyId(req),tenantId=req.user.tenant_id;const expenses=one('SELECT COALESCE(SUM(amount_cents),0) n FROM expenses WHERE tenant_id=? AND company_id=?',tenantId,companyId).n;const revenues=one('SELECT COALESCE(SUM(amount_cents),0) n FROM revenues WHERE tenant_id=? AND company_id=?',tenantId,companyId).n;res.json({company:req.clientCompany,expenses_cents:expenses,revenue_cents:revenues,balance_cents:revenues-expenses})});
const processService=mountProcessRoutes(app,{db,id,auth,role,scope,deny,audit,emitEvent,companyVisibleToUser,pageParams,paged});
const documentIntelligence=mountDocumentIntelligenceRoutes(app,{db,id,auth,role,scope,deny,companyOk,documentAccess,documentStorage,auditSystem});
aiCredentialService=mountAiCredentialRoutes(app,{
  db,id,auth,role,deny,auditSystem,config,
  testConnection:(opts)=>aiCredentialTestHook(opts),
  onCredentialChanged:refreshAccountingAIProvider
});
try{refreshAccountingAIProvider()}catch(e){
  if(config.IS_PROD){console.error(e);process.exit(1)}
  console.warn('ai_provider_boot_skipped',e&&e.message);
}
const aiControlService=mountAiControlRoutes(app,{db,id,auth,role,deny,auditSystem,config,credentialService:aiCredentialService});
accountingAIService=mountAccountingAIRoutes(app,{db,id,auth,role,scope,deny,companyOk,documentAccess,provider:configuredAccountingAIProvider,auditSystem,aiControl:aiControlService});
if(documentIntelligence&&documentIntelligence.service&&documentIntelligence.service.setVisualAi){
  function documentVisualStatus(tenantId){
    const configured=!!(accountingAIService&&accountingAIService.providerInfo().configured);
    if(!configured)return{available:false,reason:'AI_NOT_CONFIGURED'};
    if(!aiControlService)return{available:true,reason:null};
    const gate=aiControlService.availability(tenantId);
    if(gate.available)return{available:true,reason:null};
    return{available:false,reason:gate.reason||'AI_DISABLED'};
  }
  documentIntelligence.service.setVisualAi({
    status:documentVisualStatus,
    available(tenantId){return documentVisualStatus(tenantId).available;},
    interpret(input){return accountingAIService.interpretVisual(input);}
  });
}
documentPipelineService=mountDocumentPipelineRoutes(app,{
  db,id,auth,role,scope,deny,audit,companyOk,storage:documentStorage,
  extractionService:documentIntelligence.service,
  classify,assertPostableAccount,validateAccountingSemantics,
  auditSystem,emitEvent,EVENT_TYPES,accountingPeriodService,accountingAIService,
  aiControlService
});
smartExpenseService=mountSmartExpenseRoutes(app,{db,id,auth,role,scope,deny,companyOk,documentAccess,auditSystem,extractionService:documentIntelligence.service,accountingAIService,classify,config,requireClient,requireClientCompany,clientCompanyId,aiControl:aiControlService});
const pushService=mountPushRoutes(app,{db,id,auth,role,deny,audit,config});
const notificationService=createNotificationService({
  db,id,pushService,realtime:realtimeHub,
  auditSystem:({tenantId,userId,action,entityType,entityId,after})=>{
    try{auditSystem(tenantId,userId,action,entityType,entityId,after)}catch{/* best-effort */}
  }
});
notificationCenter.service=notificationService;
mountNotificationRoutes(app,{
  auth,role,deny,audit,notificationService,pushService,
  requireOffice,requireClient,requireClientCompany,clientCompanyId
});
mountRealtimeRoutes(app,{auth,deny,jwt,SECRET,sessions});
const requestService=mountRequestRoutes(app,{
  db,id,auth,role,scope,deny,audit,emitEvent,emitFromReq,EVENT_TYPES,
  companyOk,companyVisibleToUser,pageParams,paged,scopedCompanyWhere,one,qRows,exec,
  requireClient,requireClientCompany,clientCompanyId,pushService,notificationService
});
app.get('/api/invitations/:token',(req,res)=>{
  const i=one('SELECT i.*,c.name company_name,c.status company_status,t.name tenant_name,u.name user_name FROM client_invitations i JOIN companies c ON c.id=i.company_id JOIN tenants t ON t.id=i.tenant_id JOIN users u ON u.id=i.user_id WHERE i.token_hash=?',tokenHash(req.params.token));
  if(!i)return deny(res,404,'Não foi possível validar este convite.','INVITATION_NOT_FOUND');
  const purpose=i.purpose||'ACTIVATION';
  if(purpose!=='ACTIVATION'&&purpose!=='PASSWORD_RESET')return res.status(410).json({error:'INVITATION_UNAVAILABLE',message:'Este link de acesso expirou ou já foi utilizado.',invitation:invitationView(i)});
  if(i.status==='PENDING'&&new Date(i.expires_at)<=new Date()){exec("UPDATE client_invitations SET status='EXPIRED' WHERE id=?",i.id);i.status='EXPIRED'}
  if(i.status!=='PENDING')return res.status(410).json({error:'INVITATION_UNAVAILABLE',message:invitationMessage(i.status,purpose),invitation:invitationView(i)});
  if(i.company_status!=='ACTIVE')return res.status(403).json({error:'COMPANY_UNAVAILABLE',message:'Este convite não está mais disponível.',invitation:invitationView(i)});
  const isReset=purpose==='PASSWORD_RESET';
  res.json({...invitationView(i),title:isReset?'Crie sua nova senha':'Ative seu acesso',message:isReset?'Crie sua nova senha':'Ative seu acesso'});
});
app.post('/api/invitations/:token/accept',(req,res)=>{
  const i=one('SELECT i.*,c.name company_name,c.status company_status,t.name tenant_name,u.name user_name,u.active FROM client_invitations i JOIN companies c ON c.id=i.company_id JOIN tenants t ON t.id=i.tenant_id JOIN users u ON u.id=i.user_id WHERE i.token_hash=?',tokenHash(req.params.token));
  if(!i)return deny(res,404,'Não foi possível validar este convite.','INVITATION_NOT_FOUND');
  const purpose=i.purpose||'ACTIVATION';
  if(purpose!=='ACTIVATION'&&purpose!=='PASSWORD_RESET')return res.status(410).json({error:'INVITATION_UNAVAILABLE',message:'Este link de acesso expirou ou já foi utilizado.'});
  if(i.status==='PENDING'&&new Date(i.expires_at)<=new Date()){exec("UPDATE client_invitations SET status='EXPIRED' WHERE id=?",i.id);i.status='EXPIRED'}
  if(i.status!=='PENDING')return res.status(410).json({error:'INVITATION_UNAVAILABLE',message:invitationMessage(i.status,purpose)});
  if(i.company_status!=='ACTIVE')return deny(res,403,'Este convite não está mais disponível.','COMPANY_UNAVAILABLE');
  const password=String(req.body.password||''),confirmation=String(req.body.confirmation||req.body.password_confirmation||'');
  const pw=passwordPolicyError(password);
  if(pw||password!==confirmation)return deny(res,400,'A senha deve ter no mínimo 8 caracteres, com letras e números, e as confirmações devem coincidir.','INVALID_PASSWORD');
  const name=String(req.body.name||i.user_name).trim();
  const isReset=purpose==='PASSWORD_RESET';
  db.transaction(()=>{
    exec('UPDATE users SET name=?,password_hash=?,active=1,pin_hash=NULL,pin_configured_at=NULL,pin_setup_required=1 WHERE id=? AND tenant_id=? AND company_id=?',name,bcrypt.hashSync(password,12),i.user_id,i.tenant_id,i.company_id);
    exec("UPDATE client_invitations SET status='ACCEPTED',accepted_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'",i.id);
    exec('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_json) VALUES(?,?,?,?,?,?,?)',id(),i.tenant_id,i.user_id,'CLIENT_INVITATION_ACCEPTED','INVITATION',i.id,JSON.stringify({user_id:i.user_id,purpose}));
    exec('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)',id(),i.tenant_id,i.user_id,'USER_ACTIVATED','USER',i.user_id);
    exec('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_json) VALUES(?,?,?,?,?,?,?)',id(),i.tenant_id,i.user_id,isReset?'CLIENT_PASSWORD_DEFINED':'CLIENT_PASSWORD_CREATED','USER',i.user_id,JSON.stringify({result:'ok',purpose}));
    exec('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)',id(),i.tenant_id,i.user_id,'PASSWORD_CREATED','USER',i.user_id);
    if(isReset)exec('INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_json) VALUES(?,?,?,?,?,?,?)',id(),i.tenant_id,i.user_id,'PIN_RESET','USER',i.user_id,JSON.stringify({result:'ok',method:'PASSWORD_RESET'}));
  })();
  if(isReset){
    try{
      const completedAt=new Date().toISOString();
      markPasswordResetRequestNotifications(i.tenant_id,i.user_id,{read:true});
      auditSystem(i.tenant_id,i.user_id,'PASSWORD_RESET_COMPLETED','USER',i.user_id,{
        company_id:i.company_id,tenant_id:i.tenant_id,client_user_id:i.user_id,user_id:i.user_id,
        invitation_id:i.id,method:'EMAIL',status:'CONCLUIDA',
        requested_at:i.created_at||null,completed_at:completedAt
      });
      emitEvent({
        tenantId:i.tenant_id,
        companyId:i.company_id,
        eventType:EVENT_TYPES.PASSWORD_RESET_COMPLETED,
        actorUserId:i.user_id,
        entityType:'client_user',
        entityId:i.user_id,
        payload:{
          user_name:i.user_name,
          user_email:i.email,
          target_user_id:i.user_id,
          reference_type:'CLIENT_USER',
          title:i.company_name,
          method:'EMAIL',
          status:'CONCLUIDA',
          invitation_id:i.id,
          requested_at:i.created_at||null,
          completed_at:completedAt
        }
      });
    }catch(err){console.error('password_reset_completed_notify',String(err&&err.message||err).slice(0,200))}
  }
  const profile=one('SELECT profile FROM client_user_profiles WHERE user_id=?',i.user_id)?.profile||'CLIENT_VIEWER';
  const fresh=one('SELECT * FROM users WHERE id=?',i.user_id);
  const token=issueToken(fresh,profile);
  const pinState=pinAuth.publicPinState(fresh);res.json({message:isReset?'Senha criada com sucesso.':'Conta ativada com sucesso',token,redirect:'/portal/',pin_configured:pinState.pin_configured,requires_pin_setup:pinState.requires_pin_setup,user:{id:i.user_id,role:'CLIENT',profile,company_id:i.company_id,tenant_id:i.tenant_id,pin_configured:pinState.pin_configured,requires_pin_setup:pinState.requires_pin_setup}});
});
app.get('/',(req,res,next)=>{if(!isClientFront(req))return next();res.set('Cache-Control','no-store');res.sendFile(path.join(PUBLIC,'portal','index.html'))});
app.get(['/portal','/portal/'],(req,res)=>{res.set('Cache-Control','no-store');res.sendFile(path.join(PUBLIC,'portal','index.html'))});
app.get('/convite/:token',(req,res)=>{res.set('Cache-Control','no-store');res.sendFile(path.join(PUBLIC,'convite.html'))});
app.get('/ativar-escritorio/:token',(req,res)=>{res.set('Cache-Control','no-store');res.sendFile(path.join(PUBLIC,'ativar-escritorio.html'))});
app.use((req,res,next)=>{if(/\.(html)$/i.test(req.path)||req.path==='/')res.set('Cache-Control','no-store');else if(/\.(js|css)$/i.test(req.path))res.set('Cache-Control','no-cache, must-revalidate');next()});
app.use('/portal',express.static(path.join(PUBLIC,'portal'),{setHeaders:(res,filePath)=>{if(String(filePath).endsWith('.webmanifest'))res.setHeader('Content-Type','application/manifest+json; charset=utf-8')}}));
app.use(express.static(PUBLIC,{setHeaders:(res,filePath)=>{if(String(filePath).endsWith('.webmanifest'))res.setHeader('Content-Type','application/manifest+json; charset=utf-8')}}));
app.get('/*splat',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'NOT_FOUND'});res.set('Cache-Control','no-store');res.sendFile(path.join(PUBLIC,'index.html'))});
app.use((err,req,res,next)=>{if(err&&err.code==='LIMIT_FILE_SIZE')return deny(res,413,'O arquivo excede o tamanho máximo permitido.','FILE_TOO_LARGE');console.error(err);res.status(500).json({error:'INTERNAL_ERROR',message:'Não foi possível concluir esta operação.'})});
function runProcessRecurrenceScheduler(){try{const now=new Date();const result=processService.recurrence.runDue(now);const overdue=processService.events.scanOverdue(now);if(result.created)console.log('process_recurrence_generated',result.created);if(overdue.notified)console.log('process_overdue_notifications',overdue.notified);if(result.errors.length)console.warn('process_recurrence_errors',result.errors)}catch(e){console.error('process_recurrence_scheduler_error',e.message)}}
if(require.main===module&&process.env.CDS_PROCESS_SCHEDULER!=='off'){const interval=Math.max(60000,Number(process.env.CDS_PROCESS_SCHEDULER_MS||300000));setImmediate(runProcessRecurrenceScheduler);setInterval(runProcessRecurrenceScheduler,interval).unref()}
if(require.main===module){
  const NETWORK_MODE=config.NETWORK_MODE||'local';
  const HOST=listenHost(NETWORK_MODE);
  const onListen=()=>{
    if(NETWORK_MODE==='lan'){
      console.log(formatLanBanner({port:PORT,clientPort:CLIENT_PORT,ips:listPrivateIPv4()}));
    }else{
      console.log(`Escritório (contador): http://localhost:${PORT}/`);
      if(CLIENT_PORT>0&&CLIENT_PORT!==PORT){
        console.log(`Portal do cliente:     http://localhost:${CLIENT_PORT}/`);
        console.log(`(O escritório NÃO é o portal — use a porta ${PORT} para o contador.)`);
      }else{
        console.log(`Portal do cliente:     http://localhost:${PORT}/portal/`);
      }
    }
  };
  const startErr=(err)=>{
    if(err){
      if(err.code==='EADDRINUSE'){
        console.error(`A porta ${PORT} já está em uso. Abra http://localhost:${PORT} — o servidor anterior continua no ar.`);
        process.exit(1);
      }
      console.error(err);
      process.exit(1);
    }
    onListen();
    if(CLIENT_PORT>0&&CLIENT_PORT!==PORT){
      const clientListen=HOST?app.listen(CLIENT_PORT,HOST,err2=>{
        if(err2){
          if(err2.code==='EADDRINUSE')console.error(`Portal do cliente: use http://localhost:${PORT}/portal/ (porta ${CLIENT_PORT} ocupada).`);
          else console.error(err2);
          return;
        }
        markClientFrontPort(clientListen.address().port);
      }):app.listen(CLIENT_PORT,err2=>{
        if(err2){
          if(err2.code==='EADDRINUSE')console.error(`Portal do cliente: use http://localhost:${PORT}/portal/ (porta ${CLIENT_PORT} ocupada).`);
          else console.error(err2);
          return;
        }
        markClientFrontPort(clientListen.address().port);
      });
    }
    if(process.env.CDS_COMMS_WORKER!=='off'){
      setInterval(()=>{comms.processDueJobs(10,'proc-'+process.pid).catch(()=>{})},2000).unref();
    }
  };
  if(HOST)app.listen(PORT,HOST,startErr);
  else app.listen(PORT,startErr);
}
module.exports={app,db,config,documentStorage,documentAccess,documentIntelligence,accountingAIService,smartExpenseService,aiControlService,aiCredentialService,setAccountingAIProvider,refreshAccountingAIProvider,setAiCredentialTestConnection,sessions,emitEvent,EVENT_TYPES,setCnpjProvider,setCepProvider,setEmailProvider,setSmtpHooks,cnpjNorm,setWhatsAppProvider,processCommunicationJobs:(n,w)=>comms.processDueJobs(n,w),communicationEngine:comms,communicationService,origens,documentOwnership,markClientFrontPort,entryStates,postingService,validateAccountingSemantics,processService,exportService,accountingPeriodService,documentPipelineService,pushService,notificationService,chartParser,chartService};
