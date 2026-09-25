'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1316-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-16-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'frontend/public/index.html'),'utf8');
const ctxSrc=js.slice(js.indexOf('const contextMenuGroups='),js.indexOf('const officeOnly='));
const menuSrc=js.slice(js.indexOf('const menuGroups='),js.indexOf('const contextMenuGroups='));
const classifSrc=js.slice(js.indexOf('async function classificationPage'),js.indexOf('async function',js.indexOf('async function classificationPage')+10));

function loadNav(){
  const start=js.indexOf('const menuGroups=');
  const end=js.indexOf('const officeOnly=');
  return Function(js.slice(start,end)+';return {menuGroups,contextMenuGroups,companyContextNav};')();
}
const {menuGroups,contextMenuGroups}=loadNav();
const ctxItems=contextMenuGroups.flatMap(g=>g.items);
const globalItems=menuGroups.flatMap(g=>g.items);
const labels=ctxItems.map(x=>x[1]);

let server,base,ownerA,ownerB,companyA,companyA2,companyB,accDesp,accBanco;
let ncId,pendId,postedId;
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
function uuid(){return crypto.randomUUID()}
function items(r){return Array.isArray(r.data)?r.data:(r.data&&r.data.items)||[]}
function insertAccount(tenantId,planId,code,type,desc,postable){
  const id=uuid();
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tenantId,planId,code,code,code,type,desc,null,1,postable?1:0,1);
  return {id,code,desc};
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1316 A',email:'owner.a.s1316@test.local',password,tenantName:'Tenant 1316 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1316@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1316 B',email:'owner.b.s1316@test.local',password,tenantName:'Tenant 1316 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1316@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa Demonstração 1316',cnpj:'11222333000181'},ownerA.token)).data;
  companyA2=(await req('POST','/api/empresas',{name:'Empresa 1316 A2',cnpj:'33444555000103'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa 1316 B',cnpj:'22333444000192'},ownerB.token)).data;
  const planA=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planA,ownerA.user.tenant_id,'Plano 1316 A','ACTIVE');
  accDesp=insertAccount(ownerA.user.tenant_id,planA,'3210400001','A','FRETES E CARRETOS',1);
  accBanco=insertAccount(ownerA.user.tenant_id,planA,'1110200004','A','BANCO NUBANK',1);
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1 Pendências não aparece no menu dentro da empresa',()=>{
  assert.ok(!labels.includes('Pendências'));
  assert.ok(!ctxItems.some(x=>x[0]==='pendencias'));
  assert.doesNotMatch(ctxSrc,/\['pendencias','Pendências'/);
});

test('2 Classificação aparece no menu da empresa',()=>{
  assert.ok(ctxItems.some(x=>x[0]==='classificacao'&&x[1]==='Classificação'));
  assert.equal(contextMenuGroups.find(g=>g.items.some(i=>i[0]==='classificacao')).title,'CONTÁBIL');
});

test('3 Aprovação aparece no menu da empresa',()=>{
  assert.ok(ctxItems.some(x=>x[0]==='aprovacao'&&x[1]==='Aprovação'));
});

test('4 Lançamentos aparece no menu da empresa',()=>{
  assert.ok(ctxItems.some(x=>x[0]==='lancamentos'&&x[1]==='Lançamentos'));
});

test('5 Classificação mostra count de NEEDS_CLASSIFICATION',async()=>{
  const nc=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Frete fila 1316',amount:'120,00',payment_method:'PIX'},ownerA.token);
  const pend=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Pending fila 1316',lines:[{account_id:accDesp.id,side:'D',amount_cents:12000},{account_id:accBanco.id,side:'C',amount_cents:12000}]},ownerA.token);
  const posted=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Posted fila 1316',lines:[{account_id:accDesp.id,side:'D',amount_cents:5000},{account_id:accBanco.id,side:'C',amount_cents:5000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+posted.data.id+'/aprovar',{},ownerA.token);
  ncId=nc.data.entry_id;pendId=pend.data.id;postedId=posted.data.id;
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(dash.status,200);
  assert.equal(dash.data.expenses_awaiting_classification,1);
  assert.match(js,/sidebarCounters\.classificacao=Number\(dash\.expenses_awaiting_classification\|\|0\)\|\|null/);
  assert.match(js,/function renderBadge\(page\)\{const value=Number\(sidebarCounters\[page\]\|\|0\);return value>0/);
});

test('6 Aprovação mostra count de PENDING',async()=>{
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(dash.data.entries_awaiting_approval,1);
  assert.match(js,/sidebarCounters\.aprovacao=Number\(dash\.entries_awaiting_approval\|\|dash\.pending\|\|0\)\|\|null/);
});

test('7 POSTED não entra no count de Classificação',async()=>{
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  assert.ok(!classif.some(x=>x.id===postedId));
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(dash.data.expenses_awaiting_classification,1);
});

test('8 POSTED não entra no count de Aprovação',async()=>{
  const approval=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  assert.ok(approval.every(x=>x.status==='PENDING'));
  assert.ok(!approval.some(x=>x.id===postedId||x.id===ncId));
  assert.ok(approval.some(x=>x.id===pendId));
});

test('9 Classificação abre diretamente a fila',()=>{
  assert.match(classifSrc,/status:'NEEDS_CLASSIFICATION'/);
  assert.match(classifSrc,/head\('Classificação','Movimentações que precisam de definição ou revisão contábil\.'\)/);
  assert.match(classifSrc,/Nenhuma movimentação aguardando classificação\./);
  assert.match(classifSrc,/A fila está em dia\./);
  assert.doesNotMatch(classifSrc,/Nada encontrado/);
  assert.doesNotMatch(js,/Nova classificação/);
});

test('10 Item NEEDS_CLASSIFICATION aparece diretamente em Classificação',async()=>{
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  assert.ok(classif.some(x=>x.id===ncId&&x.status==='NEEDS_CLASSIFICATION'));
  assert.match(classifSrc,/Classificar →/);
});

test('11 Não existe página intermediária Pendente Classificação',()=>{
  assert.doesNotMatch(js,/Pendente Classificação/);
  assert.ok(!ctxItems.some(x=>String(x[1]).includes('Pendente')));
  assert.match(html,/app\.js\?v=s39-5/);
});

test('12 Clique Classificar leva diretamente para a classificação',()=>{
  assert.match(classifSrc,/onclick="classifyEntry\('\$\{x\.id\}'\)">Classificar →/);
  assert.match(js,/CLASSIFICATION:\{page:'classificacao',label:'Classificar →'\}/);
  assert.match(js,/enterCompany\(x\.company_id,act\.page\|\|\(pendencyKind\(x\)==='CLASSIFICATION'\?'classificacao':'pendencias'\)\)/);
  assert.doesNotMatch(ctxSrc,/enterCompany\([^)]*'pendencias'/);
});

test('13 Contexto da empresa permanece',()=>{
  assert.match(js,/X-Company-Id/);
  assert.match(js,/function enterCompany\(id,page\)/);
  assert.match(js,/history\.pushState\(\{company:x\.id\},'', '\/empresas\/'\+x\.id\)/);
  assert.deepEqual(contextMenuGroups.map(g=>g.title),['OPERAÇÃO','CONTÁBIL','IMPORTAÇÃO','ACESSO']);
  assert.deepEqual(contextMenuGroups.find(g=>g.title==='OPERAÇÃO').items.map(x=>x[1]),['Visão geral','Despesas','Documentos','Solicitações']);
});

test('14 ← Empresas continua funcionando',()=>{
  assert.match(js,/id="leaveCompany">← Empresas/);
  assert.match(js,/function leaveCompany\(\)\{[\s\S]*?state\.selectedCompany=null;[\s\S]*?state\.page='empresas'/);
});

test('15 Pendências global continua fora do contexto da empresa',()=>{
  assert.ok(globalItems.some(x=>x[0]==='pendencias'&&x[1]==='Pendências'));
  assert.match(js,/if\(state\.page==='pendencias'\)return pendenciesPage/);
  assert.match(js,/async function pendenciesPage/);
  assert.match(js,/api\('\/pendencias\?page='/);
  assert.match(menuSrc,/\['pendencias','Pendências'/);
});

test('16 Tenant isolation dos contadores e da fila',async()=>{
  const dashB=await req('GET','/api/dashboard',undefined,ownerB.token,companyB.id);
  assert.equal(dashB.data.expenses_awaiting_classification,0);
  assert.equal(dashB.data.entries_awaiting_approval,0);
  const classifB=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerB.token,companyB.id));
  assert.ok(!classifB.some(x=>x.description==='Frete fila 1316'));
  const leak=await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyB.id);
  assert.ok(!items(leak).some(x=>x.description==='Frete fila 1316'));
});

test('17 Company isolation dos contadores e da fila',async()=>{
  const dash2=await req('GET','/api/dashboard',undefined,ownerA.token,companyA2.id);
  assert.equal(dash2.data.expenses_awaiting_classification,0);
  assert.equal(dash2.data.entries_awaiting_approval,0);
  const classif2=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA2.id));
  assert.ok(!classif2.some(x=>x.description==='Frete fila 1316'));
  const own=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  assert.ok(own.some(x=>x.description==='Frete fila 1316'));
});
