'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s11-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-11-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,EVENT_TYPES,origens}=require('../backend/src/server');

let server,base,ownerA,ownerB,staffA,companyA,companyB,blocked,clientToken,clientId;
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
function uuid(){return crypto.randomUUID()}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório S11 A',email:'owner.a.s11@test.local',password,tenantName:'Tenant S11 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s11@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório S11 B',email:'owner.b.s11@test.local',password,tenantName:'Tenant S11 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s11@test.local',password,tenant:b.data.tenant_slug})).data;
  const staff=await req('POST','/api/usuarios',{name:'Staff S11',email:'staff.a.s11@test.local',password,role:'STAFF'},ownerA.token);
  assert.equal(staff.status,201,JSON.stringify(staff.data));
  staffA=(await req('POST','/api/auth/login',{email:'staff.a.s11@test.local',password,tenant:a.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Fort Construcoes Ltda',trade_name:'Fort Construcoes',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa B Ltda',trade_name:'Empresa B',cnpj:'22333444000192'},ownerB.token)).data;
  blocked=(await req('POST','/api/empresas',{name:'Bloqueada Ltda',trade_name:'Bloqueada',cnpj:'33444555000103'},ownerA.token)).data;
  await req('POST',`/api/empresas/${blocked.id}/bloquear`,{},ownerA.token);
  const cu=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cremolia User',email:'cremolia.s11@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const tok=cu.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+tok+'/accept',{name:'Cremolia User',password,confirmation:password});
  clientToken=acc.data.token;clientId=acc.data.user.id;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('carteira isolada por tenant',async()=>{
  const r=await req('GET','/api/empresas?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(r.status,200);
  assert.ok(items(r).every(x=>x.id===companyA.id||x.id===blocked.id));
  assert.ok(!items(r).some(x=>x.id===companyB.id));
});

test('paginação e busca server-side',async()=>{
  const r=await req('GET','/api/empresas?page=1&page_size=1',undefined,ownerA.token);
  assert.equal(items(r).length,1);
  assert.equal(r.data.page_size,1);
  const q=await req('GET','/api/empresas?q=Fort&page=1&page_size=25',undefined,ownerA.token);
  assert.ok(items(q).some(x=>x.id===companyA.id));
  assert.ok(!items(q).some(x=>x.id===blocked.id));
});

test('acesso à empresa e outro tenant 404',async()=>{
  const ok=await req('GET','/api/empresas/'+companyA.id,undefined,ownerA.token);
  assert.equal(ok.status,200);
  const other=await req('GET','/api/empresas/'+companyB.id,undefined,ownerA.token);
  assert.equal(other.status,404);
  const op=await req('GET','/api/empresas/'+companyB.id+'/operacional',undefined,ownerA.token);
  assert.equal(op.status,404);
});

test('empresa bloqueada: leitura ok, escrita 409',async()=>{
  const read=await req('GET','/api/empresas/'+blocked.id,undefined,ownerA.token);
  assert.equal(read.status,200);
  const write=await req('POST','/api/despesas',{company_id:blocked.id,occurred_on:'2026-09-15',description:'X',amount:'10,00',payment_method:'PIX'},ownerA.token);
  assert.equal(write.status,409);
  const imp=await req('POST','/api/importacoes',{company_id:blocked.id,origin:'IMPORTACAO_CONTABIL',movements:[{type:'EXPENSE',occurred_on:'2026-09-15',description:'X',amount:'10,00',payment_method:'PIX'}]},ownerA.token);
  assert.equal(imp.status,409);
});

test('contexto X-Company-Id é autoridade do backend',async()=>{
  const spoof=await req('POST','/api/despesas',{company_id:companyB.id,occurred_on:'2026-09-15',description:'Spoof',amount:'10,00',payment_method:'PIX'},ownerA.token,companyA.id);
  assert.equal(spoof.status,201);
  assert.equal(spoof.data.company_id,companyA.id);
  const other=await req('GET','/api/dashboard',undefined,ownerA.token,companyB.id);
  assert.equal(other.status,404);
});

test('indicadores da carteira não misturam tenant',async()=>{
  const dashA=await req('GET','/api/dashboard',undefined,ownerA.token);
  const dashB=await req('GET','/api/dashboard',undefined,ownerB.token);
  assert.equal(dashA.status,200);
  assert.ok(dashA.data.total_companies>=2);
  assert.equal(dashB.data.total_companies,1);
  assert.ok(dashA.data.active_companies>=1);
});

test('despesa do portal com origem PORTAL_CLIENTE, evento e notificação',async()=>{
  const fd=new FormData();
  fd.append('file',new Blob([png],{type:'image/png'}),'frete.png');
  const up=await fetch(base+'/api/client/documentos',{method:'POST',headers:{Authorization:'Bearer '+clientToken},body:fd});
  const doc=await up.json();
  assert.equal(up.status,201);
  const exp=await req('POST','/api/client/despesas',{occurred_on:'2026-09-15',description:'Frete',amount:'120,00',payment_method:'PIX',document_id:doc.id},clientToken);
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  assert.equal(exp.data.origin,'PORTAL_CLIENTE');
  const ev=db.prepare("SELECT * FROM domain_events WHERE event_type='EXPENSE_CREATED' AND entity_id=?").get(exp.data.id);
  assert.ok(ev);
  const notes=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,ownerA.token);
  assert.ok(items(notes).some(x=>x.entity_id===exp.data.id&&/despesa/i.test(x.title+x.message)));
  const op=await req('GET','/api/empresas/'+companyA.id+'/operacional',undefined,ownerA.token);
  assert.ok(op.data.expenses>=1);
  assert.ok(op.data.documents>=1);
  assert.ok(op.data.origins.some(x=>x.origin==='PORTAL_CLIENTE'));
});

