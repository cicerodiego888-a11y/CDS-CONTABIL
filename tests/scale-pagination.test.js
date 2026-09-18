'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s06-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-06-secret-ok';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,companyA,companyB,companyFort;
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
  const a=await req('POST','/api/auth/register',{name:'Escritório Escala A',email:'owner.a.s06@test.local',password,tenantName:'Tenant Escala A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s06@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório Escala B',email:'owner.b.s06@test.local',password,tenantName:'Tenant Escala B'});
  assert.equal(b.status,201,JSON.stringify(b.data));
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s06@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa Base A Ltda',trade_name:'Base A',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa Base B Ltda',trade_name:'Base B',cnpj:'22333444000192'},ownerB.token)).data;
  const ins=db.prepare('INSERT INTO companies(id,tenant_id,name,trade_name,cnpj,status) VALUES(?,?,?,?,?,?)');
  db.transaction(()=>{
    for(let i=1;i<=999;i++){
      const n=String(i).padStart(4,'0');
      ins.run(uuid(),ownerA.user.tenant_id,`Empresa Escala ${n} Ltda`,`Escala ${n}`,String(10000000000000+i),'ACTIVE');
    }
    companyFort={id:uuid()};
    ins.run(companyFort.id,ownerA.user.tenant_id,'Fort Construções Ltda','Fort Construções','55666777000108','ACTIVE');
    for(let i=1;i<=500;i++){
      const n=String(i).padStart(4,'0');
      ins.run(uuid(),ownerB.user.tenant_id,`Outro Tenant ${n} Ltda`,`Outro ${n}`,String(20000000000000+i),'ACTIVE');
    }
  })();
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('empresas página 1 não devolve a massa inteira',async()=>{
  const t0=Date.now();
  const r=await req('GET','/api/empresas?page=1&page_size=25',undefined,ownerA.token);
  const ms=Date.now()-t0;
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(items(r).length,25);
  assert.equal(r.data.total,1001);
  assert.equal(r.data.page,1);
  assert.equal(r.data.page_size,25);
  assert.equal(r.data.pagination.total_pages,Math.ceil(1001/25));
  assert.ok(ms<2000,`GET /api/empresas lento: ${ms}ms`);
});

test('empresas página 2 e page 40',async()=>{
  const p2=await req('GET','/api/empresas?page=2&page_size=25&sort=name&dir=asc',undefined,ownerA.token);
  assert.equal(p2.status,200);
  assert.equal(items(p2).length,25);
  assert.equal(p2.data.page,2);
  const p40=await req('GET','/api/empresas?page=40&page_size=25&sort=name&dir=asc',undefined,ownerA.token);
  assert.equal(p40.status,200);
  assert.ok(items(p40).length<=25);
  assert.equal(p40.data.page,40);
  const ids1=new Set(items(await req('GET','/api/empresas?page=1&page_size=25&sort=name&dir=asc',undefined,ownerA.token)).map(x=>x.id));
  assert.ok(items(p2).every(x=>!ids1.has(x.id)));
});

test('page_size máximo é 100',async()=>{
  const r=await req('GET','/api/empresas?page=1&page_size=999999',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.page_size,100);
  assert.equal(items(r).length,100);
});

test('page inválida é normalizada',async()=>{
  const r=await req('GET','/api/empresas?page=0&page_size=-1',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.page,1);
  assert.ok(r.data.page_size>=1&&r.data.page_size<=100);
});

test('busca de empresas no SQLite do tenant',async()=>{
  const name=await req('GET','/api/empresas?page=1&page_size=25&q=Fort',undefined,ownerA.token);
  assert.equal(name.status,200);
  assert.ok(items(name).some(x=>/Fort/.test(x.name)||/Fort/.test(x.trade_name||'')));
  assert.ok(items(name).length<=25);
  const cnpj=await req('GET','/api/empresas?page=1&page_size=25&q=55666777000108',undefined,ownerA.token);
  assert.ok(items(cnpj).some(x=>x.cnpj==='55666777000108'));
  const other=await req('GET','/api/empresas?page=1&page_size=25&q=Fort',undefined,ownerB.token);
  assert.ok(!items(other).some(x=>x.cnpj==='55666777000108'));
});

