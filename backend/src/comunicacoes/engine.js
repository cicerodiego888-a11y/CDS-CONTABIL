'use strict';

const crypto=require('crypto');
const {normalizeWhatsAppPhone,isValidWhatsAppPhone,formatPhoneDisplay}=require('./phone');
const {EVENT_LABELS,DEFAULT_WHATSAPP_ON,renderTemplate,templateVars}=require('./templates');
const {createWhatsAppProviderFromEnv}=require('./providers/whatsapp');

const OFFICE_ROLES=new Set(['OWNER','ACCOUNTANT','STAFF']);
const WHATSAPP_EVENTS=new Set(Object.keys(EVENT_LABELS));

function isoNow(){return new Date().toISOString()}
function isoPlus(ms){return new Date(Date.now()+ms).toISOString()}

function createCommunicationEngine(opts){
  const {db,id,one,qRows,exec,auditSystem,providerFactory,backoffMs:backoffOpt,maxAttempts:maxOpt}=opts;
  let provider=(providerFactory||createWhatsAppProviderFromEnv)();
  let processEmailJob=null;
  function setEmailJobProcessor(fn){processEmailJob=fn}
  const maxAttempts=Math.max(1,Number(maxOpt||process.env.CDS_WHATSAPP_MAX_ATTEMPTS||3)||3);
  const backoffFn=typeof backoffOpt==='function'?backoffOpt:null;

  function setProvider(p){if(p)provider=p;return provider}
  function backoffMs(attempt){
    if(backoffFn)return backoffFn(attempt);
    return [15000,60000,180000][Math.min(Math.max(attempt,1)-1,2)];
  }

  function settings(tenantId){
    return one('SELECT * FROM communication_settings WHERE tenant_id=?',tenantId)||{
      tenant_id:tenantId,whatsapp_enabled:0,whatsapp_provider:'meta',whatsapp_phone_number_id:null,display_number:null
    };
  }

  function ensureSettings(tenantId){
    const row=one('SELECT tenant_id FROM communication_settings WHERE tenant_id=?',tenantId);
    if(!row)exec('INSERT INTO communication_settings(tenant_id,whatsapp_enabled,whatsapp_provider) VALUES(?,?,?)',tenantId,0,'meta');
    return settings(tenantId);
  }

  function eventPrefOn(tenantId,eventType){
    const row=one('SELECT whatsapp_enabled FROM communication_event_prefs WHERE tenant_id=? AND event_type=?',tenantId,eventType);
    if(!row)return DEFAULT_WHATSAPP_ON.has(eventType);
    return Number(row.whatsapp_enabled)===1;
  }

  function integrationStatus(tenantId){
    const s=settings(tenantId);
    const cfg=provider.configured(s.whatsapp_phone_number_id);
    if(!Number(s.whatsapp_enabled))return 'DESATIVADO';
    if(cfg.reason==='PROVIDER_OFF')return 'INDISPONIVEL';
    if(cfg.reason==='TOKEN_AUSENTE'||cfg.reason==='URL_AUSENTE')return 'ERRO_CONFIGURACAO';
    if(cfg.reason==='PHONE_NUMBER_ID_AUSENTE')return 'CONFIGURANDO';
    if(cfg.ok)return 'ATIVO';
    return 'ERRO_CONFIGURACAO';
  }

  function publicConfig(tenantId){
    const s=ensureSettings(tenantId);
    const st=integrationStatus(tenantId);
    const cfg=provider.configured(s.whatsapp_phone_number_id);
    const prefs=qRows('SELECT event_type,whatsapp_enabled FROM communication_event_prefs WHERE tenant_id=?',tenantId);
    const prefMap={};for(const p of prefs)prefMap[p.event_type]=!!p.whatsapp_enabled;
    const events=Object.keys(EVENT_LABELS).map(event_type=>({
      event_type,label:EVENT_LABELS[event_type],
      whatsapp_enabled:prefMap[event_type]===undefined?DEFAULT_WHATSAPP_ON.has(event_type):prefMap[event_type]
    }));
    const recipients=qRows("SELECT id,name,role,active,whatsapp_phone FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') ORDER BY name",tenantId)
      .map(u=>({user_id:u.id,name:u.name,role:u.role,active:!!u.active,phone:formatPhoneDisplay(u.whatsapp_phone)||null,has_phone:isValidWhatsAppPhone(u.whatsapp_phone)}));
    return {
      whatsapp_enabled:!!Number(s.whatsapp_enabled),
      provider:s.whatsapp_provider||provider.name||'meta',
      phone_number_id:s.whatsapp_phone_number_id||null,
      display_number:s.display_number||null,
      has_token:provider.configured('configured').ok,
      status:st,
      events,
      recipients
    };
  }

  function patchConfig(tenantId,body,actorUserId){
    ensureSettings(tenantId);
    const enabled=body.whatsapp_enabled===undefined?null:(body.whatsapp_enabled?1:0);
    const phoneId=body.whatsapp_phone_number_id!==undefined?String(body.whatsapp_phone_number_id||'').trim()||null:undefined;
    const display=body.display_number!==undefined?String(body.display_number||'').trim()||null:undefined;
    const cur=settings(tenantId);
    exec('UPDATE communication_settings SET whatsapp_enabled=?,whatsapp_phone_number_id=?,display_number=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?',
      enabled===null?cur.whatsapp_enabled:enabled,
      phoneId===undefined?cur.whatsapp_phone_number_id:phoneId,
      display===undefined?cur.display_number:display,
      tenantId);
    if(Array.isArray(body.events)){
      for(const it of body.events){
        if(!WHATSAPP_EVENTS.has(it.event_type))continue;
        const on=it.whatsapp_enabled?1:0;
        const existing=one('SELECT id FROM communication_event_prefs WHERE tenant_id=? AND event_type=?',tenantId,it.event_type);
        if(existing)exec('UPDATE communication_event_prefs SET whatsapp_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',on,existing.id);
        else exec('INSERT INTO communication_event_prefs(id,tenant_id,event_type,whatsapp_enabled) VALUES(?,?,?,?)',id(),tenantId,it.event_type,on);
      }
    }
    if(Array.isArray(body.recipient_phones)){
      for(const r of body.recipient_phones){
        if(!r||!r.user_id)continue;
        const u=one("SELECT id FROM users WHERE id=? AND tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF')",r.user_id,tenantId);
        if(!u)continue;
        const phone=r.phone===undefined||r.phone===null||r.phone===''?null:normalizeWhatsAppPhone(r.phone);
        exec('UPDATE users SET whatsapp_phone=? WHERE id=? AND tenant_id=?',phone,u.id,tenantId);
      }
    }
    if(auditSystem)auditSystem(tenantId,actorUserId,'WHATSAPP_CONFIG_UPDATED','COMMUNICATION',tenantId,{whatsapp_enabled:settings(tenantId).whatsapp_enabled});
    return publicConfig(tenantId);
  }

  function insertJob(row){
    try{
      exec('INSERT INTO communication_jobs(id,tenant_id,company_id,event_id,notification_id,recipient_user_id,channel,destination,template_key,payload_json,status,attempts,max_attempts,next_attempt_at,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        row.id,row.tenant_id,row.company_id||null,row.event_id||null,row.notification_id||null,row.recipient_user_id,'WHATSAPP',row.destination||null,row.template_key,JSON.stringify(row.payload||{}),row.status||'PENDING',row.attempts||0,maxAttempts,row.next_attempt_at||isoNow(),row.last_error||null);
      return true;
    }catch(err){
      if(String(err.message||'').includes('UNIQUE'))return false;
      throw err;
    }
  }

  function enqueueForEvent(event){
    if(!event||!event.tenant_id||!event.event_type)return [];
    if(!WHATSAPP_EVENTS.has(event.event_type))return [];
    const s=settings(event.tenant_id);
    if(!Number(s.whatsapp_enabled))return [];
    if(!eventPrefOn(event.tenant_id,event.event_type))return [];
    const company=event.company_id?one('SELECT name,trade_name FROM companies WHERE id=? AND tenant_id=?',event.company_id,event.tenant_id):null;
    const companyName=company?(company.trade_name||company.name):'Empresa';
    let payload={};
    try{payload=JSON.parse(event.payload_json||'{}')}catch{payload={}}
    const vars=templateVars(event,companyName,payload);
    const text=renderTemplate(event.event_type,vars);
    const users=qRows("SELECT id,role,active,whatsapp_phone FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') AND active=1",event.tenant_id);
    const created=[];
    for(const u of users){
      if(!OFFICE_ROLES.has(u.role))continue;
      const notif=one('SELECT id FROM notifications WHERE tenant_id=? AND event_id=? AND COALESCE(recipient_user_id,user_id)=?',event.tenant_id,event.id,u.id);
      const phone=normalizeWhatsAppPhone(u.whatsapp_phone);
      const jobId=id();
      if(!phone){
        insertJob({id:jobId,tenant_id:event.tenant_id,company_id:event.company_id,event_id:event.id,notification_id:notif&&notif.id,recipient_user_id:u.id,destination:null,template_key:event.event_type,payload:vars,status:'FAILED',attempts:0,last_error:'NO_PHONE',next_attempt_at:isoNow()});
        exec("UPDATE communication_jobs SET failed_at=CURRENT_TIMESTAMP WHERE id=?",jobId);
        if(auditSystem)auditSystem(event.tenant_id,u.id,'WHATSAPP_FAILED','COMMUNICATION',jobId,{code:'NO_PHONE'});
        continue;
      }
      const ok=insertJob({id:jobId,tenant_id:event.tenant_id,company_id:event.company_id,event_id:event.id,notification_id:notif&&notif.id,recipient_user_id:u.id,destination:phone,template_key:event.event_type,payload:{...vars,text},status:'PENDING',attempts:0,last_error:null,next_attempt_at:isoNow()});
      if(ok){
        created.push(jobId);
        if(auditSystem)auditSystem(event.tenant_id,u.id,'WHATSAPP_SEND_REQUESTED','COMMUNICATION',jobId,{channel:'WHATSAPP'});
      }
    }
    return created;
  }

  function recoverStale(nowIso){
    const cutoff=new Date(Date.parse(nowIso||isoNow())-5*60*1000).toISOString();
    exec("UPDATE communication_jobs SET status='PENDING',locked_at=NULL,locked_by=NULL WHERE status='PROCESSING' AND locked_at IS NOT NULL AND locked_at<?",cutoff);
  }

  function claimJobs(limit,workerId){
    recoverStale();
    const cap=Math.min(100,Math.max(1,limit||10));
    const due=qRows("SELECT id FROM communication_jobs WHERE status='PENDING' AND next_attempt_at<=? ORDER BY created_at LIMIT ?",isoNow(),cap);
    const claimed=[];
    const lock=isoNow();
    for(const row of due){
      const r=exec("UPDATE communication_jobs SET status='PROCESSING',locked_at=?,locked_by=? WHERE id=? AND status='PENDING'",lock,workerId||'worker',row.id);
      if(r.changes)claimed.push(row.id);
    }
    return claimed;
  }

  async function processJob(jobId){
    const job=one('SELECT * FROM communication_jobs WHERE id=?',jobId);
    if(!job||job.status!=='PROCESSING')return job;
    if(String(job.channel||'')==='EMAIL'){
      if(typeof processEmailJob==='function')return processEmailJob(job);
      exec("UPDATE communication_jobs SET status='FAILED',last_error='NO_EMAIL_PROCESSOR',failed_at=CURRENT_TIMESTAMP,locked_at=NULL,locked_by=NULL WHERE id=?",job.id);
      return one('SELECT * FROM communication_jobs WHERE id=?',job.id);
    }
    let payload={};
    try{payload=JSON.parse(job.payload_json||'{}')}catch{payload={}}
    const text=payload.text||renderTemplate(job.template_key,payload);
    if(!isValidWhatsAppPhone(job.destination)){
      exec("UPDATE communication_jobs SET status='FAILED',last_error='NO_PHONE',failed_at=CURRENT_TIMESTAMP,locked_at=NULL,locked_by=NULL WHERE id=?",job.id);
      if(auditSystem)auditSystem(job.tenant_id,job.recipient_user_id,'WHATSAPP_FAILED','COMMUNICATION',job.id,{code:'NO_PHONE'});
      return one('SELECT * FROM communication_jobs WHERE id=?',job.id);
    }
    const s=settings(job.tenant_id);
    const result=await provider.sendMessage({to:job.destination,text,phoneNumberId:s.whatsapp_phone_number_id});
    const attempts=Number(job.attempts||0)+1;
    if(result.status==='ok'){
      exec("UPDATE communication_jobs SET status='SENT',attempts=?,provider_message_id=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL,locked_at=NULL,locked_by=NULL WHERE id=?",attempts,result.messageId||null,job.id);
      if(auditSystem)auditSystem(job.tenant_id,job.recipient_user_id,'WHATSAPP_SENT','COMMUNICATION',job.id,{channel:'WHATSAPP'});
      return one('SELECT * FROM communication_jobs WHERE id=?',job.id);
    }
    const permanent=!result.retryable||['NO_PHONE','PROVIDER_BAD_REQUEST','PROVIDER_FORBIDDEN','PROVIDER_NOT_FOUND','TOKEN_AUSENTE','URL_AUSENTE','PHONE_NUMBER_ID_AUSENTE','PROVIDER_OFF'].includes(result.code);
    if(permanent||attempts>=Number(job.max_attempts||maxAttempts)){
      exec("UPDATE communication_jobs SET status='FAILED',attempts=?,last_error=?,failed_at=CURRENT_TIMESTAMP,locked_at=NULL,locked_by=NULL WHERE id=?",attempts,result.code||'ERRO_PROVIDER',job.id);
      if(auditSystem)auditSystem(job.tenant_id,job.recipient_user_id,'WHATSAPP_FAILED','COMMUNICATION',job.id,{code:result.code||'ERRO_PROVIDER'});
    }else{
      exec("UPDATE communication_jobs SET status='PENDING',attempts=?,last_error=?,next_attempt_at=?,locked_at=NULL,locked_by=NULL WHERE id=?",attempts,result.code||'ERRO_PROVIDER',isoPlus(backoffMs(attempts)),job.id);
    }
    return one('SELECT * FROM communication_jobs WHERE id=?',job.id);
  }

  async function processDueJobs(limit,workerId){
    const ids=claimJobs(limit,workerId);
    const out=[];
    for(const jid of ids)out.push(await processJob(jid));
    return out;
  }

  function applyWebhookStatus({messageId,status,tenantHint}){
    if(!messageId)return null;
    const job=tenantHint
      ?one('SELECT * FROM communication_jobs WHERE provider_message_id=? AND tenant_id=?',messageId,tenantHint)
      :one('SELECT * FROM communication_jobs WHERE provider_message_id=?',messageId);
    if(!job)return null;
    const st=String(status||'').toLowerCase();
    if(st==='delivered'){
      if(job.status==='DELIVERED')return job;
      exec("UPDATE communication_jobs SET status='DELIVERED',delivered_at=CURRENT_TIMESTAMP WHERE id=? AND status IN('SENT','DELIVERED','PROCESSING')",job.id);
      if(auditSystem&&job.status!=='DELIVERED')auditSystem(job.tenant_id,job.recipient_user_id,'WHATSAPP_DELIVERED','COMMUNICATION',job.id,{channel:'WHATSAPP'});
    }else if(st==='failed'||st==='undelivered'){
      if(job.status==='FAILED')return job;
      exec("UPDATE communication_jobs SET status='FAILED',last_error='PROVIDER_FAILED',failed_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'FAILED'",job.id);
      if(auditSystem)auditSystem(job.tenant_id,job.recipient_user_id,'WHATSAPP_FAILED','COMMUNICATION',job.id,{code:'PROVIDER_FAILED'});
    }else if(st==='sent'&&job.status==='PROCESSING'){
      exec("UPDATE communication_jobs SET status='SENT',sent_at=CURRENT_TIMESTAMP WHERE id=?",job.id);
    }
    return one('SELECT * FROM communication_jobs WHERE id=?',job.id);
  }

  function verifyWebhookSignature(rawBody,header,appSecret){
    const secret=String(appSecret||process.env.CDS_WHATSAPP_APP_SECRET||'').trim();
    if(!secret)return false;
    const given=String(header||'');
    const m=given.match(/^sha256=(.+)$/i);
    if(!m)return false;
    const expected=crypto.createHmac('sha256',secret).update(rawBody||Buffer.from('')).digest('hex');
    const a=Buffer.from(m[1],'utf8');
    const b=Buffer.from(expected,'utf8');
    if(a.length!==b.length)return false;
    return crypto.timingSafeEqual(a,b);
  }

  function verifyChallenge(query){
    const token=String(process.env.CDS_WHATSAPP_VERIFY_TOKEN||'').trim();
    if(!token)return null;
    if(String(query['hub.mode']||query.hub_mode||'')!=='subscribe')return null;
    if(String(query['hub.verify_token']||query.hub_verify_token||'')!==token)return null;
    return String(query['hub.challenge']||query.hub_challenge||'');
  }

  function parseWebhookPayload(body){
    const statuses=[];
    const entries=body&&body.entry||[];
    for(const entry of entries){
      for(const change of entry.changes||[]){
        for(const st of (change.value&&change.value.statuses)||[]){
          statuses.push({messageId:st.id,status:st.status});
        }
      }
    }
    return statuses;
  }

  return {
    setProvider,
    setEmailJobProcessor,
    settings,
    ensureSettings,
    publicConfig,
    patchConfig,
    integrationStatus,
    enqueueForEvent,
    claimJobs,
    processJob,
    processDueJobs,
    recoverStale,
    applyWebhookStatus,
    verifyWebhookSignature,
    verifyChallenge,
    parseWebhookPayload,
    provider:()=>provider
  };
}

module.exports={createCommunicationEngine,WHATSAPP_EVENTS,DEFAULT_WHATSAPP_ON};
