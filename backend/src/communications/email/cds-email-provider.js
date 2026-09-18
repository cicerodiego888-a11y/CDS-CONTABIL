'use strict';

const {normalizeResult}=require('../communication-provider');
const {stripSecrets}=require('../communication-errors');

function createCdsEmailProvider(options={}){
  const url=String(options.apiUrl||process.env.CDS_EMAIL_API_URL||'').trim();
  const key=String(options.apiKey||process.env.CDS_EMAIL_API_KEY||'').trim();
  const timeoutMs=Math.max(1000,Number(options.timeoutMs||process.env.CDS_EMAIL_TIMEOUT_MS||10000)||10000);
  const name='cds';

  function available(){
    return !!(url&&key);
  }

  function getStatus(){
    if(!available())return {provider:name,status:'NOT_CONFIGURED',available:false,configured:false};
    return {provider:name,status:'AVAILABLE',available:true,configured:true};
  }

  async function request(body){
    if(!available())return {accepted:false,provider:name,status:'failed',code:'EMAIL_NOT_CONFIGURED',message:'Envio de e-mail aguardando configuração da infraestrutura do CDS.'};
    const ac=new AbortController();
    const t=setTimeout(()=>ac.abort(),timeoutMs);
    try{
      const res=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'User-Agent':'cds-contabil-connect'},
        body:JSON.stringify(body),
        signal:ac.signal
      });
      const text=await res.text();
      let data={};try{data=JSON.parse(text)}catch{}
      if(res.ok){
        return normalizeResult({accepted:true,provider:name,provider_message_id:data.id||data.message_id||data.provider_message_id,status:'accepted'},name);
      }
      const retryable=res.status>=500||res.status===429;
      return {accepted:false,provider:name,status:'failed',code:retryable?'EMAIL_TEMPORARY':'EMAIL_SEND_FAILED',message:'A infraestrutura de e-mail do CDS recusou o envio.',retryable};
    }catch(err){
      console.error('cds_email_failed',JSON.stringify({code:'EMAIL_SEND_FAILED',reason:stripSecrets(err&&err.message||err,[key])}));
      return {accepted:false,provider:name,status:'failed',code:'EMAIL_TEMPORARY',message:'Não foi possível alcançar a infraestrutura de e-mail do CDS.',retryable:true};
    }finally{
      clearTimeout(t);
    }
  }

  async function send(message){
    return request({
      to:message.to,
      cc:message.cc||undefined,
      bcc:message.bcc||undefined,
      subject:message.subject,
      html:message.html,
      text:message.text,
      replyTo:message.replyTo||undefined,
      metadata:message.metadata&&typeof message.metadata==='object'?message.metadata:undefined
    });
  }

  async function verify(){
    if(!available())return {ok:false,status:'not_configured',code:'EMAIL_NOT_CONFIGURED',message:'Envio de e-mail aguardando configuração da infraestrutura do CDS.'};
    const r=await request({action:'verify'});
    if(r.accepted)return {ok:true,status:'ok',code:'EMAIL_VERIFY_OK'};
    return {ok:false,status:'failed',code:r.code||'EMAIL_VERIFY_FAILED',message:r.message||'Não foi possível verificar a infraestrutura de e-mail do CDS.'};
  }

  return {name,available,getStatus,send,verify,configured:available};
}

module.exports={createCdsEmailProvider};
