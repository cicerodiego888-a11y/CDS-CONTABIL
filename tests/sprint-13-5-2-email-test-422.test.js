'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
const net=require('net');
const http=require('http');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.CDS_DB_PATH=path.join(os.tmpdir(),`cds-s1352-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET='test-sprint-13-5-2-secret-ok';
process.env.CDS_EMAIL_PROVIDER='off';
process.env.CDS_COMMS_WORKER='off';
try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
const {app,db,setSmtpHooks}=require('../backend/src/server');
const {verifySmtp}=require('../backend/src/email/smtp');

const password='Senha@123';
let server,base,ownerA;

function req(method,url,body,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>{
    let data=null;try{data=await r.json()}catch{}
    return {status:r.status,data,raw:JSON.stringify(data)};
  });
}

before(async()=>{
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const a=await req('POST','/api/auth/register',{name:'Escritório 1352',email:'owner.a.s1352@test.local',password,tenantName:'Tenant 1352'});
  ownerA=(await req('POST','/api/auth/login',{email:'owner.a.s1352@test.local',password,tenant:a.data.tenant_slug})).data;
});
after(()=>{
  setSmtpHooks(null);
  server.close();
  try{db.close()}catch{}
  try{fs.unlinkSync(process.env.CDS_DB_PATH)}catch{}
});

test('teste sem configuração salva informa para salvar',async()=>{
  const r=await req('POST','/api/configuracoes/comunicacoes/email/teste',{to:'cicerodiego888@gmail.com'},ownerA.token);
  assert.equal(r.status,400,r.raw);
  assert.match(r.data.message,/Salve a configuração de e-mail antes de enviar um teste/);
});

test('payload {to} continua sendo o contrato do e-mail de teste',async()=>{
  const js=fs.readFileSync(path.join(__dirname,'../frontend/public/assets/app.js'),'utf8');
  assert.match(js,/JSON\.stringify\(\{to\}\)/);
  assert.match(js,/Salve a configuração de e-mail antes de enviar um teste/);
  assert.match(js,/senha de app \(16 letras\)/);
});

test('senha de app com espaços é normalizada',()=>{
  const {normalizeSmtpPassword,isAuthRejected}=require('../backend/src/email/smtp');
  assert.equal(normalizeSmtpPassword('abcd efgh ijkl mnop'),'abcdefghijklmnop');
  assert.equal(isAuthRejected(new Error('SMTP 535-5.7.8 Username and Password not accepted')),true);
});

test('SMTP consome resposta EHLO multilinha no mesmo pacote',async()=>{
  let gotStartTls=false;
  const srv=net.createServer(sock=>{
    sock.write('220 mock smtp\r\n');
    let buf='';
    sock.on('data',d=>{
      buf+=d.toString('utf8');
      if(/EHLO/i.test(buf)&&!gotStartTls){
        sock.write('250-mock.local\r\n250-STARTTLS\r\n250 AUTH LOGIN PLAIN\r\n');
      }
      if(/STARTTLS/i.test(buf)){
        gotStartTls=true;
        sock.write('220 ready\r\n');
        sock.end();
      }
    });
  });
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  const port=srv.address().port;
  try{
    await verifySmtp({host:'127.0.0.1',port,timeoutMs:1500,secure:false});
  }catch{}
  await new Promise(resolve=>srv.close(resolve));
  assert.equal(gotStartTls,true);
});
