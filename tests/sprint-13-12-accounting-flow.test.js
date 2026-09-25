'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1312-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-12-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,EVENT_TYPES,entryStates}=require('../backend/src/server');

let server,base,ownerA,ownerB,companyA,companyB,clientToken;
let accDesp,accDesp2,accBanco,accCaixa,accSynth,accInactive;
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
function insertAccount(tenantId,planId,code,type,desc,postable,active=1){
  const id=uuid();
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tenantId,planId,code,code,code,type,desc,null,1,postable?1:0,active);
  return {id,code,desc};
}
function entryRow(id){return db.prepare('SELECT * FROM entries WHERE id=?').get(id)}
function linesCount(id){return db.prepare('SELECT COUNT(*) n FROM entry_lines WHERE entry_id=?').get(id).n}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1312 A',email:'owner.a.s1312@test.local',password,tenantName:'Tenant 1312 A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1312@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório 1312 B',email:'owner.b.s1312@test.local',password,tenantName:'Tenant 1312 B'});
  assert.equal(b.status,201,JSON.stringify(b.data));
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s1312@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa 1312 A',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa 1312 B',cnpj:'22333444000192'},ownerB.token)).data;
  const planA=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planA,ownerA.user.tenant_id,'Plano 1312 A','ACTIVE');
  accSynth=insertAccount(ownerA.user.tenant_id,planA,'3','S','DESPESAS',0);
  accDesp=insertAccount(ownerA.user.tenant_id,planA,'3210100012','A','ENERGIA ELETRICA',1);
  accDesp2=insertAccount(ownerA.user.tenant_id,planA,'3210100013','A','OUTRAS DESPESAS',1);
  accBanco=insertAccount(ownerA.user.tenant_id,planA,'1110200001','A','BANCO DO BRASIL',1);
  accCaixa=insertAccount(ownerA.user.tenant_id,planA,'1110100001','A','CAIXA GERAL',1);
  accInactive=insertAccount(ownerA.user.tenant_id,planA,'1110300001','A','CONTA INATIVA',1,0);
  const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente 1312',email:'cliente.s1312@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const token=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+token+'/accept',{name:'Cliente 1312',password,confirmation:password});
  assert.equal(acc.status,200,JSON.stringify(acc.data));
  clientToken=acc.data.token;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('PENDING no banco equivale a PENDING_APPROVAL',()=>{
  assert.equal(entryStates.PENDING_APPROVAL,'PENDING');
  entryStates.assertTransition('NEEDS_CLASSIFICATION','PENDING');
  assert.throws(()=>entryStates.assertTransition('NEEDS_CLASSIFICATION','POSTED'));
  assert.throws(()=>entryStates.assertTransition('PENDING','NEEDS_CLASSIFICATION'));
});

test('1-4 filas: classificação vs aprovação',async()=>{
  const nc=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Fila NC 1312',amount:'10,00',payment_method:'PIX'},ownerA.token);
  assert.equal(nc.status,201);
  assert.equal(nc.data.status,'NEEDS_CLASSIFICATION');
  const pend=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Fila PENDING 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:1000},{account_id:accBanco.id,side:'C',amount_cents:1000}]},ownerA.token);
  assert.equal(pend.status,201);
  assert.equal(pend.data.status,'PENDING');
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  const approval=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  assert.ok(classif.some(x=>x.id===nc.data.entry_id));
  assert.ok(!classif.some(x=>x.id===pend.data.id));
  assert.ok(approval.some(x=>x.id===pend.data.id));
  assert.ok(!approval.some(x=>x.id===nc.data.entry_id));
  assert.ok(approval.every(x=>x.status==='PENDING'));
});

test('5-8 aprovação exige classificação, gera POSTED único',async()=>{
  const nc=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Aprovar NC 1312',amount:'15,00',payment_method:'PIX'},ownerA.token);
  const bad=await req('POST','/api/aprovacao/'+nc.data.entry_id+'/aprovar',{},ownerA.token);
  assert.equal(bad.status,409);
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Aprovar POSTED 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:1500},{account_id:accBanco.id,side:'C',amount_cents:1500}]},ownerA.token);
  const ok=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal(ok.data.status,'POSTED');
  assert.equal(entryRow(e.data.id).status,'POSTED');
  assert.equal(entryRow(e.data.id).generated_by_workflow,1);
  const again=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  assert.equal(again.status,200);
  assert.equal(again.data.status,'POSTED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM approvals WHERE entry_id=? AND action=\'APPROVE\'').get(e.data.id).n,1);
  assert.equal(linesCount(e.data.id),2);
});

