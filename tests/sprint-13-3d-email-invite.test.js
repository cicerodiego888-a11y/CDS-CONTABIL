'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s133d-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-3d-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {createEmailProvider,diagnose,sentMessage,MSG_NOT_CONFIGURED,MSG_FAILED}=require('../backend/src/email/provider');
const {app,db,setEmailProvider}=require('../backend/src/server');

const smtpOk={name:'smtp',host:'smtp.test.local',user:'mailer@test.local',password:'SmtpSecretPass1',from:'nao-responda@test.local'};
let server,base,owner,company,created;
const password='Senha@123';

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 133D',email:'owner.s133d@test.local',password,tenantName:'Tenant 133D'});
  owner=(await req('POST','/api/auth/login',{email:'owner.s133d@test.local',password,tenant:a.data.tenant_slug})).data;
  company=(await req('POST','/api/empresas',{name:'Pastelaria do Cheff',trade_name:'PASTELARIA DO CHEFF',cnpj:'38204469000115'},owner.token)).data;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1 provider smtp configurado',()=>{
  const p=createEmailProvider({...smtpOk});
  assert.equal(p.configured(),true);
  assert.deepEqual(p.diagnose().missing,[]);
});

test('2 provider ausente',()=>{
  const p=createEmailProvider({name:'off',host:'',user:'',password:'',from:''});
  assert.equal(p.configured(),false);
  assert.ok(p.diagnose().missing.includes('provider'));
});

test('3 host ausente',()=>{
  const d=diagnose({name:'smtp',host:'',user:'u',password:'p',from:'a@b.c'});
  assert.equal(d.ok,false);
  assert.ok(d.missing.includes('host'));
});

test('4 user ausente',()=>{
  const d=diagnose({name:'smtp',host:'smtp.test',user:'',password:'p',from:'a@b.c'});
  assert.ok(d.missing.includes('user'));
});

test('5 password ausente',()=>{
  const d=diagnose({name:'smtp',host:'smtp.test',user:'u',password:'',from:'a@b.c'});
  assert.ok(d.missing.includes('password'));
});

test('6 from ausente',()=>{
  const d=diagnose({name:'smtp',host:'smtp.test',user:'u',password:'p',from:''});
  assert.ok(d.missing.includes('from'));
});

test('7 convite criado com envio bem-sucedido',async()=>{
  const sent=[];
  setEmailProvider(createEmailProvider({send:async mail=>sent.push(mail)}));
  const r=await req('POST',`/api/empresas/${company.id}/users`,{name:'Wilian',email:'wilian.s133d@test.local',profile:'CLIENT_ADMIN'},owner.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  created=r.data;
  assert.equal(r.data.invitation.email_sent,true);
  assert.equal(r.data.invitation.message,sentMessage('wilian.s133d@test.local'));
  assert.equal(sent.length,1);
  assert.match(sent[0].html,/Ativar meu acesso/);
});

test('8 erro de SMTP',async()=>{
  setEmailProvider(createEmailProvider({...smtpOk,send:async()=>{throw new Error('SMTP 535 authentication failed '+smtpOk.password)}}));
  const r=await req('POST',`/api/empresas/${company.id}/users`,{name:'Falha SMTP',email:'falha.s133d@test.local',profile:'CLIENT_VIEWER'},owner.token);
  assert.equal(r.status,201);
  assert.equal(r.data.invitation.email_sent,false);
  assert.equal(r.data.invitation.message,MSG_FAILED);
});

test('9 reenvio revoga convite anterior',async()=>{
  const sent=[];
  setEmailProvider(createEmailProvider({send:async mail=>sent.push(mail)}));
  const old=created.invitation.activation_url.split('/convite/')[1];
  const resent=await req('POST','/api/client-users/'+created.user.id+'/resend-invitation',{},owner.token);
  assert.equal(resent.status,200);
  assert.equal(resent.data.email_sent,true);
  const neu=resent.data.activation_url.split('/convite/')[1];
  assert.notEqual(old,neu);
  const stale=await req('GET','/api/invitations/'+old);
  assert.equal(stale.status,410);
  assert.equal(sent.length,1);
});

test('9b salvar usuário pendente envia convite automaticamente',async()=>{
  const sent=[];
  setEmailProvider(createEmailProvider({send:async mail=>sent.push(mail)}));
  const createdUser=await req('POST',`/api/empresas/${company.id}/users`,{
    name:'Auto Save',email:'autosave.s133d@test.local',profile:'CLIENT_VIEWER'
  },owner.token);
  assert.equal(createdUser.status,201,JSON.stringify(createdUser.data));
  sent.length=0;
  const patched=await req('PATCH','/api/client-users/'+createdUser.data.user.id,{
    name:'Auto Save',email:'autosave.novo.s133d@test.local',profile:'CLIENT_VIEWER'
  },owner.token);
  assert.equal(patched.status,200,JSON.stringify(patched.data));
  assert.ok(patched.data.invitation);
  assert.equal(patched.data.invitation.email_sent,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,'autosave.novo.s133d@test.local');
});

test('10 token nunca aparece em resposta de produção',async()=>{
  const prev=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  try{
    const r=await req('POST',`/api/empresas/${company.id}/users`,{name:'Prod',email:'prod.s133d@test.local',profile:'CLIENT_VIEWER'},owner.token);
    assert.equal(r.status,201);
    assert.equal(r.data.invitation.activation_url,undefined);
  }finally{
    process.env.NODE_ENV=prev;
  }
});

test('11 senha SMTP nunca aparece em logs',async()=>{
  const secret='SmtpSecretPass1';
  const lines=[];
  const orig=console.error;
  console.error=(...a)=>{lines.push(a.map(String).join(' '))};
  try{
    const p=createEmailProvider({...smtpOk,send:async()=>{throw new Error('auth failed '+secret)}});
    await p.sendInvitation({to:'x@test.local',name:'X',company:'Y',url:'http://localhost/convite/abc123deadbeef',resend:false});
  }finally{
    console.error=orig;
  }
  const blob=lines.join('\n');
  assert.doesNotMatch(blob,new RegExp(secret));
  assert.doesNotMatch(blob,/abc123deadbeef/);
});

test('12 fluxo de ativação continua funcionando',async()=>{
  setEmailProvider(createEmailProvider({send:async()=>{}}));
  const r=await req('POST',`/api/empresas/${company.id}/users`,{name:'Ativar',email:'ativar.s133d@test.local',profile:'CLIENT_FINANCE'},owner.token);
  const tok=r.data.invitation.activation_url.split('/convite/')[1];
  const ok=await req('POST','/api/invitations/'+tok+'/accept',{name:'Ativar',password,confirmation:password});
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal(ok.data.redirect,'/portal/');
  const login=await req('POST','/api/auth/login',{email:'ativar.s133d@test.local',password,tenant:owner.user.tenant_slug});
  assert.equal(login.status,200);
});

test('mensagem de não configurado permanece correta',async()=>{
  setEmailProvider(createEmailProvider({name:'off'}));
  const r=await req('POST',`/api/empresas/${company.id}/users`,{name:'Sem Mail',email:'sem.s133d@test.local',profile:'CLIENT_VIEWER'},owner.token);
  assert.equal(r.data.invitation.email_sent,false);
  assert.equal(r.data.invitation.message,MSG_NOT_CONFIGURED);
});
