'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s131-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-1-secret-ok';
process.env.CDS_CNPJ_PROVIDER='mock';
process.env.CDS_CEP_PROVIDER='mock';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}

const {mapBrasilApi,toCompanyFields}=require('../backend/src/empresas/cnpj/normalize');
const {shouldLookupCep,mergeAddressData,complementCnpjAddress}=require('../backend/src/empresas/cep/address');
const {app,db,setCnpjProvider,setCepProvider}=require('../backend/src/server');

const CNPJ_REAL='38204469000115';
const password='Senha@123';
let server,base,owner,cepCalls;

function brasilApiPastelaria(){
  return {
    uf:'CE',cep:'63031010',bairro:'TIRADENTES',municipio:'JUAZEIRO DO NORTE',
    logradouro:'',numero:'',complemento:'',
    razao_social:'CICERA ERICA ALVES GOMES LANCHONETE',
    nome_fantasia:'PASTELARIA DO CHEFF',
    ddd_telefone_1:'',ddd_telefone_2:'',email:null
  };
}

function completeCadastro(){
  return {
    cnpj:'41.049.807/0001-04',razao_social:'EMPRESA COMPLETA LTDA',nome_fantasia:'Completa',
    logradouro:'Rua Exemplo',numero:'123',complemento:'Sala 1',bairro:'Centro',
    cep:'63031-010',municipio:'Juazeiro do Norte',uf:'CE',telefone:'88999999999',email:'a@b.com'
  };
}

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
      if(key==='00000000')throw new Error('cep fail');
      if(key==='11111111')return {status:'unavailable',code:'PROVIDER_INDISPONIVEL'};
      return {status:'ok',data:{cep:'63031-010',logradouro:'Rua X',bairro:'TIRADENTES',municipio:'JUAZEIRO DO NORTE',uf:'CE'}};
    }
  });
  setCnpjProvider({
    name:'mock',
    consultarCnpj:async cnpj=>{
      const key=String(cnpj||'').replace(/\D/g,'');
      if(key===CNPJ_REAL)return {status:'ok',code:'EMPRESA_ENCONTRADA',data:mapBrasilApi(brasilApiPastelaria(),key)};
      if(key==='11111111000191')return {status:'ok',data:{...completeCadastro(),numero:null,telefone:null,cnpj:'11.111.111/0001-91'}};
      if(key==='22222222000172')return {status:'ok',data:{...completeCadastro(),logradouro:null,cnpj:'22.222.222/0001-72'}};
      if(key==='33333333000153')return {status:'ok',data:{...completeCadastro(),bairro:null,cnpj:'33.333.333/0001-53'}};
      if(key==='44444444000134')return {status:'ok',data:{...completeCadastro(),municipio:null,cnpj:'44.444.444/0001-34'}};
      if(key==='55555555000115')return {status:'ok',data:{...completeCadastro(),uf:null,cnpj:'55.555.555/0001-15'}};
      if(key==='66666666000106')return {status:'ok',data:{...completeCadastro(),cep:null,logradouro:null,cnpj:'66.666.666/0001-06'}};
      if(key==='77777777000197')return {status:'ok',data:{...completeCadastro(),logradouro:null,cep:'11111-111',cnpj:'77.777.777/0001-97'}};
      return {status:'ok',data:completeCadastro()};
    }
  });
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório CEP',email:'owner.s131@test.local',password,tenantName:'Tenant CEP'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  owner=(await req('POST','/api/auth/login',{email:'owner.s131@test.local',password,tenant:a.data.tenant_slug})).data;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('cenário 1: endereço completo do CNPJ não consulta CEP',async()=>{
  assert.equal(shouldLookupCep(completeCadastro()),false);
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'41.049.807/0001-04'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cadastro.logradouro,'Rua Exemplo');
  assert.equal(r.data.cep_fallback,false);
  assert.equal(cepCalls,0);
});

test('cenário 2: CEP + bairro + município + UF sem logradouro consulta CEP e preserva os demais',async()=>{
  const cnpj={cep:'63031-010',logradouro:null,bairro:'TIRADENTES',municipio:'JUAZEIRO DO NORTE',uf:'CE'};
  assert.equal(shouldLookupCep(cnpj),true);
  const merged=mergeAddressData(cnpj,{logradouro:'Rua X',bairro:'OUTRO',municipio:'OUTRA',uf:'SP'});
  assert.equal(merged.logradouro,'Rua X');
  assert.equal(merged.bairro,'TIRADENTES');
  assert.equal(merged.municipio,'JUAZEIRO DO NORTE');
  assert.equal(merged.uf,'CE');
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'22.222.222/0001-72'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cep_fallback,true);
  assert.equal(r.data.cadastro.logradouro,'Rua X');
  assert.equal(r.data.cadastro.bairro,'Centro');
  assert.ok(cepCalls>=1);
});

