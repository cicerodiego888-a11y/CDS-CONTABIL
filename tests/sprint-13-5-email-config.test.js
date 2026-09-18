'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s135-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-5-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
process.env.CDS_EMAIL_HOST='';
process.env.CDS_EMAIL_USER='';
process.env.CDS_EMAIL_PASSWORD='';
process.env.CDS_EMAIL_FROM='';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,setEmailProvider,setSmtpHooks}=require('../backend/src/server');
const {createEmailProvider,MSG_NOT_CONFIGURED}=require('../backend/src/email/provider');
const {decryptPassword}=require('../backend/src/email/credential');

const SECRET='SmtpTenantSecret99';
const password='Senha@123';
const emailBody={provider:'smtp',host:'smtp.gmail.com',port:587,user:'cdscontabil@gmail.com',from:'cdscontabil@gmail.com',fromName:'CDS Contábil',password:SECRET};

let server,base,ownerA,ownerB,staffA,accA,slugA,companyA,clientAdmin,clientFinance,clientViewer;

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data,raw:JSON.stringify(data)};
  });
}
function noSecret(value){
  const s=typeof value==='string'?value:JSON.stringify(value);
  assert.doesNotMatch(s,new RegExp(SECRET));
  assert.doesNotMatch(s,/"password"\s*:/);
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 135 A',email:'owner.a.s135@test.local',password,tenantName:'Tenant 135 A'});
  slugA=a.data.tenant_slug;
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s135@test.local',password,tenant:slugA})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 135 B',email:'owner.b.s135@test.local',password,tenantName:'Tenant 135 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s135@test.local',password,tenant:b.data.tenant_slug})).data;
  accA=(await req('POST','/api/usuarios',{name:'Contador 135',email:'acc.s135@test.local',password,role:'ACCOUNTANT'},ownerA.token)).data;
  staffA=(await req('POST','/api/usuarios',{name:'Staff 135',email:'staff.s135@test.local',password,role:'STAFF'},ownerA.token)).data;
  staffA=(await req('POST','/api/auth/login',{email:'staff.s135@test.local',password,tenant:slugA})).data;
  accA=(await req('POST','/api/auth/login',{email:'acc.s135@test.local',password,tenant:slugA})).data;
  companyA=(await req('POST','/api/empresas',{name:'Pastelaria do Cheff',trade_name:'PASTELARIA DO CHEFF',cnpj:'38204469000115'},ownerA.token)).data;
  const ca=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Admin Cliente',email:'client.admin.s135@test.local',profile:'CLIENT_ADMIN'},ownerA.token);
  const cf=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Fin Cliente',email:'client.fin.s135@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const cv=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'View Cliente',email:'client.view.s135@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  const accept=async(created,email)=>{
    const tok=created.data.invitation.activation_url.split('/convite/')[1];
    const acc=await req('POST','/api/invitations/'+tok+'/accept',{name:email,password,confirmation:password});
    return acc.data.token;
  };
  clientAdmin=await accept(ca,'Admin Cliente');
  clientFinance=await accept(cf,'Fin Cliente');
  clientViewer=await accept(cv,'View Cliente');
});
after(()=>{
  setSmtpHooks(null);
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1 GET sem configuração',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.configured,false);
  assert.equal(r.data.status,'not_configured');
  assert.equal(r.data.hasCredential,false);
  noSecret(r.data);
});

test('4 PUT cria configuração',async()=>{
  const r=await req('PUT','/api/configuracoes/comunicacoes/email',emailBody,ownerA.token);
  assert.equal(r.status,201,r.raw);
  assert.equal(r.data.host,'smtp.gmail.com');
  assert.equal(r.data.from,'cdscontabil@gmail.com');
  assert.equal(r.data.hasCredential,true);
  noSecret(r.data);
});

test('2 GET com configuração',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.configured,true);
  assert.equal(r.data.source,'tenant');
  assert.equal(r.data.user,'cdscontabil@gmail.com');
  noSecret(r.data);
});

