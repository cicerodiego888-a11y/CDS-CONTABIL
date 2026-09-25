'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const cp=require('child_process');
const jwt=require('jsonwebtoken');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s05-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-05-secret-ok';
process.env.DEMO_MODE='false';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,ownerA,ownerB,slugA,slugB,companyA,companyB,staffA,accA;
const password='Senha@123';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const root=path.resolve(__dirname,'..');

function req(method,url,body,token,companyId){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(companyId)headers['X-Company-Id']=companyId;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data,headers:r.headers};
  });
}
function items(r){return Array.isArray(r.data)?r.data:(r.data&&r.data.items)||[]}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Owner A',email:'admin@empresa.com',password,tenantName:'Tenant Alfa S05'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  slugA=a.data.tenant_slug;
  ownerA=(await req('POST','/api/auth/login',{email:'admin@empresa.com',password,tenant:slugA})).data;
  const b=await req('POST','/api/auth/register',{name:'Owner B',email:'admin@empresa.com',password,tenantName:'Tenant Beta S05'});
  assert.equal(b.status,201,JSON.stringify(b.data));
  slugB=b.data.tenant_slug;
  ownerB=(await req('POST','/api/auth/login',{email:'admin@empresa.com',password,tenant:slugB})).data;
  companyA=(await req('POST','/api/empresas',{name:'Empresa A S05',trade_name:'EA'},ownerA.token)).data;
  companyB=(await req('POST','/api/empresas',{name:'Empresa B S05',trade_name:'EB'},ownerB.token)).data;
  const staff=await req('POST','/api/usuarios',{name:'Staff A',email:'staff.a@test.local',password,role:'STAFF'},ownerA.token);
  assert.equal(staff.status,201,JSON.stringify(staff.data));
  staffA=(await req('POST','/api/auth/login',{email:'staff.a@test.local',password,tenant:slugA})).data;
  const acc=await req('POST','/api/usuarios',{name:'Contador A',email:'acc.a@test.local',password,role:'ACCOUNTANT'},ownerA.token);
  assert.equal(acc.status,201,JSON.stringify(acc.data));
  accA=(await req('POST','/api/auth/login',{email:'acc.a@test.local',password,tenant:slugA})).data;
  await req('POST','/api/despesas',{company_id:companyA.id,occurred_on:'2026-09-10',description:'Desp A',amount:'10,00',payment_method:'PIX'},ownerA.token);
  await req('POST','/api/despesas',{company_id:companyB.id,occurred_on:'2026-09-10',description:'Desp B',amount:'20,00',payment_method:'PIX'},ownerB.token);
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('JWT_SECRET ausente em production impede o boot',()=>{
  // Isola do .env local: produção + DEMO_MODE=true é rejeitado antes do JWT.
  // Este teste valida JWT_SECRET, então força DEMO_MODE=false explicitamente.
  const childEnv={
    ...process.env,
    NODE_ENV:'production',
    DEMO_MODE:'false',
    JWT_SECRET:'',
    CDS_DB_PATH:path.join(os.tmpdir(),'cds-jwt-prod.db')
  };
  const r=cp.spawnSync(process.execPath,['-e',"process.env.NODE_ENV='production';process.env.DEMO_MODE='false';process.env.JWT_SECRET='';process.env.CDS_DB_PATH=require('os').tmpdir()+'/cds-jwt-prod.db';try{require('./backend/src/server');process.exit(0)}catch(e){process.stderr.write(e.message);process.exit(2)}"],{cwd:root,env:childEnv,encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(String(r.stderr||'')+String(r.stdout||''),/JWT_SECRET/);
});

test('mesmo e-mail autentica no tenant correto e falha no outro',async()=>{
  const okA=await req('POST','/api/auth/login',{email:'admin@empresa.com',password,tenant:slugA});
  assert.equal(okA.status,200);
  assert.equal(okA.data.user.tenant_id,ownerA.user.tenant_id);
  const decoded=jwt.decode(okA.data.token);
  assert.equal(decoded.tenant_id,ownerA.user.tenant_id);
  assert.equal(decoded.sub,ownerA.user.id);
  assert.ok(decoded.iat);
  const okB=await req('POST','/api/auth/login',{email:'admin@empresa.com',password,tenant:slugB});
  assert.equal(okB.status,200);
  assert.equal(okB.data.user.tenant_id,ownerB.user.tenant_id);
  const cross=await req('POST','/api/auth/login',{email:'staff.a@test.local',password,tenant:slugB});
  assert.equal(cross.status,401);
  assert.equal(cross.data.error,'INVALID_CREDENTIALS');
  assert.equal(cross.data.message,'Credenciais inválidas.');
});

test('senha errada, tenant inexistente e ausência de tenant (Login V2)',async()=>{
  const bad=await req('POST','/api/auth/login',{email:'admin@empresa.com',password:'Errada123',tenant:slugA});
  assert.equal(bad.status,401);
  assert.equal(bad.data.message,'Credenciais inválidas.');
  const missing=await req('POST','/api/auth/login',{email:'admin@empresa.com',password,tenant:'nao-existe'});
  assert.equal(missing.status,401);
  assert.equal(missing.data.message,'Credenciais inválidas.');
  const noneBad=await req('POST','/api/auth/login',{email:'admin@empresa.com',password:'Errada123'});
  assert.equal(noneBad.status,401);
  assert.equal(noneBad.data.message,'Credenciais inválidas.');
  assert.ok(!noneBad.data.environments);
  const none=await req('POST','/api/auth/login',{email:'admin@empresa.com',password});
  assert.equal(none.status,200);
  assert.ok(none.data.token||none.data.needs_environment_choice);
});

test('usuário inativo recebe falha genérica',async()=>{
  db.prepare('UPDATE users SET active=0 WHERE email=? AND tenant_id=?').run('staff.a@test.local',ownerA.user.tenant_id);
  const r=await req('POST','/api/auth/login',{email:'staff.a@test.local',password,tenant:slugA});
  assert.equal(r.status,401);
  assert.equal(r.data.message,'Credenciais inválidas.');
  db.prepare('UPDATE users SET active=1 WHERE email=? AND tenant_id=?').run('staff.a@test.local',ownerA.user.tenant_id);
});

test('CLIENT não acessa API administrativa',async()=>{
  const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente View',email:'viewer.s05@test.local',profile:'CLIENT_VIEWER'},ownerA.token);
  assert.equal(u.status,201,JSON.stringify(u.data));
  const token=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+token+'/accept',{name:'Cliente View',password,confirmation:password});
  assert.equal(acc.status,200);
  const dash=await req('GET','/api/dashboard',undefined,acc.data.token);
  assert.equal(dash.status,403);
  const emp=await req('GET','/api/empresas',undefined,acc.data.token);
  assert.equal(emp.status,403);
  const exp=await req('POST','/api/client/despesas',{occurred_on:'2026-09-15',description:'Negado',amount:'10,00',payment_method:'PIX'},acc.data.token);
  assert.equal(exp.status,403);
});

test('OWNER persiste nome, e-mail, perfil e status do usuário do escritório',async()=>{
  const created=await req('POST','/api/usuarios',{name:'Equipe Edit',email:'staff.edit@test.local',password,role:'STAFF'},ownerA.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  const id=created.data.id;
  const patch=await req('PATCH','/api/usuarios/'+id,{name:'Equipe Editada',email:'staff.editado@test.local',role:'ACCOUNTANT',active:false},ownerA.token);
  assert.equal(patch.status,200,JSON.stringify(patch.data));
  assert.equal(patch.data.name,'Equipe Editada');
  assert.equal(patch.data.email,'staff.editado@test.local');
  assert.equal(patch.data.role,'ACCOUNTANT');
  assert.equal(Number(patch.data.active),0);
  const listed=await req('GET','/api/usuarios?q='+encodeURIComponent('staff.editado@test.local'),undefined,ownerA.token);
  assert.equal(listed.status,200);
  const row=(listed.data.items||[]).find(x=>x.id===id);
  assert.ok(row);
  assert.equal(row.name,'Equipe Editada');
  assert.equal(row.email,'staff.editado@test.local');
  assert.equal(row.role,'ACCOUNTANT');
  assert.equal(Number(row.active),0);
  const dbRow=db.prepare('SELECT name,email,role,active FROM users WHERE id=? AND tenant_id=?').get(id,ownerA.user.tenant_id);
  assert.equal(dbRow.name,'Equipe Editada');
  assert.equal(dbRow.email,'staff.editado@test.local');
  assert.equal(dbRow.role,'ACCOUNTANT');
  assert.equal(Number(dbRow.active),0);
  const labeled=await req('PATCH','/api/usuarios/'+id,{role:'Equipe'},ownerA.token);
  assert.equal(labeled.status,403);
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id).role,'ACCOUNTANT');
});

