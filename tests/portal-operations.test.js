'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const http=require('http');
const crypto=require('crypto');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s03-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-03';
process.env.CDS_CLIENT_UPLOAD_MAX='800';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db}=require('../backend/src/server');

let server,base,office,otherOffice,cremolia,empresaB,joao,maria,pedro,category,bank,expense,revenue,pdfDoc,jpgDoc;
const password='Senha@123';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const jpg=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=','base64');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF');

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data};
  });
}
async function upload(token,filename,buf,type,notes){
  const fd=new FormData();
  fd.append('file',new Blob([buf],{type}),filename);
  if(notes)fd.append('notes',notes);
  const r=await fetch(base+'/api/client/documentos',{method:'POST',headers:{Authorization:'Bearer '+token},body:fd});
  let data=null;try{data=await r.json()}catch{}
  return {status:r.status,data};
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(()=>{
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

async function registerOffice(name,email){
  const created=await req('POST','/api/auth/register',{name,email,password,tenantName:name,cnpj:'00000000000191'});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const login=await req('POST','/api/auth/login',{email,password,tenant:created.data.tenant_slug});
  assert.equal(login.status,200,JSON.stringify(login.data));
  return login.data;
}
async function accept(invite,name){
  const token=invite.activation_url.split('/convite/')[1];
  const r=await req('POST','/api/invitations/'+token+'/accept',{name,password,confirmation:password});
  assert.equal(r.status,200,JSON.stringify(r.data));
  return r.data;
}

test('TESTE 01 CLIENT cria despesa',async()=>{
  office=await registerOffice('Audácia Contabilidade','audacia@test.local');
  const company=await req('POST','/api/empresas',{name:'Cremolia Alimentos Ltda',trade_name:'Cremolia',cnpj:'11222333000181'},office.token);
  assert.equal(company.status,201);
  cremolia=company.data;
  const u1=await req('POST',`/api/empresas/${cremolia.id}/users`,{name:'João',email:'joao.cremolia@test.local',profile:'Administrador'},office.token);
  const u2=await req('POST',`/api/empresas/${cremolia.id}/users`,{name:'Maria',email:'maria.cremolia@test.local',profile:'Financeiro'},office.token);
  const u3=await req('POST',`/api/empresas/${cremolia.id}/users`,{name:'Pedro',email:'pedro.cremolia@test.local',profile:'Visualizador'},office.token);
  joao=await accept(u1.data.invitation,'João');
  maria=await accept(u2.data.invitation,'Maria');
  pedro=await accept(u3.data.invitation,'Pedro');
  assert.equal(joao.user.company_id,cremolia.id);
  assert.equal(maria.user.company_id,cremolia.id);
  assert.equal(pedro.user.company_id,cremolia.id);
  const planId=crypto.randomUUID();
  db.prepare('INSERT INTO account_plans(id,tenant_id,name,status) VALUES(?,?,?,?)').run(planId,office.user.tenant_id,'Plano 03','ACTIVE');
  const accDesp=crypto.randomUUID();
  const accBank=crypto.randomUUID();
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)').run(accDesp,office.user.tenant_id,planId,'3210400001','3210400001','3210400001','A','FRETES',null,1,1);
  db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)').run(accBank,office.user.tenant_id,planId,'1110200001','1110200001','1110200001','A','BANCO DO BRASIL',null,1,1);
  const cat=await req('POST','/api/categorias',{name:'Frete',kind:'EXPENSE',company_id:cremolia.id,account_id:accDesp},office.token);
  const bk=await req('POST','/api/bancos',{name:'Banco do Brasil',company_id:cremolia.id,account_id:accBank},office.token);
  category=cat.data;bank=bk.data;
  const r=await req('POST','/api/client/despesas',{occurred_on:'2026-09-15',description:'Frete de material',amount:'200,00',payment_method:'PIX',bank_id:bank.id,category_id:category.id,notes:'Frete referente à entrega do material comprado em 14/09.',company_id:'empresa-de-outra-pessoa',debit_account_id:'fake-debit',credit_account_id:'fake-credit'},maria.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.amount_cents,20000);
  assert.equal(r.data.occurred_on,'2026-09-15');
  assert.equal(r.data.description,'Frete de material');
  assert.equal(r.data.notes,'Frete referente à entrega do material comprado em 14/09.');
  assert.equal(r.data.classification,undefined);
  expense=r.data;
  const row=db.prepare('SELECT * FROM expenses WHERE id=?').get(expense.id);
  assert.equal(row.company_id,cremolia.id);
  assert.equal(row.tenant_id,office.user.tenant_id);
  assert.equal(row.category_id,category.id);
  assert.equal(row.payment_method,'PIX');
  assert.equal(row.bank_id,bank.id);
});

test('TESTE 02-07 campos da despesa persistidos',()=>{
  const row=db.prepare('SELECT * FROM expenses WHERE id=?').get(expense.id);
  assert.equal(row.occurred_on,'2026-09-15');
  assert.equal(row.amount_cents,20000);
  assert.equal(row.category_id,category.id);
  assert.equal(row.payment_method,'PIX');
  assert.equal(row.bank_id,bank.id);
  assert.equal(row.notes,'Frete referente à entrega do material comprado em 14/09.');
});

test('TESTE 08 Documento PDF anexado e vinculado',async()=>{
  const up=await upload(maria.token,'comprovante.pdf',pdf,'application/pdf');
  assert.equal(up.status,201,JSON.stringify(up.data));
  assert.ok(up.data.sha256);
  assert.equal(up.data.storage_path,undefined);
  pdfDoc=up.data;
  const r=await req('POST','/api/client/despesas',{occurred_on:'2026-09-16',description:'Frete com PDF',amount:150,payment_method:'PIX',document_id:pdfDoc.id,category_id:category.id},maria.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.document_id,pdfDoc.id);
  const linked=await req('GET','/api/client/documentos/'+pdfDoc.id,undefined,maria.token);
  assert.equal(linked.status,200);
  assert.equal(linked.data.linked,true);
  assert.equal(linked.data.movement.id,r.data.id);
});

test('TESTE 09-11 Upload JPG JPEG PNG',async()=>{
  jpgDoc=(await upload(maria.token,'comprovante.jpg',jpg,'image/jpeg')).data;
  assert.ok(jpgDoc.id);
  const jpeg=await upload(maria.token,'comprovante.jpeg',jpg,'image/jpeg');
  assert.equal(jpeg.status,201,JSON.stringify(jpeg.data));
  const pngUp=await upload(maria.token,'comprovante.png',png,'image/png');
  assert.equal(pngUp.status,201,JSON.stringify(pngUp.data));
});

test('TESTE 12 Documento inválido rejeitado',async()=>{
  const r=await upload(maria.token,'malware.exe',Buffer.from('MZ'),'application/octet-stream');
  assert.equal(r.status,422);
});

test('TESTE 13 Documento acima do limite rejeitado',async()=>{
  const r=await upload(maria.token,'grande.pdf',Buffer.alloc(900),'application/pdf');
  assert.ok(r.status===413||r.status===422,String(r.status)+JSON.stringify(r.data));
});

test('TESTE 15 Cliente visualiza documento',async()=>{
  const r=await fetch(base+'/api/client/documentos/'+pdfDoc.id+'/download',{headers:{Authorization:'Bearer '+maria.token}});
  assert.equal(r.status,200);
  assert.ok((await r.arrayBuffer()).byteLength>0);
});

test('TESTE 17-18 Cliente não altera company_id nem informa débito/crédito',async()=>{
  const r=await req('POST','/api/client/despesas',{occurred_on:'2026-09-17',description:'Tentativa spoof',amount:10,payment_method:'DINHEIRO',company_id:'outra',debit_account_id:'x',credit_account_id:'y'},maria.token);
  assert.equal(r.status,201);
  const row=db.prepare('SELECT company_id FROM expenses WHERE id=?').get(r.data.id);
  assert.equal(row.company_id,cremolia.id);
  assert.equal(r.data.classification,undefined);
});

test('TESTE 19 Visualizador não cria despesa',async()=>{
  const r=await req('POST','/api/client/despesas',{occurred_on:'2026-09-17',description:'Bloqueado',amount:10,payment_method:'PIX'},pedro.token);
  assert.equal(r.status,403);
});

test('TESTE 20 Movimentação aprovada não pode ser editada pelo cliente',async()=>{
  db.prepare("UPDATE entries SET status='POSTED' WHERE source_id=?").run(expense.id);
  const r=await req('PATCH','/api/client/despesas/'+expense.id,{description:'Alterar aprovada'},maria.token);
  assert.equal(r.status,403);
});

test('TESTE 21-25 Receita, documento e dashboard',async()=>{
  const up=await upload(maria.token,'recibo.pdf',pdf,'application/pdf','Recibo de venda');
  assert.equal(up.status,201);
  const blockedRev=await req('POST','/api/client/receitas',{occurred_on:'2026-09-18',description:'Venda de produto',amount:38200,receipt_method:'PIX',bank_id:bank.id,document_id:up.data.id,notes:'Recebimento PIX'},maria.token);
  assert.equal(blockedRev.status,403);
  const r=await req('POST','/api/importacoes',{company_id:cremolia.id,origin:'IMPORTACAO_CONTABIL',period_start:'2026-09-01',period_end:'2026-09-30',movements:[{type:'REVENUE',occurred_on:'2026-09-18',description:'Venda de produto',amount:38200,receipt_method:'PIX',bank_id:bank.id,document_id:up.data.id,notes:'Recebimento PIX'}]},office.token);
  assert.equal(r.status,201,JSON.stringify(r.data));
  const list=await req('GET','/api/client/receitas',undefined,maria.token);
  revenue=list.data.find(x=>x.description==='Venda de produto');
  assert.ok(revenue);
  assert.equal(revenue.document_id,up.data.id);
  const viewerRev=await req('POST','/api/client/receitas',{occurred_on:'2026-09-18',description:'Bloqueado',amount:10,receipt_method:'PIX'},pedro.token);
  assert.equal(viewerRev.status,403);
  const dash=await req('GET','/api/client/dashboard',undefined,maria.token);
  assert.equal(dash.status,200);
  assert.equal(dash.data.company.trade_name,'Cremolia');
  assert.ok(dash.data.revenue_cents>=3820000);
  assert.ok(dash.data.recent.some(x=>x.description==='Venda de produto'));
  const notes=await req('GET','/api/client/notificacoes',undefined,maria.token);
  assert.ok(notes.data.some(x=>/Despesa registrada com sucesso/.test(x.title)));
  const pend=await req('GET','/api/client/pendencias',undefined,maria.token);
  assert.equal(pend.status,200);
  assert.ok(pend.data.some(x=>x.title==='Precisamos de uma informação.'&&x.movement));
});

test('TESTE 26-30 Isolamento por empresa e tenant',async()=>{
  const otherCo=await req('POST','/api/empresas',{name:'Empresa B Ltda',trade_name:'Empresa B',cnpj:'22333444000172'},office.token);
  empresaB=otherCo.data;
  const u=await req('POST',`/api/empresas/${empresaB.id}/users`,{name:'Ana',email:'ana.b@test.local',profile:'CLIENT_ADMIN'},office.token);
  const ana=await accept(u.data.invitation,'Ana');
  const expB=await req('GET','/api/client/despesas',undefined,ana.token);
  assert.ok(expB.data.every(x=>x.company_id===empresaB.id));
  assert.ok(!expB.data.some(x=>x.id===expense.id));
  const docB=await req('GET','/api/client/documentos/'+pdfDoc.id,undefined,ana.token);
  assert.equal(docB.status,404);
  const dl=await fetch(base+'/api/client/documentos/'+pdfDoc.id+'/download',{headers:{Authorization:'Bearer '+ana.token}});
  assert.equal(dl.status,404);
  const revB=await req('GET','/api/client/receitas',undefined,ana.token);
  assert.ok(!revB.data.some(x=>x.id===revenue.id));
  otherOffice=await registerOffice('Outro Escritório','outro@test.local');
  const foreign=await req('GET','/api/empresas/'+cremolia.id,undefined,otherOffice.token);
  assert.equal(foreign.status,404);
  const list=await req('GET','/api/empresas?page=1&page_size=50',undefined,otherOffice.token);
  assert.ok(!list.data.items.some(x=>x.id===cremolia.id));
});

test('TESTE ESCALA 1.000 empresas paginadas',async()=>{
  const ins=db.prepare('INSERT INTO companies(id,tenant_id,name,trade_name,cnpj,status) VALUES(?,?,?,?,?,?)');
  const tx=db.transaction(()=>{
    for(let i=1;i<=1000;i++){
      const n=String(i).padStart(4,'0');
      ins.run(crypto.randomUUID(),office.user.tenant_id,`Empresa Escala ${n} Ltda`,`Escala ${n}`,String(10000000000000+i),'ACTIVE');
    }
    ins.run(crypto.randomUUID(),office.user.tenant_id,'Empresa Bloqueada Escala','Bloqueada Escala','11999888000100','BLOCKED');
  });
  tx();
  const t0=Date.now();
  const page=await req('GET','/api/empresas?page=1&page_size=50&sort=name&dir=asc',undefined,office.token);
  const elapsed=Date.now()-t0;
  assert.equal(page.status,200,JSON.stringify(page.data));
  assert.ok(page.data.total>=1000);
  assert.equal(page.data.items.length,50);
  assert.equal(page.data.page_size,50);
  assert.ok(elapsed<2000,`listagem lenta: ${elapsed}ms`);
  const searchName=await req('GET','/api/empresas?q='+encodeURIComponent('Escala 0500'),undefined,office.token);
  assert.ok(searchName.data.items.some(x=>/Escala 0500/.test(x.trade_name||x.name)));
  assert.ok(searchName.data.items.length<=50);
  const cnpj='10000000000500';
  const searchCnpj=await req('GET','/api/empresas?q='+cnpj,undefined,office.token);
  assert.ok(searchCnpj.data.items.some(x=>x.cnpj===cnpj));
  const blocked=await req('GET','/api/empresas?status=BLOCKED&page_size=50',undefined,office.token);
  assert.ok(blocked.data.items.every(x=>x.status==='BLOCKED'));
  const desc=await req('GET','/api/empresas?sort=name&dir=desc&page_size=10',undefined,office.token);
  assert.equal(desc.data.items.length,10);
  const extra=await req('POST','/api/empresas',{name:'Empresa 1001 Extra Ltda',trade_name:'Extra 1001',cnpj:'99888777000166'},office.token);
  assert.equal(extra.status,201);
  const total=await req('GET','/api/empresas?page_size=1',undefined,office.token);
  assert.ok(total.data.total>=1001);
  assert.equal(total.data.items.length,1);
});

test('TESTE auditoria e documento independente',async()=>{
  const indep=await upload(maria.token,'encaminhado.pdf',pdf,'application/pdf','Documento avulso');
  assert.equal(indep.status,201);
  assert.equal(indep.data.linked,false);
  const audit=db.prepare("SELECT action FROM audit_logs WHERE tenant_id=? AND action IN('EXPENSE_CREATED','REVENUE_CREATED','CLIENT_UPLOADED_DOCUMENT')").all(office.user.tenant_id);
  assert.ok(audit.some(x=>x.action==='EXPENSE_CREATED'));
  assert.ok(audit.some(x=>x.action==='REVENUE_CREATED'));
  assert.ok(audit.some(x=>x.action==='CLIENT_UPLOADED_DOCUMENT'));
  const bad=db.prepare("SELECT after_json FROM audit_logs WHERE tenant_id=?").all(office.user.tenant_id);
  assert.ok(!bad.some(x=>x.after_json&&/password|Bearer /i.test(x.after_json)));
});

test('HTTP serve a implementação nova de Nova despesa',async()=>{
  const portalPage=await fetch(base+'/portal/');
  const portalHtml=await portalPage.text();
  assert.equal(portalPage.status,200);
  assert.match(portalHtml,/portal\.js\?v=/);
  assert.match(portalHtml,/smart-expense\.js\?v=/);
  assert.doesNotMatch(portalHtml,/Salvar e classificar|Categoria amigável/);
  const portalJs=await fetch(base+'/portal/portal.js?v=s28-1-6').then(r=>r.text());
  const smartJs=await fetch(base+'/assets/smart-expense.js?v=s23-1').then(r=>r.text());
  assert.match(portalJs,/CdsSmartExpense\.open/);
  assert.match(smartJs,/Salvar despesa/);
  assert.match(smartJs,/Arraste o comprovante|Selecionar arquivo/);
  assert.match(smartJs,/Despesa registrada com sucesso\. Ela foi enviada para análise da contabilidade\./);
  assert.doesNotMatch(portalJs,/Salvar e classificar/);
  assert.doesNotMatch(portalJs,/Categoria amigável/);
  const adminPage=await fetch(base+'/');
  const adminHtml=await adminPage.text();
  assert.match(adminHtml,/app\.js\?v=/);
  assert.match(adminHtml,/smart-expense\.js\?v=/);
  const adminJs=await fetch(base+'/assets/app.js?v=s28-1-6').then(r=>r.text());
  assert.match(adminJs,/CdsSmartExpense\.open/);
  assert.match(smartJs,/Salvar despesa/);
  assert.match(portalJs,/function statusTone/);
  assert.match(portalJs,/POSTED','APPROVED','ACCOUNTED'/);
  assert.match(adminJs,/function txBadge/);
  assert.match(adminJs,/badge approved">Aprovada/);
  assert.match(adminJs,/badge rejected">Reprovada/);
  assert.match(adminJs,/badge pending">Pendente/);
  assert.doesNotMatch(adminJs,/Categoria amigável/);
});
