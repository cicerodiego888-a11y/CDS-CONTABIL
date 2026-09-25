'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s09-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-09-secret-ok';
process.env.CDS_CNPJ_PROVIDER='mock';
process.env.CDS_CNPJ_LOOKUP_MAX='400';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {normalizeCnpjKey,isPlausibleCnpj,formatCnpjDisplay,mapBrasilApi,toCompanyFields}=require('../backend/src/empresas/cnpj/normalize');
const {createCnpjProvider}=require('../backend/src/empresas/cnpj/provider');
const {app,db,setCnpjProvider,EVENT_TYPES}=require('../backend/src/server');

let server,base,ownerA,ownerB,staffA,slugA,slugB,clientToken,calls;
const password='Senha@123';
const CNPJ='41049807000104';
const CNPJ_FMT='41.049.807/0001-04';
const OTHER='11222333000181';
const ALPHA='12ABC345000189';

function sampleCadastro(cnpj=CNPJ){
  return{
    cnpj:formatCnpjDisplay(cnpj),razao_social:'EMPRESA TESTE LTDA',nome_fantasia:'Teste Fantasia',
    situacao_cadastral:'ATIVA',data_abertura:'2010-03-15',natureza_juridica:'206-2 - Sociedade Empresária Limitada',
    cnae_principal:'6201-5/00 — Desenvolvimento de programas',cnaes_secundarios:null,
    logradouro:'RUA DAS FLORES',numero:'100',complemento:'SALA 1',bairro:'CENTRO',cep:'01311-000',
    municipio:'SAO PAULO',uf:'SP',telefone:'1133334444',email:'contato@teste.local',
    porte:'DEMAIS',capital_social:'1000',simples_nacional:false,mei:false
  };
}

function mockProvider(overrides={}){
  calls=[];
  return{
    name:'mock',
    async consultarCnpj(cnpj){
      const key=normalizeCnpjKey(cnpj);
      calls.push(key);
      if(overrides.handler)return overrides.handler(key);
      if(key==='00000000000000')return{status:'not_found',code:'CNPJ_NAO_ENCONTRADO'};
      if(key==='99999999999999')return{status:'unavailable',code:'PROVIDER_INDISPONIVEL'};
      if(key==='88888888888888')return{status:'timeout',code:'PROVIDER_INDISPONIVEL'};
      if(key==='77777777777777')return{status:'error',code:'ERRO_PROVIDER'};
      if(key==='55555555555555')return{status:'ok',code:'EMPRESA_ENCONTRADA',data:{...sampleCadastro(key),situacao_cadastral:'BAIXADA',razao_social:'BAIXADA LTDA'}};
      return{status:'ok',code:'EMPRESA_ENCONTRADA',data:sampleCadastro(key)};
    }
  };
}

function req(method,url,body,token,companyId){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(companyId)headers['X-Company-Id']=companyId;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}

