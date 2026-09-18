'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s021-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-021';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,companyA,companyB,joao,maria,pedro,pending;
const today='2026-09-01';
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
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

async function registerOffice(name,email){
  const created=await req('POST','/api/auth/register',{name,email,password,tenantName:name,cnpj:'00000000000191'});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const login=await req('POST','/api/auth/login',{email,password,tenant:created.data.tenant_slug});
  assert.equal(login.status,200,JSON.stringify(login.data));
  return login.data;
}
async function accept(invite,name){
  const token=invite.activation_url.split('/convite/')[1];
  const r=await req('POST','/api/invitations/'+token+'/accept',{name,password,confirmation:password});
  assert.equal(r.status,200,JSON.stringify(r.data));
  return r.data;
}

test('TESTE 01 Criar empresa cliente',async()=>{
  ownerA=await registerOffice('Escritório Alfa','owner.a@test.local');
  const r=await req('POST','/api/empresas',{name:'Empresa Alfa Ltda',trade_name:'Alfa',cnpj:'11222333000181',email:'alfa@test.local',phone:'11999999999',address:'Rua A',address_number:'10',neighborhood:'Centro',city:'São Paulo',state:'SP',zip:'01001000'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.name,'Empresa Alfa Ltda');
  assert.equal(r.data.status,'ACTIVE');
  companyA=r.data;
});

test('TESTE 02 Criar primeiro usuário',async()=>{
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'João Silva',email:'joao.alfa@test.local',profile:'CLIENT_ADMIN'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  joao=r.data;
  assert.ok(joao.invitation.activation_url);
});

test('TESTE 03 Confirmar role = CLIENT',()=>{
  assert.equal(joao.user.role,'CLIENT');
  const row=db.prepare('SELECT role FROM users WHERE id=?').get(joao.user.id);
  assert.equal(row.role,'CLIENT');
});

test('TESTE 04 Confirmar perfil = CLIENT_ADMIN',()=>{
  assert.equal(joao.profile,'CLIENT_ADMIN');
  const row=db.prepare('SELECT profile FROM client_user_profiles WHERE user_id=?').get(joao.user.id);
  assert.equal(row.profile,'CLIENT_ADMIN');
});

test('TESTE 05 Criar segundo usuário Financeiro',async()=>{
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Maria Souza',email:'maria.alfa@test.local',profile:'Financeiro'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.user.role,'CLIENT');
  assert.equal(r.data.profile,'CLIENT_FINANCE');
  maria=r.data;
});

test('TESTE 06 Criar terceiro usuário Visualizador',async()=>{
  const r=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Pedro Lima',email:'pedro.alfa@test.local',profile:'Visualizador'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.profile,'CLIENT_VIEWER');
  pedro=r.data;
});

test('TESTE 07 Mesmo tenant_id e company_id',()=>{
  const rows=db.prepare("SELECT tenant_id,company_id FROM users WHERE id IN(?,?,?)").all(joao.user.id,maria.user.id,pedro.user.id);
  assert.equal(rows.length,3);
  for(const row of rows){
    assert.equal(row.tenant_id,ownerA.user.tenant_id);
    assert.equal(row.company_id,companyA.id);
  }
});

test('TESTE 08 Visualizador não cria despesa',async()=>{
  const invited=await accept(pedro.invitation,'Pedro Lima');
  pedro.session=invited;
  const r=await req('POST','/api/client/despesas',{occurred_on:today,description:'Despesa indevida',amount:'10,00',payment_method:'PIX'},pedro.session.token);
  assert.equal(r.status,403);
  assert.match(String(r.data.message||''),/permiss/i);
});

test('TESTE 09 Visualizador não cria receita',async()=>{
  const r=await req('POST','/api/client/receitas',{occurred_on:today,description:'Receita indevida',amount:'10,00',receipt_method:'PIX'},pedro.session.token);
  assert.equal(r.status,403);
});

test('TESTE 10 Financeiro pode executar as operações previstas',async()=>{
  maria.session=await accept(maria.invitation,'Maria Souza');
  const dash=await req('GET','/api/client/dashboard',undefined,maria.session.token);
  assert.equal(dash.status,200);
  const exp=await req('POST','/api/client/despesas',{occurred_on:today,description:'Despesa financeira',amount:'20,00',payment_method:'PIX'},maria.session.token);
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  const rev=await req('POST','/api/client/receitas',{occurred_on:today,description:'Receita financeira',amount:'30,00',receipt_method:'PIX'},maria.session.token);
  assert.equal(rev.status,403);
  assert.equal(rev.data.error,'REVENUE_NOT_AVAILABLE_FOR_CLIENT');
});

test('TESTE 11 Administrador pode executar as operações previstas',async()=>{
  joao.session=await accept(joao.invitation,'João Silva');
  const dash=await req('GET','/api/client/dashboard',undefined,joao.session.token);
  assert.equal(dash.status,200);
  const exp=await req('POST','/api/client/despesas',{occurred_on:today,description:'Despesa admin',amount:'40,00',payment_method:'PIX'},joao.session.token);
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  const rel=await req('GET','/api/client/relatorios',undefined,joao.session.token);
  assert.equal(rel.status,200);
});

test('TESTE 12 Bloquear usuário',async()=>{
  const r=await req('POST',`/api/client-users/${pedro.user.id}/block`,{},ownerA.token);
  assert.equal(r.status,200);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(pedro.user.id).active,0);
});