test('6-7 desbalanceado não aprova',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Bal 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:2000},{account_id:accBanco.id,side:'C',amount_cents:2000}]},ownerA.token);
  db.prepare("UPDATE entry_lines SET amount_cents=1 WHERE entry_id=? AND side='C'").run(e.data.id);
  const r=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  assert.equal(r.status,422);
  assert.equal(entryRow(e.data.id).status,'PENDING');
});

test('10-11 duas aprovações simultâneas e ENTRY_POSTED após efetivação',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Concorrência 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:3000},{account_id:accBanco.id,side:'C',amount_cents:3000}]},ownerA.token);
  const [r1,r2]=await Promise.all([
    req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token),
    req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token)
  ]);
  assert.ok([r1.status,r2.status].every(s=>s===200));
  assert.equal(entryRow(e.data.id).status,'POSTED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM approvals WHERE entry_id=? AND action=\'APPROVE\'').get(e.data.id).n,1);
  assert.equal(linesCount(e.data.id),2);
  const posted=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type=? AND entity_id=?").get(EVENT_TYPES.ENTRY_POSTED,e.data.id).n;
  const approved=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type=? AND entity_id=?").get(EVENT_TYPES.ENTRY_APPROVED,e.data.id).n;
  assert.equal(posted,1);
  assert.equal(approved,1);
});

test('12-13 auditoria ENTRY_APPROVED e ENTRY_POSTED',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Audit 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:4000},{account_id:accBanco.id,side:'C',amount_cents:4000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  const a1=db.prepare("SELECT * FROM audit_logs WHERE action='ENTRY_APPROVED' AND entity_id=?").get(e.data.id);
  const a2=db.prepare("SELECT * FROM audit_logs WHERE action='ENTRY_POSTED' AND entity_id=?").get(e.data.id);
  assert.ok(a1);assert.ok(a2);
  assert.equal(a1.tenant_id,ownerA.user.tenant_id);
  assert.equal(a1.user_id,ownerA.user.id);
  const after=JSON.parse(a2.after_json||'{}');
  assert.equal(after.status,'POSTED');
  assert.equal(after.generated_by_workflow,true);
  assert.equal(after.company_id,companyA.id);
});

test('14-16 rejeição exige motivo e volta à classificação',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Rejeitar 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:5000},{account_id:accBanco.id,side:'C',amount_cents:5000}]},ownerA.token);
  const empty=await req('POST','/api/aprovacao/'+e.data.id+'/rejeitar',{},ownerA.token);
  assert.equal(empty.status,400);
  const rej=await req('POST','/api/aprovacao/'+e.data.id+'/rejeitar',{reason:'Conta de frete incorreta. Revisar classificação.'},ownerA.token);
  assert.equal(rej.status,200,JSON.stringify(rej.data));
  assert.equal(rej.data.status,'NEEDS_CLASSIFICATION');
  assert.equal(entryRow(e.data.id).status,'NEEDS_CLASSIFICATION');
  const approval=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  assert.ok(!approval.some(x=>x.id===e.data.id));
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  assert.ok(classif.some(x=>x.id===e.data.id));
  const ev=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type=? AND entity_id=?").get(EVENT_TYPES.ENTRY_REJECTED,e.data.id).n;
  assert.equal(ev,1);
});

test('17-20 POSTED na tela de lançamentos; filas não misturam',async()=>{
  const posted=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Lista POSTED 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:6000},{account_id:accBanco.id,side:'C',amount_cents:6000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+posted.data.id+'/aprovar',{},ownerA.token);
  const nc=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Lista NC 1312',amount:'20,00',payment_method:'PIX'},ownerA.token);
  const pend=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Lista PENDING 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:7000},{account_id:accBanco.id,side:'C',amount_cents:7000}]},ownerA.token);
  const list=items(await req('GET','/api/lancamentos',undefined,ownerA.token,companyA.id));
  assert.ok(list.some(x=>x.id===posted.data.id&&x.status==='POSTED'));
  assert.ok(!list.some(x=>x.id===nc.data.entry_id));
  assert.ok(!list.some(x=>x.id===pend.data.id));
  assert.ok(list.every(x=>x.status==='POSTED'));
});

