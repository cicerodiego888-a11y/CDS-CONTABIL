'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s133a-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-3a-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,slugA,companyA,acc,staff;
const password='Senha@123';
const root=path.resolve(__dirname,'..');

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}
function items(r){return (r.data&&r.data.items)||[]}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 133A',email:'owner.a.s133a@test.local',password,tenantName:'Tenant 133A'});
  slugA=a.data.tenant_slug;
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s133a@test.local',password,tenant:slugA})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 133B',email:'owner.b.s133a@test.local',password,tenantName:'Tenant 133B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s133a@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Pastelaria do Cheff',trade_name:'PASTELARIA DO CHEFF',cnpj:'38204469000115'},ownerA.token)).data;
  acc=(await req('POST','/api/usuarios',{name:'Contador 133A',email:'acc.s133a@test.local',password,role:'ACCOUNTANT'},ownerA.token)).data;
  staff=(await req('POST','/api/usuarios',{name:'Equipe 133A',email:'staff.s133a@test.local',password,role:'STAFF'},ownerA.token)).data;
  const client=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente Teste',email:'cliente.s133a@test.local',profile:'CLIENT_ADMIN'},ownerA.token);
  assert.equal(client.status,201,JSON.stringify(client.data));
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('tela global usa título Equipe e acessos e rota /usuarios',()=>{
  const js=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
  assert.match(js,/\['usuarios','Equipe e acessos'/);
  assert.match(js,/head\('Equipe e acessos','Gerencie os usuários que fazem parte do seu escritório\.'/);
  assert.match(js,/api\('\/usuarios\?page='/);
  assert.match(js,/roleLabel\(x\.role\)/);
  assert.match(js,/OWNER:'Administrador'/);
  assert.match(js,/ACCOUNTANT:'Contador'/);
  assert.match(js,/STAFF:'Equipe'/);
  const modal=js.slice(js.indexOf('function userModal'),js.indexOf('async function commsPage'));
  assert.match(modal,/>\$\{roleLabel\(r\)\}</);
  assert.doesNotMatch(modal,/CLIENT_ADMIN/);
  assert.doesNotMatch(modal,/CLIENT_FINANCE/);
  assert.doesNotMatch(modal,/CLIENT_VIEWER/);
  assert.doesNotMatch(modal,/option value="CLIENT"/);
});

test('GET /api/usuarios lista OWNER ACCOUNTANT STAFF e exclui CLIENT',async()=>{
  const r=await req('GET','/api/usuarios?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(r.status,200);
  const roles=items(r).map(x=>x.role);
  assert.ok(roles.includes('OWNER'));
  assert.ok(roles.includes('ACCOUNTANT'));
  assert.ok(roles.includes('STAFF'));
  assert.ok(!roles.includes('CLIENT'));
  assert.ok(!items(r).some(x=>x.email==='cliente.s133a@test.local'));
  assert.ok(items(r).some(x=>x.email==='owner.a.s133a@test.local'));
  assert.ok(items(r).some(x=>x.email==='acc.s133a@test.local'));
  assert.ok(items(r).some(x=>x.email==='staff.s133a@test.local'));
});

test('busca e paginação de equipe continuam funcionando',async()=>{
  const q=await req('GET','/api/usuarios?q='+encodeURIComponent('acc.s133a@test.local'),undefined,ownerA.token);
  assert.equal(q.status,200);
  assert.equal(items(q).length,1);
  assert.equal(items(q)[0].role,'ACCOUNTANT');
  const page=await req('GET','/api/usuarios?page=1&page_size=2',undefined,ownerA.token);
  assert.equal(page.status,200);
  assert.ok(page.data.total>=3);
  assert.ok(items(page).length<=2);
  assert.ok(page.data.pages>=2);
});

test('criação global não permite CLIENT nem perfis de empresa',async()=>{
  const c=await req('POST','/api/usuarios',{name:'Fake Client',email:'fake.client.s133a@test.local',password,role:'CLIENT'},ownerA.token);
  assert.equal(c.status,400);
  assert.equal(c.data.error,'CLIENT_VIA_COMPANY');
  const admin=await req('POST','/api/usuarios',{name:'Fake Admin',email:'fake.admin.s133a@test.local',password,role:'CLIENT_ADMIN'},ownerA.token);
  assert.equal(admin.status,400);
  const fin=await req('POST','/api/usuarios',{name:'Fake Fin',email:'fake.fin.s133a@test.local',password,role:'CLIENT_FINANCE'},ownerA.token);
  assert.equal(fin.status,400);
  const view=await req('POST','/api/usuarios',{name:'Fake View',email:'fake.view.s133a@test.local',password,role:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(view.status,400);
});

test('tenant isolation e CLIENT não acessa Equipe e acessos',async()=>{
  const foreign=await req('GET','/api/usuarios',undefined,ownerB.token);
  assert.equal(foreign.status,200);
  assert.ok(!items(foreign).some(x=>x.email==='owner.a.s133a@test.local'));
  assert.ok(!items(foreign).some(x=>x.email==='acc.s133a@test.local'));
  const created=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente Login',email:'cliente.login.s133a@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  const token=created.data.invitation.activation_url.split('/convite/')[1];
  const accpt=await req('POST','/api/invitations/'+token+'/accept',{name:'Cliente Login',password,confirmation:password});
  assert.equal(accpt.status,200);
  const admin=await req('GET','/api/usuarios',undefined,accpt.data.token);
  assert.equal(admin.status,403);
});
