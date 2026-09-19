'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s07-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-07-secret-ok';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,companyA,companyB,clientToken;
let planA,accDesp,accDesp2,accBanco,accCaixa,accReceita,accSynth,accB;
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
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,tenantId,planId,code,code,code,type,desc,null,1,postable?1:0);
  return {id,code,desc};
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório Motor A',email:'owner.a.s07@test.local',password,tenantName:'Tenant Motor A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s07@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório Motor B',email:'owner.b.s07@test.local',password,tenantName:'Tenant Motor B'});
  assert.equal(b.status,201,JSON.stringify(b.data));
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s07@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa Motor A',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa Motor B',cnpj:'22333444000192'},ownerB.token)).data;
  planA=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planA,ownerA.user.tenant_id,'Plano A','ACTIVE');
  accSynth=insertAccount(ownerA.user.tenant_id,planA,'3','S','DESPESAS',0);
  accDesp=insertAccount(ownerA.user.tenant_id,planA,'3210100012','A','ENERGIA ELETRICA',1);
  accDesp2=insertAccount(ownerA.user.tenant_id,planA,'3210100013','A','OUTRAS DESPESAS',1);
  accBanco=insertAccount(ownerA.user.tenant_id,planA,'1110200001','A','BANCO DO BRASIL',1);
  accCaixa=insertAccount(ownerA.user.tenant_id,planA,'1110100001','A','CAIXA GERAL',1);
  accReceita=insertAccount(ownerA.user.tenant_id,planA,'4110100001','A','RECEITAS DE SERVICOS',1);
  const planB=uuid();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planB,ownerB.user.tenant_id,'Plano B','ACTIVE');
  accB=insertAccount(ownerB.user.tenant_id,planB,'1110200001','A','BANCO B',1);
  const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente Motor',email:'cliente.s07@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const token=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+token+'/accept',{name:'Cliente Motor',password,confirmation:password});
  assert.equal(acc.status,200,JSON.stringify(acc.data));
  clientToken=acc.data.token;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

function linesDC(pairs){return pairs}

test('1D+1C persistido e balanceado',async()=>{
  const r=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Partida simples',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accBanco.id,side:'C',amount_cents:100000}]},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.lines.length,2);
  assert.equal(r.data.debit,100000);
  assert.equal(r.data.credit,100000);
  assert.equal(r.data.balanced,true);
  const n=db.prepare('SELECT COUNT(*) n FROM entry_lines WHERE entry_id=?').get(r.data.id).n;
  assert.equal(n,2);
});

test('1D+2C, 1D+3C, 2D+1C, 2D+2C, 3D+3C',async()=>{
  const cases=[
    [{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accBanco.id,side:'C',amount_cents:60000},{account_id:accCaixa.id,side:'C',amount_cents:40000}],
    [{account_id:accDesp.id,side:'D',amount_cents:90000},{account_id:accBanco.id,side:'C',amount_cents:30000},{account_id:accCaixa.id,side:'C',amount_cents:30000},{account_id:accBanco.id,side:'C',amount_cents:30000}],
    [{account_id:accDesp.id,side:'D',amount_cents:70000},{account_id:accDesp2.id,side:'D',amount_cents:30000},{account_id:accBanco.id,side:'C',amount_cents:100000}],
    [{account_id:accDesp.id,side:'D',amount_cents:50000},{account_id:accDesp2.id,side:'D',amount_cents:50000},{account_id:accBanco.id,side:'C',amount_cents:60000},{account_id:accCaixa.id,side:'C',amount_cents:40000}],
    [{account_id:accDesp.id,side:'D',amount_cents:40000},{account_id:accDesp2.id,side:'D',amount_cents:30000},{account_id:accDesp.id,side:'D',amount_cents:30000},{account_id:accBanco.id,side:'C',amount_cents:40000},{account_id:accCaixa.id,side:'C',amount_cents:30000},{account_id:accBanco.id,side:'C',amount_cents:30000}]
  ];
  for(const lines of cases){
    const r=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'N linhas',lines},ownerA.token);
    assert.equal(r.status,201,JSON.stringify(r.data));
    assert.equal(r.data.lines.length,lines.length);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM entry_lines WHERE entry_id=?').get(r.data.id).n,lines.length);
    assert.equal(r.data.balanced,true);
  }
});