test('21-24 exportação somente POSTED',async()=>{
  const a=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-12',description:'Exp NC 1312',amount:'11,00',payment_method:'PIX'},ownerA.token);
  const b=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-12',description:'Exp PENDING 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:1100},{account_id:accBanco.id,side:'C',amount_cents:1100}]},ownerA.token);
  const c=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-12',description:'Exp REJECT 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:1200},{account_id:accBanco.id,side:'C',amount_cents:1200}]},ownerA.token);
  await req('POST','/api/aprovacao/'+c.data.id+'/rejeitar',{reason:'Revisar'},ownerA.token);
  const d=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-12',description:'Exp POSTED 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:1300},{account_id:accBanco.id,side:'C',amount_cents:1300}]},ownerA.token);
  await req('POST','/api/aprovacao/'+d.data.id+'/aprovar',{},ownerA.token);
  const exp=await req('POST','/api/exportacoes/gerar',{company_id:companyA.id,system_key:'contaazul',period_start:'2026-09-12',period_end:'2026-09-12'},ownerA.token);
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  const ids=db.prepare('SELECT entry_id FROM export_items WHERE export_id=?').all(exp.data.id).map(x=>x.entry_id);
  assert.ok(ids.includes(d.data.id));
  assert.ok(!ids.includes(a.data.entry_id));
  assert.ok(!ids.includes(b.data.id));
  assert.ok(!ids.includes(c.data.id));
});

test('25-30 manual, N-lines, contas inválidas',async()=>{
  const man=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Manual 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:1000},{account_id:accBanco.id,side:'C',amount_cents:1000}]},ownerA.token);
  assert.equal(man.status,201);
  assert.equal(man.data.source_type,'MANUAL');
  const n=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Nlines 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accDesp2.id,side:'D',amount_cents:20000},{account_id:accBanco.id,side:'C',amount_cents:110000},{account_id:accCaixa.id,side:'C',amount_cents:10000}]},ownerA.token);
  assert.equal(n.status,201);
  assert.equal(n.data.lines.length,4);
  const posted=await req('POST','/api/aprovacao/'+n.data.id+'/aprovar',{},ownerA.token);
  assert.equal(posted.data.status,'POSTED');
  assert.equal(linesCount(n.data.id),4);
  const unbalanced=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Unb',lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:50}]},ownerA.token);
  assert.equal(unbalanced.status,422);
  const synth=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Synth',lines:[{account_id:accSynth.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.equal(synth.status,422);
  const inactive=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Inativa',lines:[{account_id:accInactive.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.equal(inactive.status,422);
});

test('31-33 isolamento tenant/company e auditoria',async()=>{
  const companyA2=(await req('POST','/api/empresas',{name:'Empresa 1312 A2',cnpj:'33444555000103'},ownerA.token)).data;
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-17',description:'Iso 1312',lines:[{account_id:accDesp.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  const other=await req('GET','/api/lancamentos/'+e.data.id,undefined,ownerB.token);
  assert.equal(other.status,404);
  const approveB=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerB.token);
  assert.equal(approveB.status,404);
  const crossCo=await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token,companyA2.id);
  assert.equal(crossCo.status,404);
  await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  const log=db.prepare("SELECT * FROM audit_logs WHERE action='ENTRY_POSTED' AND entity_id=?").get(e.data.id);
  assert.equal(log.tenant_id,ownerA.user.tenant_id);
  assert.equal(log.user_id,ownerA.user.id);
});

