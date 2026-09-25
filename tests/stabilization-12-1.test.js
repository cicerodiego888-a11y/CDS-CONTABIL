'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const jwt=require('jsonwebtoken');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s12-1-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-12-1-secret';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');
const root=path.resolve(__dirname,'..');
const brandRoot=path.join(root,'uploads','branding');

let server,base,ownerA,ownerB,slugA,slugB,accA,staffA,clientA,companyA;
const password='Senha@123';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const pngB=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
const jpg=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=','base64');

function req(method,url,body,token,companyId){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(companyId)headers['X-Company-Id']=companyId;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}
async function uploadLogo(token,buf,filename,type){
  const fd=new FormData();
  fd.append('file',new Blob([buf],{type:type||'image/png'}),filename);
  const r=await fetch(base+'/api/tenant/branding/logo',{method:'POST',headers:{Authorization:'Bearer '+token},body:fd});
  let data=null;try{data=await r.json()}catch{}
  return {status:r.status,data};
}
async function getLogo(token){
  const r=await fetch(base+'/api/tenant/branding/logo',{headers:{Authorization:'Bearer '+(token||'')}});
  const buf=Buffer.from(await r.arrayBuffer());
  return {status:r.status,buf,type:r.headers.get('content-type')}
}
async function accept(invite,name){
  const token=invite.activation_url.split('/convite/')[1];
  const r=await req('POST','/api/invitations/'+token+'/accept',{name,password,confirmation:password});
  assert.equal(r.status,200,JSON.stringify(r.data));
  return r.data;
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Owner A',email:'owner.a.s121@test.local',password,tenantName:'Escritório Alfa S121'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  slugA=a.data.tenant_slug;
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s121@test.local',password,tenant:slugA})).data;
  const b=await req('POST','/api/auth/register',{name:'Owner B',email:'owner.b.s121@test.local',password,tenantName:'Escritório Beta S121'});
  assert.equal(b.status,201,JSON.stringify(b.data));
  slugB=b.data.tenant_slug;
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s121@test.local',password,tenant:slugB})).data;
  const acc=await req('POST','/api/usuarios',{name:'Contador A',email:'acc.a.s121@test.local',password,role:'ACCOUNTANT'},ownerA.token);
  assert.equal(acc.status,201,JSON.stringify(acc.data));
  accA=(await req('POST','/api/auth/login',{email:'acc.a.s121@test.local',password,tenant:slugA})).data;
  const staff=await req('POST','/api/usuarios',{name:'Staff A',email:'staff.a.s121@test.local',password,role:'STAFF'},ownerA.token);
  assert.equal(staff.status,201,JSON.stringify(staff.data));
  staffA=(await req('POST','/api/auth/login',{email:'staff.a.s121@test.local',password,tenant:slugA})).data;
  companyA=(await req('POST','/api/empresas',{name:'Cliente Alfa Ltda',trade_name:'Alfa',cnpj:'11222333000181'},ownerA.token)).data;
  const inv=await req('POST',`/api/empresas/${companyA.id}/users`,{name:'João Cliente',email:'joao.s121@test.local',profile:'Administrador'},ownerA.token);
  clientA=await accept(inv.data.invitation,'João Cliente');
});
after(()=>{
  const rows=db.prepare('SELECT logo_path FROM tenant_branding').all();
  for(const row of rows){
    if(!row.logo_path)continue;
    try{fs.unlinkSync(path.join(brandRoot,row.logo_path))}catch{}
  }
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('tenant sem logo recebe fallback persistente',async()=>{
  const r=await req('GET','/api/tenant/branding',undefined,ownerA.token);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.has_logo,false);
  assert.equal(r.data.office_name,'Escritório Alfa S121');
  assert.equal(r.data.logo_url,null);
  assert.equal(r.data.logo_path,undefined);
  const logo=await getLogo(ownerA.token);
  assert.equal(logo.status,404);
});

test('OWNER persiste identidade e logo no servidor',async()=>{
  const patch=await req('PATCH','/api/tenant/branding',{office_name:'Contábil Alfa',slogan:'Contabilidade com clareza',tenant_id:ownerB.user.tenant_id},ownerA.token);
  assert.equal(patch.status,200,JSON.stringify(patch.data));
  assert.equal(patch.data.office_name,'Contábil Alfa');
  assert.equal(patch.data.slogan,'Contabilidade com clareza');
  const up=await uploadLogo(ownerA.token,png,'logo-a.png','image/png');
  assert.equal(up.status,200,JSON.stringify(up.data));
  assert.equal(up.data.has_logo,true);
  assert.match(up.data.logo_url,/\/api\/tenant\/branding\/logo/);
  const row=db.prepare('SELECT * FROM tenant_branding WHERE tenant_id=?').get(ownerA.user.tenant_id);
  assert.ok(row.logo_path.startsWith(ownerA.user.tenant_id+'/'));
  assert.ok(fs.existsSync(path.join(brandRoot,row.logo_path)));
  const docs=db.prepare('SELECT COUNT(*) n FROM documents WHERE tenant_id=?').get(ownerA.user.tenant_id).n;
  assert.equal(docs,0);
  const tenant=db.prepare('SELECT name FROM tenants WHERE id=?').get(ownerA.user.tenant_id);
  assert.equal(tenant.name,'Contábil Alfa');
});

test('logo permanece após nova autenticação sem localStorage',async()=>{
  const login=await req('POST','/api/auth/login',{email:'owner.a.s121@test.local',password,tenant:slugA});
  assert.equal(login.status,200);
  const brand=await req('GET','/api/tenant/branding',undefined,login.data.token);
  assert.equal(brand.status,200);
  assert.equal(brand.data.has_logo,true);
  const logo=await getLogo(login.data.token);
  assert.equal(logo.status,200);
  assert.equal(logo.type,'image/png');
  assert.ok(logo.buf.equals(png));
});

test('isolamento: Tenant B não recebe logo do Tenant A',async()=>{
  const empty=await req('GET','/api/tenant/branding',undefined,ownerB.token);
  assert.equal(empty.status,200);
  assert.equal(empty.has_logo||empty.data.has_logo,false);
  const up=await uploadLogo(ownerB.token,pngB,'logo-b.png','image/png');
  assert.equal(up.status,200,JSON.stringify(up.data));
  const logoA=await getLogo(ownerA.token);
  const logoB=await getLogo(ownerB.token);
  assert.equal(logoA.status,200);
  assert.equal(logoB.status,200);
  assert.ok(logoA.buf.equals(png));
  assert.ok(logoB.buf.equals(pngB));
  assert.ok(!logoA.buf.equals(logoB.buf));
});

test('ACCOUNTANT pode atualizar identidade do próprio tenant',async()=>{
  const r=await req('PATCH','/api/tenant/branding',{slogan:'Revisão do contador'},accA.token);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.slogan,'Revisão do contador');
  const jpgUp=await uploadLogo(accA.token,jpg,'marca.jpg','image/jpeg');
  assert.equal(jpgUp.status,200,JSON.stringify(jpgUp.data));
  const logo=await getLogo(accA.token);
  assert.equal(logo.status,200);
  assert.equal(logo.type,'image/jpeg');
});