before(async()=>{
  setCnpjProvider(mockProvider());
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório CNPJ A',email:'owner.a.s09@test.local',password,tenantName:'Tenant CNPJ A'});
  assert.equal(a.status,201,JSON.stringify(a.data));
  slugA=a.data.tenant_slug;
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s09@test.local',password,tenant:slugA})).data;
  const b=await req('POST','/api/auth/register',{name:'Escritório CNPJ B',email:'owner.b.s09@test.local',password,tenantName:'Tenant CNPJ B'});
  slugB=b.data.tenant_slug;
  ownerB=(await req('POST','/api/auth/login',{email:'owner.b.s09@test.local',password,tenant:slugB})).data;
  const staff=await req('POST','/api/usuarios',{name:'Staff S09',email:'staff.s09@test.local',password,role:'STAFF'},ownerA.token);
  assert.equal(staff.status,201);
  staffA=(await req('POST','/api/auth/login',{email:'staff.s09@test.local',password,tenant:slugA})).data;
  const co=await req('POST','/api/empresas',{name:'Empresa para cliente',cnpj:OTHER},ownerA.token);
  const u=await req('POST',`/api/empresas/${co.data.id}/users`,{name:'Cliente S09',email:'client.s09@test.local',profile:'CLIENT_ADMIN'},ownerA.token);
  const tok=u.data.invitation.activation_url.split('/convite/')[1];
  const acc=await req('POST','/api/invitations/'+tok+'/accept',{name:'Cliente S09',password,confirmation:password});
  clientToken=acc.data.token;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('CNPJ é string, preserva zeros e formata o numérico',()=>{
  assert.equal(typeof normalizeCnpjKey('04104980700010'),'string');
  assert.equal(normalizeCnpjKey('04104980700010'),'04104980700010');
  assert.notEqual(Number(normalizeCnpjKey('04104980700010')),normalizeCnpjKey('04104980700010'));
  assert.equal(normalizeCnpjKey(CNPJ_FMT),CNPJ);
  assert.equal(formatCnpjDisplay(CNPJ),CNPJ_FMT);
  assert.equal(isPlausibleCnpj(CNPJ),true);
  assert.equal(isPlausibleCnpj('123'),false);
  assert.equal(isPlausibleCnpj(ALPHA),true);
  assert.equal(normalizeCnpjKey(ALPHA),ALPHA);
});

test('campos ausentes do provider não quebram a normalização',()=>{
  const mapped=mapBrasilApi({cnpj:CNPJ},CNPJ);
  assert.equal(mapped.razao_social,null);
  assert.equal(mapped.cep,null);
  const fields=toCompanyFields(mapped);
  assert.equal(fields.name,null);
  assert.equal(fields.cnpj,CNPJ);
});

test('dados do provider são normalizados',()=>{
  const mapped=mapBrasilApi({
    cnpj:CNPJ,razao_social:'EMPRESA TESTE LTDA',nome_fantasia:'Fantasia',descricao_situacao_cadastral:'Ativa',
    data_inicio_atividade:'2010-03-15',natureza_juridica:'Sociedade Limitada',cnae_fiscal:6201500,
    cnae_fiscal_descricao:'Software',logradouro:'RUA A',numero:'10',bairro:'CENTRO',cep:'01311000',
    municipio:'SAO PAULO',uf:'sp',ddd_telefone_1:'1133334444',email:'A@TESTE.LOCAL'
  },CNPJ);
  assert.equal(mapped.situacao_cadastral,'ATIVA');
  assert.equal(mapped.uf,'SP');
  assert.equal(mapped.cep,'01311-000');
  assert.equal(mapped.email,'a@teste.local');
  assert.match(mapped.cnae_principal,/6201500/);
  assert.equal(mapped.razao_social,'EMPRESA TESTE LTDA');
});

test('provider timeout e erro externo não vazam segredo',async()=>{
  const p=createCnpjProvider({
    name:'brasilapi',
    apiUrl:'https://example.test/cnpj',
    apiKey:'super-secret-key-do-not-leak',
    timeoutMs:30,
    fetchImpl:()=>new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'})),5))
  });
  const r=await p.consultarCnpj(CNPJ);
  assert.equal(r.status,'timeout');
  assert.equal(JSON.stringify(r).includes('super-secret-key-do-not-leak'),false);
  const errP=createCnpjProvider({
    name:'brasilapi',apiUrl:'https://example.test/cnpj',apiKey:'super-secret-key-do-not-leak',
    fetchImpl:async()=>({status:502,ok:false,json:async()=>({error:'nope'})})
  });
  const e=await errP.consultarCnpj(CNPJ);
  assert.equal(e.code,'PROVIDER_INDISPONIVEL');
  assert.equal(JSON.stringify(e).includes('super-secret-key-do-not-leak'),false);
});

test('consulta: CNPJ inválido, não encontrado, indisponível, timeout e erro',async()=>{
  setCnpjProvider(mockProvider());
  const bad=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'123'},ownerA.token);
  assert.equal(bad.status,400);assert.equal(bad.data.error,'CNPJ_INVALIDO');
  const nf=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'00000000000000'},ownerA.token);
  assert.equal(nf.status,404);assert.equal(nf.data.error,'CNPJ_NAO_ENCONTRADO');
  const un=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'99999999999999'},ownerA.token);
  assert.equal(un.status,502);assert.equal(un.data.error,'PROVIDER_INDISPONIVEL');
  assert.match(un.data.message,/Não foi possível consultar o cadastro do CNPJ/);
  const to=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'88888888888888'},ownerA.token);
  assert.equal(to.status,502);
  const er=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'77777777777777'},ownerA.token);
  assert.equal(er.status,502);
  assert.equal(JSON.stringify(er.data).includes('super-secret'),false);
});