test('28 E2E despesa + documento → classificação → aprovação → POSTED → exportação',async()=>{
  const fd=new FormData();
  fd.append('file',new Blob([pdf],{type:'application/pdf'}),'nf-frete.pdf');
  fd.append('company_id',companyA.id);
  const up=await fetch(base+'/api/documentos/upload',{method:'POST',headers:{Authorization:'Bearer '+ownerA.token},body:fd});
  const doc=await up.json();
  assert.equal(up.status,201,JSON.stringify(doc));
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-16',description:'Frete E2E 1312',amount:'250,00',payment_method:'PIX',document_id:doc.id},ownerA.token);
  assert.equal(exp.status,201);
  assert.equal(exp.data.status,'NEEDS_CLASSIFICATION');
  assert.equal(entryRow(exp.data.entry_id).status,'NEEDS_CLASSIFICATION');
  const cls=await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Frete operacional',lines:[{account_id:accDesp.id,side:'D',amount_cents:25000},{account_id:accBanco.id,side:'C',amount_cents:25000}]},ownerA.token);
  assert.equal(cls.data.status,'PENDING');
  const classif=items(await req('GET','/api/lancamentos?status=NEEDS_CLASSIFICATION',undefined,ownerA.token,companyA.id));
  assert.ok(!classif.some(x=>x.id===exp.data.entry_id));
  const pending=items(await req('GET','/api/aprovacao/pendentes',undefined,ownerA.token,companyA.id));
  assert.ok(pending.some(x=>x.id===exp.data.entry_id));
  const posted=await req('POST','/api/aprovacao/'+exp.data.entry_id+'/aprovar',{},ownerA.token);
  assert.equal(posted.data.status,'POSTED');
  assert.equal(entryRow(exp.data.entry_id).status,'POSTED');
  const listed=items(await req('GET','/api/lancamentos',undefined,ownerA.token,companyA.id));
  assert.ok(listed.some(x=>x.id===exp.data.entry_id));
  const exportJob=await req('POST','/api/exportacoes/gerar',{company_id:companyA.id,system_key:'contaazul',period_start:'2026-09-16',period_end:'2026-09-16'},ownerA.token);
  const ids=db.prepare('SELECT entry_id FROM export_items WHERE export_id=?').all(exportJob.data.id).map(x=>x.entry_id);
  assert.ok(ids.includes(exp.data.entry_id));
  const clsAudit=db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CLASSIFICATION_COMPLETED' AND entity_id=?").get(exp.data.entry_id).n;
  assert.ok(clsAudit>=1);
});

test('29 rejeição completa sem duplicar lançamento',async()=>{
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-16',description:'Ciclo rejeição 1312',amount:'80,00',payment_method:'PIX'},ownerA.token);
  await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Primeira',lines:[{account_id:accDesp.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+exp.data.entry_id+'/rejeitar',{reason:'Conta de frete incorreta. Revisar classificação.'},ownerA.token);
  assert.equal(entryRow(exp.data.entry_id).status,'NEEDS_CLASSIFICATION');
  await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Corrigida',lines:[{account_id:accDesp2.id,side:'D',amount_cents:8000},{account_id:accBanco.id,side:'C',amount_cents:8000}]},ownerA.token);
  assert.equal(entryRow(exp.data.entry_id).status,'PENDING');
  await req('POST','/api/aprovacao/'+exp.data.entry_id+'/aprovar',{},ownerA.token);
  assert.equal(entryRow(exp.data.entry_id).status,'POSTED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entries WHERE source_id=?').get(exp.data.id).n,1);
});

test('34-36 documentos, portal cliente e escritório',async()=>{
  const docs=await req('GET','/api/documentos',undefined,ownerA.token,companyA.id);
  assert.equal(docs.status,200);
  const portal=await fetch(base+'/portal/');
  assert.equal(portal.status,200);
  const office=await fetch(base+'/');
  assert.equal(office.status,200);
  const html=await office.text();
  assert.match(html,/app\.js\?v=s40-doc-preview/);
  const js=fs.readFileSync(path.join(__dirname,'../frontend/public/assets/app.js'),'utf8');
  assert.match(js,/Após classificar, a movimentação seguirá para aprovação/);
  assert.match(js,/Após aprovar, o lançamento contábil será efetivado automaticamente/);
  assert.match(js,/Partidas contábeis efetivadas após aprovação/);
  assert.doesNotMatch(js,/Gerar lançamento/);
  const client=await req('GET','/api/client/despesas',undefined,clientToken);
  assert.equal(client.status,200);
});
