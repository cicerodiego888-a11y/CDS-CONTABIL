'use strict';

const {COMMUNICATION_EVENTS,OFFICE_EMAIL_EVENTS,eventLabel}=require('./communication-events');
const {createCommunicationQueue}=require('./queue/communication-queue');
const {templates}=require('./email/email-service');
const {authFailMessage,sentMessage,MSG_NOT_CONFIGURED,MSG_RESEND_NOT_CONFIGURED,MSG_FAILED,MSG_RESEND_FAILED}=require('../email/provider');

function createCommunicationService(deps){
  const {id,one,qRows,exec,auditSystem,resolveEmailProvider,appPublicUrl}=deps;
  const queue=createCommunicationQueue({id,one,qRows,exec,auditSystem,backoffMs:deps.backoffMs});

  function branding(tenantId){
    const tenant=one('SELECT name FROM tenants WHERE id=?',tenantId);
    const row=one('SELECT office_name,slogan FROM tenant_branding WHERE tenant_id=?',tenantId);
    return {name:tenant&&tenant.name,office_name:(row&&row.office_name)||(tenant&&tenant.name)||'CDS Contábil',slogan:row&&row.slogan||null};
  }

  function emailPrefOn(userId,eventType){
    const row=one('SELECT email_enabled,in_app_enabled FROM notification_preferences WHERE user_id=? AND event_type=?',userId,eventType);
    if(!row)return true;
    if(row.email_enabled===null||row.email_enabled===undefined)return true;
    return Number(row.email_enabled)===1;
  }

  function providerReady(p){
    if(!p)return false;
    if(typeof p.configured==='function')return !!p.configured();
    if(typeof p.available==='function')return !!p.available();
    return true;
  }

  async function dispatch(provider,mail,inviteOpts){
    if(inviteOpts&&typeof provider.sendInvitation==='function'){
      const r=await provider.sendInvitation(inviteOpts);
      if(r&&r.email_sent)return {accepted:true,provider:provider.name||'smtp',status:'accepted',code:'EMAIL_SENT',message:r.message};
      return {accepted:false,provider:provider.name||'smtp',status:r&&r.status||'failed',code:r&&r.code||'EMAIL_SEND_FAILED',message:r&&r.message,retryable:false};
    }
    const r=await provider.send(mail);
    if(r&&(r.accepted||r.status==='sent'||r.status==='accepted'))return {accepted:true,provider:r.provider||provider.name,provider_message_id:r.provider_message_id,status:'accepted',code:r.code||'EMAIL_ACCEPTED'};
    return {accepted:false,provider:r&&r.provider||provider.name,status:'failed',code:r&&r.code||'EMAIL_SEND_FAILED',message:r&&r.message,retryable:r&&r.retryable===true};
  }

  async function deliverInvite({tenantId,companyId,userId,to,name,company,url,resend,actorUserId,purpose}){
    const provider=resolveEmailProvider(tenantId);
    const brand=branding(tenantId);
    const isReset=String(purpose||'')==='PASSWORD_RESET';
    const templateKey=isReset?'password-reset':'user-invite';
    const eventType=isReset?'PASSWORD_RESET':(resend?COMMUNICATION_EVENTS.USER_INVITE_RESEND:COMMUNICATION_EVENTS.USER_INVITE);
    const inviteUrl=String(url||'').trim();
    const tpl=templates.render(templateKey,{name,company,url:inviteUrl,branding:brand,cta:isReset?'Criar nova senha':undefined});
    // url no payload é obrigatório para CTA e para retries do worker (sem recriar href vazio).
    const jobId=queue.insertEmailJob({
      tenant_id:tenantId,company_id:companyId,recipient_user_id:userId,destination:to,
      template_key:templateKey,event_type:eventType,provider:provider&&provider.name||null,
      actor_user_id:actorUserId,payload:{
        to,subject:tpl.subject,has_cta:true,office_name:brand.office_name,name,company,
        purpose:isReset?'PASSWORD_RESET':'ACTIVATION',url:inviteUrl
      }
    });
    let delivery;
    try{
      // PASSWORD_RESET usa o HTML/assunto já renderizados; sendInvitation do provider é só para ativação.
      delivery=await dispatch(
        provider,
        {to,subject:tpl.subject,text:tpl.text,html:tpl.html,metadata:{event_type:eventType}},
        isReset?null:{to,name,company,url:inviteUrl,resend:!!resend}
      );
    }catch(err){
      delivery={accepted:false,status:'failed',code:'EMAIL_SEND_FAILED',message:resend?MSG_RESEND_FAILED:MSG_FAILED};
    }
    const job=one('SELECT * FROM communication_jobs WHERE id=?',jobId);
    if(job)queue.applyResult(job,delivery,Number(job.attempts||0)+1);
    if(delivery.accepted)return {status:'accepted',email_sent:true,message:delivery.message||sentMessage(to),job_id:jobId,provider:delivery.provider};
    if(delivery.code==='EMAIL_NOT_CONFIGURED'||delivery.status==='not_configured'){
      return {status:'not_configured',email_sent:false,message:resend?MSG_RESEND_NOT_CONFIGURED:MSG_NOT_CONFIGURED,job_id:jobId,provider:provider&&provider.name||'cds'};
    }
    return {status:'failed',email_sent:false,message:delivery.message||(resend?MSG_RESEND_FAILED:MSG_FAILED),job_id:jobId,provider:delivery.provider};
  }

  async function verifyEmail(tenantId,provider){
    const p=provider||resolveEmailProvider(tenantId);
    if(!providerReady(p))return {ok:false,status:'not_configured',code:'EMAIL_NOT_CONFIGURED',message:'Envio de e-mail aguardando configuração da infraestrutura do CDS.'};
    if(typeof p.verify==='function')return p.verify();
    return {ok:true,status:'ok',code:'EMAIL_VERIFY_OK'};
  }

  async function sendTestEmail({tenantId,userId,to,provider}){
    const p=provider||resolveEmailProvider(tenantId);
    const tpl=templates.render('EMAIL_TEST',{to,branding:branding(tenantId)});
    const jobId=queue.insertEmailJob({tenant_id:tenantId,recipient_user_id:userId,destination:to,template_key:'email-test',event_type:COMMUNICATION_EVENTS.EMAIL_TEST,provider:p&&p.name||null,payload:{to,subject:tpl.subject}});
    let result;
    try{
      if(typeof p.sendTest==='function')result=await p.sendTest({to});
      else result=await dispatch(p,{to,subject:tpl.subject,text:tpl.text,html:tpl.html,metadata:{event_type:'EMAIL_TEST'}});
    }catch{
      result={accepted:false,code:'EMAIL_SEND_FAILED',email_sent:false};
    }
    const accepted=!!(result&&(result.accepted||result.email_sent||result.status==='sent'||result.status==='accepted'));
    const job=one('SELECT * FROM communication_jobs WHERE id=?',jobId);
    if(job)queue.applyResult(job,accepted?{accepted:true,provider:p&&p.name}:{accepted:false,code:result&&result.code||'EMAIL_SEND_FAILED',retryable:false},1);
    if(accepted)return {status:'sent',email_sent:true,message:result.message||'E-mail de teste enviado com sucesso.',job_id:jobId};
    if(result&&(result.code==='EMAIL_AUTH_FAILED'))return {status:'failed',email_sent:false,message:result.message||authFailMessage({host:'smtp.gmail.com'}),job_id:jobId,code:'EMAIL_AUTH_FAILED'};
    if(result&&(result.code==='EMAIL_NOT_CONFIGURED'||result.status==='not_configured'))return {status:'not_configured',code:'EMAIL_NOT_CONFIGURED',email_sent:false,message:result.message||'Salve a configuração de e-mail antes de enviar um teste.'};
    return {status:'failed',email_sent:false,message:(result&&result.message)||'Não foi possível enviar o e-mail de teste. Verifique a configuração de envio.',job_id:jobId,code:result&&result.code};
  }

  async function processEmailJob(job){
    if(!job||job.channel!=='EMAIL')return job;
    const provider=resolveEmailProvider(job.tenant_id);
    let payload={};try{payload=JSON.parse(job.payload_json||'{}')}catch{payload={}}
    const to=payload.to||job.destination;
    const brand=branding(job.tenant_id);
    const tpl=templates.render(job.template_key,Object.assign({},payload,{branding:brand,to,url:payload.url||''}));
    let result;
    try{
      result=await dispatch(provider,{to,cc:payload.cc,bcc:payload.bcc,subject:tpl.subject||payload.subject,text:tpl.text,html:tpl.html,replyTo:payload.replyTo,metadata:{event_type:job.event_type}});
    }catch{
      result={accepted:false,code:'EMAIL_SEND_FAILED',retryable:true};
    }
    return queue.applyResult(job,result,Number(job.attempts||0)+1);
  }

  function enqueueEmailForEvent(event){
    if(!event||!OFFICE_EMAIL_EVENTS.has(event.event_type))return [];
    const provider=resolveEmailProvider(event.tenant_id);
    if(!providerReady(provider))return [];
    const company=event.company_id?one('SELECT name,trade_name FROM companies WHERE id=? AND tenant_id=?',event.company_id,event.tenant_id):null;
    const companyName=company?(company.trade_name||company.name):'Empresa';
    let payload={};try{payload=JSON.parse(event.payload_json||'{}')}catch{payload={}}
    const users=qRows("SELECT id,email FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') AND active=1",event.tenant_id);
    const created=[];
    const brand=branding(event.tenant_id);
    const tpl=templates.render(event.event_type,{company:companyName,title:eventLabel(event.event_type),message:payload.description||payload.title,branding:brand});
    for(const u of users){
      if(!u.email||!emailPrefOn(u.id,event.event_type))continue;
      const jobId=queue.insertEmailJob({
        tenant_id:event.tenant_id,company_id:event.company_id,event_id:event.id,recipient_user_id:u.id,
        destination:u.email,template_key:event.event_type,event_type:event.event_type,provider:provider.name,
        payload:{to:u.email,subject:tpl.subject,office_name:brand.office_name}
      });
      if(jobId)created.push(jobId);
    }
    return created;
  }

  return {
    deliverInvite,
    verifyEmail,
    sendTestEmail,
    processEmailJob,
    enqueueEmailForEvent,
    listRecent:(tenantId,limit)=>queue.listRecent(tenantId,limit),
    eventLabel,
    COMMUNICATION_EVENTS
  };
}

module.exports={createCommunicationService};
