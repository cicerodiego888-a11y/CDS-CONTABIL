'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s10-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-10-secret-ok';
process.env.CDS_COMMS_WORKER='off';
process.env.CDS_WHATSAPP_BACKOFF_MS='0';
process.env.CDS_WHATSAPP_APP_SECRET='wa-app-secret-test';
process.env.CDS_WHATSAPP_VERIFY_TOKEN='wa-verify-test';
process.env.CDS_WHATSAPP_API_TOKEN='';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {normalizeWhatsAppPhone,isValidWhatsAppPhone}=require('../backend/src/comunicacoes/phone');
const {renderTemplate,interpolate}=require('../backend/src/comunicacoes/templates');
const {createWhatsAppProvider}=require('../backend/src/comunicacoes/providers/whatsapp');
const {app,db,EVENT_TYPES,setWhatsAppProvider,processCommunicationJobs}=require('../backend/src/server');

let server,base,ownerA,ownerB,staffA,companyA,companyB,clientToken,sends;
const password='Senha@123';
const APP_SECRET='wa-app-secret-test';

function req(method,url,body,token,extraHeaders){
  const headers={'Content-Type':'application/json',...(extraHeaders||{})};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)}).then(async r=>{
    const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{data=text}
    return {status:r.status,data,text};
  });
}

function mockWa(handler){
  sends=[];
  return{
    name:'meta',
    configured(pid){
      if(!pid)return{ok:false,reason:'PHONE_NUMBER_ID_AUSENTE'};
      return{ok:true,phoneNumberId:pid};
    },
    async sendMessage({to,text}){
      if(handler)return handler({to,text});
      const id='wamid.'+crypto.randomUUID();
      sends.push({to,text,id});
      return{status:'ok',retryable:false,code:'SENT',httpStatus:200,messageId:id};
    }
  };
}

function sign(raw){
  return 'sha256='+crypto.createHmac('sha256',APP_SECRET).update(raw).digest('hex');
}

async function enableA(){
  setWhatsAppProvider(mockWa());
  await req('PATCH','/api/comunicacoes/config',{
    whatsapp_enabled:true,whatsapp_phone_number_id:'1234567890',display_number:'(88) 99999-0000',
    events:[{event_type:'EXPENSE_CREATED',whatsapp_enabled:true},{event_type:'REVENUE_CREATED',whatsapp_enabled:true},{event_type:'DOCUMENT_UPLOADED',whatsapp_enabled:true},{event_type:'CLASSIFICATION_REQUIRED',whatsapp_enabled:true},{event_type:'ENTRY_APPROVED',whatsapp_enabled:false}],
    recipient_phones:[{user_id:ownerA.user.id,phone:'(88) 99999-1111'}]
  },ownerA.token);
}

before(async()=>{
  setWhatsAppProvider(mockWa());
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório WA A',email:'owner.a.s10@test.local',password,tenantName:'Tenant WA A'});
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s10@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório WA B',email:'owner.b.s10@test.local',password,tenantName:'Tenant WA B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s10@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa WA A',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa WA B',cnpj:'22333444000192'},ownerB.token)).data;
  const staff=await req('POST','/api/usuarios',{name:'Staff WA',email:'staff.s10@test.local',password,role:'STAFF'},ownerA.token);
  staffA=(await req('POST','/api/auth/login',{email:'staff.s10@test.local',password,tenant:a.data.tenant_slug})).data;
  const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente WA',email:'client.s10@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const tok=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+tok+'/accept',{name:'Cliente WA',password,confirmation:password});
  clientToken=acc.data.token;
});
after(()=>{server.close();try{db.close()}catch{};try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}});

test('telefone é string, brasileiro e rejeita inválido',()=>{
  assert.equal(typeof normalizeWhatsAppPhone('(88) 99999-1111'),'string');
  assert.equal(normalizeWhatsAppPhone('(88) 99999-1111'),'5588999991111');
  assert.equal(normalizeWhatsAppPhone('88999991111'),'5588999991111');
  assert.equal(isValidWhatsAppPhone('123'),false);
  assert.equal(isValidWhatsAppPhone(''),false);
  assert.equal(isValidWhatsAppPhone(null),false);
  assert.notEqual(Number(normalizeWhatsAppPhone('088999991111')),normalizeWhatsAppPhone('088999991111'));
});

