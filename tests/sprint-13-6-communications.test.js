'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s136-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-6-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
process.env.CDS_COMMS_WORKER='off';
process.env.CDS_EMAIL_API_URL='';
process.env.CDS_EMAIL_API_KEY='';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,setEmailProvider,setSmtpHooks,communicationService}=require('../backend/src/server');
const {createEmailProvider,MSG_NOT_CONFIGURED}=require('../backend/src/email/provider');
const {createCdsEmailProvider}=require('../backend/src/communications/email/cds-email-provider');
const {createEmailResolver}=require('../backend/src/communications/email/resolver');
const {COMMUNICATION_EVENTS}=require('../backend/src/communications/communication-events');
const {isPermanent}=require('../backend/src/communications/communication-errors');
const templates=require('../backend/src/communications/email/templates');

const SECRET='SmtpMotorSecret136';
const password='Senha@123';
let server,base,ownerA,ownerB,staffA,companyA;

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data,raw:JSON.stringify(data)};
  });
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 136 A',email:'owner.a.s136@test.local',password,tenantName:'Tenant 136 A'});
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s136@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 136 B',email:'owner.b.s136@test.local',password,tenantName:'Tenant 136 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s136@test.local',password,tenant:b.data.tenant_slug})).data;
  await req('POST','/api/usuarios',{name:'Staff 136',email:'staff.s136@test.local',password,role:'STAFF'},ownerA.token);
  staffA=(await req('POST','/api/auth/login',{email:'staff.s136@test.local',password,tenant:a.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Pastelaria 136',cnpj:'38204469000115'},ownerA.token)).data;
});
after(()=>{
  setSmtpHooks(null);
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('CdsEmailProvider não finge envio sem infraestrutura',async()=>{
  const p=createCdsEmailProvider({apiUrl:'',apiKey:''});
  assert.equal(p.getStatus().status,'NOT_CONFIGURED');
  const r=await p.send({to:'a@b.c',subject:'x',text:'t',html:'<p>t</p>'});
  assert.equal(r.accepted,false);
  assert.equal(r.code,'EMAIL_NOT_CONFIGURED');
});

test('resolver: CDS padrão, SMTP só quando explícito, off',()=>{
  const rows=new Map();
  const resolver=createEmailResolver({
    persistedEmailCfg:id=>{const row=rows.get(id);return row&&row.smtp?row.smtp:null},
    getRow:id=>rows.get(id),
    getOverride:()=>null
  });
  assert.equal(resolver.chosenProvider(null),'cds');
  assert.equal(resolver.chosenProvider({provider:'smtp'}),'smtp');
  assert.equal(resolver.chosenProvider({provider:'off'}),'off');
});

test('GET inicial usa provider CDS conceitual sem SMTP obrigatório',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.provider,'cds');
  assert.equal(r.data.configured,false);
  assert.equal(r.data.password,undefined);
  assert.doesNotMatch(r.raw,/CDS_EMAIL_API_KEY|password_cipher/);
});

test('PUT cds não exige servidor SMTP',async()=>{
  const r=await req('PUT','/api/configuracoes/comunicacoes/email',{provider:'cds'},ownerA.token);
  assert.ok([200,201].includes(r.status),r.raw);
  assert.equal(r.data.provider,'cds');
  assert.equal(r.data.configured,false);
});

test('STAFF não grava; CLIENT 403',async()=>{
  assert.equal((await req('PUT','/api/configuracoes/comunicacoes/email',{provider:'cds'},staffA.token)).status,403);
  const login=await req('POST','/api/auth/login',{email:'owner.b.s136@test.local',password,tenant:ownerB.user.tenant_slug});
  assert.equal(login.status,200);
});

test('convite cria job e não finge enviado sem provider',async()=>{
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Wilian 136',email:'wilian.s136@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(r.status,201,r.raw);
  assert.equal(r.data.invitation.email_sent,false);
  assert.equal(r.data.invitation.message,MSG_NOT_CONFIGURED);
  const jobs=db.prepare("SELECT * FROM communication_jobs WHERE tenant_id=? AND channel='EMAIL' AND destination=?").all(ownerA.user.tenant_id,'wilian.s136@test.local');
  assert.ok(jobs.length>=1);
  assert.ok(['FAILED','PENDING'].includes(jobs[0].status));
  assert.ok(jobs[0].event_type==='USER_INVITE'||jobs[0].template_key==='user-invite');
});

test('convite com SMTP aceito gera job ACCEPTED',async()=>{
  const sent=[];
  setEmailProvider(createEmailProvider({send:async mail=>sent.push(mail)}));
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Ana 136',email:'ana.s136@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(r.status,201,r.raw);
  assert.equal(r.data.invitation.email_sent,true);
  assert.equal(sent.length,1);
  const job=db.prepare("SELECT * FROM communication_jobs WHERE tenant_id=? AND destination=? ORDER BY created_at DESC").get(ownerA.user.tenant_id,'ana.s136@test.local');
  assert.equal(job.status,'ACCEPTED');
  setEmailProvider(null);
});

test('reenvio gera novo job',async()=>{
  const u=db.prepare("SELECT id FROM users WHERE email='ana.s136@test.local'").get();
  setEmailProvider(createEmailProvider({send:async()=>{}}));
  const r=await req('POST','/api/client-users/'+u.id+'/resend-invitation',{},ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.email_sent,true);
  const n=db.prepare("SELECT COUNT(*) n FROM communication_jobs WHERE recipient_user_id=? AND channel='EMAIL'").get(u.id).n;
  assert.ok(n>=2);
  setEmailProvider(null);
});

test('tenant B não lê jobs de A',async()=>{
  const a=await req('GET','/api/comunicacoes/jobs?page=1&page_size=100',undefined,ownerA.token);
  const b=await req('GET','/api/comunicacoes/jobs?page=1&page_size=100',undefined,ownerB.token);
  assert.equal(a.status,200);
  assert.equal(b.status,200);
  const idsA=new Set((a.data.items||[]).map(j=>j.id));
  assert.ok(!(b.data.items||[]).some(j=>idsA.has(j.id)));
});

test('SMTP legado continua testável',async()=>{
  const put=await req('PUT','/api/configuracoes/comunicacoes/email',{provider:'smtp',host:'smtp.gmail.com',port:587,user:'cds@test.local',from:'cds@test.local',fromName:'CDS',password:SECRET},ownerA.token);
  assert.ok([200,201].includes(put.status),put.raw);
  assert.equal(put.data.provider,'smtp');
  assert.equal(put.data.password,undefined);
  setSmtpHooks({verify:async()=>{}});
  const v=await req('POST','/api/configuracoes/comunicacoes/email/testar',{},ownerA.token);
  assert.equal(v.status,200,v.raw);
  setSmtpHooks({send:async()=>{}});
  const t=await req('POST','/api/configuracoes/comunicacoes/email/teste',{to:ownerA.user.email},ownerA.token);
  assert.equal(t.status,200,t.raw);
  setSmtpHooks(null);
});

test('retry permanente vs temporário',()=>{
  assert.equal(isPermanent('EMAIL_NOT_CONFIGURED'),true);
  assert.equal(isPermanent('EMAIL_AUTH_FAILED'),true);
  assert.equal(isPermanent('EMAIL_TEMPORARY',true),false);
});

test('eventos e templates centralizados',()=>{
  assert.equal(COMMUNICATION_EVENTS.USER_INVITE,'USER_INVITE');
  const mail=templates.render('user-invite',{name:'Ana',company:'Pastelaria',url:'http://localhost/convite/x',branding:{office_name:'Escritório Demo'}});
  assert.match(mail.html,/Ativar meu acesso/);
  assert.match(mail.html,/Escritório Demo|CDS Contábil/);
  const exp=templates.render('EXPENSE_CREATED',{company:'Pastelaria',branding:{office_name:'Escritório Demo'}});
  assert.match(exp.text,/despesa/i);
});

test('despesa respeita preferência de e-mail desligada',async()=>{
  await req('PUT','/api/notificacoes/preferencias',{items:[{event_type:'EXPENSE_CREATED',in_app_enabled:true,email_enabled:false}]},ownerA.token);
  const before=db.prepare("SELECT COUNT(*) n FROM communication_jobs WHERE tenant_id=? AND channel='EMAIL' AND event_type='EXPENSE_CREATED' AND recipient_user_id=?").get(ownerA.user.tenant_id,ownerA.user.id).n;
  await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-16',description:'Sem e-mail',amount:'10,00',payment_method:'PIX'},ownerA.token);
  const after=db.prepare("SELECT COUNT(*) n FROM communication_jobs WHERE tenant_id=? AND channel='EMAIL' AND event_type='EXPENSE_CREATED' AND recipient_user_id=?").get(ownerA.user.tenant_id,ownerA.user.id).n;
  assert.equal(after,before);
});

test('UI mostra CDS como padrão e SMTP avançado',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../frontend/public/assets/app.js'),'utf8');
  assert.match(js,/Envio pelo CDS/);
  assert.match(js,/Servidor próprio \/ SMTP/);
  assert.match(js,/Não é necessário configurar SMTP/);
  assert.match(js,/Últimos envios/);
  assert.match(js,/ainda não possui um servidor/);
  assert.doesNotMatch(js,new RegExp(SECRET));
});

test('service existe e não loga segredo',async()=>{
  assert.equal(typeof communicationService.deliverInvite,'function');
  const lines=[];
  const orig=console.error;
  console.error=(...a)=>lines.push(a.join(' '));
  try{
    const p=createCdsEmailProvider({apiUrl:'http://127.0.0.1:9/mail',apiKey:SECRET});
    await p.send({to:'a@b.c',subject:'s',text:'t',html:'h'});
  }finally{console.error=orig}
  assert.doesNotMatch(lines.join('\n'),new RegExp(SECRET));
});
