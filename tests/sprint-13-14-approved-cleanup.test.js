'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1314-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-14-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,EVENT_TYPES,entryStates,postingService}=require('../backend/src/server');

let server,base,ownerA,ownerB,companyA,companyB;
let accDesp,accBanco,accDesp2;
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
function insertAccount(tenantId,planId,code,type,desc,postable,active=1){
  const id=uuid();
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tenantId,planId,code,code,code,type,desc,null,1,postable?1:0,active);
  return {id,code,desc};
}
function entryRow(id){return db.prepare('SELECT * FROM entries WHERE id=?').get(id)}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1314 A',email:'owner.a.s1314@test.local',password,tenantName:'Tenant 1314 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1314@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1314 B',email:'owner.b.s1314@test.local',password,tenantName:'Tenant 1314 B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1314@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa 1314 A',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa 1314 B',cnpj:'22333444000192'},ownerB.token)).data;
  const planA=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planA,ownerA.user.tenant_id,'Plano 1314 A','ACTIVE');
  accDesp=insertAccount(ownerA.user.tenant_id,planA,'3210100012','A','ENERGIA ELETRICA',1);
  accDesp2=insertAccount(ownerA.user.tenant_id,planA,'3210100013','A','OUTRAS DESPESAS',1);
  accBanco=insertAccount(ownerA.user.tenant_id,planA,'1110200001','A','BANCO DO BRASIL',1);
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('1-2 APPROVED não é estado operacional nem transição',()=>{
  assert.equal(entryStates.STATUSES.APPROVED,undefined);
  assert.deepEqual(Object.keys(entryStates.STATUSES).sort(),['NEEDS_CLASSIFICATION','PENDING','PENDING_APPROVAL','POSTED','REJECTED'].sort());
  assert.equal(entryStates.canTransition('PENDING','APPROVED'),false);
  assert.equal(entryStates.canTransition('APPROVED','POSTED'),false);
  assert.equal(entryStates.canTransition('NEEDS_CLASSIFICATION','POSTED'),false);
  assert.equal(entryStates.canTransition('REJECTED','POSTED'),false);
  assert.equal(entryStates.canTransition('PENDING','POSTED'),true);
  assert.throws(()=>entryStates.assertTransition('PENDING','APPROVED'),e=>e.code==='INVALID_TRANSITION');
  assert.throws(()=>entryStates.assertTransition('APPROVED','POSTED'),e=>e.code==='INVALID_TRANSITION');
});

test('3-6 PENDING vira POSTED na aprovação; não vira APPROVED',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-18',description:'Aprovar 1314',lines:[{account_id:accDesp.id,side:'D',amount_cents:2100},{account_id:accBanco.id,side:'C',amount_cents:2100}]},ownerA.token);
  assert.equal(e.data.status,'PENDING');
  const ok=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal(ok.data.status,'POSTED');
  assert.equal(entryRow(e.data.id).status,'POSTED');
  assert.notEqual(ok.data.status,'APPROVED');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM entries WHERE id=? AND status='APPROVED'").get(e.data.id).n,0);
});

test('5 APPROVED residual não vira POSTED',()=>{
  const id=uuid();
  db.prepare("INSERT INTO entries(id,tenant_id,company_id,source_type,occurred_on,description,status,generated_by) VALUES(?,?,?,?,?,?,?,?)").run(id,ownerA.user.tenant_id,companyA.id,'MANUAL','2026-09-18','Residual APPROVED 1314','APPROVED',ownerA.user.id);
  db.prepare('INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents) VALUES(?,?,?,?,?)').run(uuid(),id,accDesp.id,'D',100);
  db.prepare('INSERT INTO entry_lines(id,entry_id,account_id,side,amount_cents) VALUES(?,?,?,?,?)').run(uuid(),id,accBanco.id,'C',100);
  const entry=db.prepare('SELECT * FROM entries WHERE id=?').get(id);
  assert.throws(()=>postingService.postFromApproval({entry,userId:ownerA.user.id,generatedByWorkflow:true}),e=>e.code==='INVALID_TRANSITION');
  assert.equal(entryRow(id).status,'APPROVED');
});