test('3 GET nunca retorna senha',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.data.password,undefined);
  assert.equal(r.data.credential,undefined);
  assert.equal(r.data.password_cipher,undefined);
  noSecret(r.raw);
});

test('5 PUT atualiza configuração',async()=>{
  const r=await req('PUT','/api/configuracoes/comunicacoes/email',{...emailBody,fromName:'CDS Contábil Connect',password:SECRET},ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.fromName,'CDS Contábil Connect');
  noSecret(r.data);
});

test('6 credencial é protegida',()=>{
  const row=db.prepare('SELECT * FROM tenant_email_settings WHERE tenant_id=?').get(ownerA.user.tenant_id);
  assert.ok(row.password_cipher);
  assert.notEqual(row.password_cipher,SECRET);
  assert.notEqual(decryptPassword(row),row.password_cipher);
  assert.equal(decryptPassword(row),SECRET);
});

test('7 atualização sem nova senha preserva credencial',async()=>{
  const r=await req('PUT','/api/configuracoes/comunicacoes/email',{host:'smtp.gmail.com',port:587,user:'cdscontabil@gmail.com',from:'cdscontabil@gmail.com',fromName:'CDS Contábil'},ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.hasCredential,true);
  const row=db.prepare('SELECT * FROM tenant_email_settings WHERE tenant_id=?').get(ownerA.user.tenant_id);
  assert.equal(decryptPassword(row),SECRET);
  noSecret(r.data);
});

test('8 configuração persistida tem precedência sobre .env',async()=>{
  process.env.CDS_EMAIL_PROVIDER='smtp';
  process.env.CDS_EMAIL_HOST='smtp.env.local';
  process.env.CDS_EMAIL_USER='env@test.local';
  process.env.CDS_EMAIL_PASSWORD='EnvSecretShouldNotWin';
  process.env.CDS_EMAIL_FROM='env@test.local';
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.data.source,'tenant');
  assert.equal(r.data.host,'smtp.gmail.com');
  assert.notEqual(r.data.host,'smtp.env.local');
  noSecret(r.data);
});

test('11 Tenant A não acessa configuração de Tenant B',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerB.token);
  assert.equal(r.status,200);
  assert.notEqual(r.data.host,'smtp.gmail.com');
  noSecret(r.data);
});

test('12 Tenant A não altera configuração de Tenant B',async()=>{
  await req('PUT','/api/configuracoes/comunicacoes/email',{...emailBody,host:'smtp.tenant-b.local',from:'b@test.local',user:'b@test.local'},ownerB.token);
  const a=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(a.data.host,'smtp.gmail.com');
});