test('consulta preenche cadastro público e não cria empresa',async()=>{
  setCnpjProvider(mockProvider());
  const before=db.prepare('SELECT COUNT(*) n FROM companies WHERE tenant_id=?').get(ownerA.user.tenant_id).n;
  const eventsBefore=db.prepare("SELECT COUNT(*) n FROM domain_events WHERE tenant_id=? AND event_type='COMPANY_CREATED'").get(ownerA.user.tenant_id).n;
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:CNPJ_FMT,tenant_id:ownerB.user.tenant_id},ownerA.token);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.status,'EMPRESA_ENCONTRADA');
  assert.equal(r.data.cadastro.razao_social,'EMPRESA TESTE LTDA');
  assert.equal(r.data.cadastro.nome_fantasia,'Teste Fantasia');
  assert.equal(r.data.cadastro.municipio,'SAO PAULO');
  assert.equal(r.data.cadastro.uf,'SP');
  assert.ok(r.data.cadastro.cep);
  assert.ok(r.data.cadastro.cnae_principal);
  assert.equal(r.data.cadastro.situacao_cadastral,'ATIVA');
  assert.equal(calls.length,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM companies WHERE tenant_id=?').get(ownerA.user.tenant_id).n,before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM domain_events WHERE tenant_id=? AND event_type='COMPANY_CREATED'").get(ownerA.user.tenant_id).n,eventsBefore);
  assert.equal(r.data.tenant_id,undefined);
});

test('alerta de situação cadastral BAIXADA não impede consulta',async()=>{
  setCnpjProvider(mockProvider());
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'55555555555555'},ownerA.token);
  assert.equal(r.status,200);
  assert.match(r.data.alerta,/BAIXADA/);
});

test('integração: consulta → POST carteira → GET encontra; evento e auditoria',async()=>{
  setCnpjProvider(mockProvider());
  const look=await req('POST','/api/empresas/consulta-cnpj',{cnpj:CNPJ},ownerA.token);
  assert.equal(look.status,200);
  const created=await req('POST','/api/empresas',{
    name:look.data.cadastro.razao_social,trade_name:look.data.cadastro.nome_fantasia,cnpj:CNPJ,
    address:look.data.cadastro.logradouro,address_number:look.data.cadastro.numero,city:look.data.cadastro.municipio,
    state:look.data.cadastro.uf,zip:look.data.cadastro.cep,cadastral_status:look.data.cadastro.situacao_cadastral,
    main_cnae:look.data.cadastro.cnae_principal,opened_on:look.data.cadastro.data_abertura
  },ownerA.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.cnpj_normalized,CNPJ);
  assert.equal(created.data.tenant_id,ownerA.user.tenant_id);
  const listed=await req('GET','/api/empresas?q='+CNPJ,undefined,ownerA.token);
  assert.ok((listed.data.items||[]).some(x=>x.id===created.data.id));
  const row=db.prepare('SELECT * FROM companies WHERE id=? AND tenant_id=?').get(created.data.id,ownerA.user.tenant_id);
  assert.equal(row.name,'EMPRESA TESTE LTDA');
  assert.equal(row.cnpj_normalized,CNPJ);
  const ev=db.prepare("SELECT * FROM domain_events WHERE tenant_id=? AND event_type=? AND entity_id=?").get(ownerA.user.tenant_id,EVENT_TYPES.COMPANY_CREATED,created.data.id);
  assert.ok(ev);
  const aud=db.prepare("SELECT * FROM audit_logs WHERE tenant_id=? AND action='COMPANY_CREATED' AND entity_id=?").get(ownerA.user.tenant_id,created.data.id);
  assert.ok(aud);
  assert.equal(JSON.stringify(aud).toLowerCase().includes('password'),false);
});

