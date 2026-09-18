'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s139-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-9-secret-ok';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}

const {cepDigitsExact,fillEmptyAddress,mapBrasilApiCep}=require('../backend/src/empresas/cep/address');
const {createCepProvider}=require('../backend/src/empresas/cep/provider');
const {app,db,setCepProvider}=require('../backend/src/server');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const password='Senha@123';
let server,base,ownerA,staffA,clientToken,cepCalls;

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}

before(async()=>{
  cepCalls=0;
  setCepProvider({
    name:'mock',
    consultarCep:async cep=>{
      cepCalls++;
      const key=String(cep||'').replace(/\D/g,'');
      if(key==='00000000')return {status:'not_found',code:'CEP_NAO_ENCONTRADO'};
      if(key==='11111111')return {status:'unavailable',code:'PROVIDER_INDISPONIVEL'};
      if(key==='22222222')return {status:'ok',data:{cep:'22222-222',logradouro:'',bairro:'Centro',municipio:'Fortaleza',uf:'CE'}};
      if(key==='63031165')return {status:'ok',data:{cep:'63031-165',logradouro:'Rua José Sabiá',bairro:'Tiradentes',municipio:'Juazeiro do Norte',uf:'CE'}};
      return {status:'ok',data:{cep:'63031-010',logradouro:'Rua X',bairro:'Tiradentes',municipio:'Juazeiro do Norte',uf:'CE'}};
    }
  });
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 139',email:'owner.s139@test.local',password,tenantName:'Tenant 139'});
  ownerA=(await req('POST','/api/auth/login',{email:'owner.s139@test.local',password,tenant:a.data.tenant_slug})).data;
  await req('POST','/api/usuarios',{name:'Staff 139',email:'staff.s139@test.local',password,role:'STAFF'},ownerA.token);
  staffA=(await req('POST','/api/auth/login',{email:'staff.s139@test.local',password,tenant:a.data.tenant_slug})).data;
  const company=(await req('POST','/api/empresas',{name:'Empresa 139',cnpj:'38204469000115'},ownerA.token)).data;
  const u=await req('POST',`/api/empresas/${company.id}/users`,{name:'Cliente 139',email:'client.s139@test.local',profile:'CLIENT_ADMIN'},ownerA.token);
  const tok=u.data.invitation.activation_url.split('/convite/')[1];
  clientToken=(await req('POST','/api/invitations/'+tok+'/accept',{name:'Cliente 139',password,confirmation:password})).data.token;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('normaliza CEP de 8 dígitos, hífen e espaços; rejeita incompleto',()=>{
  assert.equal(cepDigitsExact('63031165'),'63031165');
  assert.equal(cepDigitsExact('63031-165'),'63031165');
  assert.equal(cepDigitsExact(' 63031 165 '),'63031165');
  assert.equal(cepDigitsExact('6303116'),null);
  assert.equal(cepDigitsExact('abc'),null);
});

test('preenche somente campos vazios e não toca número/complemento',()=>{
  const filled=fillEmptyAddress({address:'Rua X',neighborhood:'',city:'',state:'',zip:'',address_number:'10',complement:'Ap 2'},{
    logradouro:'Rua Y',bairro:'Tiradentes',municipio:'Juazeiro do Norte',uf:'CE',cep:'63031-165',complemento:'Ignorar'
  });
  assert.equal(filled.address,'Rua X');
  assert.equal(filled.neighborhood,'Tiradentes');
  assert.equal(filled.city,'Juazeiro do Norte');
  assert.equal(filled.state,'CE');
  assert.equal(filled.address_number,'10');
  assert.equal(filled.complement,'Ap 2');
});

test('provider existente mapeia BrasilAPI sem segundo fetch próprio',()=>{
  const mapped=mapBrasilApiCep({street:'Rua José Sabiá',neighborhood:'Tiradentes',city:'Juazeiro do Norte',state:'CE',cep:'63031165'},'63031165');
  assert.equal(mapped.logradouro,'Rua José Sabiá');
  assert.equal(mapped.bairro,'Tiradentes');
  assert.equal(mapped.municipio,'Juazeiro do Norte');
  assert.equal(mapped.uf,'CE');
  const p=createCepProvider({name:'brasilapi',fetchImpl:async()=>({status:200,ok:true,json:async()=>({street:'A',neighborhood:'B',city:'C',state:'CE',cep:'63031165'})})});
  assert.equal(p.name,'brasilapi');
  assert.match(p.apiUrl,/brasilapi/);
});

test('CEP 8 dígitos, hífen e espaços consultam o mesmo endereço',async()=>{
  cepCalls=0;
  const a=await req('POST','/api/empresas/consulta-cep',{cep:'63031165'},ownerA.token);
  const b=await req('POST','/api/empresas/consulta-cep',{cep:'63031-165'},ownerA.token);
  const c=await req('POST','/api/empresas/consulta-cep',{cep:'63031 165'},ownerA.token);
  assert.equal(a.status,200,JSON.stringify(a.data));
  assert.equal(b.status,200);
  assert.equal(c.status,200);
  assert.equal(a.data.endereco.logradouro,'Rua José Sabiá');
  assert.equal(a.data.endereco.bairro,'Tiradentes');
  assert.equal(a.data.endereco.municipio,'Juazeiro do Norte');
  assert.equal(a.data.endereco.uf,'CE');
  assert.equal(a.data.endereco.cep,'63031-165');
  assert.equal(a.data.endereco.numero,undefined);
  assert.equal(cepCalls,3);
});

test('CEP inválido não consulta; inexistente e indisponível não apagam contrato',async()=>{
  const before=cepCalls;
  const invalid=await req('POST','/api/empresas/consulta-cep',{cep:'63031'},ownerA.token);
  assert.equal(invalid.status,400);
  assert.equal(invalid.data.error,'CEP_INVALIDO');
  assert.equal(cepCalls,before);
  const nf=await req('POST','/api/empresas/consulta-cep',{cep:'00000-000'},ownerA.token);
  assert.equal(nf.status,404);
  assert.equal(nf.data.message,'CEP não encontrado.');
  const un=await req('POST','/api/empresas/consulta-cep',{cep:'11111111'},ownerA.token);
  assert.equal(un.status,502);
  assert.match(un.data.message,/Preencha o endereço manualmente/);
});

test('retorno parcial preenche só o disponível',async()=>{
  const r=await req('POST','/api/empresas/consulta-cep',{cep:'22222222'},ownerA.token);
  assert.equal(r.status,200);
  assert.equal(r.data.endereco.logradouro,null);
  assert.equal(r.data.endereco.bairro,'Centro');
  assert.equal(r.data.endereco.municipio,'Fortaleza');
  assert.equal(r.data.endereco.uf,'CE');
});

test('autenticação, STAFF autorizado, CLIENT bloqueado',async()=>{
  const noAuth=await req('POST','/api/empresas/consulta-cep',{cep:'63031165'});
  assert.equal(noAuth.status,401);
  const staff=await req('POST','/api/empresas/consulta-cep',{cep:'63031165'},staffA.token);
  assert.equal(staff.status,200);
  const client=await req('POST','/api/empresas/consulta-cep',{cep:'63031165'},clientToken);
  assert.equal(client.status,403);
});

test('formulário dispara CEP no blur/debounce, preserva manuais e não consulta a cada tecla',()=>{
  const js=read('frontend/public/assets/app.js');
  const css=read('frontend/public/assets/theme.css');
  assert.match(js,/function bindCepLookup/);
  assert.match(js,/\/api\/empresas\/consulta-cep/);
  assert.match(js,/Consultando CEP\.\.\./);
  assert.match(js,/Endereço preenchido automaticamente/);
  assert.match(js,/CEP não encontrado\./);
  assert.match(js,/Não foi possível consultar o CEP\. Preencha o endereço manualmente\./);
  assert.match(js,/key\.length===8/);
  assert.match(js,/setTimeout\(consult,400\)/);
  assert.match(js,/input\.onblur/);
  assert.match(js,/fillEmptyInput\(form\.querySelector\('\[name="address"\]'\)/);
  assert.match(js,/fillEmptyInput\(form\.querySelector\('\[name="neighborhood"\]'\)/);
  assert.match(js,/fillEmptyInput\(form\.querySelector\('\[name="city"\]'\)/);
  assert.match(js,/fillEmptyInput\(form\.querySelector\('\[name="state"\]'\)/);
  assert.match(js,/function fillEmptyInput/);
  assert.doesNotMatch(js,/fillEmptyInput\(form\.querySelector\('\[name="address_number"\]'\)/);
  assert.doesNotMatch(js,/fillEmptyInput\(form\.querySelector\('\[name="complement"\]'\)/);
  assert.match(js,/id="cepInput"/);
  assert.match(js,/bindCepLookup\(\)/);
  assert.match(js,/consulta-cnpj/);
  assert.match(css,/\.cep-hint/);
  const providers=fs.readdirSync(path.join(root,'backend/src/empresas/cep')).filter(f=>f.endsWith('.js'));
  assert.deepEqual(providers.sort(),['address.js','provider.js']);
});