test('STAFF lê branding e não ganha permissão de escrita',async()=>{
  const get=await req('GET','/api/tenant/branding',undefined,staffA.token);
  assert.equal(get.status,200);
  assert.equal(get.data.has_logo,true);
  const patch=await req('PATCH','/api/tenant/branding',{slogan:'Staff não pode'},staffA.token);
  assert.equal(patch.status,403);
  const up=await uploadLogo(staffA.token,png,'staff.png','image/png');
  assert.equal(up.status,403);
  const del=await req('DELETE','/api/tenant/branding/logo',undefined,staffA.token);
  assert.equal(del.status,403);
  const still=await req('GET','/api/auth/me',undefined,staffA.token);
  assert.equal(still.status,200);
});

test('CLIENT não altera nem lê identidade do escritório',async()=>{
  const get=await req('GET','/api/tenant/branding',undefined,clientA.token);
  assert.equal(get.status,403);
  const patch=await req('PATCH','/api/tenant/branding',{office_name:'Hack'},clientA.token);
  assert.equal(patch.status,403);
  const up=await uploadLogo(clientA.token,png,'cli.png','image/png');
  assert.equal(up.status,403);
  const me=await req('GET','/api/auth/me',undefined,clientA.token);
  assert.equal(me.status,200);
  assert.equal(me.data.role,'CLIENT');
});

test('tenant_id do corpo não altera o tenant do JWT',async()=>{
  const before=await req('GET','/api/tenant/branding',undefined,ownerB.token);
  await req('PATCH','/api/tenant/branding',{office_name:'Nome do B',tenant_id:ownerA.user.tenant_id,id:ownerA.user.tenant_id},ownerB.token);
  const a=await req('GET','/api/tenant/branding',undefined,ownerA.token);
  const b=await req('GET','/api/tenant/branding',undefined,ownerB.token);
  assert.notEqual(a.data.office_name,'Nome do B');
  assert.equal(b.data.office_name,'Nome do B');
  assert.equal(before.status,200);
});

test('upload rejeita SVG e arquivo inválido',async()=>{
  const svg=await uploadLogo(ownerA.token,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),'x.svg','image/svg+xml');
  assert.equal(svg.status,422);
  const fake=await uploadLogo(ownerA.token,Buffer.from('not-an-image'),'x.png','image/png');
  assert.equal(fake.status,422);
  const me=await req('GET','/api/auth/me',undefined,ownerA.token);
  assert.equal(me.status,200);
});

test('remoção da logo volta ao fallback sem quebrar o tenant',async()=>{
  const del=await req('DELETE','/api/tenant/branding/logo',undefined,ownerA.token);
  assert.equal(del.status,200);
  assert.equal(del.data.has_logo,false);
  const logo=await getLogo(ownerA.token);
  assert.equal(logo.status,404);
  const brand=await req('GET','/api/tenant/branding',undefined,ownerA.token);
  assert.equal(brand.status,200);
  assert.equal(brand.data.has_logo,false);
});