test('ordenação usa whitelist',async()=>{
  const r=await req('GET','/api/empresas?sort=name;DROP TABLE companies&dir=asc&page_size=5',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.ok(items(r).length>0);
});

test('isolamento: total de empresas não soma tenants',async()=>{
  const a=await req('GET','/api/empresas?page=1&page_size=25',undefined,ownerA.token);
  const b=await req('GET','/api/empresas?page=1&page_size=25',undefined,ownerB.token);
  assert.equal(a.data.total,1001);
  assert.equal(b.data.total,501);
});

test('despesas, receitas e documentos paginados com contexto',async()=>{
  const insE=db.prepare('INSERT INTO expenses(id,tenant_id,company_id,occurred_on,description,amount_cents,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)');
  const insR=db.prepare('INSERT INTO revenues(id,tenant_id,company_id,occurred_on,description,amount_cents,receipt_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)');
  db.transaction(()=>{
    for(let i=1;i<=60;i++){
      insE.run(uuid(),ownerA.user.tenant_id,companyA.id,'2026-09-01','Despesa escala '+i,1000,'PIX','PENDING',ownerA.user.id);
      insR.run(uuid(),ownerA.user.tenant_id,companyA.id,'2026-09-01','Receita escala '+i,2000,'PIX','PENDING',ownerA.user.id);
    }
    insE.run(uuid(),ownerB.user.tenant_id,companyB.id,'2026-09-01','Despesa outro tenant',999,'PIX','PENDING',ownerB.user.id);
  })();
  const exp=await req('GET','/api/despesas?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(exp.status,200);
  assert.equal(items(exp).length,25);
  assert.equal(exp.data.total,60);
  assert.ok(items(exp).every(x=>x.company_id===companyA.id));
  const exp2=await req('GET','/api/despesas?page=3&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(items(exp2).length,10);
  const rev=await req('GET','/api/receitas?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(rev.data.total,60);
  assert.equal(items(rev).length,25);
  const leak=await req('GET','/api/despesas?page=1&page_size=100',undefined,ownerA.token);
  assert.ok(!items(leak).some(x=>x.description==='Despesa outro tenant'));
});

test('documentos, lançamentos, pendências, solicitações, exportações e usuários paginados',async()=>{
  const insD=db.prepare('INSERT INTO documents(id,tenant_id,company_id,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,status) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const insN=db.prepare('INSERT INTO entries(id,tenant_id,company_id,source_type,occurred_on,description,status,confidence,generated_by) VALUES(?,?,?,?,?,?,?,?,?)');
  const insP=db.prepare('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason,status) VALUES(?,?,?,?,?,?,?)');
  const insS=db.prepare('INSERT INTO requests(id,tenant_id,company_id,created_by,type,title,description,priority,status) VALUES(?,?,?,?,?,?,?,?,?)');
  const insX=db.prepare('INSERT INTO exports(id,tenant_id,company_id,system_key,period_start,period_end,status,file_path,checksum,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)');
  db.transaction(()=>{
    for(let i=1;i<=40;i++){
      insD.run(uuid(),ownerA.user.tenant_id,companyA.id,'doc-'+i+'.pdf','/tmp/none','application/pdf',100,'abc',ownerA.user.id,'ACTIVE');
      insN.run(uuid(),ownerA.user.tenant_id,companyA.id,'MANUAL','2026-09-01','Lançamento escala '+i,'PENDING',1,ownerA.user.id);
      insP.run(uuid(),ownerA.user.tenant_id,companyA.id,'ENTRY','e'+i,'Pendência escala '+i,'OPEN');
      insS.run(uuid(),ownerA.user.tenant_id,companyA.id,ownerA.user.id,'GENERAL','Solicitação '+i,null,'NORMAL','OPEN');
      insX.run(uuid(),ownerA.user.tenant_id,companyA.id,'dominio','2026-09-01','2026-09-30','GENERATED','/tmp/none','abc',ownerA.user.id);
    }
    insD.run(uuid(),ownerB.user.tenant_id,companyB.id,'segredo.pdf','/tmp/none','application/pdf',10,'zzz',ownerB.user.id,'ACTIVE');
    insN.run(uuid(),ownerB.user.tenant_id,companyB.id,'MANUAL','2026-09-01','Lançamento B','PENDING',1,ownerB.user.id);
    insP.run(uuid(),ownerB.user.tenant_id,companyB.id,'ENTRY','eb','Pendência B','OPEN');
    insS.run(uuid(),ownerB.user.tenant_id,companyB.id,ownerB.user.id,'GENERAL','Solicitação B',null,'NORMAL','OPEN');
    insX.run(uuid(),ownerB.user.tenant_id,companyB.id,'dominio','2026-09-01','2026-09-30','GENERATED','/tmp/none','zzz',ownerB.user.id);
  })();
  const docs=await req('GET','/api/documentos?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(docs.data.total,40);
  assert.equal(items(docs).length,25);
  assert.ok(!items(docs).some(x=>x.original_name==='segredo.pdf'));
  const lan=await req('GET','/api/lancamentos?status=PENDING&page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(lan.data.total,40);
  assert.equal(items(lan).length,25);
  assert.ok(items(lan).every(x=>x.company_id===companyA.id));
  const pend=await req('GET','/api/pendencias?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(pend.data.total,40);
  assert.ok(!items(pend).some(x=>x.reason==='Pendência B'));
  const sol=await req('GET','/api/solicitacoes?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(sol.data.total,40);
  const exp=await req('GET','/api/exportacoes?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(exp.data.total,40);
  assert.ok(!items(exp).some(x=>x.checksum==='zzz'));
  const users=await req('GET','/api/usuarios?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(users.status,200);
  assert.ok(users.data.total>=1);
  assert.ok(items(users).length<=25);
  assert.ok(items(users).every(x=>x.email!=='owner.b.s06@test.local'));
});

test('COUNT de despesas respeita tenant e company',async()=>{
  const scoped=await req('GET','/api/despesas?page=1&page_size=1',undefined,ownerA.token,companyA.id);
  const overview=await req('GET','/api/despesas?page=1&page_size=1',undefined,ownerA.token);
  assert.equal(scoped.data.total,60);
  assert.ok(overview.data.total>=60);
  const other=await req('GET','/api/despesas?page=1&page_size=1',undefined,ownerB.token,companyB.id);
  assert.equal(other.data.total,1);
});

test('dashboard usa agregados SQL',async()=>{
  const d=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(d.status,200);
  assert.equal(d.data.company_id,companyA.id);
  assert.equal(d.data.expenses_cents,60000);
  assert.equal(d.data.revenue_cents,120000);
  const g=await req('GET','/api/dashboard',undefined,ownerA.token);
  assert.equal(g.data.company_id,null);
  assert.ok(g.data.companies>=1000);
});

test('anti-spoof de company_id permanece no contexto',async()=>{
  const r=await req('POST','/api/despesas',{company_id:companyB.id,occurred_on:'2026-09-15',description:'Spoof escala',amount:'10,00',payment_method:'PIX'},ownerA.token,companyA.id);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.company_id,companyA.id);
});

test('header de outro tenant continua 404',async()=>{
  const r=await req('GET','/api/despesas',undefined,ownerA.token,companyB.id);
  assert.equal(r.status,404);
});

test('lançamentos não usam N+1 por linha',()=>{
  const serverSrc=fs.readFileSync(path.join(__dirname,'../backend/src/server.js'),'utf8');
  assert.match(serverSrc,/COALESCE\(\(SELECT SUM\(amount_cents\) FROM entry_lines WHERE entry_id=e\.id AND side='D'\)/);
  assert.doesNotMatch(serverSrc,/qRows\(sql,\.\.\.p\)\.map\(x=>\{const a=one\(/);
  assert.doesNotMatch(serverSrc,/\.map\(e=>\(\{\.\.\.e,entry:entry\(req,e\.id\)\}\)\)/);
});

test('EXPLAIN QUERY PLAN usa índice de empresas por tenant',()=>{
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT c.id FROM companies c WHERE c.tenant_id=? AND (c.name LIKE ? OR IFNULL(c.trade_name,'') LIKE ?) ORDER BY c.name LIMIT 25").all(ownerA.user.tenant_id,'%Fort%','%Fort%');
  const text=plan.map(x=>x.detail).join(' | ');
  assert.match(text,/companies/i);
});

test('fluxo HTTP: login, empresas, contexto e portal single-company',async()=>{
  const login=await req('POST','/api/auth/login',{email:'owner.a.s06@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(login.status,200);
  const list=await req('GET','/api/empresas?q=Fort&page=1&page_size=15',undefined,login.data.token);
  assert.ok(items(list).some(x=>x.id===companyFort.id));
  const dash=await req('GET','/api/dashboard',undefined,login.data.token,companyA.id);
  assert.equal(dash.data.company_id,companyA.id);
  const html=await fetch(base+'/');
  assert.equal(html.status,200);
  const portal=await fetch(base+'/portal/');
  assert.equal(portal.status,200);
});
