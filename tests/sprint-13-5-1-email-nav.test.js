'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1351-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-5-1-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
process.env.CDS_EMAIL_HOST='';
process.env.CDS_EMAIL_USER='';
process.env.CDS_EMAIL_PASSWORD='';
process.env.CDS_EMAIL_FROM='';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,setEmailProvider,setSmtpHooks}=require('../backend/src/server');
const {createEmailProvider}=require('../backend/src/email/provider');

const SECRET='SmtpNavSecret1351';
const password='Senha@123';
const emailBody={provider:'smtp',host:'smtp.gmail.com',port:587,user:'cdscontabil@gmail.com',from:'cdscontabil@gmail.com',fromName:'CDS Contábil',password:SECRET};
const js=fs.readFileSync(path.join(__dirname,'../frontend/public/assets/app.js'),'utf8');
const portal=fs.readFileSync(path.join(__dirname,'../frontend/public/portal/portal.js'),'utf8');
const start=js.indexOf('const menuGroups=');
const end=js.indexOf('const companyContextNav=');
const {menuGroups,contextMenuGroups}=Function(js.slice(start,end)+';return {menuGroups,contextMenuGroups};')();

let server,base,ownerA,ownerB,staffA,accA,slugA,companyA,clientAdmin,clientFinance,clientViewer;

function req(method,url,body,token,headers={}){
  const h={'Content-Type':'application/json',...headers};
  if(token)h.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data,raw:JSON.stringify(data)};
  });
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1351 A',email:'owner.a.s1351@test.local',password,tenantName:'Tenant 1351 A'});
  slugA=a.data.tenant_slug;
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1351@test.local',password,tenant:slugA})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1351 B',email:'owner.b.s1351@test.local',password,tenantName:'Tenant 1351 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1351@test.local',password,tenant:b.data.tenant_slug})).data;
  await req('POST','/api/usuarios',{name:'Contador 1351',email:'acc.s1351@test.local',password,role:'ACCOUNTANT'},ownerA.token);
  await req('POST','/api/usuarios',{name:'Staff 1351',email:'staff.s1351@test.local',password,role:'STAFF'},ownerA.token);
  staffA=(await req('POST','/api/auth/login',{email:'staff.s1351@test.local',password,tenant:slugA})).data;
  accA=(await req('POST','/api/auth/login',{email:'acc.s1351@test.local',password,tenant:slugA})).data;
  companyA=(await req('POST','/api/empresas',{name:'Pastelaria do Cheff',trade_name:'PASTELARIA DO CHEFF',cnpj:'38204469000115'},ownerA.token)).data;
  const accept=async(created)=>{
    const tok=created.data.invitation.activation_url.split('/convite/')[1];
    return (await req('POST','/api/invitations/'+tok+'/accept',{name:'Cliente',password,confirmation:password})).data.token;
  };
  clientAdmin=await accept(await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Admin Cliente',email:'client.admin.s1351@test.local',profile:'CLIENT_ADMIN'},ownerA.token));
  clientFinance=await accept(await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Fin Cliente',email:'client.fin.s1351@test.local',profile:'CLIENT_FINANCE'},ownerA.token));
  clientViewer=await accept(await req('POST',`/api/empresas/${companyA.id}/users`,{name:'View Cliente',email:'client.view.s1351@test.local',profile:'CLIENT_VIEWER'},ownerA.token));
});
after(()=>{
  setSmtpHooks(null);
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1 menu global possui Configurações/Comunicações',()=>{
  const titles=menuGroups.map(g=>g.title);
  assert.ok(titles.includes('CONFIGURAÇÕES'));
  const cfg=menuGroups.find(g=>g.title==='CONFIGURAÇÕES');
  assert.ok(cfg.items.some(x=>x[0]==='comunicacoes'&&x[1]==='Comunicações'));
  assert.ok(titles.includes('SISTEMA'));
  assert.ok(!titles.includes('MOVIMENTAÇÕES'));
});

test('2 configuração não aparece no contexto da empresa',()=>{
  const items=contextMenuGroups.flatMap(g=>g.items);
  assert.ok(!items.some(x=>x[0]==='comunicacoes'||x[1]==='Comunicações'||x[1]==='E-mail'));
  assert.match(js,/state\.selectedCompany\?contextMenuGroups:menuGroups/);
});