test('401 de sessão expirada informa a causa',async()=>{
  const expired=jwt.sign({sub:ownerA.user.id,tenant_id:ownerA.user.tenant_id,role:'OWNER'},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'1ms'});
  await new Promise(r=>setTimeout(r,20));
  const r=await req('GET','/api/tenant/branding',undefined,expired);
  assert.equal(r.status,401);
  assert.equal(r.data.error,'TOKEN_EXPIRED');
  assert.match(r.data.message,/Sua sessão expirou/);
});

test('403 não invalida a sessão',async()=>{
  const forbidden=await req('PATCH','/api/tenant/branding',{slogan:'nope'},staffA.token);
  assert.equal(forbidden.status,403);
  const me=await req('GET','/api/auth/me',undefined,staffA.token);
  assert.equal(me.status,200);
  const dash=await req('GET','/api/dashboard',undefined,staffA.token);
  assert.equal(dash.status,200);
});

test('404 não invalida a sessão',async()=>{
  const missing=await req('GET','/api/empresas/nao-existe',undefined,ownerA.token);
  assert.equal(missing.status,404);
  const api404=await req('GET','/api/recurso-inexistente-s121',undefined,ownerA.token);
  assert.equal(api404.status,404);
  const me=await req('GET','/api/auth/me',undefined,ownerA.token);
  assert.equal(me.status,200);
});

test('409 não invalida a sessão',async()=>{
  const dup=await req('POST','/api/empresas',{name:'Outra',cnpj:'11222333000181'},ownerA.token);
  assert.equal(dup.status,409);
  const me=await req('GET','/api/auth/me',undefined,ownerA.token);
  assert.equal(me.status,200);
});

test('422 não invalida a sessão',async()=>{
  const bad=await uploadLogo(ownerA.token,Buffer.from('abc'),'x.webp','image/webp');
  assert.equal(bad.status,422);
  const me=await req('GET','/api/auth/me',undefined,ownerA.token);
  assert.equal(me.status,200);
});

test('erro de servidor conhecido não exige novo login',async()=>{
  const js=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
  assert.match(js,/status===401&&!String\(path\)\.startsWith\('\/auth\/login'\)/);
  assert.match(js,/Não foi possível conectar ao servidor/);
  assert.doesNotMatch(js,/catch\(error\)\{\s*logout\(\)/);
  const r=await req('GET','/api/dashboard',undefined,ownerA.token);
  assert.equal(r.status,200);
});

test('Portal preserva sessão em erro e só reautentica em 401',async()=>{
  const js=fs.readFileSync(path.join(root,'frontend/public/portal/portal.js'),'utf8');
  assert.match(js,/status===401&&path!=='\/auth\/login'/);
  assert.match(js,/Tentar novamente/);
  assert.doesNotMatch(js,/catch\{localStorage\.removeItem\('ccc_token'\)/);
  assert.doesNotMatch(js,/Nova receita/);
  const dash=await req('GET','/api/client/dashboard',undefined,clientA.token);
  assert.equal(dash.status,200);
  const forbidden=await req('GET','/api/dashboard',undefined,clientA.token);
  assert.equal(forbidden.status,403);
  const me=await req('GET','/api/auth/me',undefined,clientA.token);
  assert.equal(me.status,200);
});

test('Dashboard carrega identidade do backend e trata erro parcial',async()=>{
  const js=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
  assert.match(js,/\/tenant\/branding/);
  assert.match(js,/officeIdentityHtml/);
  assert.match(js,/retryActivity/);
  assert.match(js,/Não foi possível carregar agora/);
  assert.match(js,/Identidade do [Ee]scritório/);
  assert.doesNotMatch(js,/ccc_tenant_logo_/);
  assert.doesNotMatch(js,/localStorage\.setItem\(tenantLogoKey/);
  const dash=await req('GET','/api/dashboard',undefined,ownerA.token);
  assert.equal(dash.status,200);
});

test('erro de rede e 5xx não disparam logout no SPA',()=>{
  const appJs=fs.readFileSync(path.join(root,'frontend/public/assets/app.js'),'utf8');
  const portalJs=fs.readFileSync(path.join(root,'frontend/public/portal/portal.js'),'utf8');
  for(const js of[appJs,portalJs]){
    assert.match(js,/Não foi possível conectar ao servidor/);
    assert.match(js,/status>=500/);
    assert.match(js,/if\(e&&e\.status===401\)return/);
    assert.doesNotMatch(js,/catch\(error\)\{\s*(logout|clearSession)\(\)/);
  }
});

test('schema e endpoints de branding estão isolados do acervo contábil',()=>{
  const schema=fs.readFileSync(path.join(root,'database/schema/013_tenant_branding.sql'),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS tenant_branding/);
  assert.match(schema,/tenant_id TEXT NOT NULL UNIQUE/);
  const server=fs.readFileSync(path.join(root,'backend/src/server.js'),'utf8');
  assert.match(server,/inspectBrandImage/);
  assert.match(server,/resolveBrandFile/);
  assert.match(server,/uploads.*branding|BRAND_DIR/);
  assert.doesNotMatch(server,/image\/svg/);
});
