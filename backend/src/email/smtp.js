'use strict';

const net=require('net');
const tls=require('tls');

const hooks={};
const leftovers=new WeakMap();

function setSmtpHooks(next){
  if(!next){hooks.send=null;hooks.verify=null;return}
  if(next.send!==undefined)hooks.send=next.send;
  if(next.verify!==undefined)hooks.verify=next.verify;
}

function appendChunk(socket,chunk){
  leftovers.set(socket,(leftovers.get(socket)||'')+chunk.toString('utf8'));
}

function pullLine(socket){
  const buf=leftovers.get(socket)||'';
  const m=buf.match(/^(.*?)(\r\n|\n)/);
  if(!m)return null;
  leftovers.set(socket,buf.slice(m[0].length));
  return m[1];
}

function readLine(socket){
  return new Promise((resolve,reject)=>{
    const ready=pullLine(socket);
    if(ready!==null)return resolve(ready);
    const onData=chunk=>{
      appendChunk(socket,chunk);
      const line=pullLine(socket);
      if(line===null)return;
      socket.off('data',onData);socket.off('error',onErr);
      resolve(line);
    };
    const onErr=err=>{socket.off('data',onData);reject(err)};
    socket.on('data',onData);socket.once('error',onErr);
  });
}

async function expect(socket,ok){
  const line=await readLine(socket);
  const code=Number(String(line).slice(0,3));
  if(!ok.includes(code))throw new Error('SMTP '+line);
  return line;
}

function write(socket,cmd){
  return new Promise((resolve,reject)=>{
    socket.write(cmd+'\r\n','utf8',err=>err?reject(err):resolve());
  });
}

function connect(host,port,secure,timeoutMs){
  return new Promise((resolve,reject)=>{
    const opts={host,port,timeout:timeoutMs};
    const socket=secure?tls.connect({...opts,servername:host},()=>resolve(socket)):net.connect(opts,()=>resolve(socket));
    socket.setTimeout(timeoutMs,()=>{socket.destroy();reject(new Error('SMTP timeout'))});
    socket.once('error',reject);
  });
}

async function upgradeTls(socket,host,timeoutMs){
  return new Promise((resolve,reject)=>{
    const secure=tls.connect({socket,servername:host,timeout:timeoutMs},()=>resolve(secure));
    secure.setTimeout(timeoutMs,()=>{secure.destroy();reject(new Error('SMTP timeout'))});
    secure.once('error',reject);
  });
}

function encodeAddress(fromName,fromEmail){
  const email=String(fromEmail||'').trim();
  const name=String(fromName||'').trim();
  if(!name)return email;
  return '"'+name.replace(/"/g,'')+'" <'+email+'>';
}

function normalizeSmtpPassword(value){
  return String(value||'').replace(/[\s\u00a0]/g,'');
}

function isAuthRejected(err){
  return /534|535|5\.7\.8|5\.7\.9|Username and Password not accepted|BadCredentials|Application-specific password|authentication failed/i.test(String(err&&err.message||err||''));
}

async function authenticate(socket,config){
  const user=String(config.user||'').trim();
  const password=normalizeSmtpPassword(config.password);
  await write(socket,'AUTH PLAIN '+Buffer.from('\0'+user+'\0'+password).toString('base64'));
  const plainLine=await readLine(socket);
  const plainCode=Number(String(plainLine).slice(0,3));
  if(plainCode===235)return;
  if(plainCode===535)throw new Error('SMTP '+plainLine);
  if(plainCode===334){
    await write(socket,Buffer.from('\0'+user+'\0'+password).toString('base64'));
    await expect(socket,[235]);
    return;
  }
  await write(socket,'AUTH LOGIN');
  const authLine=await readLine(socket);
  const authCode=Number(String(authLine).slice(0,3));
  if(authCode===334){
    await write(socket,Buffer.from(user,'utf8').toString('base64'));
    await expect(socket,[334]);
    await write(socket,Buffer.from(password,'utf8').toString('base64'));
    await expect(socket,[235]);
    return;
  }
  throw new Error('SMTP '+plainLine);
}

async function handshake(config){
  const host=config.host;
  const port=Number(config.port||587);
  const timeoutMs=Math.max(1000,Number(config.timeoutMs||10000)||10000);
  const secure=config.secure===true||port===465;
  let socket=await connect(host,port,secure,timeoutMs);
  await expect(socket,[220]);
  await write(socket,'EHLO cds-contabil-connect');
  let ehlo=await readLine(socket);
  while(/^\d{3}-/.test(ehlo))ehlo=await readLine(socket);
  if(!secure&&port!==465){
    await write(socket,'STARTTLS');
    await expect(socket,[220]);
    socket=await upgradeTls(socket,host,timeoutMs);
    await write(socket,'EHLO cds-contabil-connect');
    ehlo=await readLine(socket);
    while(/^\d{3}-/.test(ehlo))ehlo=await readLine(socket);
  }
  if(config.user)await authenticate(socket,config);
  return socket;
}

async function verifySmtp(config){
  if(typeof hooks.verify==='function')return hooks.verify(config);
  const socket=await handshake(config);
  await write(socket,'QUIT').catch(()=>{});
  socket.end();
}

async function sendSmtp(config,mail){
  if(typeof hooks.send==='function')return hooks.send(config,mail);
  const socket=await handshake(config);
  await write(socket,'MAIL FROM:<'+config.from+'>');
  await expect(socket,[250]);
  await write(socket,'RCPT TO:<'+mail.to+'>');
  await expect(socket,[250,251]);
  await write(socket,'DATA');
  await expect(socket,[354]);
  const fromHeader=encodeAddress(config.fromName,config.from);
  const payload=[
    'From: '+fromHeader,
    'To: '+mail.to,
    'Subject: '+mail.subject,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="cds-invite"',
    '',
    '--cds-invite',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    mail.text,
    '--cds-invite',
    'Content-Type: text/html; charset=UTF-8',
    '',
    mail.html,
    '--cds-invite--',
    '.'
  ].join('\r\n');
  await write(socket,payload);
  await expect(socket,[250]);
  await write(socket,'QUIT').catch(()=>{});
  socket.end();
}

module.exports={sendSmtp,verifySmtp,setSmtpHooks,normalizeSmtpPassword,isAuthRejected};