test('3 rota/página de comunicação existe',()=>{
  assert.match(js,/if\(state\.page==='comunicacoes'\)return commsPage\(c\)/);
  assert.match(js,/async function emailSettingsPage/);
  assert.match(js,/commsTab\|\|'email'/);
});

test('4 página sem configuração renderiza estado vazio válido',()=>{
  assert.match(js,/E-mail do sistema/);
  assert.match(js,/ainda não possui um servidor/);
  assert.match(js,/Não configurado/);
  assert.match(js,/Configurar e-mail/);
  assert.doesNotMatch(js,/emailSettingsPage[\s\S]{0,400}Registro não encontrado/);
});

test('5 página com configuração renderiza configuração',()=>{
  assert.match(js,/Credencial<br>\$\{mail\.hasCredential\?'Configurada':'Não configurada'\}/);
  assert.match(js,/Servidor<br>/);
});

test('6 GET configured=false não gera registro não encontrado',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.configured,false);
  assert.doesNotMatch(r.raw,/Registro não encontrado/);
  assert.match(js,/err\.status===404/);
});

test('7 OWNER acessa',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(r.status,200);
});

test('8 ACCOUNTANT acessa',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,accA.token);
  assert.equal(r.status,200);
});

test('9 STAFF visualiza e não grava',async()=>{
  const g=await req('GET','/api/configuracoes/comunicacoes/email',undefined,staffA.token);
  assert.equal(g.status,200);
  const p=await req('PUT','/api/configuracoes/comunicacoes/email',emailBody,staffA.token);
  assert.equal(p.status,403);
});

test('10 CLIENT_ADMIN recebe bloqueio',async()=>{
  assert.equal((await req('GET','/api/configuracoes/comunicacoes/email',undefined,clientAdmin)).status,403);
});

test('11 CLIENT_FINANCE recebe bloqueio',async()=>{
  assert.equal((await req('GET','/api/configuracoes/comunicacoes/email',undefined,clientFinance)).status,403);
});

test('12 CLIENT_VIEWER recebe bloqueio',async()=>{
  assert.equal((await req('GET','/api/configuracoes/comunicacoes/email',undefined,clientViewer)).status,403);
});

test('13 API continua funcionando',async()=>{
  const created=await req('PUT','/api/configuracoes/comunicacoes/email',emailBody,ownerA.token);
  assert.equal(created.status,201,created.raw);
  const got=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(got.data.host,'smtp.gmail.com');
  assert.equal(got.data.password,undefined);
});

test('14 teste de conexão continua funcionando',async()=>{
  setSmtpHooks({verify:async()=>{}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/testar',{},ownerA.token);
  assert.equal(r.status,200,r.raw);
});

test('15 e-mail de teste continua funcionando',async()=>{
  setSmtpHooks({send:async()=>{}});
  const r=await req('POST','/api/configuracoes/comunicacoes/email/teste',{to:ownerA.user.email},ownerA.token);
  assert.equal(r.status,200,r.raw);
});

test('16 convite continua utilizando configuração persistida',async()=>{
  const sent=[];
  setSmtpHooks({send:async(cfg,mail)=>sent.push({from:cfg.from,to:mail.to})});
  setEmailProvider(createEmailProvider({name:'off'}));
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Wilian',email:'wilian.s1351@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(r.status,201,r.raw);
  assert.equal(r.data.invitation.email_sent,true);
  assert.equal(sent[0].from,'cdscontabil@gmail.com');
  setEmailProvider(null);
});

test('17 multi-tenant continua isolado',async()=>{
  const r=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerB.token);
  assert.equal(r.status,200);
  assert.notEqual(r.data.host,'smtp.gmail.com');
  const spoof=await req('PUT','/api/configuracoes/comunicacoes/email',{...emailBody,tenant_id:ownerA.user.tenant_id,company_id:companyA.id,host:'smtp.evil.local'},ownerB.token);
  assert.ok(spoof.status===201||spoof.status===200);
  const a=await req('GET','/api/configuracoes/comunicacoes/email',undefined,ownerA.token);
  assert.equal(a.data.host,'smtp.gmail.com');
});

test('18 Portal permanece sem alteração',()=>{
  assert.doesNotMatch(portal,/menuGroups/);
  assert.doesNotMatch(portal,/configuracoes\/comunicacoes\/email/);
  assert.doesNotMatch(portal,/E-mail do sistema/);
  const html=fs.readFileSync(path.join(__dirname,'../frontend/public/portal/index.html'),'utf8');
  assert.match(html,/portal\.js\?v=s34/);
});