test('mesmo CNPJ em outro tenant é permitido; duplicata no mesmo tenant é 409 e não chama provider',async()=>{
  setCnpjProvider(mockProvider());
  const DUP='66777888000155';
  const a=await req('POST','/api/empresas',{name:'Empresa A dup',cnpj:DUP},ownerA.token);
  assert.equal(a.status,201,JSON.stringify(a.data));
  const b=await req('POST','/api/empresas',{name:'Empresa B mesma',cnpj:DUP},ownerB.token);
  assert.equal(b.status,201,JSON.stringify(b.data));
  const before=calls.length;
  const look=await req('POST','/api/empresas/consulta-cnpj',{cnpj:DUP},ownerA.token);
  assert.equal(look.status,409);
  assert.equal(look.data.error,'EMPRESA_JA_CADASTRADA');
  assert.equal(calls.length,before);
  assert.ok(look.data.company&&look.data.company.id);
  assert.equal(look.data.company.users,undefined);
  const dup=await req('POST','/api/empresas',{name:'Duplicata',cnpj:DUP},ownerA.token);
  assert.equal(dup.status,409);
  assert.equal(dup.data.error,'EMPRESA_JA_CADASTRADA');
});

test('CNPJ alfanumérico é aceito como string',async()=>{
  setCnpjProvider(mockProvider());
  const look=await req('POST','/api/empresas/consulta-cnpj',{cnpj:ALPHA},ownerA.token);
  assert.equal(look.status,200,JSON.stringify(look.data));
  const created=await req('POST','/api/empresas',{name:'Alfa Ltda',cnpj:ALPHA},ownerA.token);
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.cnpj_normalized,ALPHA);
  assert.equal(typeof created.data.cnpj_normalized,'string');
});

test('tenant do body não altera escopo; CLIENT e spoof isolados',async()=>{
  setCnpjProvider(mockProvider());
  const look=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'12345678000199',tenant_id:ownerB.user.tenant_id},ownerA.token);
  assert.equal(look.status,200);
  const created=await req('POST','/api/empresas',{name:'Escopo A',cnpj:'12345678000199',tenant_id:ownerB.user.tenant_id},ownerA.token);
  assert.equal(created.status,201);
  assert.equal(created.data.tenant_id,ownerA.user.tenant_id);
  const clientLook=await req('POST','/api/empresas/consulta-cnpj',{cnpj:CNPJ},clientToken);
  assert.equal(clientLook.status,403);
  const clientPost=await req('POST','/api/empresas',{name:'Hack',cnpj:'22333444000192'},clientToken);
  assert.equal(clientPost.status,403);
  const foreign=await req('GET','/api/empresas/'+created.data.id,undefined,ownerB.token);
  assert.equal(foreign.status,404);
  const ctx=await req('GET','/api/empresas?page=1&page_size=5',undefined,ownerA.token,created.data.id);
  assert.equal(ctx.status,200);
});

test('paginação da carteira e edição de usuário permanecem',async()=>{
  const page=await req('GET','/api/empresas?page=1&page_size=25',undefined,ownerA.token);
  assert.equal(page.status,200);
  assert.ok(page.data.page_size<=100);
  const patch=await req('PATCH','/api/usuarios/'+staffA.user.id,{name:'Staff S09 Editado'},ownerA.token);
  assert.equal(patch.status,200);
  assert.equal(patch.data.name,'Staff S09 Editado');
  const dbUser=db.prepare('SELECT name FROM users WHERE id=?').get(staffA.user.id);
  assert.equal(dbUser.name,'Staff S09 Editado');
});