test('ACCOUNTANT e STAFF não elevam privilégio para OWNER',async()=>{
  const elev=await req('POST','/api/usuarios',{name:'Fake Owner',email:'fake.owner@test.local',password,role:'OWNER'},accA.token);
  assert.equal(elev.status,403);
  assert.equal(elev.data.error,'ROLE_ELEVATION_FORBIDDEN');
  const patch=await req('PATCH','/api/usuarios/'+ownerA.user.id,{role:'STAFF'},accA.token);
  assert.equal(patch.status,403);
  const staffPatch=await req('PATCH','/api/usuarios/'+ownerA.user.id,{role:'OWNER'},staffA.token);
  assert.equal(staffPatch.status,403);
  const foreign=await req('PATCH','/api/usuarios/'+staffA.user.id,{name:'Hijack'},ownerB.token);
  assert.equal(foreign.status,404);
  assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(staffA.user.id).name,'Staff A');
  const clientUser=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Cliente Patch',email:'client.patch.s05@test.local',profile:'CLIENT_ADMIN'},ownerA.token);
  assert.equal(clientUser.status,201,JSON.stringify(clientUser.data));
  const inviteTok=clientUser.data.invitation.activation_url.split('/convite/')[1];
  const clientAcc=await req('POST','/api/invitations/'+inviteTok+'/accept',{name:'Cliente Patch',password,confirmation:password});
  assert.equal(clientAcc.status,200);
  const clientAdmin=await req('PATCH','/api/usuarios/'+staffA.user.id,{name:'Via Cliente'},clientAcc.data.token);
  assert.equal(clientAdmin.status,403);
  assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(staffA.user.id).name,'Staff A');
});

