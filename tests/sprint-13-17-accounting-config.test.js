'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1317-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-17-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
const portalJs=fs.readFileSync(path.join(root,'frontend/public/portal/portal.js'),'utf8');
const html=fs.readFileSync(path.join(root,'frontend/public/index.html'),'utf8');
const portalHtml=fs.readFileSync(path.join(root,'frontend/public/portal/index.html'),'utf8');
const formSrc=portalJs.slice(portalJs.indexOf('async function transactionForm'),portalJs.indexOf('async function detail'));

let server,base,ownerA,ownerB,accA,companyA,companyA2,companyB,clientToken;
let catId,bankId,catNoAcc,bankNoAcc,analyticA,analyticBank,synthA,analyticB;
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
function insertAccount(tenantId,planId,code,type,desc,postable,active=1){
  const id=uuid();
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tenantId,planId,code,code,code,type,desc,null,1,postable?1:0,active);
  return {id,code,desc};
}
function audit(action,entityId){
  return db.prepare('SELECT * FROM audit_logs WHERE action=? AND entity_id=? ORDER BY created_at DESC LIMIT 1').get(action,entityId);
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1317 A',email:'owner.a.s1317@test.local',password,tenantName:'Tenant 1317 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1317@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1317 B',email:'owner.b.s1317@test.local',password,tenantName:'Tenant 1317 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1317@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa 1317 A',cnpj:'11222333000181'},ownerA.token)).data;
  companyA2=(await req('POST','/api/empresas',{name:'Empresa 1317 A2',cnpj:'33444555000103'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa 1317 B',cnpj:'22333444000192'},ownerB.token)).data;
  const accUser=await req('POST','/api/usuarios',{name:'Contador 1317',email:'acc.s1317@test.local',password,role:'ACCOUNTANT'},ownerA.token);
  assert.equal(accUser.status,201,JSON.stringify(accUser.data));
  accA=(await req('POST','/api/auth/login',{email:'acc.s1317@test.local',password,tenant:ownerA.user.tenant_slug||a.data.tenant_slug})).data;
  const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Maria 1317',email:'maria.s1317@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const token=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+token+'/accept',{name:'Maria 1317',password,confirmation:password});
  assert.equal(acc.status,200,JSON.stringify(acc.data));
  clientToken=acc.data.token;
  const planA=uuid(),planB=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planA,ownerA.user.tenant_id,'Plano 1317 A','ACTIVE');
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planB,ownerB.user.tenant_id,'Plano 1317 B','ACTIVE');
  analyticA=insertAccount(ownerA.user.tenant_id,planA,'3210600013','A','MATERIAL DE ESCRITORIO',1);
  analyticBank=insertAccount(ownerA.user.tenant_id,planA,'1110200001','A','BANCO DO BRASIL',1);
  synthA=insertAccount(ownerA.user.tenant_id,planA,'1110200000','S','BANCOS SINTETICA',0);
  analyticB=insertAccount(ownerB.user.tenant_id,planB,'1110200001','A','BANCO DO BRASIL B',1);
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1 cria categoria',async()=>{
  const r=await req('POST','/api/categorias',{name:'Produtos de limpeza',accounting_account_id:analyticA.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.name,'Produtos de limpeza');
  assert.equal(r.data.accounting_account_id,analyticA.id);
  assert.equal(r.data.account_id,analyticA.id);
  assert.equal(r.data.active,1);
  catId=r.data.id;
  const log=audit('CATEGORY_CREATED',catId);
  assert.ok(log);
  assert.equal(log.tenant_id,ownerA.user.tenant_id);
  assert.equal(log.user_id,ownerA.user.id);
  assert.equal(log.entity_type,'CATEGORY');
});