test('CLIENT não cadastra receita; receita por importação',async()=>{
  const denyRev=await req('POST','/api/client/receitas',{occurred_on:'2026-09-15',description:'Venda',amount:'10,00',receipt_method:'PIX'},clientToken);
  assert.equal(denyRev.status,403);
  assert.equal(denyRev.data.error,'REVENUE_NOT_AVAILABLE_FOR_CLIENT');
  const imp=await req('POST','/api/importacoes',{company_id:companyA.id,origin:'IMPORTACAO_CONTABIL',period_start:'2026-09-01',period_end:'2026-09-30',movements:[{type:'REVENUE',occurred_on:'2026-09-15',description:'Venda importada',amount:'250,00',receipt_method:'PIX'}]},ownerA.token);
  assert.equal(imp.status,201,JSON.stringify(imp.data));
  assert.equal(imp.data.origin,'IMPORTACAO_CONTABIL');
  assert.equal(imp.data.status,'CONCLUIDA');
  const revs=await req('GET','/api/receitas?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  const row=items(revs).find(x=>x.description==='Venda importada');
  assert.ok(row);
  assert.equal(row.origin,'IMPORTACAO_CONTABIL');
  const ev=db.prepare("SELECT * FROM domain_events WHERE event_type=? AND entity_id=?").get(EVENT_TYPES.REVENUE_CREATED,row.id);
  assert.ok(ev);
  const view=await req('GET','/api/client/receitas',undefined,clientToken);
  assert.ok(view.data.some(x=>x.id===row.id));
});

test('origens CDS_SISTEMAS e IMPORTACAO_FISCAL sem provider externo',async()=>{
  const cds=await req('POST','/api/importacoes',{company_id:companyA.id,origin:'CDS_SISTEMAS',period_start:'2026-09-01',period_end:'2026-09-30',movements:[{type:'EXPENSE',occurred_on:'2026-09-14',description:'Do CDS',amount:'40,00',payment_method:'PIX'}]},ownerA.token);
  assert.equal(cds.status,201,JSON.stringify(cds.data));
  assert.equal(cds.data.origin_label,'CDS Sistemas');
  const fiscal=await req('POST','/api/importacoes',{company_id:companyA.id,origin:'IMPORTACAO_FISCAL',movements:[{type:'EXPENSE',occurred_on:'2026-09-13',description:'NF',amount:'15,00',payment_method:'BOLETO'}]},ownerA.token);
  assert.equal(fiscal.status,201);
  const list=await req('GET','/api/importacoes?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  const origins=items(list).map(x=>x.origin);
  assert.ok(origins.includes('CDS_SISTEMAS'));
  assert.ok(origins.includes('IMPORTACAO_FISCAL'));
  assert.ok(!JSON.stringify(list.data).includes('api_token'));
  const company=await req('GET','/api/empresas/'+companyA.id,undefined,ownerA.token);
  assert.equal(Number(company.data.cds_systems_enabled||0),0);
});

test('empresa sem CDS continua operacional',async()=>{
  const exp=await req('POST','/api/client/despesas',{occurred_on:'2026-09-15',description:'Água',amount:'80,00',payment_method:'PIX'},clientToken);
  assert.equal(exp.status,201);
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(dash.status,200);
  assert.ok(dash.data.movements>=1);
  const portal=fs.readFileSync(path.join(__dirname,'../frontend/public/portal/portal.js'),'utf8');
  assert.doesNotMatch(portal,/Nova receita/);
});

test('pendências, solicitações, classificações e aprovações na visão operacional',async()=>{
  db.prepare('INSERT INTO pendencies(id,tenant_id,company_id,entity_type,entity_id,reason,status) VALUES(?,?,?,?,?,?,?)').run(uuid(),ownerA.user.tenant_id,companyA.id,'ENTRY','x','Doc','OPEN');
  const sol=await req('POST','/api/solicitacoes',{company_id:companyA.id,type:'DOCUMENT',title:'Enviar NF',description:'NF'},ownerA.token);
  assert.equal(sol.status,201);
  const op=await req('GET','/api/empresas/'+companyA.id+'/operacional',undefined,ownerA.token);
  assert.ok(op.data.pendencies>=1);
  assert.ok(op.data.requests>=1);
  assert.ok(op.data.classifications>=0);
  assert.ok(op.data.approvals>=0);
  const carteira=await req('GET','/api/empresas?q=Fort',undefined,ownerA.token);
  const card=items(carteira).find(x=>x.id===companyA.id);
  assert.ok(card.pending_count>=1);
  assert.ok(card.open_requests>=1);
});

test('eventos de importação e auditoria',async()=>{
  const imp=await req('POST','/api/importacoes',{company_id:companyA.id,origin:'IMPORTACAO_CONTABIL',movements:[{type:'EXPENSE',occurred_on:'2026-09-12',description:'Material',amount:'9,00',payment_method:'PIX'}]},ownerA.token);
  assert.equal(imp.status,201);
  const created=db.prepare("SELECT * FROM domain_events WHERE event_type='IMPORT_CREATED' AND entity_id=?").get(imp.data.id);
  const done=db.prepare("SELECT * FROM domain_events WHERE event_type='IMPORT_COMPLETED' AND entity_id=?").get(imp.data.id);
  assert.ok(created);assert.ok(done);
  const audit=db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action IN('IMPORT_CREATED','IMPORT_COMPLETED') AND entity_id=?").get(ownerA.user.tenant_id,imp.data.id);
  assert.ok(audit.n>=2);
});

test('notificações isoladas e usuários inativos',async()=>{
  await req('PATCH','/api/usuarios/'+staffA.user.id,{active:false},ownerA.token);
  const exp=await req('POST','/api/client/despesas',{occurred_on:'2026-09-15',description:'Inativo',amount:'11,00',payment_method:'PIX'},clientToken);
  assert.equal(exp.status,201);
  const notesStaff=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,staffA.token);
  assert.equal(notesStaff.status,200);
  assert.ok(!items(notesStaff).some(x=>x.entity_id===exp.data.id));
  const notesB=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,ownerB.token);
  assert.ok(!items(notesB).some(x=>x.entity_id===exp.data.id));
});