test('HTML do escritório aponta consulta de CNPJ no cadastro',async()=>{
  const html=await fetch(base+'/').then(r=>r.text());
  assert.match(html,/app\.js\?v=s40-doc-preview/);
  const js=await fetch(base+'/assets/app.js?v=s13-15').then(r=>r.text());
  assert.match(js,/Consultar CNPJ/);
  assert.match(js,/\/api\/empresas\/consulta-cnpj/);
  assert.match(js,/Cadastrar empresa/);
  assert.match(js,/Os dados preenchidos serão substituídos/);
  assert.match(js,/Consulte novamente antes de cadastrar/);
});

test('duplicidade concorrente é bloqueada pelo índice UNIQUE',async()=>{
  const key='99888777000166';
  const ins=db.prepare('INSERT INTO companies(id,tenant_id,name,cnpj,cnpj_normalized,status) VALUES(?,?,?,?,?,?)');
  ins.run(crypto.randomUUID(),ownerA.user.tenant_id,'Primeira',key,key,'ACTIVE');
  assert.throws(()=>ins.run(crypto.randomUUID(),ownerA.user.tenant_id,'Segunda',key,key,'ACTIVE'));
  ins.run(crypto.randomUUID(),ownerB.user.tenant_id,'Outro tenant',key,key,'ACTIVE');
});

test('consulta sem autenticação é bloqueada',async()=>{
  const r=await req('POST','/api/empresas/consulta-cnpj',{cnpj:CNPJ});
  assert.equal(r.status,401);
});

test('provider traduz sucesso, 404, 429, 403, 500, JSON inválido e envia User-Agent',async()=>{
  const seen=[];
  function providerFor(fetchImpl){
    return createCnpjProvider({name:'brasilapi',apiUrl:'https://example.test/cnpj',apiKey:'super-secret-key-do-not-leak',fetchImpl});
  }
  const ok=await providerFor(async(url,opts)=>{
    seen.push({url,ua:opts.headers['User-Agent'],auth:opts.headers.Authorization});
    return{status:200,ok:true,json:async()=>({cnpj:CNPJ,razao_social:'EMPRESA TESTE LTDA',uf:'SP',cep:'01311000'})};
  }).consultarCnpj(CNPJ);
  assert.equal(ok.status,'ok');
  assert.equal(ok.data.razao_social,'EMPRESA TESTE LTDA');
  assert.match(seen[0].ua,/CDS-Contabil-Connect\/1\.0/);
  assert.match(seen[0].url,/41049807000104$/);
  assert.equal(seen[0].auth,'Bearer super-secret-key-do-not-leak');
  assert.equal(JSON.stringify(ok).includes('super-secret-key-do-not-leak'),false);

  const nf=await providerFor(async()=>({status:404,ok:false,json:async()=>({})})).consultarCnpj(CNPJ);
  assert.equal(nf.code,'CNPJ_NAO_ENCONTRADO');
  const tooMany=await providerFor(async()=>({status:429,ok:false,json:async()=>({})})).consultarCnpj(CNPJ);
  assert.equal(tooMany.code,'PROVIDER_INDISPONIVEL');
  const forbidden=await providerFor(async()=>({status:403,ok:false,json:async()=>({error:'Forbidden'})})).consultarCnpj(CNPJ);
  assert.equal(forbidden.code,'PROVIDER_INDISPONIVEL');
  assert.equal(forbidden.httpStatus,403);
  const down=await providerFor(async()=>({status:500,ok:false,json:async()=>({})})).consultarCnpj(CNPJ);
  assert.equal(down.code,'PROVIDER_INDISPONIVEL');
  const badJson=await providerFor(async()=>({status:200,ok:true,json:async()=>{throw new Error('invalid json')}})).consultarCnpj(CNPJ);
  assert.equal(badJson.code,'ERRO_PROVIDER');
  setCnpjProvider(providerFor(async()=>({status:403,ok:false,json:async()=>({})})));
  const api=await req('POST','/api/empresas/consulta-cnpj',{cnpj:'12345678000181'},ownerA.token);
  assert.equal(api.status,502);
  assert.equal(api.data.error,'PROVIDER_INDISPONIVEL');
  assert.equal(JSON.stringify(api.data).includes('super-secret'),false);
  setCnpjProvider(mockProvider());
});
