'use strict';

const {sendSmtp,verifySmtp,isAuthRejected,normalizeSmtpPassword}=require('./smtp');
const {invitationEmail,testEmail}=require('./template');

const MSG_NOT_CONFIGURED='Convite criado, mas o envio de e-mail não está configurado neste ambiente. O convite de acesso está aguardando envio.';
const MSG_RESEND_NOT_CONFIGURED='Convite recriado, mas o envio de e-mail não está configurado neste ambiente. O envio foi colocado na fila.';
const MSG_FAILED='Convite criado, mas não foi possível enviar o e-mail. Verifique a configuração de envio.';
const MSG_RESEND_FAILED='Convite recriado, mas não foi possível enviar o e-mail. Verifique a configuração de envio.';

function envName(){
  return String(process.env.CDS_EMAIL_PROVIDER||'').trim().toLowerCase();
}

function fromEnv(){
  return {
    name:envName(),
    host:String(process.env.CDS_EMAIL_HOST||process.env.SMTP_HOST||'').trim(),
    port:Number(process.env.CDS_EMAIL_PORT||process.env.SMTP_PORT||587)||587,
    user:String(process.env.CDS_EMAIL_USER||process.env.SMTP_USER||'').trim(),
    password:String(process.env.CDS_EMAIL_PASSWORD||process.env.SMTP_PASSWORD||''),
    from:String(process.env.CDS_EMAIL_FROM||process.env.SMTP_FROM||'').trim(),
    fromName:String(process.env.CDS_EMAIL_FROM_NAME||'CDS Contábil').trim(),
    timeoutMs:Number(process.env.CDS_EMAIL_TIMEOUT_MS||10000)||10000,
    secure:String(process.env.CDS_EMAIL_SECURE||'').trim()==='1'
  };
}

function sentMessage(to){
  return 'Convite enviado com sucesso para '+String(to||'').trim()+'.';
}

function looksLikeGmail(cfg){
  return /gmail\.com|googlemail\.com/i.test([cfg&&cfg.host,cfg&&cfg.user,cfg&&cfg.from].join(' '));
}

function authFailMessage(cfg){
  if(looksLikeGmail(cfg))return 'O Gmail recusou esta senha no SMTP. A senha de login da conta não é aceita. Ative a verificação em duas etapas e gere uma senha de app em https://myaccount.google.com/apppasswords. Cole as 16 letras sem espaços.';
  return 'A credencial SMTP foi recusada. Verifique usuário e senha.';
}

function resolveName(cfg){
  const n=String(cfg.name||'').trim().toLowerCase();
  if(n&&n!=='off'&&n!=='none'&&n!=='disabled')return n;
  if(cfg.host&&cfg.user&&cfg.password&&cfg.from)return 'smtp';
  return n||'off';
}

function diagnose(cfg){
  if(typeof cfg.send==='function')return {ok:true,missing:[],provider:resolveName(cfg)};
  const name=resolveName(cfg);
  const missing=[];
  if(!name||name==='off'||name==='none'||name==='disabled')missing.push('provider');
  if(name==='smtp'){
    if(!cfg.host)missing.push('host');
    if(!cfg.user)missing.push('user');
    if(!String(cfg.password||''))missing.push('password');
    if(!cfg.from)missing.push('from');
  }
  return {ok:!missing.length,missing,provider:name};
}

function sanitizeLog(value,secrets){
  let s=String(value||'');
  for(const secret of secrets){
    if(secret)s=s.split(secret).join('***');
  }
  return s.replace(/[a-f0-9]{32,}/gi,'[redacted]');
}

function logInvite(payload){
  const safe={...payload};
  delete safe.password;
  delete safe.token;
  delete safe.url;
  console.log('email_invite',JSON.stringify(safe));
}

