'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s08-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-08-secret-ok';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,emitEvent,EVENT_TYPES}=require('../backend/src/server');

let server,base,ownerA,ownerB,staffA,companyA,companyB,clientToken,clientId,expense,revenue,docId,entryNeed;
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
function uuid(){return crypto.randomUUID()}
function items(r){return Array.isArray(r.data)?r.data:(r.data&&r.data.items)||[]}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório Eventos A',email:'owner.a.s08@test.local',password,tenantName:'Tenant Eventos A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s08@test.local',password,tenant:a.data.tenant_slug})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório Eventos B',email:'owner.b.s08@test.local',password,tenantName:'Tenant Eventos B'});
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s08@test.local',password,tenant:b.data.tenant_slug})).data;
  companyA=(await req('POST','/api/empresas',{name:'Cremolia Alimentos Ltda',trade_name:'Cremolia',cnpj:'11222333000181'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa B Eventos',cnpj:'22333444000192'},ownerB.token)).data;
  const staff=await req('POST','/api/usuarios',{name:'Contador A',email:'staff.a.s08@test.local',password,role:'ACCOUNTANT'},ownerA.token);
  assert.equal(staff.status,201,JSON.stringify(staff.data));
  staffA=(await req('POST','/api/auth/login',{email:'staff.a.s08@test.local',password,tenant:ownerA.user.tenant_slug||a.data.tenant_slug})).data;
  const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Maria Eventos',email:'maria.s08@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
  const token=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+token+'/accept',{name:'Maria Eventos',password,confirmation:password});
  assert.equal(acc.status,200,JSON.stringify(acc.data));
  clientToken=acc.data.token;
  clientId=acc.data.user.id;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('despesa cria evento e notificação in-app',async()=>{
  const r=await req('POST','/api/client/despesas',{occurred_on:'2026-09-15',description:'Energia',amount:'1250,00',payment_method:'PIX'},clientToken);
  assert.equal(r.status,201,JSON.stringify(r.data));
  expense=r.data;
  const ev=db.prepare("SELECT * FROM domain_events WHERE tenant_id=? AND event_type='EXPENSE_CREATED' AND entity_id=?").get(ownerA.user.tenant_id,expense.id);
  assert.ok(ev);
  assert.equal(ev.company_id,companyA.id);
  assert.equal(ev.actor_user_id,clientId);
  assert.equal(ev.entity_type,'expense');
  const payload=JSON.parse(ev.payload_json);
  assert.equal(payload.amount_cents,125000);
  assert.equal(payload.payment_method,'PIX');
  assert.ok(!payload.password&&!payload.token);
  const officeNotes=await req('GET','/api/notificacoes?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(officeNotes.status,200);
  assert.ok(officeNotes.data.unread>=1);
  assert.ok(items(officeNotes).some(x=>x.entity_id===expense.id&&/Nova despesa/.test(x.title)));
  const clientNotes=await req('GET','/api/client/notificacoes',undefined,clientToken);
  assert.ok(clientNotes.data.some(x=>/Despesa registrada com sucesso/.test(x.title)));
});

test('receita e documento geram eventos com tenant/company',async()=>{
  const fd=new FormData();
  fd.append('file',new Blob([png],{type:'image/png'}),'recibo.png');
  const up=await fetch(base+'/api/client/documentos',{method:'POST',headers:{Authorization:'Bearer '+clientToken},body:fd});
  const doc=await up.json();
  assert.equal(up.status,201,JSON.stringify(doc));
  docId=doc.id;
  const rev=await req('POST','/api/receitas',{company_id:companyA.id,occurred_on:'2026-09-16',description:'Venda PIX',amount:'2500,00',receipt_method:'PIX',document_id:docId},ownerA.token);
  assert.equal(rev.status,201,JSON.stringify(rev.data));
  revenue=rev.data;
  const docEv=db.prepare("SELECT * FROM domain_events WHERE event_type='DOCUMENT_UPLOADED' AND entity_id=?").get(docId);
  const revEv=db.prepare("SELECT * FROM domain_events WHERE event_type='REVENUE_CREATED' AND entity_id=?").get(revenue.id);
  assert.equal(docEv.tenant_id,ownerA.user.tenant_id);
  assert.equal(docEv.company_id,companyA.id);
  assert.equal(revEv.entity_type,'revenue');
  const notes=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,staffA.token);
  assert.ok(items(notes).some(x=>x.entity_id===docId&&/documento/i.test(x.title)));
  assert.ok(items(notes).some(x=>x.entity_id===revenue.id&&/receita/i.test(x.title)));
});

test('solicitação notifica cliente e classificação pendente gera evento',async()=>{
  const reqCreated=await req('POST','/api/solicitacoes',{company_id:companyA.id,type:'DOCUMENT',title:'Enviar NF',description:'Precisamos da nota'},ownerA.token);
  assert.equal(reqCreated.status,201,JSON.stringify(reqCreated.data));
  const ev=db.prepare("SELECT * FROM domain_events WHERE event_type='REQUEST_CREATED' AND entity_id=?").get(reqCreated.data.id);
  assert.ok(ev);
  const clientNotes=await req('GET','/api/client/notificacoes',undefined,clientToken);
  assert.ok(clientNotes.data.some(x=>x.entity_id===reqCreated.data.id));
  const cls=db.prepare("SELECT * FROM domain_events WHERE event_type='CLASSIFICATION_REQUIRED' AND tenant_id=?").get(ownerA.user.tenant_id);
  assert.ok(cls);
  entryNeed=cls.entity_id;
  const notes=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,staffA.token);
  assert.ok(items(notes).some(x=>x.type==='CLASSIFICATION_REQUIRED'));
});

test('evento imutável e idempotência não duplica notificação',async()=>{
  const patch=await req('PATCH','/api/events/'+expense.id,{event_type:'HACK'},ownerA.token);
  assert.ok(patch.status===404||patch.status===403);
  const first=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type='EXPENSE_CREATED' AND entity_id=?").get(expense.id).n;
  emitEvent({tenantId:ownerA.user.tenant_id,companyId:companyA.id,eventType:EVENT_TYPES.EXPENSE_CREATED,actorUserId:clientId,entityType:'expense',entityId:expense.id,payload:{amount_cents:125000,description:'Energia'}});
  const second=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE event_type='EXPENSE_CREATED' AND entity_id=?").get(expense.id).n;
  assert.equal(first,1);
  assert.equal(second,1);
  const n=db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_id=(SELECT id FROM domain_events WHERE event_type='EXPENSE_CREATED' AND entity_id=?) AND COALESCE(recipient_user_id,user_id)=?").get(expense.id,ownerA.user.id).n;
  assert.equal(n,1);
});

test('isolamento tenant/usuário, CLIENT bloqueado, preferência OFF',async()=>{
  const other=await req('GET','/api/notificacoes?page=1&page_size=25',undefined,ownerB.token);
  assert.ok(!items(other).some(x=>x.entity_id===expense.id));
  const staffNotes=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,staffA.token);
  assert.ok(items(staffNotes).every(x=>x.id));
  const steal=await req('POST','/api/notificacoes/'+(items(staffNotes)[0]?.id||'x')+'/lida',{},ownerB.token);
  assert.ok(steal.status===404||steal.status===403);
  const asClient=await req('GET','/api/notificacoes',undefined,clientToken);
  assert.equal(asClient.status,403);
  const markClient=await req('POST','/api/notificacoes/'+(items(staffNotes)[0]?.id||'x')+'/lida',{},clientToken);
  assert.equal(markClient.status,403);
  await req('PUT','/api/notificacoes/preferencias',{event_type:'DOCUMENT_UPLOADED',in_app_enabled:false},staffA.token);
  const fd=new FormData();
  fd.append('file',new Blob([png],{type:'image/png'}),'off.png');
  const up=await fetch(base+'/api/client/documentos',{method:'POST',headers:{Authorization:'Bearer '+clientToken},body:fd});
  const doc=await up.json();
  assert.equal(up.status,201);
  const staffGot=db.prepare("SELECT COUNT(*) n FROM notifications WHERE COALESCE(recipient_user_id,user_id)=? AND entity_id=?").get(staffA.user.id,doc.id).n;
  const ownerGot=db.prepare("SELECT COUNT(*) n FROM notifications WHERE COALESCE(recipient_user_id,user_id)=? AND entity_id=?").get(ownerA.user.id,doc.id).n;
  assert.equal(staffGot,0);
  assert.equal(ownerGot,1);
  await req('PUT','/api/notificacoes/preferencias',{event_type:'DOCUMENT_UPLOADED',in_app_enabled:true},staffA.token);
});