test('TESTE 13 Usuário bloqueado não autentica',async()=>{
  const r=await req('POST','/api/auth/login',{email:'pedro.alfa@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(r.status,401);
});

test('TESTE 14 Desbloquear usuário',async()=>{
  const r=await req('POST',`/api/client-users/${pedro.user.id}/unblock`,{},ownerA.token);
  assert.equal(r.status,200);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(pedro.user.id).active,1);
});

test('TESTE 15 Usuário volta a acessar',async()=>{
  const r=await req('POST','/api/auth/login',{email:'pedro.alfa@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(r.status,200);
  assert.equal(r.data.user.role,'CLIENT');
  assert.equal(r.data.redirect,'/portal/');
});

test('TESTE 16 Reenviar convite',async()=>{
  pending=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Ana Costa',email:'ana.alfa@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(pending.status,201);
  pending.oldToken=pending.data.invitation.activation_url.split('/convite/')[1];
  const resent=await req('POST',`/api/client-users/${pending.data.user.id}/resend-invitation`,{},ownerA.token);
  assert.equal(resent.status,200);
  pending.newToken=resent.data.activation_url.split('/convite/')[1];
  assert.notEqual(pending.oldToken,pending.newToken);
});

test('TESTE 17 Convite anterior deixa de ser válido',async()=>{
  const r=await req('GET','/api/invitations/'+pending.oldToken);
  assert.equal(r.status,410);
  assert.equal(r.data.message,'Este convite não está mais disponível.');
});

test('TESTE 18 Revogar convite',async()=>{
  const r=await req('POST',`/api/client-users/${pending.data.user.id}/revoke-invitation`,{},ownerA.token);
  assert.equal(r.status,200);
});

test('TESTE 19 Convite revogado não pode ser aceito',async()=>{
  const r=await req('POST','/api/invitations/'+pending.newToken+'/accept',{name:'Ana Costa',password,confirmation:password});
  assert.equal(r.status,410);
  assert.equal(r.data.message,'Este convite não está mais disponível.');
});

test('TESTE 20 Aceitar convite',async()=>{
  const resent=await req('POST',`/api/client-users/${pending.data.user.id}/resend-invitation`,{},ownerA.token);
  assert.equal(resent.status,200);
  const accepted=await req('POST','/api/invitations/'+resent.data.activation_url.split('/convite/')[1]+'/accept',{name:'Ana Costa',password,confirmation:password});
  assert.equal(accepted.status,200);
  assert.equal(accepted.data.redirect,'/portal/');
  pending.session=accepted.data;
});

test('TESTE 21 Login após ativação',async()=>{
  const r=await req('POST','/api/auth/login',{email:'ana.alfa@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(r.status,200);
  assert.equal(r.data.user.role,'CLIENT');
  pending.login=r.data;
});

test('TESTE 22 Redirecionamento para /portal/',()=>{
  assert.equal(pending.login.redirect,'/portal/');
  assert.equal(pending.session.redirect,'/portal/');
});

test('TESTE 23 Usuário Empresa A não acessa Empresa B',async()=>{
  const extra=await req('POST','/api/empresas',{name:'Empresa Beta Ltda',cnpj:'22333444000172'},ownerA.token);
  assert.equal(extra.status,201);
  companyB={id:extra.data.id,sameTenant:true};
  const list=await req('GET','/api/client/despesas',undefined,joao.session.token);
  assert.equal(list.status,200);
  assert.ok(list.data.every(x=>x.company_id===companyA.id));
  const usersB=await req('GET',`/api/empresas/${extra.data.id}/users`,undefined,joao.session.token);
  assert.equal(usersB.status,403);
});

test('TESTE 24 Tenant A não acessa Tenant B',async()=>{
  ownerB=await registerOffice('Escritório Beta','owner.b@test.local');
  const created=await req('POST','/api/empresas',{name:'Empresa Gama Ltda',cnpj:'33444555000163'},ownerB.token);
  assert.equal(created.status,201);
  const foreign=await req('GET',`/api/empresas/${created.data.id}`,undefined,ownerA.token);
  assert.equal(foreign.status,404);
  const users=await req('GET',`/api/empresas/${created.data.id}/users`,undefined,ownerA.token);
  assert.equal(users.status,404);
  const list=await req('GET','/api/empresas',undefined,ownerA.token);
  assert.equal(list.status,200);
  const items=list.data.items||list.data;
  assert.ok(items.every(x=>x.tenant_id===ownerA.user.tenant_id));
  assert.ok(!items.some(x=>x.id===created.data.id));
  assert.ok(list.data.page_size<=100);
});

test('cliente sem perfil no banco aparece como Visualizador e PATCH grava Administrador',async()=>{
  const created=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Sem Perfil',email:'sem.perfil.alfa@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  const uid=created.data.user.id;
  db.prepare('DELETE FROM client_user_profiles WHERE user_id=?').run(uid);
  const listed=await req('GET',`/api/empresas/${companyA.id}/users`,undefined,ownerA.token);
  const row=(listed.data||[]).find(x=>x.id===uid);
  assert.equal(row.profile,'CLIENT_VIEWER');
  const accepted=await accept(created.data.invitation,'Sem Perfil');
  const me=await req('GET','/api/auth/me',undefined,accepted.token);
  assert.equal(me.status,200);
  assert.equal(me.data.profile,'CLIENT_VIEWER');
  const patched=await req('PATCH','/api/client-users/'+uid,{profile:'CLIENT_ADMIN'},ownerA.token);
  assert.equal(patched.status,200,JSON.stringify(patched.data));
  assert.equal(patched.data.profile,'CLIENT_ADMIN');
  const me2=await req('GET','/api/auth/me',undefined,accepted.token);
  assert.equal(me2.data.profile,'CLIENT_ADMIN');
});

test('TESTE 25 Empresa bloqueada impede acesso dos usuários CLIENT',async()=>{
  const blocked=await req('POST',`/api/empresas/${companyA.id}/bloquear`,{},ownerA.token);
  assert.equal(blocked.status,200);
  assert.equal(blocked.data.status,'BLOCKED');
  const login=await req('POST','/api/auth/login',{email:'joao.alfa@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(login.status,401);
  const dash=await req('GET','/api/client/dashboard',undefined,joao.session.token);
  assert.equal(dash.status,403);
  const users=db.prepare("SELECT COUNT(*) n FROM users WHERE company_id=?").get(companyA.id).n;
  assert.ok(users>=4);
});