test('13 teste de conexão com SMTP falso',async()=>{
  setSmtpHooks({verify:async()=>{}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/testar',{},ownerA.token);
  assert.equal(r.status,200,r.raw);
  assert.match(r.data.message,/Conexão com o servidor de e-mail realizada com sucesso/);
  assert.equal(r.data.status,'configured_ok');
});

test('14 falha de conexão',async()=>{
  setSmtpHooks({verify:async()=>{throw new Error('ECONNREFUSED smtp')}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/testar',{},ownerA.token);
  assert.equal(r.status,422);
  assert.match(r.data.message,/Não foi possível conectar ao servidor de e-mail/);
  noSecret(r.data);
});

test('14b Gmail recusa senha de login no SMTP',async()=>{
  setSmtpHooks({verify:async()=>{throw new Error('SMTP 535-5.7.8 Username and Password not accepted')}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/testar',{},ownerA.token);
  assert.equal(r.status,422);
  assert.equal(r.data.error,'EMAIL_AUTH_FAILED');
  assert.match(r.data.message,/senha de app|senha de login/i);
  noSecret(r.data);
});

test('15 e-mail de teste com sucesso',async()=>{
  const sent=[];
  setSmtpHooks({send:async(cfg,mail)=>{sent.push(mail)}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/teste',{to:ownerA.user.email},ownerA.token);
  assert.equal(r.status,200,r.raw);
  assert.match(r.data.message,/E-mail de teste enviado com sucesso/);
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,ownerA.user.email);
  noSecret(sent[0]);
});

test('16 e-mail de teste com falha',async()=>{
  setSmtpHooks({send:async()=>{throw new Error('SMTP 535 '+SECRET)}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/teste',{to:ownerA.user.email},ownerA.token);
  assert.equal(r.status,422);
  assert.match(r.data.message,/credencial SMTP foi recusada|Não foi possível enviar o e-mail de teste|senha de app|senha de login/);
  noSecret(r.data);
});

test('17 destinatário inválido',async()=>{
  const r=await req('POST','/api/configuracoes/comunicacoes/email/teste',{to:'invalido'},ownerA.token);
  assert.equal(r.status,400);
});

test('18 convite usa configuração persistida',async()=>{
  const sent=[];
  setSmtpHooks({send:async(cfg,mail)=>{sent.push({from:cfg.from,to:mail.to})}});
  setEmailProvider(createEmailProvider({name:'off'}));
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Wilian',email:'wilian.s135@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(r.status,201,r.raw);
  assert.equal(r.data.invitation.email_sent,true);
  assert.match(r.data.invitation.message,/Convite enviado com sucesso para wilian.s135@test.local/);
  assert.equal(sent[0].from,'cdscontabil@gmail.com');
  setEmailProvider(null);
});

test('9 .env funciona como fallback',async()=>{
  db.prepare('DELETE FROM tenant_email_settings WHERE tenant_id=?').run(ownerB.user.tenant_id);
  process.env.CDS_EMAIL_PROVIDER='smtp';
  process.env.CDS_EMAIL_HOST='smtp.env.local';
  process.env.CDS_EMAIL_USER='env@test.local';
  process.env.CDS_EMAIL_PASSWORD='EnvFallbackSecret1';
  process.env.CDS_EMAIL_FROM='env@test.local';
  process.env.CDS_EMAIL_FROM_NAME='Env Office';
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerB.token);
  assert.equal(r.status,200);
  assert.equal(r.data.source,'env');
  assert.equal(r.data.host,'smtp.env.local');
  assert.equal(r.data.hasCredential,true);
  assert.equal(r.data.password,undefined);
});

test('19 convite continua funcionando com fallback .env',async()=>{
  db.prepare('DELETE FROM tenant_email_settings WHERE tenant_id=?').run(ownerB.user.tenant_id);
  process.env.CDS_EMAIL_PROVIDER='smtp';
  process.env.CDS_EMAIL_HOST='smtp.env.local';
  process.env.CDS_EMAIL_USER='env@test.local';
  process.env.CDS_EMAIL_PASSWORD='EnvFallbackSecret1';
  process.env.CDS_EMAIL_FROM='env@test.local';
  const sent=[];
  setSmtpHooks({send:async(cfg,mail)=>sent.push({from:cfg.from,to:mail.to})});
  setEmailProvider(null);
  const companyB=(await req('POST','/api/empresas',{name:'Empresa B 135',cnpj:'22333444000172'},ownerB.token)).data;
  const r=await req('POST',`/api/empresas/${companyB.id}/users`,{name:'Beta',email:'beta.s135@test.local',profile:'CLIENT_VIEWER'},ownerB.token);
  assert.equal(r.status,201,r.raw);
  assert.equal(r.data.invitation.email_sent,true);
  assert.equal(sent[0].from,'env@test.local');
});

test('10 persistida ignora .env',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.data.source,'tenant');
  assert.equal(r.data.host,'smtp.gmail.com');
});

test('20 sem configuração continua exibindo estado correto',async()=>{
  const empty=db.prepare('SELECT * FROM tenant_email_settings WHERE tenant_id=?').get(ownerB.user.tenant_id);
  if(empty)db.prepare('DELETE FROM tenant_email_settings WHERE tenant_id=?').run(ownerB.user.tenant_id);
  process.env.CDS_EMAIL_PROVIDER='off';
  process.env.CDS_EMAIL_HOST='';
  process.env.CDS_EMAIL_USER='';
  process.env.CDS_EMAIL_PASSWORD='';
  process.env.CDS_EMAIL_FROM='';
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerB.token);
  assert.equal(r.data.configured,false);
  assert.equal(r.data.status,'not_configured');
});

test('21 nenhuma senha aparece nos logs',async()=>{
  const lines=[];
  const origLog=console.log,origErr=console.error;
  console.log=(...a)=>lines.push(a.map(String).join(' '));
  console.error=(...a)=>lines.push(a.map(String).join(' '));
  try{
    setSmtpHooks({verify:async()=>{throw new Error('auth failed '+SECRET)}});
    await req('POST','/api/configuracoes/comunicacoes/email/testar',{password:SECRET},ownerA.token);
  }finally{
    console.log=origLog;console.error=origErr;
  }
  noSecret(lines.join('\n'));
});

test('22 nenhuma senha aparece nas respostas HTTP',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  noSecret(r.raw);
});

test('23 nenhuma senha aparece nos testes',()=>{
  const r={status:200,data:{host:'smtp.gmail.com',hasCredential:true}};
  noSecret(r);
});

test('24 auditoria de criação',()=>{
  const row=db.prepare("SELECT * FROM audit_logs WHERE tenant_id=? AND action='EMAIL_CONFIG_CREATED'").get(ownerA.user.tenant_id);
  assert.ok(row);
  noSecret(row.after_json||'');
});

test('25 auditoria de atualização',()=>{
  const row=db.prepare("SELECT * FROM audit_logs WHERE tenant_id=? AND action='EMAIL_CONFIG_UPDATED'").get(ownerA.user.tenant_id);
  assert.ok(row);
  noSecret(row.after_json||'');
});

test('26 auditoria de teste',()=>{
  const row=db.prepare("SELECT * FROM audit_logs WHERE tenant_id=? AND action='EMAIL_CONFIG_TESTED'").get(ownerA.user.tenant_id);
  assert.ok(row);
  noSecret(row.after_json||'');
});

test('27 auditoria de envio de teste',()=>{
  const row=db.prepare("SELECT * FROM audit_logs WHERE tenant_id=? AND action='EMAIL_TEST_SENT'").get(ownerA.user.tenant_id);
  assert.ok(row);
  noSecret(row.after_json||'');
});

test('28 configuração não pode ser acessada por CLIENT_ADMIN',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,clientAdmin);
  assert.equal(r.status,403);
});

test('29 configuração não pode ser acessada por CLIENT_FINANCE',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,clientFinance);
  assert.equal(r.status,403);
});

test('30 configuração não pode ser acessada por CLIENT_VIEWER',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,clientViewer);
  assert.equal(r.status,403);
});

test('STAFF visualiza e não grava; ACCOUNTANT grava',async()=>{
  const g=await req('GET','/api/configuracoes/comunicacoes/email',undefined,staffA.token);
  assert.equal(g.status,200);
  const p=await req('PUT','/api/configuracoes/comunicacoes/email',emailBody,staffA.token);
  assert.equal(p.status,403);
  const a=await req('GET','/api/configuracoes/comunicacoes/email',undefined,accA.token);
  assert.equal(a.status,200);
});

test('tela de Comunicações possui aba E-mail',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../frontend/public/assets/app.js'),'utf8');
  assert.match(js,/id="tabEmail">E-mail/);
  assert.match(js,/E-mail do sistema/);
  assert.match(js,/Testar conexão/);
  assert.match(js,/Enviar e-mail de teste/);
  assert.match(js,/Salvar configuração/);
  assert.match(js,/\/configuracoes\/comunicacoes\/email/);
  assert.doesNotMatch(js,new RegExp(SECRET));
});