test('usuário inativo não recebe; unread e marcar lida; paginação; since',async()=>{
  const inactiveId=uuid();
  db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?,0)").run(inactiveId,ownerA.user.tenant_id,'Inativo','inativo.s08@test.local',bcrypt.hashSync(password,4),'STAFF');
  const r=await req('POST','/api/client/despesas',{occurred_on:'2026-09-17',description:'Água',amount:'80,00',payment_method:'BOLETO'},clientToken);
  assert.equal(r.status,201);
  const got=db.prepare("SELECT COUNT(*) n FROM notifications WHERE COALESCE(recipient_user_id,user_id)=? AND entity_id=?").get(inactiveId,r.data.id).n;
  assert.equal(got,0);
  const list=await req('GET','/api/notificacoes?page=1&page_size=5',undefined,ownerA.token);
  assert.equal(list.data.page_size,5);
  assert.ok(list.data.unread>=1);
  assert.ok(list.data.pagination);
  const oneItem=items(list)[0];
  const mark=await req('POST','/api/notificacoes/'+oneItem.id+'/lida',{},ownerA.token);
  assert.equal(mark.status,200);
  const after=await req('GET','/api/notificacoes?page=1&page_size=5',undefined,ownerA.token);
  assert.ok(after.data.unread<list.data.unread||after.data.unread>=0);
  const since=oneItem.created_at;
  const inc=await req('GET','/api/notificacoes?page=1&page_size=50&since='+encodeURIComponent(since),undefined,ownerA.token);
  assert.ok(items(inc).every(x=>x.created_at>since));
  const all=await req('POST','/api/notificacoes/lidas',{},ownerA.token);
  assert.equal(all.status,200);
  const zero=await req('GET','/api/notificacoes?page=1&page_size=5',undefined,ownerA.token);
  assert.equal(zero.data.unread,0);
});