test('company de outro tenant no header e no body',async()=>{
  const routes=['/api/dashboard','/api/despesas','/api/receitas','/api/documentos','/api/lancamentos','/api/pendencias','/api/categorias','/api/bancos','/api/regras-contabeis','/api/solicitacoes','/api/exportacoes','/api/aprovacao/pendentes'];
  for(const url of routes){
    const r=await req('GET',url,undefined,ownerA.token,companyB.id);
    assert.equal(r.status,404,url+' '+JSON.stringify(r.data));
  }
  const body=await req('POST','/api/despesas',{company_id:companyB.id,occurred_on:'2026-09-16',description:'Spoof tenant',amount:'10,00',payment_method:'PIX'},ownerA.token);
  assert.equal(body.status,404);
  const spoof=await req('POST','/api/despesas',{company_id:companyB.id,occurred_on:'2026-09-16',description:'Spoof contexto',amount:'10,00',payment_method:'PIX'},ownerA.token,companyA.id);
  assert.equal(spoof.status,201);
  assert.equal(spoof.data.company_id,companyA.id);
});

test('documento e exportação cross-tenant',async()=>{
  const fd=new FormData();
  fd.append('file',new Blob([png],{type:'image/png'}),'a.png');
  fd.append('company_id',companyB.id);
  const up=await fetch(base+'/api/documentos/upload',{method:'POST',headers:{Authorization:'Bearer '+ownerB.token},body:fd});
  const doc=await up.json();
  assert.equal(up.status,201,JSON.stringify(doc));
  const dl=await fetch(base+'/api/documentos/'+doc.id+'/download',{headers:{Authorization:'Bearer '+ownerA.token}});
  assert.equal(dl.status,404);
  const exp=await req('POST','/api/exportacoes/gerar',{company_id:companyB.id,system_key:'dominio',period_start:'2026-09-01',period_end:'2026-09-30'},ownerA.token);
  assert.ok([400,404].includes(exp.status));
  const list=await req('GET','/api/exportacoes',undefined,ownerA.token);
  assert.ok(items(list).every(x=>x.company_id!==companyB.id));
});

