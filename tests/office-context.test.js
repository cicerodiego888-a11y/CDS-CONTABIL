'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s04-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-04';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,cremolia,empresaA2,empresaB1,blocked;
const password='Senha@123';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

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
async function uploadOffice(token,companyId,spoofCompany){
  const fd=new FormData();
  fd.append('file',new Blob([png],{type:'image/png'}),'comprovante.png');
  if(spoofCompany)fd.append('company_id',spoofCompany);
  const headers={Authorization:'Bearer '+token};
  if(companyId)headers['X-Company-Id']=companyId;
  const r=await fetch(base+'/api/documentos/upload',{method:'POST',headers,body:fd});
  let data=null;try{data=await r.json()}catch{}
  return {status:r.status,data};
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório A',email:'owner.a.s04@test.local',password,tenantName:'Escritório A',cnpj:'00000000000191'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s04@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório B',email:'owner.b.s04@test.local',password,tenantName:'Escritório B',cnpj:'00000000000191'});
  assert.equal(b.status,201,JSON.stringify(b.data));
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s04@test.local',password,tenant:b.data.tenant_slug})).data;
  cremolia=(await req('POST','/api/empresas',{name:'Cremolia Alimentos Ltda',trade_name:'Cremolia',cnpj:'11222333000181'},ownerA.token)).data;
  empresaA2=(await req('POST','/api/empresas',{name:'Empresa A2 Ltda',trade_name:'A2',cnpj:'22333444000192'},ownerA.token)).data;
  empresaB1=(await req('POST','/api/empresas',{name:'Empresa B1 Ltda',trade_name:'B1',cnpj:'33444555000103'},ownerB.token)).data;
  blocked=(await req('POST','/api/empresas',{name:'Empresa Bloqueada Ltda',trade_name:'Bloqueada',cnpj:'44555666000114'},ownerA.token)).data;
  await req('POST',`/api/empresas/${blocked.id}/bloquear`,{},ownerA.token);
  const expC=await req('POST','/api/despesas',{company_id:cremolia.id,occurred_on:'2026-09-10',description:'Despesa Cremolia',amount:'150,00',payment_method:'PIX'},ownerA.token);
  assert.equal(expC.status,201,JSON.stringify(expC.data));
  const expA2=await req('POST','/api/despesas',{company_id:empresaA2.id,occurred_on:'2026-09-11',description:'Despesa A2',amount:'80,00',payment_method:'DINHEIRO'},ownerA.token);
  assert.equal(expA2.status,201,JSON.stringify(expA2.data));
  const revC=await req('POST','/api/receitas',{company_id:cremolia.id,occurred_on:'2026-09-12',description:'Receita Cremolia',amount:'400,00',receipt_method:'PIX'},ownerA.token);
  assert.equal(revC.status,201,JSON.stringify(revC.data));
  const revA2=await req('POST','/api/receitas',{company_id:empresaA2.id,occurred_on:'2026-09-12',description:'Receita A2',amount:'50,00',receipt_method:'PIX'},ownerA.token);
  assert.equal(revA2.status,201,JSON.stringify(revA2.data));
  db.prepare('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason,status) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),ownerA.user.tenant_id,cremolia.id,'ENTRY',expC.data.id,'Pendência Cremolia','OPEN');
  db.prepare('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason,status) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),ownerA.user.tenant_id,empresaA2.id,'ENTRY',expA2.data.id,'Pendência A2','OPEN');
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('acessar empresa do próprio tenant',async()=>{
  const r=await req('GET','/api/empresas/'+cremolia.id,undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.trade_name,'Cremolia');
});

test('não acessar empresa de outro tenant',async()=>{
  const r=await req('GET','/api/empresas/'+empresaB1.id,undefined,ownerA.token);
  assert.equal(r.status,404);
  assert.equal(r.data.error,'NOT_FOUND');
});

test('estabelecer contexto filtra dashboard da empresa',async()=>{
  const overview=await req('GET','/api/dashboard',undefined,ownerA.token);
  assert.equal(overview.status,200);
  assert.equal(overview.data.company_id,null);
  assert.ok(overview.data.companies>=2);
  const ctx=await req('GET','/api/dashboard',undefined,ownerA.token,cremolia.id);
  assert.equal(ctx.status,200);
  assert.equal(ctx.data.company_id,cremolia.id);
  assert.equal(ctx.data.companies,1);
  assert.equal(ctx.data.revenue_cents,40000);
  assert.equal(ctx.data.expenses_cents,15000);
  assert.ok(ctx.data.movements>=1);
});

test('despesas, receitas, documentos, pendências e lançamentos no contexto',async()=>{
  const expenses=await req('GET','/api/despesas',undefined,ownerA.token,cremolia.id);
  assert.equal(expenses.status,200);
  assert.ok(items(expenses).every(x=>x.company_id===cremolia.id));
  assert.ok(items(expenses).some(x=>x.description==='Despesa Cremolia'));
  assert.ok(!items(expenses).some(x=>x.description==='Despesa A2'));
  const revenues=await req('GET','/api/receitas',undefined,ownerA.token,cremolia.id);
  assert.ok(items(revenues).every(x=>x.company_id===cremolia.id));
  const docs=await req('GET','/api/documentos',undefined,ownerA.token,cremolia.id);
  assert.equal(docs.status,200);
  assert.ok(items(docs).every(x=>x.company_id===cremolia.id));
  const pend=await req('GET','/api/pendencias',undefined,ownerA.token,cremolia.id);
  assert.ok(items(pend).every(x=>x.company_id===cremolia.id));
  assert.ok(items(pend).some(x=>x.reason==='Pendência Cremolia'));
  const entries=await req('GET','/api/lancamentos',undefined,ownerA.token,cremolia.id);
  assert.ok(items(entries).every(x=>x.company_id===cremolia.id));
  const approval=await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,cremolia.id);
  assert.ok(items(approval).every(x=>x.company_id===cremolia.id));
});

test('limpar contexto volta à visão geral',async()=>{
  const overview=await req('GET','/api/despesas',undefined,ownerA.token);
  assert.ok(items(overview).some(x=>x.company_id===cremolia.id));
  assert.ok(items(overview).some(x=>x.company_id===empresaA2.id));
});

test('spoof de company_id no body é ignorado pelo contexto',async()=>{
  const r=await req('POST','/api/despesas',{company_id:empresaA2.id,occurred_on:'2026-09-13',description:'Spoof no contexto Cremolia',amount:'10,00',payment_method:'PIX'},ownerA.token,cremolia.id);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.company_id,cremolia.id);
});