test('templates interpolam e escapam',()=>{
  const t=renderTemplate('EXPENSE_CREATED',{company_name:'Cremolia',amount:'R$ 10,00',payment_method:'PIX'});
  assert.match(t,/Cremolia/);assert.match(t,/PIX/);
  assert.equal(interpolate('Hi {{name}} <script>',{name:'A<script>'}).includes('<script>'),false);
});

test('provider traduz HTTP e não vaza token',async()=>{
  const cases=[[200,{messages:[{id:'m1'}]},'ok'],[400,{},'PROVIDER_BAD_REQUEST'],[401,{},'PROVIDER_FORBIDDEN'],[403,{},'PROVIDER_FORBIDDEN'],[404,{},'PROVIDER_NOT_FOUND'],[429,{},'PROVIDER_UNAVAILABLE'],[500,{},'PROVIDER_UNAVAILABLE'],[503,{},'PROVIDER_UNAVAILABLE']];
  for(const [httpStatus,body,code] of cases){
    const p=createWhatsAppProvider({name:'meta',apiUrl:'https://graph.facebook.com/v21.0',apiToken:'super-secret-wa-token',phoneNumberId:'99',fetchImpl:async()=>({status:httpStatus,ok:httpStatus<300,json:async()=>body})});
    const r=await p.sendMessage({to:'5588999991111',text:'oi'});
    if(httpStatus===200)assert.equal(r.status,'ok');else assert.equal(r.code,code);
    assert.equal(JSON.stringify(r).includes('super-secret-wa-token'),false);
  }
  const missing=createWhatsAppProvider({name:'custom',apiUrl:'',apiToken:'x',phoneNumberId:'1'});
  assert.equal((await missing.sendMessage({to:'5588999991111',text:'x'})).code,'URL_AUSENTE');
  const noTok=createWhatsAppProvider({name:'meta',apiUrl:'https://graph.facebook.com/v21.0',apiToken:'',phoneNumberId:'1'});
  assert.equal((await noTok.sendMessage({to:'5588999991111',text:'x'})).code,'TOKEN_AUSENTE');
  const to=createWhatsAppProvider({name:'meta',apiUrl:'https://graph.facebook.com/v21.0',apiToken:'t',phoneNumberId:'1',timeoutMs:20,fetchImpl:()=>new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'})),5))});
  assert.equal((await to.sendMessage({to:'5588999991111',text:'x'})).code,'TIMEOUT');
});

test('config padrão desativada, token não aparece, CLIENT bloqueado',async()=>{
  const cfg=await req('GET','/api/comunicacoes/config',undefined,ownerA.token);
  assert.equal(cfg.status,200);
  assert.equal(cfg.data.whatsapp_enabled,false);
  assert.equal(cfg.data.status,'DESATIVADO');
  assert.equal(JSON.stringify(cfg.data).includes('super-secret'),false);
  assert.equal(JSON.stringify(cfg.data).includes('wa-app-secret'),false);
  const client=await req('GET','/api/comunicacoes/config',undefined,clientToken);
  assert.equal(client.status,403);
  const staffPatch=await req('PATCH','/api/comunicacoes/config',{whatsapp_enabled:true},staffA.token);
  assert.equal(staffPatch.status,403);
  const spoof=await req('PATCH','/api/comunicacoes/config',{whatsapp_enabled:true,tenant_id:ownerB.user.tenant_id,api_token:'x'},ownerA.token);
  assert.equal(spoof.status,400);
});

test('ativar WhatsApp, preferências e destinatários isolados por tenant',async()=>{
  await enableA();
  const cfg=await req('GET','/api/comunicacoes/config',undefined,ownerA.token);
  assert.equal(cfg.data.whatsapp_enabled,true);
  assert.equal(cfg.data.status,'ATIVO');
  assert.ok(cfg.data.events.find(e=>e.event_type==='EXPENSE_CREATED').whatsapp_enabled);
  assert.equal(cfg.data.events.find(e=>e.event_type==='ENTRY_APPROVED').whatsapp_enabled,false);
  const b=await req('GET','/api/comunicacoes/config',undefined,ownerB.token);
  assert.equal(b.data.whatsapp_enabled,false);
  const st=await req('GET','/api/comunicacoes/status',undefined,staffA.token);
  assert.equal(st.status,200);assert.equal(st.data.status,'ATIVO');
});

test('despesa cria IN_APP e job WhatsApp; falha do provider não dá rollback',async()=>{
  await enableA();
  setWhatsAppProvider(mockWa(()=>({status:'error',retryable:true,code:'PROVIDER_UNAVAILABLE',httpStatus:500,messageId:null})));
  const r=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Energia WA',amount:'1250,00',payment_method:'PIX'},ownerA.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  const exp=db.prepare('SELECT * FROM expenses WHERE id=?').get(r.data.id);
  assert.ok(exp);
  const ev=db.prepare("SELECT * FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r.data.id);
  assert.ok(ev);assert.equal(ev.company_id,companyA.id);
  const notes=db.prepare('SELECT COUNT(*) n FROM notifications WHERE event_id=?').get(ev.id).n;
  assert.ok(notes>=1);
  const jobs=db.prepare("SELECT * FROM communication_jobs WHERE event_id=? AND channel='WHATSAPP'").all(ev.id);
  assert.ok(jobs.length>=1);
  assert.equal(jobs[0].tenant_id,ownerA.user.tenant_id);
  const processed=await processCommunicationJobs(20,'t1');
  assert.ok(processed.length>=1);
  const after=db.prepare('SELECT * FROM communication_jobs WHERE id=?').get(jobs[0].id);
  assert.ok(['PENDING','FAILED'].includes(after.status));
  assert.ok(db.prepare('SELECT id FROM expenses WHERE id=?').get(r.data.id));
  const notes2=await req('GET','/api/notificacoes?page=1&page_size=25',undefined,ownerA.token);
  assert.ok((notes2.data.items||[]).some(x=>x.entity_id===r.data.id));
});

test('retry transitório, permanente, backoff e máximo',async()=>{
  await enableA();
  let n=0;
  setWhatsAppProvider(mockWa(()=>{n++;return{status:'error',retryable:true,code:'PROVIDER_UNAVAILABLE',httpStatus:503,messageId:null}}));
  const r=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Retry WA',amount:'10,00',payment_method:'PIX'},ownerA.token);
  const ev=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r.data.id);
  const job=db.prepare("SELECT * FROM communication_jobs WHERE event_id=? AND recipient_user_id=?").get(ev.id,ownerA.user.id);
  await processCommunicationJobs(20,'r1');
  db.prepare("UPDATE communication_jobs SET next_attempt_at=datetime('now','-1 second') WHERE event_id=?").run(ev.id);
  await processCommunicationJobs(20,'r2');
  db.prepare("UPDATE communication_jobs SET next_attempt_at=datetime('now','-1 second') WHERE event_id=?").run(ev.id);
  await processCommunicationJobs(20,'r3');
  const done=db.prepare('SELECT * FROM communication_jobs WHERE id=?').get(job.id);
  assert.equal(done.status,'FAILED');
  assert.ok(done.attempts>=3);
  setWhatsAppProvider(mockWa(()=>({status:'error',retryable:false,code:'PROVIDER_BAD_REQUEST',httpStatus:400,messageId:null})));
  const r2=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Perm WA',amount:'11,00',payment_method:'PIX'},ownerA.token);
  const ev2=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r2.data.id);
  await processCommunicationJobs(20,'p1');
  const perm=db.prepare("SELECT * FROM communication_jobs WHERE event_id=? AND recipient_user_id=?").get(ev2.id,ownerA.user.id);
  assert.equal(perm.status,'FAILED');
});

test('envio ok, webhook delivered/failed/duplicado e assinatura',async()=>{
  await enableA();
  setWhatsAppProvider(mockWa());
  const r=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Sent WA',amount:'20,00',payment_method:'PIX'},ownerA.token);
  await processCommunicationJobs(20,'s1');
  const ev=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r.data.id);
  const job=db.prepare("SELECT * FROM communication_jobs WHERE event_id=? AND recipient_user_id=?").get(ev.id,ownerA.user.id);
  assert.equal(job.status,'SENT');
  assert.ok(job.provider_message_id);
  assert.ok(sends[0].text.includes('despesa')||sends[0].text.includes('Despesa')||/enviou/.test(sends[0].text));
  assert.doesNotMatch(sends[0].text,/débito|crédito|token/i);
  const payload={entry:[{changes:[{value:{statuses:[{id:job.provider_message_id,status:'delivered'}]}}]}]};
  const raw=JSON.stringify(payload);
  const bad=await req('POST','/api/webhooks/whatsapp',raw,undefined,{'Content-Type':'application/json','X-Hub-Signature-256':'sha256=deadbeef'});
  assert.equal(bad.status,401);
  const ok=await fetch(base+'/api/webhooks/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sign(raw)},body:raw});
  assert.equal(ok.status,200);
  const delivered=db.prepare('SELECT status FROM communication_jobs WHERE id=?').get(job.id).status;
  assert.equal(delivered,'DELIVERED');
  const ok2=await fetch(base+'/api/webhooks/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sign(raw)},body:raw});
  assert.equal(ok2.status,200);
  assert.equal(db.prepare('SELECT status FROM communication_jobs WHERE id=?').get(job.id).status,'DELIVERED');
  const failBody={entry:[{changes:[{value:{statuses:[{id:job.provider_message_id,status:'failed'}]}}]}]};
  const rawF=JSON.stringify(failBody);
  await fetch(base+'/api/webhooks/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sign(rawF)},body:rawF});
  assert.equal(db.prepare('SELECT status FROM communication_jobs WHERE id=?').get(job.id).status,'FAILED');
  const verify=await fetch(base+'/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wa-verify-test&hub.challenge=abc123');
  assert.equal(verify.status,200);
  assert.equal(await verify.text(),'abc123');
});

test('idempotência de job, isolamento tenant e COMPANY_CREATED não quebra IN_APP',async()=>{
  await enableA();
  setWhatsAppProvider(mockWa());
  await req('PATCH','/api/comunicacoes/config',{whatsapp_enabled:true,whatsapp_phone_number_id:'999',recipient_phones:[{user_id:ownerB.user.id,phone:'11988887777'}]},ownerB.token);
  const r=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Iso WA',amount:'30,00',payment_method:'PIX'},ownerA.token);
  const ev=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r.data.id);
  const jobsA=db.prepare('SELECT * FROM communication_jobs WHERE event_id=?').all(ev.id);
  const nA=jobsA.length;
  db.prepare("INSERT OR IGNORE INTO communication_jobs(id,tenant_id,recipient_user_id,channel,event_id,payload_json,status) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(),ownerA.user.tenant_id,ownerA.user.id,'WHATSAPP',ev.id,'{}','PENDING');
  const n2=db.prepare('SELECT COUNT(*) n FROM communication_jobs WHERE event_id=?').get(ev.id).n;
  assert.equal(n2,nA);
  assert.ok(jobsA.every(j=>j.tenant_id===ownerA.user.tenant_id));
  const bJobs=db.prepare('SELECT COUNT(*) n FROM communication_jobs WHERE tenant_id=? AND event_id=?').get(ownerB.user.tenant_id,ev.id).n;
  assert.equal(bJobs,0);
  const foreign=await req('GET','/api/comunicacoes/jobs?page=1&page_size=100',undefined,ownerB.token);
  assert.ok(!(foreign.data.items||[]).some(j=>j.event_id===ev.id));
  const clientJob=await req('GET','/api/comunicacoes/jobs',undefined,clientToken);
  assert.equal(clientJob.status,403);
});

test('evento bloqueado não cria job; usuário inativo não recebe; sem telefone NO_PHONE',async()=>{
  await enableA();
  await req('PATCH','/api/comunicacoes/config',{events:[{event_type:'REVENUE_CREATED',whatsapp_enabled:false}]},ownerA.token);
  const rev=await req('POST','/api/receitas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Receita off',amount:'40,00',receipt_method:'PIX'},ownerA.token);
  const ev=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='REVENUE_CREATED'").get(rev.data.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM communication_jobs WHERE event_id=?').get(ev.id).n,0);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(staffA.user.id);
  await req('PATCH','/api/comunicacoes/config',{events:[{event_type:'EXPENSE_CREATED',whatsapp_enabled:true}]},ownerA.token);
  const r=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Inativo',amount:'5,00',payment_method:'PIX'},ownerA.token);
  const ev2=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r.data.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM communication_jobs WHERE event_id=? AND recipient_user_id=?').get(ev2.id,staffA.user.id).n,0);
  db.prepare('UPDATE users SET active=1,whatsapp_phone=NULL WHERE id=?').run(staffA.user.id);
  const r3=await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Sem fone',amount:'6,00',payment_method:'PIX'},ownerA.token);
  const ev3=db.prepare("SELECT id FROM domain_events WHERE entity_id=? AND event_type='EXPENSE_CREATED'").get(r3.data.id);
  const noPhone=db.prepare('SELECT * FROM communication_jobs WHERE event_id=? AND recipient_user_id=?').get(ev3.id,staffA.user.id);
  assert.equal(noPhone.status,'FAILED');
  assert.equal(noPhone.last_error,'NO_PHONE');
});

test('receita, documento, classificação e solicitação geram canal adequado',async()=>{
  await enableA();
  setWhatsAppProvider(mockWa());
  await req('PATCH','/api/comunicacoes/config',{events:[{event_type:'REVENUE_CREATED',whatsapp_enabled:true},{event_type:'DOCUMENT_UPLOADED',whatsapp_enabled:true},{event_type:'CLASSIFICATION_REQUIRED',whatsapp_enabled:true},{event_type:'REQUEST_UPDATED',whatsapp_enabled:true}]},ownerA.token);
  const rev=await req('POST','/api/receitas',{company_id:companyA.id,occurred_on:'2026-09-15',description:'Receita on',amount:'70,00',receipt_method:'PIX'},ownerA.token);
  assert.equal(rev.status,201);
  const fd=new FormData();fd.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'a.png');
  const up=await fetch(base+'/api/client/documentos',{method:'POST',headers:{Authorization:'Bearer '+clientToken},body:fd});
  assert.equal(up.status,201);
  const reqs=await req('POST','/api/solicitacoes',{company_id:companyA.id,title:'Doc',type:'DOCUMENT'},ownerA.token);
  assert.equal(reqs.status,201);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM communication_jobs WHERE tenant_id=? AND template_key IN('REVENUE_CREATED','DOCUMENT_UPLOADED','CLASSIFICATION_REQUIRED')").get(ownerA.user.tenant_id).n>=1);
});

test('concorrência, recuperação PROCESSING e 1000 jobs paginados',async()=>{
  await enableA();
  const ins=db.prepare("INSERT INTO communication_jobs(id,tenant_id,recipient_user_id,channel,destination,template_key,payload_json,status,next_attempt_at) VALUES(?,?,?,?,?,?,?,'PENDING',datetime('now','-1 second'))");
  for(let i=0;i<1000;i++)ins.run(crypto.randomUUID(),ownerA.user.tenant_id,ownerA.user.id,'WHATSAPP','5588999991111','EXPENSE_CREATED','{"text":"x"}');
  const page=await req('GET','/api/comunicacoes/jobs?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(page.status,200);
  assert.equal(page.data.page_size,25);
  assert.ok(page.data.total>=1000);
  setWhatsAppProvider(mockWa());
  const a=processCommunicationJobs(40,'wA');
  const b=processCommunicationJobs(40,'wB');
  const [ra,rb]=await Promise.all([a,b]);
  const ids=new Set([...ra,...rb].filter(Boolean).map(x=>x.id));
  assert.equal(ids.size,ra.length+rb.length);
  const stale=db.prepare("SELECT id FROM communication_jobs WHERE tenant_id=? AND status='PENDING' LIMIT 5").all(ownerA.user.tenant_id);
  const old=new Date(Date.now()-10*60*1000).toISOString();
  for(const row of stale)db.prepare("UPDATE communication_jobs SET status='PROCESSING',locked_at=? WHERE id=?").run(old,row.id);
  const {communicationEngine}=require('../backend/src/server');
  communicationEngine.recoverStale();
  for(const row of stale)assert.equal(db.prepare('SELECT status FROM communication_jobs WHERE id=?').get(row.id).status,'PENDING');
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM communication_jobs WHERE tenant_id=? AND status=? ORDER BY created_at DESC LIMIT 25").all(ownerA.user.tenant_id,'PENDING');
  assert.ok(plan.length>=1);
});

test('HTML do escritório possui Comunicações/WhatsApp',async()=>{
  const html=await fetch(base+'/').then(r=>r.text());
  assert.match(html,/app\.js\?v=s13-34/);
  const js=await fetch(base+'/assets/app.js?v=s13-15').then(r=>r.text());
  assert.match(js,/Comunicações/);
  assert.match(js,/\/comunicacoes\/config/);
  assert.doesNotMatch(js,/CDS_WHATSAPP_API_TOKEN/);
});
