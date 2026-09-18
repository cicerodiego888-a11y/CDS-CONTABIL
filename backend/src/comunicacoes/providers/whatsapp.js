'use strict';

const USER_AGENT='CDS-Contabil-Connect/1.0';

function mapHttp(httpStatus){
  if(httpStatus===200||httpStatus===201)return {ok:true,retryable:false};
  if(httpStatus===429||httpStatus>=500)return {ok:false,retryable:true,code:'PROVIDER_UNAVAILABLE'};
  if(httpStatus===401||httpStatus===403)return {ok:false,retryable:false,code:'PROVIDER_FORBIDDEN'};
  if(httpStatus===404)return {ok:false,retryable:false,code:'PROVIDER_NOT_FOUND'};
  if(httpStatus===400)return {ok:false,retryable:false,code:'PROVIDER_BAD_REQUEST'};
  return {ok:false,retryable:false,code:'ERRO_PROVIDER'};
}

function createWhatsAppProvider(options={}){
  const name=String(options.name||process.env.CDS_WHATSAPP_PROVIDER||'meta').trim().toLowerCase()||'meta';
  const apiUrl=String(options.apiUrl||process.env.CDS_WHATSAPP_API_URL||'').trim();
  const token=String(options.apiToken||process.env.CDS_WHATSAPP_API_TOKEN||'').trim();
  const phoneNumberId=String(options.phoneNumberId||process.env.CDS_WHATSAPP_PHONE_NUMBER_ID||'').trim();
  const timeoutMs=Math.max(1000,Number(options.timeoutMs||process.env.CDS_WHATSAPP_TIMEOUT_MS||8000)||8000);
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const graphBase=apiUrl||(name==='meta'||name==='whatsapp'?'https://graph.facebook.com/v21.0':'');

  function configured(extraPhoneId){
    const pid=String(extraPhoneId||phoneNumberId||'').trim();
    if(name==='off'||name==='none')return {ok:false,reason:'PROVIDER_OFF'};
    if(!graphBase)return {ok:false,reason:'URL_AUSENTE'};
    if(!token)return {ok:false,reason:'TOKEN_AUSENTE'};
    if(!pid)return {ok:false,reason:'PHONE_NUMBER_ID_AUSENTE'};
    return {ok:true,phoneNumberId:pid};
  }

  async function sendMessage({to,text,phoneNumberId:overrideId}){
    const cfg=configured(overrideId);
    if(!cfg.ok)return {status:'error',retryable:false,code:cfg.reason,httpStatus:null,messageId:null};
    if(typeof fetchImpl!=='function')return {status:'error',retryable:true,code:'PROVIDER_UNAVAILABLE',httpStatus:null,messageId:null};
    const url=graphBase.replace(/\/$/,'')+'/'+encodeURIComponent(cfg.phoneNumberId)+'/messages';
    const headers={
      Accept:'application/json',
      'Content-Type':'application/json',
      'User-Agent':USER_AGENT,
      Authorization:'Bearer '+token
    };
    const body=JSON.stringify({
      messaging_product:'whatsapp',
      recipient_type:'individual',
      to:String(to),
      type:'text',
      text:{preview_url:false,body:String(text||'').slice(0,1000)}
    });
    const ac=typeof AbortController==='function'?new AbortController():null;
    const timer=ac?setTimeout(()=>ac.abort(),timeoutMs):null;
    try{
      const res=await fetchImpl(url,{method:'POST',headers,body,signal:ac?ac.signal:undefined});
      const httpStatus=Number(res&&res.status)||0;
      const mapped=mapHttp(httpStatus);
      let parsed=null;
      try{parsed=await res.json()}catch{parsed=null}
      if(!mapped.ok){
        return {status:'error',retryable:mapped.retryable,code:mapped.code,httpStatus,messageId:null};
      }
      const messageId=parsed&&parsed.messages&&parsed.messages[0]&&parsed.messages[0].id?String(parsed.messages[0].id):null;
      return {status:'ok',retryable:false,code:'SENT',httpStatus,messageId};
    }catch(err){
      const msg=String(err&&err.name||err&&err.message||'');
      if(msg==='AbortError'||/timeout|aborted/i.test(msg))return {status:'error',retryable:true,code:'TIMEOUT',httpStatus:null,messageId:null};
      return {status:'error',retryable:true,code:'PROVIDER_UNAVAILABLE',httpStatus:null,messageId:null};
    }finally{
      if(timer)clearTimeout(timer);
    }
  }

  return {name,apiUrl:graphBase,timeoutMs,configured,sendMessage,sendTemplate:sendMessage};
}

function createWhatsAppProviderFromEnv(overrides){
  return createWhatsAppProvider(overrides||{});
}

module.exports={createWhatsAppProvider,createWhatsAppProviderFromEnv,USER_AGENT};
