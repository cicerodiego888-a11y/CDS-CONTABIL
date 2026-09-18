'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1315-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-15-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,companyA,companyA2,companyB,accDesp,accBanco,accDesp2;
const password='Senha@123';
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

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
function entryRow(id){return db.prepare('SELECT * FROM entries WHERE id=?').get(id)}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1315 A',email:'owner.a.s1315@test.local',password,tenantName:'Tenant 1315 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1315@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1315 B',email:'owner.b.s1315@test.local',password,tenantName:'Tenant 1315 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1315@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa 1315 A',cnpj:'11222333000181'},ownerA.token)).data;
  companyA2=(await req('POST','/api/empresas',{name:'Empresa 1315 A2',cnpj:'33444555000103'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa 1315 B',cnpj:'22333444000192'},ownerB.token)).data;
  const planA=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planA,ownerA.user.tenant_id,'Plano 1315 A','ACTIVE');
  accDesp=insertAccount(ownerA.user.tenant_id,planA,'3210400001','A','FRETES E CARRETOS',1);
  accDesp2=insertAccount(ownerA.user.tenant_id,planA,'3210100013','A','DESPESAS COM ENTREGA',1);
  accBanco=insertAccount(ownerA.user.tenant_id,planA,'1110200004','A','BANCO NUBANK',1);
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1-4 filas: classificação só NEEDS_CLASSIFICATION, aprovação só PENDING, POSTED fora',async()=>{
  const nc=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Frete fila 1315',amount:'120,00',payment_method:'PIX'},ownerA.token);
  const pend=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Pending fila 1315',lines:[{account_id:accDesp.id,side:'D',amount_cents:12000},{account_id:accBanco.id,side:'C',amount_cents:12000}]},ownerA.token);
  const posted=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Posted fila 1315',lines:[{account_id:accDesp.id,side:'D',amount_cents:5000},{account_id:accBanco.id,side:'C',amount_cents:5000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+posted.data.id+'/aprovar',{},ownerA.token);
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  const approval=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  const lanc=items(await req('GET','/api/lancamentos',undefined,ownerA.token,companyA.id));
  assert.ok(classif.every(x=>x.status==='NEEDS_CLASSIFICATION'));
  assert.ok(classif.some(x=>x.id===nc.data.entry_id));
  assert.ok(!classif.some(x=>x.id===pend.data.id||x.id===posted.data.id));
  assert.ok(approval.every(x=>x.status==='PENDING'));
  assert.ok(approval.some(x=>x.id===pend.data.id));
  assert.ok(!approval.some(x=>x.id===nc.data.entry_id||x.id===posted.data.id));
  assert.ok(lanc.every(x=>x.status==='POSTED'));
  assert.ok(lanc.some(x=>x.id===posted.data.id));
});

test('5-10 classificar envia para PENDING; aprovar vira POSTED e some da fila',async()=>{
  const fd=new FormData();
  fd.append('file',new Blob([pdf],{type:'application/pdf'}),'Comprovante PIX.pdf');
  fd.append('company_id',companyA.id);
  const up=await fetch(base+'/api/documentos/upload',{method:'POST',headers:{Authorization:'Bearer '+ownerA.token},body:fd});
  const doc=await up.json();
  assert.equal(up.status,201,JSON.stringify(doc));
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Frete',amount:'120,00',payment_method:'PIX',document_id:doc.id},ownerA.token);
  assert.equal(exp.data.status,'NEEDS_CLASSIFICATION');
  const cls=await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Frete operacional',lines:[{account_id:accDesp.id,side:'D',amount_cents:12000},{account_id:accBanco.id,side:'C',amount_cents:12000}]},ownerA.token);
  assert.equal(cls.data.status,'PENDING');
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  const approval=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  assert.ok(!classif.some(x=>x.id===exp.data.entry_id));
  assert.ok(approval.some(x=>x.id===exp.data.entry_id));
  const detail=await req('GET','/api/lancamentos/'+exp.data.entry_id,undefined,ownerA.token,companyA.id);
  assert.ok(detail.data.document&&detail.data.document.original_name);
  const ok=await req('POST','/api/aprovacao/'+exp.data.entry_id+'/aprovar',{},ownerA.token);
  assert.equal(ok.data.status,'POSTED');
  const approvalAfter=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  const lanc=items(await req('GET','/api/lancamentos',undefined,ownerA.token,companyA.id));
  assert.ok(!approvalAfter.some(x=>x.id===exp.data.entry_id));
  assert.ok(lanc.some(x=>x.id===exp.data.entry_id&&x.status==='POSTED'));
});

test('11 UI não exige Gerar lançamento; 12-13 rejeição',async()=>{
  const js=fs.readFileSync(path.join(__dirname,'../frontend/public/assets/app.js'),'utf8');
  assert.doesNotMatch(js,/Gerar lançamento/);
  assert.match(js,/Classificar →/);
  assert.match(js,/Revisar →/);
  assert.match(js,/Informe o motivo da rejeição/);
  assert.match(js,/viewOfficeDocument/);
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Rejeitar 1315',lines:[{account_id:accDesp.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  const empty=await req('POST','/api/aprovacao/'+e.data.id+'/rejeitar',{},ownerA.token);
  assert.equal(empty.status,400);
  const rej=await req('POST','/api/aprovacao/'+e.data.id+'/rejeitar',{reason:'Classificação incorreta.'},ownerA.token);
  assert.equal(rej.data.status,'NEEDS_CLASSIFICATION');
  assert.equal(entryRow(e.data.id).status,'NEEDS_CLASSIFICATION');
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  assert.ok(classif.some(x=>x.id===e.data.id));
});

test('14 N-lines no detalhe; 19-20 paginação e filtro',async()=>{
  const n=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Nlines 1315',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accDesp2.id,side:'D',amount_cents:20000},{account_id:accBanco.id,side:'C',amount_cents:120000}]},ownerA.token);
  const d=await req('GET','/api/lancamentos/'+n.data.id,undefined,ownerA.token,companyA.id);
  assert.equal((d.data.lines||[]).length,3);
  assert.equal(d.data.balanced,true);
  const page=await req('GET','/api/aprovacao/pendentes?page=1&page_size=25',undefined,ownerA.token,companyA.id);
  assert.equal(page.status,200);
  assert.ok(page.data.page>=1);
  const filtered=items(await req('GET','/api/aprovacao/pendentes?q=Nlines',undefined,ownerA.token,companyA.id));
  assert.ok(filtered.some(x=>x.id===n.data.id));
  const miss=items(await req('GET','/api/aprovacao/pendentes?q=zzzz-nao-existe',undefined,ownerA.token,companyA.id));
  assert.ok(!miss.some(x=>x.id===n.data.id));
});

test('16-18 isolamento empresa e tenant',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Iso 1315',lines:[{account_id:accDesp.id,side:'D',amount_cents:3000},{account_id:accBanco.id,side:'C',amount_cents:3000}]},ownerA.token);
  const otherTenant=await req('GET','/api/aprovacao/pendentes',undefined,ownerB.token,companyB.id);
  assert.ok(!items(otherTenant).some(x=>x.id===e.data.id));
  const otherCo=await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA2.id);
  assert.ok(!items(otherCo).some(x=>x.id===e.data.id));
  const own=await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id);
  assert.ok(items(own).some(x=>x.id===e.data.id));
  const spoof=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerB.token);
  assert.equal(spoof.status,404);
});