test('2 exige nome',async()=>{
  const r=await req('POST','/api/categorias',{name:'   ',account_id:analyticA.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,400);
  assert.equal(r.data.error,'NAME_REQUIRED');
});

test('3 exige conta contábil',async()=>{
  const r=await req('POST','/api/categorias',{name:'Sem conta',company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,400);
  assert.equal(r.data.error,'ACCOUNT_REQUIRED');
  assert.match(r.data.message,/analítica/i);
});

test('4 aceita somente conta analítica',async()=>{
  const r=await req('POST','/api/categorias',{name:'Fretes',account_id:analyticA.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,201,JSON.stringify(r.data));
  const list=await req('GET','/api/plano-contas/analiticas?q=1110200001',undefined,ownerA.token,companyA.id);
  assert.equal(list.status,200);
  assert.ok((list.data.items||[]).some(x=>x.id===analyticBank.id&&x.account_type==='A'));
  assert.ok(!(list.data.items||[]).some(x=>x.id===synthA.id));
  assert.ok(!(list.data.items||[]).some(x=>x.id===analyticB.id));
});

test('5 rejeita conta sintética',async()=>{
  const r=await req('POST','/api/categorias',{name:'Sintetica',account_id:synthA.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,422);
  assert.equal(r.data.error,'SYNTHETIC_ACCOUNT');
  assert.match(r.data.message,/sintética/i);
});

test('6 rejeita conta inexistente',async()=>{
  const r=await req('POST','/api/categorias',{name:'Inexistente',account_id:uuid(),company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,422);
  assert.equal(r.data.error,'ACCOUNT_NOT_FOUND');
});

test('7 impede duplicidade',async()=>{
  const r=await req('POST','/api/categorias',{name:'Produtos de limpeza',account_id:analyticA.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,409);
  assert.equal(r.data.error,'DUPLICATE_CATEGORY');
});

test('8 edita categoria',async()=>{
  const r=await req('PATCH','/api/categorias/'+catId,{name:'Produtos de limpeza e higiene'},ownerA.token,companyA.id);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.name,'Produtos de limpeza e higiene');
  assert.ok(audit('CATEGORY_UPDATED',catId));
});

test('9 desativa categoria',async()=>{
  const off=await req('PATCH','/api/categorias/'+catId,{active:false},ownerA.token,companyA.id);
  assert.equal(off.status,200);
  assert.equal(off.data.active,0);
  assert.ok(audit('CATEGORY_DEACTIVATED',catId));
  const on=await req('PATCH','/api/categorias/'+catId,{active:true},ownerA.token,companyA.id);
  assert.equal(on.status,200);
  assert.equal(on.data.active,1);
  assert.ok(audit('CATEGORY_ACTIVATED',catId));
});

test('10 cria banco',async()=>{
  const r=await req('POST','/api/bancos',{name:'Banco do Brasil',accounting_account_id:analyticBank.id,company_id:companyA.id,identifier:'001'},ownerA.token,companyA.id);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.name,'Banco do Brasil');
  assert.equal(r.data.accounting_account_id,analyticBank.id);
  bankId=r.data.id;
  const log=audit('BANK_ACCOUNT_CREATED',bankId);
  assert.ok(log);
  assert.equal(log.entity_type,'BANK');
});

test('11 exige conta contábil',async()=>{
  const r=await req('POST','/api/bancos',{name:'Sem conta banco',company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,400);
  assert.equal(r.data.error,'ACCOUNT_REQUIRED');
});

test('12 rejeita conta sintética',async()=>{
  const r=await req('POST','/api/bancos',{name:'Sintetico',account_id:synthA.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,422);
  assert.equal(r.data.error,'SYNTHETIC_ACCOUNT');
});

test('13 rejeita conta de outro contexto',async()=>{
  const r=await req('POST','/api/bancos',{name:'Banco estrangeiro',account_id:analyticB.id,company_id:companyA.id},ownerA.token,companyA.id);
  assert.equal(r.status,403);
  assert.equal(r.data.error,'ACCOUNT_FORBIDDEN');
});

test('14 edita banco',async()=>{
  const r=await req('PATCH','/api/bancos/'+bankId,{name:'Banco do Brasil S.A.'},ownerA.token,companyA.id);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.name,'Banco do Brasil S.A.');
  assert.ok(audit('BANK_ACCOUNT_UPDATED',bankId));
});

test('15 desativa banco',async()=>{
  const off=await req('PATCH','/api/bancos/'+bankId,{active:false},ownerA.token,companyA.id);
  assert.equal(off.status,200);
  assert.equal(off.data.active,0);
  assert.ok(audit('BANK_ACCOUNT_DEACTIVATED',bankId));
  const on=await req('PATCH','/api/bancos/'+bankId,{active:true},ownerA.token,companyA.id);
  assert.equal(on.status,200);
  assert.equal(on.data.active,1);
  assert.ok(audit('BANK_ACCOUNT_ACTIVATED',bankId));
});

test('16 cria despesa sem categoria',async()=>{
  const r=await req('POST','/api/client/despesas',{description:'Compra de produtos de limpeza',amount:250,date:'2026-09-18',payment_method:'PIX',bank_id:bankId,notes:'Recibo'},clientToken);
  assert.equal(r.status,201,JSON.stringify(r.data));
  const row=db.prepare('SELECT * FROM expenses WHERE id=?').get(r.data.id);
  assert.equal(row.category_id,null);
  assert.equal(row.bank_id,bankId);
  globalThis.__s1317Expense=r.data;
});

test('17 não exige category_id',async()=>{
  const r=await req('POST','/api/client/despesas',{description:'Água',amount:'80,00',occurred_on:'2026-09-18',payment_method:'PIX'},clientToken);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.ok(!Object.prototype.hasOwnProperty.call(r.data,'classification')||r.data.classification===undefined);
});

test('18 despesa criada entra em NEEDS_CLASSIFICATION',async()=>{
  const exp=globalThis.__s1317Expense;
  assert.equal(exp.status,'NEEDS_CLASSIFICATION');
  const entry=db.prepare('SELECT status FROM entries WHERE id=?').get(exp.entry_id);
  assert.equal(entry.status,'NEEDS_CLASSIFICATION');
});

test('19 cria evento de despesa',()=>{
  const exp=globalThis.__s1317Expense;
  const ev=db.prepare("SELECT * FROM domain_events WHERE tenant_id=? AND event_type='EXPENSE_CREATED' AND entity_id=?").get(ownerA.user.tenant_id,exp.id);
  assert.ok(ev);
  assert.equal(ev.company_id,companyA.id);
});

test('20 cria notificação',async()=>{
  const exp=globalThis.__s1317Expense;
  const notes=await req('GET','/api/notificacoes?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(notes.status,200);
  const items=Array.isArray(notes.data)?notes.data:(notes.data.items||[]);
  assert.ok(items.some(x=>x.entity_id===exp.id));
});

test('21 Tenant A não acessa categoria Tenant B',async()=>{
  const catB=await req('POST','/api/categorias',{name:'Cat B',account_id:analyticB.id,company_id:companyB.id},ownerB.token,companyB.id);
  assert.equal(catB.status,201,JSON.stringify(catB.data));
  const list=await req('GET','/api/categorias',undefined,ownerA.token,companyA.id);
  assert.ok(!(list.data||[]).some(x=>x.id===catB.data.id));
  const patch=await req('PATCH','/api/categorias/'+catB.data.id,{name:'Hijack'},ownerA.token,companyA.id);
  assert.equal(patch.status,404);
});

test('22 Tenant A não acessa banco Tenant B',async()=>{
  const bankB=await req('POST','/api/bancos',{name:'Banco B',account_id:analyticB.id,company_id:companyB.id},ownerB.token,companyB.id);
  assert.equal(bankB.status,201,JSON.stringify(bankB.data));
  const list=await req('GET','/api/bancos',undefined,ownerA.token,companyA.id);
  assert.ok(!(list.data||[]).some(x=>x.id===bankB.data.id));
  const getB=await req('GET','/api/plano-contas/analiticas?q=BANCO',undefined,ownerA.token);
  assert.ok(!(getB.data.items||[]).some(x=>x.id===analyticB.id));
});

test('23 Tenant A não altera categoria Tenant B',async()=>{
  const catB=db.prepare('SELECT id FROM categories WHERE tenant_id=? AND name=?').get(ownerB.user.tenant_id,'Cat B');
  const r=await req('PATCH','/api/categorias/'+catB.id,{active:false},ownerA.token);
  assert.equal(r.status,404);
});

test('24 Tenant A não altera banco Tenant B',async()=>{
  const bankB=db.prepare('SELECT id FROM banks WHERE tenant_id=? AND name=?').get(ownerB.user.tenant_id,'Banco B');
  const r=await req('PATCH','/api/bancos/'+bankB.id,{active:false},ownerA.token);
  assert.equal(r.status,404);
});

test('25 OWNER pode configurar',async()=>{
  const r=await req('POST','/api/categorias',{name:'Combustível',account_id:analyticA.id,company_id:companyA2.id},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  const scoped=await req('GET','/api/categorias',undefined,ownerA.token,companyA.id);
  assert.ok(!(scoped.data||[]).some(x=>x.id===r.data.id));
});

test('26 ACCOUNTANT pode configurar',async()=>{
  const r=await req('POST','/api/bancos',{name:'Nubank',account_id:analyticBank.id,company_id:companyA.id},accA.token,companyA.id);
  assert.equal(r.status,201,JSON.stringify(r.data));
});

test('27 CLIENT não pode configurar',async()=>{
  const cat=await req('POST','/api/categorias',{name:'Cliente Cat',account_id:analyticA.id},clientToken);
  assert.equal(cat.status,403);
  const bank=await req('POST','/api/bancos',{name:'Cliente Banco',account_id:analyticBank.id},clientToken);
  assert.equal(bank.status,403);
  const plan=await req('GET','/api/plano-contas/analiticas',undefined,clientToken);
  assert.equal(plan.status,403);
  const rules=await req('GET','/api/regras-contabeis',undefined,clientToken);
  assert.equal(rules.status,403);
});

test('28 categoria sem conta retorna diagnóstico específico',async()=>{
  const created=await req('POST','/api/categorias',{name:'Produtos de limpeza',account_id:analyticA.id,company_id:companyA2.id},ownerA.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  const cleared=await req('PATCH','/api/categorias/'+created.data.id,{account_id:null},ownerA.token);
  assert.equal(cleared.status,200);
  catNoAcc=cleared.data;
  const dx=await req('POST','/api/classificacao/diagnostico',{category_id:catNoAcc.id},ownerA.token,companyA2.id);
  assert.equal(dx.status,200,JSON.stringify(dx.data));
  assert.equal(dx.data.category_ready,false);
  assert.ok(dx.data.messages.some(m=>m==='A categoria Produtos de limpeza existe, mas ainda não possui conta contábil vinculada.'));
});

test('29 banco sem conta retorna diagnóstico específico',async()=>{
  const created=await req('POST','/api/bancos',{name:'Banco do Brasil',account_id:analyticBank.id,company_id:companyA2.id},ownerA.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  const cleared=await req('PATCH','/api/bancos/'+created.data.id,{account_id:null},ownerA.token);
  assert.equal(cleared.status,200);
  bankNoAcc=cleared.data;
  const dx=await req('POST','/api/classificacao/diagnostico',{bank_id:bankNoAcc.id},ownerA.token,companyA2.id);
  assert.equal(dx.status,200,JSON.stringify(dx.data));
  assert.equal(dx.data.bank_ready,false);
  assert.ok(dx.data.messages.some(m=>m==='O Banco do Brasil está cadastrado, mas ainda não possui conta contábil vinculada.'));
});

test('30 categoria + banco configurados retornam status completo',async()=>{
  const dx=await req('POST','/api/classificacao/diagnostico',{category_id:catId,bank_id:bankId},ownerA.token,companyA.id);
  assert.equal(dx.status,200,JSON.stringify(dx.data));
  assert.equal(dx.data.complete,true);
  assert.equal(dx.data.category_ready,true);
  assert.equal(dx.data.bank_ready,true);
  assert.ok(dx.data.messages.includes('Conta contábil da categoria identificada.'));
  assert.ok(dx.data.messages.includes('Conta contábil do banco identificada.'));
  assert.ok(dx.data.messages.includes('Categoria e banco possuem contas contábeis configuradas.'));
  assert.match(formSrc,/CdsSmartExpense\.open/);
  assert.match(formSrc,/category_id|categories/);
  assert.match(js,/CONFIGURAÇÕES CONTÁBEIS/);
  assert.match(js,/Pesquisar conta analítica/);
  assert.match(html,/app\.js\?v=s28-4-2/);
  assert.match(portalHtml,/portal\.js\?v=s28-4-2/);
});