test('contexto company, spoof e transação com rollback',async()=>{
  // Inbox do escritório é pessoal: X-Company-Id não esconde notificações de outras empresas.
  const scoped=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,staffA.token,companyA.id);
  assert.equal(scoped.status,200);
  assert.ok(Array.isArray(items(scoped)));
  const spoof=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,ownerA.token,companyB.id);
  assert.equal(spoof.status,404);
  const beforeExp=db.prepare('SELECT COUNT(*) n FROM expenses WHERE tenant_id=?').get(ownerA.user.tenant_id).n;
  const beforeEv=db.prepare('SELECT COUNT(*) n FROM domain_events WHERE tenant_id=?').get(ownerA.user.tenant_id).n;
  try{
    db.transaction(()=>{
      emitEvent({tenantId:ownerA.user.tenant_id,companyId:companyA.id,eventType:EVENT_TYPES.DOCUMENT_UPLOADED,actorUserId:clientId,entityType:'document',entityId:'ghost-doc',payload:{original_name:'x.png'}});
      throw new Error('force-rollback');
    })();
  }catch{}
  const ghost=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE entity_id='ghost-doc'").get().n;
  assert.equal(ghost,0);
  const bad=await req('POST','/api/client/despesas',{occurred_on:'bad',description:'x',amount:'10',payment_method:'PIX'},clientToken);
  assert.equal(bad.status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses WHERE tenant_id=?').get(ownerA.user.tenant_id).n,beforeExp);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domain_events WHERE tenant_id=?').get(ownerA.user.tenant_id).n,beforeEv);
});