test('desbalanceado, zero, negativo e D/C inválido',async()=>{
  const bad=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:50}]},ownerA.token);
  assert.equal(bad.status,422);
  const zero=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:accDesp.id,side:'D',amount_cents:0},{account_id:accBanco.id,side:'C',amount_cents:0}]},ownerA.token);
  assert.ok([400,422].includes(zero.status));
  const neg=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:accDesp.id,side:'D',amount_cents:-10},{account_id:accBanco.id,side:'C',amount_cents:-10}]},ownerA.token);
  assert.ok([400,422].includes(neg.status));
  const side=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:accDesp.id,type:'X',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.ok([400,422].includes(side.status));
});

test('conta inexistente, outro tenant e sintética',async()=>{
  const miss=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:uuid(),side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.equal(miss.status,422);
  const foreign=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:accB.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.equal(foreign.status,403);
  const synth=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'X',lines:[{account_id:accSynth.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.equal(synth.status,422);
  assert.equal(synth.data.error,'SYNTHETIC_ACCOUNT');
});

test('rollback atômico quando a segunda linha falha',async()=>{
  const before=db.prepare('SELECT COUNT(*) n FROM entries WHERE tenant_id=?').get(ownerA.user.tenant_id).n;
  const r=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Rollback',lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accSynth.id,side:'C',amount_cents:100}]},ownerA.token);
  assert.equal(r.status,422);
  const after=db.prepare('SELECT COUNT(*) n FROM entries WHERE tenant_id=?').get(ownerA.user.tenant_id).n;
  assert.equal(after,before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM entries WHERE description='Rollback'").get().n,0);
});

test('aprovação de N linhas e bloqueio após POSTED',async()=>{
  const r=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Aprovar N',lines:[{account_id:accDesp.id,side:'D',amount_cents:60000},{account_id:accDesp2.id,side:'D',amount_cents:40000},{account_id:accBanco.id,side:'C',amount_cents:100000}]},ownerA.token);
  assert.equal(r.status,201);
  const ok=await req('POST','/api/aprovacao/'+r.data.id+'/aprovar',{},ownerA.token);
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal(ok.data.status,'POSTED');
  const edit=await req('POST','/api/lancamentos/'+r.data.id+'/reclassificar',{lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accBanco.id,side:'C',amount_cents:100000}]},ownerA.token);
  assert.equal(edit.status,409);
});

test('contexto, spoof e CLIENT isolados',async()=>{
  const spoof=await req('POST','/api/lancamentos',{company_id:companyB.id,occurred_on:'2026-09-15',description:'Spoof',lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token,companyA.id);
  assert.equal(spoof.status,201,JSON.stringify(spoof.data));
  assert.equal(spoof.data.company_id,companyA.id);
  const cross=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Cross',lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},ownerA.token,companyB.id);
  assert.equal(cross.status,404);
  const cli=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Cliente',lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},clientToken);
  assert.equal(cli.status,403);
  const rec=await req('POST','/api/lancamentos/'+spoof.data.id+'/reclassificar',{lines:[{account_id:accDesp.id,side:'D',amount_cents:100},{account_id:accBanco.id,side:'C',amount_cents:100}]},clientToken);
  assert.equal(rec.status,403);
});

test('regra inequívoca gera PENDING com evidências',async()=>{
  await req('POST','/api/regras-contabeis',{name:'ENERGIA',priority:10,conditions:{description:'energia'},debit_account_id:accDesp.id,credit_account_id:accBanco.id},ownerA.token);
  const t0=Date.now();
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Conta de energia elétrica',amount:'250,00',payment_method:'PIX'},ownerA.token);
  const ms=Date.now()-t0;
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  assert.equal(exp.data.status,'PENDING');
  assert.equal(exp.data.classification.status,'CLASSIFIED');
  assert.ok(exp.data.classification.score>=70);
  assert.ok((exp.data.classification.reasons||[]).some(x=>/ENERGIA/i.test(x)||/energia/i.test(x)));
  const entry=db.prepare('SELECT * FROM entries WHERE source_id=?').get(exp.data.id);
  assert.equal(entry.status,'PENDING');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entry_lines WHERE entry_id=?').get(entry.id).n,2);
  const run=db.prepare('SELECT * FROM classification_runs WHERE source_id=? ORDER BY created_at DESC').get(exp.data.id);
  assert.equal(run.status,'CLASSIFIED');
  assert.ok(ms<2000,`classificação lenta: ${ms}ms`);
});

test('duas regras com prioridades diferentes: vence a de maior precedência',async()=>{
  await req('POST','/api/regras-contabeis',{name:'ENERGIA ALTA',priority:5,conditions:{description:'energia premium'},debit_account_id:accDesp.id,credit_account_id:accBanco.id},ownerA.token);
  await req('POST','/api/regras-contabeis',{name:'ENERGIA BAIXA',priority:90,conditions:{description:'energia premium'},debit_account_id:accDesp2.id,credit_account_id:accCaixa.id},ownerA.token);
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'energia premium escritório',amount:'10,00',payment_method:'PIX'},ownerA.token);
  assert.equal(exp.data.status,'PENDING');
  const lines=db.prepare('SELECT account_id,side FROM entry_lines WHERE entry_id=?').all(exp.data.entry_id);
  assert.ok(lines.some(x=>x.account_id===accDesp.id&&x.side==='D'));
});