test('lançamento e pendência cross-tenant',async()=>{
  const entriesB=await req('GET','/api/lancamentos',undefined,ownerB.token);
  const foreign=items(entriesB)[0];
  if(foreign){
    const get=await req('GET','/api/lancamentos/'+foreign.id,undefined,ownerA.token);
    assert.equal(get.status,404);
  }
  const pendB=await req('GET','/api/pendencias',undefined,ownerB.token);
  const pendA=await req('GET','/api/pendencias',undefined,ownerA.token);
  const idsB=new Set(items(pendB).map(x=>x.id));
  assert.ok(items(pendA).every(x=>!idsB.has(x.id)||x.company_id===companyA.id));
});

test('empresa bloqueada: leitura ok, escrita 409 mesmo com spoof no body',async()=>{
  await req('POST',`/api/empresas/${companyA.id}/bloquear`,{},ownerA.token);
  const read=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(read.status,200);
  const write=await req('POST','/api/despesas',{company_id:companyB.id,occurred_on:'2026-09-17',description:'Bloqueada',amount:'10,00',payment_method:'PIX'},ownerA.token,companyA.id);
  assert.equal(write.status,409);
  await req('POST',`/api/empresas/${companyA.id}/desbloquear`,{},ownerA.token);
});

test('logout e senha: política e sessão',async()=>{
  const out=await req('POST','/api/auth/logout',{},ownerA.token);
  assert.equal(out.status,200);
  assert.equal(out.data.ok,true);
  const weak=await req('POST','/api/auth/password',{current:password,password:'short'},ownerA.token);
  assert.equal(weak.status,400);
  const ok=await req('POST','/api/auth/password',{current:password,password:'NovaSenha1'},ownerA.token);
  assert.equal(ok.status,200);
  const old=await req('POST','/api/auth/login',{email:'admin@empresa.com',password,tenant:slugA});
  assert.equal(old.status,401);
  const neu=await req('POST','/api/auth/login',{email:'admin@empresa.com',password:'NovaSenha1',tenant:slugA});
  assert.equal(neu.status,200);
  ownerA=neu.data;
  const back=await req('POST','/api/auth/password',{current:'NovaSenha1',password},ownerA.token);
  assert.equal(back.status,200);
});

test('senha abaixo da política no registro e senha válida',async()=>{
  const weak=await req('POST','/api/auth/register',{name:'X',email:'x@test.local',password:'abcdefg',tenantName:'Fracote'});
  assert.equal(weak.status,400);
  const ok=await req('POST','/api/auth/register',{name:'Y',email:'y@test.local',password:'Abcdefg1',tenantName:'Forte Escritorio'});
  assert.equal(ok.status,201);
  assert.ok(ok.data.tenant_slug);
});

test('convite não imprime token no log',async()=>{
  const logs=[];
  const orig=console.log;
  console.log=(...a)=>logs.push(a.join(' '));
  try{
    const u=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'Log User',email:'log.s05@test.local',profile:'CLIENT_FINANCE'},ownerA.token);
    assert.equal(u.status,201,JSON.stringify(u.data));
  }finally{console.log=orig}
  assert.ok(logs.some(x=>/Convite criado/.test(x)));
  assert.ok(!logs.some(x=>/\/convite\/[a-f0-9]{20}/i.test(x)));
  assert.ok(!logs.some(x=>/Bearer /i.test(x)));
});

test('headers de segurança e CORS de desenvolvimento',async()=>{
  const r=await fetch(base+'/api/health');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.equal(r.headers.get('x-frame-options'),'DENY');
  assert.ok(!r.headers.get('x-powered-by'));
});

test('rate limit de login responde 429',async()=>{
  process.env.CDS_LOGIN_MAX='3';
  const email='ratelimit.s05@test.local';
  await req('POST','/api/auth/register',{name:'RL',email,password,tenantName:'Rate Limit Office'});
  let last;
  for(let i=0;i<4;i++) last=await req('POST','/api/auth/login',{email,password:'errada1A',tenant:'rate-limit-office'});
  delete process.env.CDS_LOGIN_MAX;
  assert.equal(last.status,429);
});

test('contexto Sprint 04 permanece: visão geral e X-Company-Id',async()=>{
  const overview=await req('GET','/api/dashboard',undefined,ownerA.token);
  assert.equal(overview.status,200);
  assert.equal(overview.data.company_id,null);
  const ctx=await req('GET','/api/dashboard',undefined,ownerA.token,companyA.id);
  assert.equal(ctx.status,200);
  assert.equal(ctx.data.company_id,companyA.id);
  const page=await fetch(base+'/empresas/'+companyA.id);
  assert.equal(page.status,200);
});