test('7-8 ENTRY_APPROVED e ENTRY_POSTED continuam registrados',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-18',description:'Eventos 1314',lines:[{account_id:accDesp.id,side:'D',amount_cents:2200},{account_id:accBanco.id,side:'C',amount_cents:2200}]},ownerA.token);
  await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type=? AND entity_id=?").get(EVENT_TYPES.ENTRY_APPROVED,e.data.id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type=? AND entity_id=?").get(EVENT_TYPES.ENTRY_POSTED,e.data.id).n,1);
  const a1=db.prepare("SELECT * FROM audit_logs WHERE action='ENTRY_APPROVED' AND entity_id=?").get(e.data.id);
  const a2=db.prepare("SELECT * FROM audit_logs WHERE action='ENTRY_POSTED' AND entity_id=?").get(e.data.id);
  assert.ok(a1);assert.ok(a2);
  assert.equal(JSON.parse(a2.after_json||'{}').status,'POSTED');
});

test('9 exportação continua aceitando POSTED',async()=>{
  const d=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-11',description:'Exp 1314',lines:[{account_id:accDesp.id,side:'D',amount_cents:1300},{account_id:accBanco.id,side:'C',amount_cents:1300}]},ownerA.token);
  await req('POST','/api/aprovacao/'+d.data.id+'/aprovar',{},ownerA.token);
  const exp=await req('POST','/api/exportacoes/gerar',{company_id:companyA.id,system_key:'dominio',period_start:'2026-09-11',period_end:'2026-09-11'},ownerA.token);
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  const ids=db.prepare('SELECT entry_id FROM export_items WHERE export_id=?').all(exp.data.id).map(x=>x.entry_id);
  assert.ok(ids.includes(d.data.id));
});

test('10-11 idempotência e concorrência',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-18',description:'Idem 1314',lines:[{account_id:accDesp.id,side:'D',amount_cents:3000},{account_id:accBanco.id,side:'C',amount_cents:3000}]},ownerA.token);
  const [r1,r2]=await Promise.all([
    req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token),
    req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token)
  ]);
  assert.ok([r1.status,r2.status].every(s=>s===200));
  assert.equal(entryRow(e.data.id).status,'POSTED');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM approvals WHERE entry_id=? AND action='APPROVE'").get(e.data.id).n,1);
  const again=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  assert.equal(again.data.status,'POSTED');
});

test('12 N-lines continua funcionando',async()=>{
  const n=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-18',description:'Nlines 1314',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accDesp2.id,side:'D',amount_cents:20000},{account_id:accBanco.id,side:'C',amount_cents:120000}]},ownerA.token);
  const posted=await req('POST','/api/aprovacao/'+n.data.id+'/aprovar',{},ownerA.token);
  assert.equal(posted.data.status,'POSTED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entry_lines WHERE entry_id=?').get(n.data.id).n,3);
});

test('13-14 rejeição e classificação sem APPROVED',async()=>{
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-18',description:'Ciclo 1314',amount:'80,00',payment_method:'PIX'},ownerA.token);
  assert.equal(exp.data.status,'NEEDS_CLASSIFICATION');
  await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Primeira',lines:[{account_id:accDesp.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  assert.equal(entryRow(exp.data.entry_id).status,'PENDING');
  await req('POST','/api/aprovacao/'+exp.data.entry_id+'/rejeitar',{reason:'Conta de frete incorreta. Revisar classificação.'},ownerA.token);
  assert.equal(entryRow(exp.data.entry_id).status,'NEEDS_CLASSIFICATION');
  await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Corrigida',lines:[{account_id:accDesp2.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+exp.data.entry_id+'/aprovar',{},ownerA.token);
  assert.equal(entryRow(exp.data.entry_id).status,'POSTED');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM entries WHERE source_id=? AND status='APPROVED'").get(exp.data.id).n,0);
});

test('15 multi-tenant: outro escritório não aprova',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-18',description:'Iso 1314',lines:[{account_id:accDesp.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  const approveB=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerB.token);
  assert.equal(approveB.status,404);
  assert.equal(entryRow(e.data.id).status,'PENDING');
});

test('código de produção não trata APPROVED como estado operacional',()=>{
  const root=path.resolve(__dirname,'..');
  const states=fs.readFileSync(path.join(root,'backend/src/accounting/entry-states.js'),'utf8');
  const boot=fs.readFileSync(path.join(root,'backend/src/server.js'),'utf8').split('\n').slice(0,45).join('\n');
  const office=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
  assert.doesNotMatch(states,/APPROVED:\s*'APPROVED'/);
  assert.doesNotMatch(boot,/WHERE status='APPROVED'/);
  assert.doesNotMatch(boot,/status='POSTED'.*status='APPROVED'/);
  assert.doesNotMatch(office,/APPROVED:'Aprovado'/);
  assert.match(fs.readFileSync(path.join(root,'backend/src/domain-events.js'),'utf8'),/ENTRY_APPROVED/);
});
