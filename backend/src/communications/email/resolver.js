'use strict';

const {createEmailProvider,createEmailProviderFromEnv,fromEnv,diagnose,resolveName}=require('../../email/provider');
const {createCdsEmailProvider}=require('./cds-email-provider');
const {createSmtpEmailProvider}=require('./smtp-email-provider');

function chosenProvider(row){
  if(!row)return 'cds';
  const p=String(row.provider||'').trim().toLowerCase();
  if(p==='smtp'||p==='off'||p==='cds')return p;
  if(row.host&&row.username)return 'smtp';
  return 'cds';
}

function createEmailResolver(deps){
  const {persistedEmailCfg,getRow,getOverride}=deps;

  function resolve(tenantId){
    const row=getRow(tenantId);
    const mode=chosenProvider(row);
    const persisted=persistedEmailCfg(tenantId);
    if(mode==='smtp'&&persisted)return createSmtpEmailProvider(persisted);
    const override=getOverride&&getOverride();
    if(override)return createSmtpEmailProvider(override);
    if(mode==='off')return createSmtpEmailProvider(createEmailProvider({name:'off'}));
    if(mode==='cds'&&row){
      const cds=createCdsEmailProvider();
      if(cds.available())return cds;
      return createSmtpEmailProvider(createEmailProvider({name:'off'}));
    }
    const cds=createCdsEmailProvider();
    if(cds.available())return cds;
    return createSmtpEmailProvider(createEmailProviderFromEnv());
  }

  function publicConfig(tenantId,emailStatusLabel){
    const row=getRow(tenantId);
    const env=fromEnv();
    const persisted=persistedEmailCfg(tenantId);
    const cds=createCdsEmailProvider();
    const mode=chosenProvider(row);
    if(mode==='smtp'&&persisted){
      const d=diagnose(persisted);
      let status='not_configured';
      if(d.ok){
        if(row&&row.last_test_status==='ok')status='configured_ok';
        else if(row&&row.last_test_status==='failed')status='connection_error';
        else status='configured_untested';
      }
      return {
        provider:'smtp',delivery_mode:'smtp',host:persisted.host||'',port:Number(persisted.port||587)||587,
        user:persisted.user||'',from:persisted.from||'',fromName:persisted.fromName||'CDS Contábil',
        secure:!!persisted.secure,configured:d.ok,hasCredential:true,source:'tenant',
        status,status_label:emailStatusLabel(status),last_tested_at:(row&&row.last_tested_at)||null,cds_available:cds.available()
      };
    }
    if(mode==='off'){
      return {provider:'off',delivery_mode:'off',host:'',port:587,user:'',from:'',fromName:'CDS Contábil',secure:false,configured:false,hasCredential:false,source:row?'tenant':'none',status:'not_configured',status_label:emailStatusLabel('not_configured'),last_tested_at:null,cds_available:cds.available()};
    }
    if(mode==='cds'&&row){
      const ok=cds.available();
      const status=ok?'configured_untested':'not_configured';
      return {provider:'cds',delivery_mode:'cds',host:'',port:587,user:'',from:'',fromName:'CDS Contábil',secure:false,configured:ok,hasCredential:false,source:'saas',status,status_label:ok?'Ativo':'Aguardando configuração da infraestrutura de e-mail',last_tested_at:(row&&row.last_tested_at)||null,cds_available:ok};
    }
    if(cds.available()){
      return {provider:'cds',delivery_mode:'cds',host:'',port:587,user:'',from:'',fromName:'CDS Contábil',secure:false,configured:true,hasCredential:false,source:'saas',status:'configured_untested',status_label:'Ativo',last_tested_at:null,cds_available:true};
    }
    const envOk=diagnose(env).ok&&resolveName(env)==='smtp';
    if(envOk){
      return {provider:'smtp',delivery_mode:'smtp',host:env.host||'',port:Number(env.port||587)||587,user:env.user||'',from:env.from||'',fromName:env.fromName||'CDS Contábil',secure:!!env.secure,configured:true,hasCredential:!!env.password,source:'env',status:'configured_untested',status_label:emailStatusLabel('configured_untested'),last_tested_at:null,cds_available:false};
    }
    return {provider:'cds',delivery_mode:'cds',host:'',port:587,user:'',from:'',fromName:'CDS Contábil',secure:false,configured:false,hasCredential:false,source:'none',status:'not_configured',status_label:emailStatusLabel('not_configured'),last_tested_at:null,cds_available:false};
  }

  return {resolve,publicConfig,chosenProvider};
}

module.exports={createEmailResolver,chosenProvider};