test('cenário 3: CEP sem bairro consulta CEP e completa bairro',async()=>{
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'33.333.333/0001-53'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cep_fallback,true);
  assert.equal(r.data.cadastro.bairro,'TIRADENTES');
  assert.equal(r.data.cadastro.logradouro,'Rua Exemplo');
  assert.ok(cepCalls>=1);
});

test('cenário 4: CEP sem município consulta CEP e completa município',async()=>{
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'44.444.444/0001-34'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cadastro.municipio,'JUAZEIRO DO NORTE');
  assert.equal(r.data.cep_fallback,true);
});

test('cenário 5: CEP sem UF consulta CEP e completa UF',async()=>{
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'55.555.555/0001-15'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cadastro.uf,'CE');
  assert.equal(r.data.cep_fallback,true);
});

test('cenário 6: endereço completo com número vazio NÃO consulta CEP',async()=>{
  const data={...completeCadastro(),numero:''};
  assert.equal(shouldLookupCep(data),false);
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'11.111.111/0001-91'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cep_fallback,false);
  assert.equal(cepCalls,0);
  assert.equal(r.data.cadastro.numero,null);
  const fields=toCompanyFields(r.data.cadastro);
  assert.equal(fields.address_number,null);
});

test('cenário 7: telefone vazio NÃO consulta CEP e não bloqueia cadastro',async()=>{
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'11.111.111/0001-91'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cep_fallback,false);
  assert.equal(cepCalls,0);
  const created=await req('POST','/api/empresas',{
    name:r.data.cadastro.razao_social,cnpj:'11.111.111/0001-91',
    address:r.data.cadastro.logradouro,city:r.data.cadastro.municipio,state:r.data.cadastro.uf,zip:r.data.cadastro.cep
  },owner.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.phone,null);
});

test('cenário 8: fallback CEP falha e consulta CNPJ permanece válida',async()=>{
  const cnpj={cep:'11111-111',logradouro:null,bairro:'TIRADENTES',municipio:'JUAZEIRO DO NORTE',uf:'CE',razao_social:'FALHA CEP LTDA'};
  const out=await complementCnpjAddress(cnpj,async()=>({status:'unavailable'}));
  assert.equal(out.cep_fallback,true);
  assert.equal(out.cep_ok,false);
  assert.equal(out.cadastro.razao_social,'FALHA CEP LTDA');
  assert.equal(out.cadastro.bairro,'TIRADENTES');
  assert.equal(out.cadastro.logradouro,null);
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'77.777.777/0001-97'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.status,'EMPRESA_ENCONTRADA');
  assert.equal(r.data.cadastro.bairro,'Centro');
});

test('cenário 9: sem CEP e endereço incompleto NÃO consulta CEP',async()=>{
  assert.equal(shouldLookupCep({cep:null,logradouro:null,bairro:'X',municipio:'Y',uf:'CE'}),false);
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'66.666.666/0001-06'},owner.token);
  assert.equal(r.status,200);
  assert.equal(r.data.cep_fallback,false);
  assert.equal(cepCalls,0);
});

test('cenário 10: CNPJ 38204469000115 complementa logradouro via CEP e mantém número/telefone manuais',async()=>{
  const mapped=mapBrasilApi(brasilApiPastelaria(),CNPJ_REAL);
  assert.equal(mapped.razao_social,'CICERA ERICA ALVES GOMES LANCHONETE');
  assert.equal(mapped.nome_fantasia,'PASTELARIA DO CHEFF');
  assert.equal(mapped.cep,'63031-010');
  assert.equal(mapped.bairro,'TIRADENTES');
  assert.equal(mapped.municipio,'JUAZEIRO DO NORTE');
  assert.equal(mapped.uf,'CE');
  assert.equal(mapped.logradouro,null);
  assert.equal(mapped.numero,null);
  assert.equal(mapped.telefone,null);
  assert.equal(shouldLookupCep(mapped),true);
  cepCalls=0;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'38.204.469/0001-15'},owner.token);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.cep_fallback,true);
  assert.equal(r.data.cadastro.razao_social,'CICERA ERICA ALVES GOMES LANCHONETE');
  assert.equal(r.data.cadastro.nome_fantasia,'PASTELARIA DO CHEFF');
  assert.equal(r.data.cadastro.cep,'63031-010');
  assert.equal(r.data.cadastro.bairro,'TIRADENTES');
  assert.equal(r.data.cadastro.municipio,'JUAZEIRO DO NORTE');
  assert.equal(r.data.cadastro.uf,'CE');
  assert.equal(r.data.cadastro.logradouro,'Rua X');
  assert.equal(r.data.cadastro.numero,null);
  assert.equal(r.data.cadastro.telefone,null);
  assert.ok(cepCalls>=1);
});
