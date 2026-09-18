'use strict';

const {asString,normalizeCep,formatCepDisplay,normalizeUf}=require('../cnpj/normalize');

function present(value){
  return !!(value&&String(value).trim());
}

function cepDigitsExact(value){
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===8?digits:null;
}

function fillEmptyAddress(current,cepData){
  const out=Object.assign({},current&&typeof current==='object'?current:{});
  const extra=cepData&&typeof cepData==='object'?cepData:{};
  const pairs=[['address','logradouro'],['neighborhood','bairro'],['city','municipio'],['state','uf']];
  for(const [formKey,cepKey] of pairs){
    if(!present(out[formKey])&&present(extra[cepKey]))out[formKey]=extra[cepKey];
  }
  if(!present(out.zip)&&present(extra.cep))out.zip=extra.cep;
  return out;
}

function shouldLookupCep(cnpjData){
  const src=cnpjData&&typeof cnpjData==='object'?cnpjData:{};
  if(!normalizeCep(src.cep))return false;
  return !(present(src.logradouro)&&present(src.bairro)&&present(src.municipio)&&present(src.uf));
}

function mergeAddressData(cnpjData,cepData){
  const base=Object.assign({},cnpjData&&typeof cnpjData==='object'?cnpjData:{});
  const extra=cepData&&typeof cepData==='object'?cepData:{};
  const fill=(key)=>{
    if(!present(base[key])&&present(extra[key]))base[key]=extra[key];
  };
  fill('logradouro');
  fill('bairro');
  fill('municipio');
  fill('uf');
  fill('cep');
  fill('complemento');
  return base;
}

async function complementCnpjAddress(cnpjData,consultarCep,log){
  const cadastro=cnpjData&&typeof cnpjData==='object'?cnpjData:{};
  if(!shouldLookupCep(cadastro)){
    const complete=present(cadastro.logradouro)&&present(cadastro.bairro)&&present(cadastro.municipio)&&present(cadastro.uf);
    if(typeof log==='function')log({cnpj_consulted:true,address_complete:complete,cep_fallback:false,has_cep:!!normalizeCep(cadastro.cep)});
    return {cadastro,cep_fallback:false,cep_ok:false};
  }
  if(typeof log==='function')log({cnpj_consulted:true,address_complete:false,cep_fallback:true,cep:normalizeCep(cadastro.cep)});
  if(typeof consultarCep!=='function'){
    return {cadastro,cep_fallback:true,cep_ok:false};
  }
  try{
    const result=await consultarCep(cadastro.cep);
    if(!result||result.status!=='ok'||!result.data){
      if(typeof log==='function')log({cep_fallback:true,cep_ok:false,cep_status:result&&result.status||'error'});
      return {cadastro,cep_fallback:true,cep_ok:false};
    }
    const merged=mergeAddressData(cadastro,result.data);
    if(typeof log==='function')log({cep_fallback:true,cep_ok:true,logradouro_filled:present(merged.logradouro)&&!present(cadastro.logradouro)});
    return {cadastro:merged,cep_fallback:true,cep_ok:true};
  }catch{
    if(typeof log==='function')log({cep_fallback:true,cep_ok:false,cep_status:'error'});
    return {cadastro,cep_fallback:true,cep_ok:false};
  }
}

function mapBrasilApiCep(raw,cepKey){
  const src=raw&&typeof raw==='object'?raw:{};
  return {
    cep:formatCepDisplay(src.cep||cepKey),
    logradouro:asString(src.street||src.logradouro),
    bairro:asString(src.neighborhood||src.bairro),
    municipio:asString(src.city||src.municipio||src.localidade),
    uf:normalizeUf(src.state||src.uf),
    complemento:asString(src.complemento)
  };
}

module.exports={present,shouldLookupCep,mergeAddressData,complementCnpjAddress,mapBrasilApiCep,cepDigitsExact,fillEmptyAddress};