test('CLIENT não acessa central, importações nem regras',async()=>{
  for(const url of['/api/empresas','/api/importacoes','/api/dashboard','/api/regras-contabeis','/api/comunicacoes/config']){
    const r=await req('GET',url,undefined,clientToken);
    assert.equal(r.status,403,url);
  }
});

test('escala 1000 empresas e agregação sem N+1 aparente',async()=>{
  const ins=db.prepare('INSERT INTO companies(id,tenant_id,name,trade_name,cnpj,status) VALUES(?,?,?,?,?,?)');
  db.transaction(()=>{
    for(let i=1;i<=1000;i++){
      ins.run(uuid(),ownerA.user.tenant_id,`Empresa Escala ${String(i).padStart(4,'0')}`,`Escala ${i}`,String(40000000000000+i),'ACTIVE');
    }
  })();
  const t0=Date.now();
  const r=await req('GET','/api/empresas?page=1&page_size=25',undefined,ownerA.token);
  const ms=Date.now()-t0;
  assert.equal(r.status,200);
  assert.equal(items(r).length,25);
  assert.ok(r.data.total>=1000);
  assert.ok(ms<2500,`GET /api/empresas lento: ${ms}ms`);
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token);
  assert.ok(dash.data.total_companies>=1000);
  assert.ok(origens.isValid('PORTAL_CLIENTE'));
});