test('empate/conflito vai para NEEDS_CLASSIFICATION',async()=>{
  await req('POST','/api/regras-contabeis',{name:'CONFLITO A',priority:20,conditions:{description:'conflito-xyz'},debit_account_id:accDesp.id,credit_account_id:accBanco.id},ownerA.token);
  await req('POST','/api/regras-contabeis',{name:'CONFLITO B',priority:20,conditions:{description:'conflito-xyz'},debit_account_id:accDesp2.id,credit_account_id:accCaixa.id},ownerA.token);
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'conflito-xyz fatura',amount:'80,00',payment_method:'PIX'},ownerA.token);
  assert.equal(exp.data.status,'NEEDS_CLASSIFICATION');
  assert.equal(exp.data.classification.status,'NEEDS_CLASSIFICATION');
  assert.ok((exp.data.classification.candidates||[]).length>=2);
  const entry=db.prepare('SELECT * FROM entries WHERE source_id=?').get(exp.data.id);
  assert.equal(entry.status,'NEEDS_CLASSIFICATION');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entry_lines WHERE entry_id=?').get(entry.id).n,0);
  const pend=db.prepare("SELECT * FROM pendencies WHERE entity_id=? AND status='OPEN'").get(entry.id);
  assert.ok(pend);
});

test('ausência de regra e fallback categoria+banco',async()=>{
  const none=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'sem regra aplicavel zzqq',amount:'15,00',payment_method:'PIX'},ownerA.token);
  assert.equal(none.data.status,'NEEDS_CLASSIFICATION');
  const cat=await req('POST','/api/categorias',{name:'Energia Cat',kind:'EXPENSE',account_id:accDesp.id,company_id:companyA.id},ownerA.token);
  const bank=await req('POST','/api/bancos',{name:'BB Cat',account_id:accBanco.id,company_id:companyA.id},ownerA.token);
  const fb=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'fallback categoria banco unico',amount:'33,00',payment_method:'PIX',category_id:cat.data.id,bank_id:bank.data.id},ownerA.token);
  assert.equal(fb.status,201,JSON.stringify(fb.data));
  assert.equal(fb.data.status,'PENDING');
  assert.equal(fb.data.classification.origin,'CATEGORY');
});

test('regra da empresa prevalece sobre global',async()=>{
  await req('POST','/api/regras-contabeis',{name:'GLOBAL FRETE',priority:10,conditions:{description:'frete-unico-s07'},debit_account_id:accDesp2.id,credit_account_id:accCaixa.id},ownerA.token);
  await req('POST','/api/regras-contabeis',{name:'EMPRESA FRETE',priority:10,company_id:companyA.id,conditions:{description:'frete-unico-s07'},debit_account_id:accDesp.id,credit_account_id:accBanco.id},ownerA.token);
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'frete-unico-s07 cidade',amount:'40,00',payment_method:'PIX'},ownerA.token);
  assert.equal(exp.data.status,'PENDING');
  const debit=db.prepare("SELECT account_id FROM entry_lines WHERE entry_id=? AND side='D'").get(exp.data.entry_id);
  assert.equal(debit.account_id,accDesp.id);
});