test('operação sem contexto exige empresa',async()=>{
  const r=await req('POST','/api/despesas',{occurred_on:'2026-09-13',description:'Sem empresa',amount:'10,00',payment_method:'PIX'},ownerA.token);
  assert.equal(r.status,400);
  assert.equal(r.data.error,'INVALID_FIELDS');
});

test('contexto inválido e empresa de outro tenant no header',async()=>{
  const invalid=await req('GET','/api/dashboard',undefined,ownerA.token,'empresa-inexistente');
  assert.equal(invalid.status,404);
  const other=await req('GET','/api/dashboard',undefined,ownerA.token,empresaB1.id);
  assert.equal(other.status,404);
  const write=await req('POST','/api/despesas',{company_id:empresaB1.id,occurred_on:'2026-09-13',description:'Outro tenant',amount:'10,00',payment_method:'PIX'},ownerA.token);
  assert.equal(write.status,404);
});

test('empresa bloqueada não aceita escrita',async()=>{
  const get=await req('GET','/api/empresas/'+blocked.id,undefined,ownerA.token);
  assert.equal(get.status,200);
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token,blocked.id);
  assert.equal(dash.status,200);
  const write=await req('POST','/api/despesas',{occurred_on:'2026-09-13',description:'Na bloqueada',amount:'10,00',payment_method:'PIX'},ownerA.token,blocked.id);
  assert.equal(write.status,409);
  assert.equal(write.data.error,'COMPANY_UNAVAILABLE');
});

test('nova despesa e documento no contexto sem seleção alternativa',async()=>{
  const exp=await req('POST','/api/despesas',{occurred_on:'2026-09-14',description:'Dentro do contexto',amount:'25,00',payment_method:'PIX'},ownerA.token,cremolia.id);
  assert.equal(exp.status,201);
  assert.equal(exp.data.company_id,cremolia.id);
  const doc=await uploadOffice(ownerA.token,cremolia.id,empresaA2.id);
  assert.equal(doc.status,201,JSON.stringify(doc.data));
  assert.equal(doc.data.company_id,cremolia.id);
});

test('exportação no contexto usa a empresa ativa',async()=>{
  const missing=await req('POST','/api/exportacoes/gerar',{system_key:'dominio',period_start:'2026-09-01',period_end:'2026-09-30'},ownerA.token);
  assert.equal(missing.status,400);
  const ok=await req('POST','/api/exportacoes/gerar',{company_id:empresaA2.id,system_key:'contaazul',period_start:'2026-09-01',period_end:'2026-09-30'},ownerA.token,cremolia.id);
  assert.equal(ok.status,201,JSON.stringify(ok.data));
  const row=db.prepare('SELECT company_id FROM exports WHERE id=?').get(ok.data.id);
  assert.equal(row.company_id,cremolia.id);
});

test('refresh restaura contexto pela URL e listagem permanece paginada',async()=>{
  const page=await fetch(base+'/empresas/'+cremolia.id);
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/app\.js\?v=s40-doc-preview/);
  const list=await req('GET','/api/empresas?page=1&page_size=50',undefined,ownerA.token,cremolia.id);
  assert.equal(list.status,200);
  assert.ok(list.data.total>=3);
  assert.ok(Array.isArray(list.data.items));
  const js=await fetch(base+'/assets/app.js?v=s13-15').then(r=>r.text());
  assert.match(js,/Acessar empresa/);
  assert.match(js,/X-Company-Id/);
  assert.match(js,/leaveCompany/);
  assert.match(js,/VISÃO GERAL DO ESCRITÓRIO/);
  assert.doesNotMatch(js,/Salvar e classificar/);
});

test('portal do cliente permanece isolado',async()=>{
  const portal=await fetch(base+'/portal/');
  assert.equal(portal.status,200);
  const html=await portal.text();
  assert.match(html,/portal\.js\?v=/);
  assert.doesNotMatch(html,/Acessar empresa/);
});