function createEmailProvider(options={}){
  const cfg={...fromEnv(),...options};
  const name=resolveName(cfg);

  function configured(){
    return diagnose(cfg).ok;
  }

  async function send(mail){
    const d=diagnose(cfg);
    if(!d.ok){
      logInvite({status:'not_configured',code:'EMAIL_NOT_CONFIGURED',missing:d.missing,provider:d.provider,hasHost:!!cfg.host,hasUser:!!cfg.user,hasFrom:!!cfg.from,hasPassword:!!cfg.password});
      return {status:'not_configured',code:'EMAIL_NOT_CONFIGURED'};
    }
    try{
      if(typeof cfg.send==='function'){
        await cfg.send(mail);
      }else{
        await sendSmtp({
          host:cfg.host,port:cfg.port,user:cfg.user,password:normalizeSmtpPassword(cfg.password),
          from:cfg.from,fromName:cfg.fromName,timeoutMs:cfg.timeoutMs,secure:cfg.secure
        },mail);
      }
      return {status:'sent',code:'EMAIL_SENT'};
    }catch(err){
      console.error('email_send_failed',JSON.stringify({
        code:isAuthRejected(err)?'EMAIL_AUTH_FAILED':'EMAIL_SEND_FAILED',
        reason:sanitizeLog(err&&err.message||err,[cfg.password,cfg.user,process.env.CDS_EMAIL_PASSWORD,process.env.SMTP_PASSWORD,process.env.CDS_EMAIL_USER])
      }));
      return {status:'failed',code:isAuthRejected(err)?'EMAIL_AUTH_FAILED':'EMAIL_SEND_FAILED'};
    }
  }

  async function verify(){
    const d=diagnose(cfg);
    if(!d.ok){
      logInvite({status:'not_configured',code:'EMAIL_NOT_CONFIGURED',missing:d.missing,provider:d.provider,hasHost:!!cfg.host,hasUser:!!cfg.user,hasFrom:!!cfg.from,hasPassword:!!cfg.password});
      return {ok:false,status:'not_configured',code:'EMAIL_NOT_CONFIGURED'};
    }
    try{
      if(typeof cfg.verify==='function')await cfg.verify();
      else if(typeof cfg.send==='function'){/* provedor de teste */}
      else await verifySmtp({
        host:cfg.host,port:cfg.port,user:cfg.user,password:normalizeSmtpPassword(cfg.password),
        from:cfg.from,fromName:cfg.fromName,timeoutMs:cfg.timeoutMs,secure:cfg.secure
      });
      return {ok:true,status:'ok',code:'EMAIL_VERIFY_OK'};
    }catch(err){
      const auth=isAuthRejected(err);
      console.error('email_verify_failed',JSON.stringify({
        code:auth?'EMAIL_AUTH_FAILED':'EMAIL_VERIFY_FAILED',
        reason:sanitizeLog(err&&err.message||err,[cfg.password,cfg.user,process.env.CDS_EMAIL_PASSWORD,process.env.SMTP_PASSWORD,process.env.CDS_EMAIL_USER])
      }));
      return {ok:false,status:'failed',code:auth?'EMAIL_AUTH_FAILED':'EMAIL_VERIFY_FAILED',message:auth?authFailMessage(cfg):'Não foi possível conectar ao servidor de e-mail. Verifique as configurações.'};
    }
  }

  async function sendTest({to}){
    const d=diagnose(cfg);
    if(!d.ok){
      return {status:'not_configured',code:'EMAIL_NOT_CONFIGURED',email_sent:false,message:'Salve a configuração de e-mail antes de enviar um teste.'};
    }
    const tpl=testEmail({to});
    const result=await send({to,subject:tpl.subject,text:tpl.text,html:tpl.html});
    if(result.status==='sent')return {...result,email_sent:true,message:'E-mail de teste enviado com sucesso.'};
    if(result.code==='EMAIL_AUTH_FAILED')return {...result,email_sent:false,message:authFailMessage(cfg)};
    return {...result,email_sent:false,message:'Não foi possível enviar o e-mail de teste. Verifique a configuração de envio.'};
  }

  async function sendInvitation({to,name:person,company,url,resend}){
    const d=diagnose(cfg);
    if(!d.ok){
      logInvite({status:'not_configured',code:'EMAIL_NOT_CONFIGURED',missing:d.missing,provider:d.provider,hasHost:!!cfg.host,hasUser:!!cfg.user,hasFrom:!!cfg.from,hasPassword:!!cfg.password});
      return {status:'not_configured',code:'EMAIL_NOT_CONFIGURED',email_sent:false,message:resend?MSG_RESEND_NOT_CONFIGURED:MSG_NOT_CONFIGURED};
    }
    const tpl=invitationEmail({name:person,company,url});
    const result=await send({to,subject:tpl.subject,text:tpl.text,html:tpl.html});
    if(result.status==='sent')return {...result,email_sent:true,message:sentMessage(to)};
    return {status:'failed',code:'EMAIL_SEND_FAILED',email_sent:false,message:resend?MSG_RESEND_FAILED:MSG_FAILED};
  }

  return {
    name,
    configured,
    diagnose:()=>diagnose(cfg),
    send,
    verify,
    sendTest,
    sendInvitation,
    config:{host:cfg.host,port:cfg.port,from:cfg.from,fromName:cfg.fromName,hasUser:!!cfg.user,hasPassword:!!cfg.password}
  };
}

function createEmailProviderFromEnv(overrides){
  return createEmailProvider(overrides||{});
}

module.exports={
  createEmailProvider,
  createEmailProviderFromEnv,
  diagnose,
  fromEnv,
  resolveName,
  sentMessage,
  MSG_NOT_CONFIGURED,
  MSG_RESEND_NOT_CONFIGURED,
  MSG_FAILED,
  MSG_RESEND_FAILED,
  authFailMessage
};