test('score determinístico e classificação cross-tenant',async()=>{
  const a=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Conta de energia elétrica',amount:'12,00',payment_method:'PIX'},ownerA.token);
  const b=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Conta de energia elétrica',amount:'12,00',payment_method:'PIX'},ownerA.token);
  assert.equal(a.data.classification.score,b.data.classification.score);
  const other=await req('GET','/api/lancamentos/'+a.data.entry_id,undefined,ownerB.token);
  assert.equal(other.status,404);
});

test('decisão manual N linhas, histórico e idempotência',async()=>{
  const exp=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'manual-ambigua-s07 sem match xxx',amount:'100,00',payment_method:'PIX'},ownerA.token);
  assert.equal(exp.data.status,'NEEDS_CLASSIFICATION');
  const before=db.prepare('SELECT COUNT(*) n FROM entries WHERE source_id=?').get(exp.data.id).n;
  assert.equal(before,1);
  const dup=await req('POST','/api/lancamentos',{company_id:companyA.id,source_type:'EXPENSE',source_id:exp.data.id,occurred_on:'2026-09-15',description:'dup',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accBanco.id,side:'C',amount_cents:100000}]},ownerA.token);
  assert.equal(dup.status,409);
  const man=await req('POST','/api/lancamentos/'+exp.data.entry_id+'/reclassificar',{reason:'Rateio caixa e banco',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accBanco.id,side:'C',amount_cents:60000},{account_id:accCaixa.id,side:'C',amount_cents:40000}]},ownerA.token,companyA.id);
  assert.equal(man.status,200,JSON.stringify(man.data));
  assert.equal(man.data.status,'PENDING');
  assert.equal(man.data.lines.length,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entries WHERE source_id=?').get(exp.data.id).n,1);
  const runs=db.prepare('SELECT * FROM classification_runs WHERE source_id=? ORDER BY created_at').all(exp.data.id);
  assert.ok(runs.length>=2);
  assert.equal(runs.at(-1).origin,'MANUAL');
  assert.equal(runs.at(-1).decided_by,ownerA.user.id);
  const audit=db.prepare("SELECT * FROM audit_logs WHERE action='RECLASSIFY' AND entity_id=?").get(exp.data.entry_id);
  assert.ok(audit);
});

test('exportação canônica lê N linhas',async()=>{
  const e=await req('POST','/api/lancamentos',{company_id:companyA.id,occurred_on:'2026-09-10',description:'Export N',lines:[{account_id:accDesp.id,side:'D',amount_cents:100000},{account_id:accBanco.id,side:'C',amount_cents:60000},{account_id:accCaixa.id,side:'C',amount_cents:40000}]},ownerA.token);
  await req('POST','/api/aprovacao/'+e.data.id+'/aprovar',{},ownerA.token);
  const exp=await req('POST','/api/exportacoes/gerar',{company_id:companyA.id,system_key:'contaazul',period_start:'2026-09-01',period_end:'2026-09-30'},ownerA.token);
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  assert.ok(exp.data.count>=1);
});

test('HTTP: login, despesa, classificação e portal sem conta',async()=>{
  const login=await req('POST','/api/auth/login',{email:'owner.a.s07@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(login.status,200);
  const dash=await req('GET','/api/dashboard',undefined,login.data.token,companyA.id);
  assert.equal(dash.data.company_id,companyA.id);
  const portal=await fetch(base+'/portal/');
  assert.equal(portal.status,200);
  const pjs=await fetch(base+'/portal/portal.js?v=s05-1').then(r=>r.text()).catch(()=>fs.readFileSync(path.join(__dirname,'../frontend/public/portal/portal.js'),'utf8'));
  assert.doesNotMatch(pjs,/debit_account|credit_account|name="account_id"/);
});
