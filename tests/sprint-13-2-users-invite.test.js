'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s132-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-2-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,setEmailProvider}=require('../backend/src/server');
const {invitationEmail}=require('../backend/src/email/template');
const {createEmailProvider}=require('../backend/src/email/provider');

let server,base,ownerA,ownerB,companyA,companyB,pending,sent;
const password='Senha@123';

function req(method,url,body,token,companyId){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(companyId)headers['X-Company-Id']=companyId;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 132 A',email:'owner.a.s132@test.local',password,tenantName:'Tenant 132 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s132@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 132 B',email:'owner.b.s132@test.local',password,tenantName:'Tenant 132 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s132@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Pastelaria do Cheff',trade_name:'PASTELARIA DO CHEFF',cnpj:'38204469000115'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa Beta 132',cnpj:'22333444000172'},ownerA.token)).data;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('template de e-mail de ativação em português',()=>{
  const mail=invitationEmail({name:'Usuário Teste',company:'PASTELARIA DO CHEFF',url:'http://localhost:3333/convite/abc'});
  assert.equal(mail.subject,'Ative seu acesso ao CDS Contábil');
  assert.match(mail.text,/Olá, Usuário Teste/);
  assert.match(mail.text,/PASTELARIA DO CHEFF/);
  assert.match(mail.html,/Ativar meu acesso/);
  assert.doesNotMatch(mail.text,/Senha@/);
});

test('criação de CLIENT gera convite sem senha e usuário pendente',async()=>{
  sent=[];
  setEmailProvider(createEmailProvider({send:async mail=>{sent.push(mail)}}));
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Usuário Teste',email:'user.teste.s132@test.local',profile:'Administrador'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  pending=r.data;
  assert.equal(pending.user.role,'CLIENT');
  assert.equal(pending.user.active,0);
  assert.equal(pending.user.company_id,companyA.id);
  assert.equal(pending.profile,'CLIENT_ADMIN');
  assert.ok(pending.invitation.id);
  assert.ok(pending.invitation.activation_url);
  assert.equal(pending.invitation.email_sent,true);
  assert.equal(sent.length,1);
  assert.match(sent[0].subject,/Ative seu acesso/);
  assert.equal(r.data.user.password,undefined);
  assert.equal(r.data.password,undefined);
  const row=db.prepare('SELECT active,password_hash FROM users WHERE id=?').get(pending.user.id);
  assert.equal(row.active,0);
  assert.ok(row.password_hash);
  const login=await req('POST','/api/auth/login',{email:'user.teste.s132@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(login.status,401);
});

test('provider ausente não finge envio',async()=>{
  setEmailProvider(createEmailProvider({name:'off',host:'',from:''}));
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Sem SMTP',email:'sem.smtp.s132@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(r.status,201);
  assert.equal(r.data.invitation.email_sent,false);
  assert.match(r.data.invitation.message,/não está configurado/);
});

test('falha do provider não impede o cadastro',async()=>{
  setEmailProvider({configured:()=>true,sendInvitation:async()=>{throw new Error('smtp down')}});
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Falha Mail',email:'falha.mail.s132@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.user.company_id,companyA.id);
  assert.equal(r.data.invitation.email_sent,false);
});

test('reenvio invalida convite anterior e chama provider',async()=>{
  sent=[];
  setEmailProvider(createEmailProvider({send:async mail=>{sent.push(mail)}}));
  const old=pending.invitation.activation_url.split('/convite/')[1];
  const resent=await req('POST','/api/client-users/'+pending.user.id+'/resend-invitation',{},ownerA.token);
  assert.equal(resent.status,200);
  assert.equal(resent.data.email_sent,true);
  assert.match(resent.data.message,/Convite enviado com sucesso para user\.teste\.s132@test\.local/);
  const neu=resent.data.activation_url.split('/convite/')[1];
  assert.notEqual(old,neu);
  const stale=await req('GET','/api/invitations/'+old);
  assert.equal(stale.status,410);
  assert.equal(sent.length,1);
});

test('token válido permite ativação com senha do usuário',async()=>{
  const tok= (await req('POST','/api/client-users/'+pending.user.id+'/resend-invitation',{},ownerA.token)).data.activation_url.split('/convite/')[1];
  const bad=await req('POST','/api/invitations/'+tok+'/accept',{name:'Usuário Teste',password,confirmation:'outra'});
  assert.equal(bad.status,400);
  const ok=await req('POST','/api/invitations/'+tok+'/accept',{name:'Usuário Teste',password,confirmation:password});
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal(ok.data.redirect,'/portal/');
  const row=db.prepare('SELECT active FROM users WHERE id=?').get(pending.user.id);
  assert.equal(row.active,1);
  const audit=db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='USER_ACTIVATED' AND entity_id=?").get(pending.user.id);
  assert.ok(audit.n>=1);
  const reuse=await req('POST','/api/invitations/'+tok+'/accept',{name:'Usuário Teste',password,confirmation:password});
  assert.equal(reuse.status,410);
  const login=await req('POST','/api/auth/login',{email:'user.teste.s132@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(login.status,200);
});

test('token expirado falha',async()=>{
  setEmailProvider(createEmailProvider({name:'off'}));
  const created=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Expirado',email:'exp.s132@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  const tok=created.data.invitation.activation_url.split('/convite/')[1];
  db.prepare("UPDATE client_invitations SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(created.data.user.id);
  const r=await req('GET','/api/invitations/'+tok);
  assert.equal(r.status,410);
});

test('usuários da empresa A não aparecem na B',async()=>{
  const listA=await req('GET',`/api/empresas/${companyA.id}/users`,undefined,ownerA.token);
  const listB=await req('GET',`/api/empresas/${companyB.id}/users`,undefined,ownerA.token);
  assert.ok(listA.data.some(x=>x.email==='user.teste.s132@test.local'));
  assert.ok(!listB.data.some(x=>x.email==='user.teste.s132@test.local'));
});

test('tenant isolation e CLIENT não acessa administração',async()=>{
  const list=await req('GET',`/api/empresas/${companyA.id}/users`,undefined,ownerB.token);
  assert.equal(list.status,404);
  const login=await req('POST','/api/auth/login',{email:'user.teste.s132@test.local',password,tenant:ownerA.user.tenant_slug});
  const admin=await req('GET','/api/usuarios',undefined,login.data.token);
  assert.equal(admin.status,403);
  const other=await req('GET',`/api/empresas/${companyB.id}/users`,undefined,login.data.token);
  assert.equal(other.status,403);
});

test('tela global de usuários lista somente o escritório',async()=>{
  const users=await req('GET','/api/usuarios',undefined,ownerA.token);
  assert.equal(users.status,200);
  assert.ok(users.data.items.every(x=>x.role!=='CLIENT'));
});

test('produção não devolve token de ativação',async()=>{
  const prev=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  try{
    const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Prod Token',email:'prod.token.s132@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
    assert.equal(r.status,201);
    assert.equal(r.data.invitation.activation_url,undefined);
  }finally{
    process.env.NODE_ENV=prev;
  }
});

test('criação recusa senha enviada pelo escritório',async()=>{
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Com Senha',email:'com.senha.s132@test.local',profile:'CLIENT_ADMIN',password:'Senha@123'},ownerA.token);
  assert.equal(r.status,400);
  assert.equal(r.data.error,'PASSWORD_NOT_ALLOWED');
});