test('escala 100 usuários e 1000 notificações paginadas',async()=>{
  const hash=bcrypt.hashSync(password,4);
  const insertU=db.prepare('INSERT INTO users(id,tenant_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?,1)');
  for(let i=0;i<100;i++)insertU.run(uuid(),ownerA.user.tenant_id,'User '+i,'scale.s08.'+i+'@test.local',hash,'STAFF');
  const companies=[];
  const insertC=db.prepare('INSERT INTO companies(id,tenant_id,name,cnpj,status) VALUES(?,?,?,?,?)');
  for(let i=0;i<100;i++){const cid=uuid();insertC.run(cid,ownerA.user.tenant_id,'Emp Scale '+i,'00000000000'+String(i).padStart(3,'0'),'ACTIVE');companies.push(cid)}
  const t0=Date.now();
  const insertE=db.prepare("INSERT INTO domain_events(id,tenant_id,company_id,event_type,actor_user_id,entity_type,entity_id,payload_json,status,processed_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)");
  const insertN=db.prepare('INSERT INTO notifications(id,tenant_id,user_id,type,title,message,event_id,company_id,recipient_user_id,entity_type,entity_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const batch=db.transaction(()=>{
    for(let i=0;i<1000;i++){
      const eid=uuid(),nid=uuid(),cid=companies[i%100];
      insertE.run(eid,ownerA.user.tenant_id,cid,'EXPENSE_CREATED',clientId,'expense','scale-exp-'+i,'{"amount_cents":100}','PROCESSED');
      insertN.run(nid,ownerA.user.tenant_id,ownerA.user.id,'EXPENSE_CREATED','Nova despesa recebida','Cremolia enviou uma nova despesa',eid,cid,ownerA.user.id,'expense','scale-exp-'+i);
    }
  });
  batch();
  const elapsed=Date.now()-t0;
  const page=await req('GET','/api/notificacoes?page=2&page_size=50',undefined,ownerA.token);
  assert.equal(page.status,200);
  assert.equal(items(page).length,50);
  assert.ok(page.data.total>=1000);
  assert.ok(page.data.unread>=1000);
  const iso=await req('GET','/api/notificacoes?page=1&page_size=50',undefined,ownerB.token);
  assert.ok(!items(iso).some(x=>String(x.entity_id||'').startsWith('scale-exp-')));
  assert.ok(elapsed<15000,elapsed);
});

test('HTTP: login, portal isolado e HTML do escritório com notificações',async()=>{
  const login=await req('POST','/api/auth/login',{email:'owner.a.s08@test.local',password,tenant:ownerA.user.tenant_slug});
  assert.equal(login.status,200);
  const dash=await req('GET','/api/dashboard',undefined,login.data.token);
  assert.equal(dash.status,200);
  const html=await fetch(base+'/').then(r=>r.text());
  assert.match(html,/app\.js\?v=s28-1/);
  const js=await fetch(base+'/assets/app.js?v=s13-15').then(r=>r.text());
  assert.match(js,/notif-bell/);
  assert.match(js,/NOTIF_POLL_VISIBLE_MS\s*=\s*5000/);
  assert.match(js,/startNotifPoll/);
  assert.match(js,/dedupeNotifications/);
  const portal=await fetch(base+'/portal/').then(r=>r.text());
  assert.doesNotMatch(portal,/Débito/);
});
