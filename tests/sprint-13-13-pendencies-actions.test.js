'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1313-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-13-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
const portal=fs.readFileSync(path.join(root,'frontend/public/portal/portal.js'),'utf8');
const start=js.indexOf('function pendencyKind');
const end=js.indexOf('function timeAgo');
assert.ok(start>=0&&end>start);
const {pendencyKind,pendencyAction,pendencyCopy}=Function(js.slice(start,end)+';return {pendencyKind,pendencyAction,pendencyCopy};')();

let server,base,ownerA,ownerB,companyA,companyB;
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
function items(r){return Array.isArray(r.data)?r.data:(r.data&&r.data.items)||[]}
function uuid(){return crypto.randomUUID()}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1313 A',email:'owner.a.s1313@test.local',password,tenantName:'Tenant 1313 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1313@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1313 B',email:'owner.b.s1313@test.local',password,tenantName:'Tenant 1313 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1313@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa 1313 A',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa 1313 B',cnpj:'22333444000192'},ownerB.token)).data;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1-4 pendência de classificação no contexto da empresa',()=>{
  const x={entity_type:'ENTRY',reason:'Movimentação aguardando classificação',entry_status:'NEEDS_CLASSIFICATION',company_id:'co-a'};
  const act=pendencyAction(x,true);
  assert.equal(pendencyKind(x),'CLASSIFICATION');
  assert.match(act.label,/Classificar/);
  assert.equal(act.page,'classificacao');
  assert.doesNotMatch(act.label,/Abrir empresa/);
  assert.match(js,/if\(inCompany\)\{if\(act\.page\)\{state\.page=act\.page;render\(\)\}return\}/);
  assert.match(js,/enterCompany\(x\.company_id,act\.page\|\|\(pendencyKind\(x\)==='CLASSIFICATION'\?'classificacao':'pendencias'\)\)/);
});

test('2 dentro da empresa a lista não usa Abrir empresa',()=>{
  const page=js.slice(js.indexOf('async function pendenciesPage'),js.indexOf('async function plan'));
  assert.doesNotMatch(page,/Abrir empresa/);
  assert.match(page,/inCompany\?\(act\.page/);
  assert.match(js,/id="leaveCompany">← Empresas/);
});

test('5-8 pendência de aprovação contextual',()=>{
  const x={entity_type:'ENTRY',reason:'Partida pronta',entry_status:'PENDING',company_id:'co-a'};
  const act=pendencyAction(x,true);
  assert.equal(pendencyKind(x),'APPROVAL');
  assert.match(act.label,/Aprovar/);
  assert.equal(act.page,'aprovacao');
  assert.doesNotMatch(act.label,/Abrir empresa/);
  assert.equal(pendencyCopy(x).happened,'Classificação aguardando aprovação');
});

test('9-10 documento',()=>{
  const act=pendencyAction({entity_type:'DOCUMENT',reason:'Comprovante pendente'},true);
  assert.match(act.label,/Ver documento/);
  assert.equal(act.page,'documentos');
});

test('11-12 solicitação',()=>{
  const act=pendencyAction({entity_type:'REQUEST',reason:'Pedido do cliente'},true);
  assert.match(act.label,/Ver solicitação|Responder/);
  assert.equal(act.page,'solicitacoes');
});

test('13 importação se o tipo existir no mapeamento',()=>{
  const act=pendencyAction({entity_type:'IMPORT',reason:'Importação com rejeições'},true);
  assert.match(act.label,/Ver importação/);
  assert.equal(act.page,'importacoes');
});

test('14 visão global usa Acessar empresa e preserva destino',()=>{
  const x={entity_type:'ENTRY',reason:'Movimentação aguardando classificação',company_id:'co-a'};
  const act=pendencyAction(x,false);
  assert.match(act.label,/Acessar empresa/);
  assert.equal(act.page,'classificacao');
  assert.equal(act.enter,true);
});

test('15 despesa e tipo desconhecido não prometem Visão geral',()=>{
  const exp=pendencyAction({entity_type:'EXPENSE',reason:'Despesa incompleta'},true);
  assert.equal(exp.page,'despesas');
  const unk=pendencyAction({entity_type:'OTHER',reason:'Item genérico'},true);
  assert.equal(unk.page,null);
  assert.match(unk.label,/Ver detalhes/);
  assert.doesNotMatch(unk.label,/Abrir empresa/);
});

test('16-17 isolamento tenant/company no GET pendências',async()=>{
  db.prepare('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason,status) VALUES(?,?,?,?,?,?,?)')
    .run(uuid(),ownerA.user.tenant_id,companyA.id,'ENTRY','e-a','Movimentação aguardando classificação','OPEN');
  db.prepare('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason,status) VALUES(?,?,?,?,?,?,?)')
    .run(uuid(),ownerB.user.tenant_id,companyB.id,'ENTRY','e-b','Segredo B','OPEN');
  const a=await req('GET','/api/pendencias',undefined,ownerA.token,companyA.id);
  const b=await req('GET','/api/pendencias',undefined,ownerB.token,companyB.id);
  const leak=await req('GET','/api/pendencias',undefined,ownerA.token,companyB.id);
  assert.ok(items(a).every(x=>x.company_id===companyA.id));
  assert.ok(items(a).some(x=>x.reason==='Movimentação aguardando classificação'));
  assert.ok('entry_status' in (items(a)[0]||{}));
  assert.ok(items(b).every(x=>x.company_id===companyB.id));
  assert.ok(!items(a).some(x=>x.reason==='Segredo B'));
  assert.equal(leak.status,404);
});

test('18 Portal do Cliente permanece sem ações do escritório',()=>{
  assert.doesNotMatch(portal,/pendencyAction|Acessar empresa|Classificar →/);
  assert.match(portal,/async function pending\(\)/);
});
