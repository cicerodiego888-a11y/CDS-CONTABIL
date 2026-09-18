'use strict';

const {isPlausibleCnpj,normalizeCnpjKey,mapBrasilApi}=require('./normalize');

const USER_AGENT='CDS-Contabil-Connect/1.0';

function providerError(status,code,extra){
  const out={status,code,cause:null};
  if(extra&&typeof extra==='object'){
    if(extra.httpStatus!=null)out.httpStatus=extra.httpStatus;
  }
  return out;
}

function createCnpjProvider(options={}){
  const name=String(options.name||process.env.CDS_CNPJ_PROVIDER||'brasilapi').trim().toLowerCase()||'brasilapi';
  const apiUrl=String(options.apiUrl||process.env.CDS_CNPJ_API_URL||'').trim();
  const apiKey=String(options.apiKey||process.env.CDS_CNPJ_API_KEY||'').trim();
  const timeoutMs=Math.max(1000,Number(options.timeoutMs||process.env.CDS_CNPJ_TIMEOUT_MS||8000)||8000);
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const base=apiUrl||(name==='brasilapi'?'https://brasilapi.com.br/api/cnpj/v1':'');

  async function consultarCnpj(cnpj){
    const key=normalizeCnpjKey(cnpj);
    if(!isPlausibleCnpj(key))return providerError('invalid','CNPJ_INVALIDO');
    if(name==='off'||name==='none'||!base)return providerError('unavailable','PROVIDER_INDISPONIVEL');
    if(typeof fetchImpl!=='function')return providerError('unavailable','PROVIDER_INDISPONIVEL');
    const url=base.replace(/\/$/,'')+'/'+encodeURIComponent(key);
    const headers={
      Accept:'application/json',
      'User-Agent':USER_AGENT
    };
    if(apiKey)headers.Authorization='Bearer '+apiKey;
    const ac=typeof AbortController==='function'?new AbortController():null;
    const timer=ac?setTimeout(()=>ac.abort(),timeoutMs):null;
    try{
      const res=await fetchImpl(url,{method:'GET',headers,signal:ac?ac.signal:undefined});
      const httpStatus=Number(res&&res.status)||0;
      if(httpStatus===404)return providerError('not_found','CNPJ_NAO_ENCONTRADO',{httpStatus});
      if(httpStatus===401||httpStatus===403||httpStatus===429||httpStatus>=500)return providerError('unavailable','PROVIDER_INDISPONIVEL',{httpStatus});
      if(!res||!res.ok)return providerError('error','ERRO_PROVIDER',{httpStatus});
      let body=null;
      try{body=await res.json()}catch{return providerError('error','ERRO_PROVIDER',{httpStatus})}
      if(!body||typeof body!=='object')return providerError('not_found','CNPJ_NAO_ENCONTRADO',{httpStatus});
      return {status:'ok',code:'EMPRESA_ENCONTRADA',data:mapBrasilApi(body,key),provider:name,httpStatus};
    }catch(err){
      const msg=String(err&&err.name||err&&err.message||'');
      if(msg==='AbortError'||/timeout|aborted/i.test(msg))return providerError('timeout','PROVIDER_INDISPONIVEL');
      return providerError('unavailable','PROVIDER_INDISPONIVEL');
    }finally{
      if(timer)clearTimeout(timer);
    }
  }

  return {name,apiUrl:base,consultarCnpj,timeoutMs,userAgent:USER_AGENT};
}

function createCnpjProviderFromEnv(overrides){
  return createCnpjProvider(overrides||{});
}

module.exports={createCnpjProvider,createCnpjProviderFromEnv,USER_AGENT};
