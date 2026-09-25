'use strict';

const EVENT_TYPES = Object.freeze({
  EXPENSE_CREATED: 'EXPENSE_CREATED',
  REVENUE_CREATED: 'REVENUE_CREATED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  CLASSIFICATION_REQUIRED: 'CLASSIFICATION_REQUIRED',
  CLASSIFICATION_COMPLETED: 'CLASSIFICATION_COMPLETED',
  ENTRY_CREATED: 'ENTRY_CREATED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  ENTRY_APPROVED: 'ENTRY_APPROVED',
  ENTRY_POSTED: 'ENTRY_POSTED',
  ENTRY_REJECTED: 'ENTRY_REJECTED',
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_UPDATED: 'REQUEST_UPDATED',
  REQUEST_MESSAGE_CREATED: 'REQUEST_MESSAGE_CREATED',
  REQUEST_MESSAGE_READ: 'REQUEST_MESSAGE_READ',
  REQUEST_STATUS_CHANGED: 'REQUEST_STATUS_CHANGED',
  PENDENCY_RESPONSE: 'PENDENCY_RESPONSE',
  COMPANY_CREATED: 'COMPANY_CREATED',
  IMPORT_CREATED: 'IMPORT_CREATED',
  IMPORT_COMPLETED: 'IMPORT_COMPLETED',
  IMPORT_FAILED: 'IMPORT_FAILED',
  PROCESS_OCCURRENCE_AUTO_CREATED: 'PROCESS_OCCURRENCE_AUTO_CREATED',
  PROCESS_OCCURRENCE_MANUALLY_CREATED: 'PROCESS_OCCURRENCE_MANUALLY_CREATED',
  PROCESS_OCCURRENCE_STARTED: 'PROCESS_OCCURRENCE_STARTED',
  PROCESS_STEP_STARTED: 'PROCESS_STEP_STARTED',
  PROCESS_STEP_COMPLETED: 'PROCESS_STEP_COMPLETED',
  PROCESS_OCCURRENCE_COMPLETED: 'PROCESS_OCCURRENCE_COMPLETED',
  PROCESS_STEP_OVERDUE: 'PROCESS_STEP_OVERDUE',
  CLIENT_PASSWORD_RESET_REQUESTED: 'CLIENT_PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED'
});

const UNIQUE_ONCE = new Set([
  EVENT_TYPES.EXPENSE_CREATED,
  EVENT_TYPES.REVENUE_CREATED,
  EVENT_TYPES.DOCUMENT_UPLOADED,
  EVENT_TYPES.CLASSIFICATION_REQUIRED,
  EVENT_TYPES.ENTRY_CREATED,
  EVENT_TYPES.REQUEST_CREATED,
  EVENT_TYPES.COMPANY_CREATED,
  EVENT_TYPES.IMPORT_CREATED,
  EVENT_TYPES.IMPORT_COMPLETED,
  EVENT_TYPES.IMPORT_FAILED,
  EVENT_TYPES.PROCESS_OCCURRENCE_AUTO_CREATED,
  EVENT_TYPES.PROCESS_OCCURRENCE_MANUALLY_CREATED,
  EVENT_TYPES.PROCESS_STEP_OVERDUE
]);

const OFFICE_EVENTS = new Set([
  EVENT_TYPES.EXPENSE_CREATED,
  EVENT_TYPES.REVENUE_CREATED,
  EVENT_TYPES.DOCUMENT_UPLOADED,
  EVENT_TYPES.CLASSIFICATION_REQUIRED,
  EVENT_TYPES.ENTRY_CREATED,
  EVENT_TYPES.APPROVAL_REQUIRED,
  EVENT_TYPES.ENTRY_APPROVED,
  EVENT_TYPES.ENTRY_POSTED,
  EVENT_TYPES.ENTRY_REJECTED,
  EVENT_TYPES.REQUEST_UPDATED,
  EVENT_TYPES.REQUEST_MESSAGE_CREATED,
  EVENT_TYPES.PENDENCY_RESPONSE,
  EVENT_TYPES.COMPANY_CREATED,
  EVENT_TYPES.IMPORT_CREATED,
  EVENT_TYPES.IMPORT_COMPLETED,
  EVENT_TYPES.IMPORT_FAILED,
  EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED,
  EVENT_TYPES.PASSWORD_RESET_COMPLETED,
  EVENT_TYPES.PASSWORD_RESET_FAILED
]);

const CLIENT_CONFIRM_EVENTS = new Set([
  EVENT_TYPES.EXPENSE_CREATED,
  EVENT_TYPES.REVENUE_CREATED
]);

const COMPANY_CLIENT_EVENTS = new Set([
  EVENT_TYPES.REQUEST_CREATED,
  EVENT_TYPES.REQUEST_MESSAGE_CREATED
]);

const PAYLOAD_KEYS = new Set([
  'amount_cents','description','payment_method','receipt_method','method','original_name',
  'status','note','title','imported_rows','total_rows','process_id','occurrence_id','step_id',
  'responsible_user_id','next_responsible_user_id','step_name','process_name','source',
  'user_name','user_email','target_user_id','reference_type','message_id','preview','note'
]);

function moneyLabel(cents){
  const n=Number(cents||0)/100;
  return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}

function sanitizePayload(raw){
  const out={};
  if(!raw||typeof raw!=='object')return out;
  for(const k of PAYLOAD_KEYS){
    if(raw[k]===undefined||raw[k]===null)continue;
    const v=raw[k];
    if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')out[k]=v;
  }
  return out;
}

function copyFor(eventType, companyName, payload, audience){
  const name=companyName||'Empresa';
  const amount=payload.amount_cents!=null?moneyLabel(payload.amount_cents):null;
  const method=payload.payment_method||payload.receipt_method||payload.method||null;
  const ctx=[amount,method].filter(Boolean).join(' · ');
  const file=payload.original_name||null;
  if(audience==='client_actor'){
    if(eventType==='EXPENSE_CREATED')return{title:'Despesa registrada com sucesso.',message:`Despesa de ${amount||'valor informado'} enviada à contabilidade.`,context:payload.description||''};
    if(eventType==='REVENUE_CREATED')return{title:'Receita registrada com sucesso.',message:`Receita de ${amount||'valor informado'} enviada à contabilidade.`,context:payload.description||''};
  }
  switch(eventType){
    case 'EXPENSE_CREATED':return{title:'Nova despesa recebida',message:`${name} enviou uma nova despesa`,context:ctx||payload.description||''};
    case 'REVENUE_CREATED':return{title:'Nova receita recebida',message:`${name} enviou uma nova receita`,context:ctx||payload.description||''};
    case 'DOCUMENT_UPLOADED':
      if(audience==='company_client'){
        return{title:'Novo documento',message:'O escritório enviou um documento para você.',context:file||''};
      }
      return{title:'Novo documento recebido',message:`${name} enviou um documento`,context:file||''};
    case 'CLASSIFICATION_REQUIRED':return{title:'Classificação pendente',message:`${name} possui uma movimentação aguardando classificação`,context:ctx||payload.description||''};
    case 'CLASSIFICATION_COMPLETED':return{title:'Classificação concluída',message:`Uma movimentação de ${name} foi classificada`,context:payload.description||''};
    case 'ENTRY_CREATED':return{title:'Lançamento gerado',message:`Novo lançamento de ${name}`,context:payload.description||''};
    case 'APPROVAL_REQUIRED':return{title:'Aprovação pendente',message:'Novo lançamento aguardando aprovação.',context:payload.description||payload.note||''};
    case 'ENTRY_APPROVED':return{title:'Classificação aprovada',message:`Uma classificação de ${name} foi aprovada`,context:payload.description||''};
    case 'ENTRY_POSTED':return{title:'Lançamento efetivado',message:`Um lançamento de ${name} foi gerado após a aprovação`,context:payload.description||''};
    case 'ENTRY_REJECTED':return{title:'Lançamento rejeitado',message:`Um lançamento de ${name} foi rejeitado`,context:payload.note||payload.description||''};
    case 'REQUEST_CREATED':return{title:'Nova solicitação do escritório',message:'O escritório enviou uma solicitação',context:payload.title||payload.description||''};
    case 'REQUEST_UPDATED':return{title:'Resposta de solicitação recebida',message:`${name} respondeu uma solicitação`,context:payload.title||''};
    case 'REQUEST_MESSAGE_CREATED':return{title:'Nova mensagem',message:`Nova mensagem em ${payload.title||'solicitação'}`,context:payload.preview||payload.title||''};
    case 'REQUEST_STATUS_CHANGED':return{title:'Situação da solicitação',message:`Solicitação atualizada para ${payload.status||''}`,context:payload.title||''};
    case 'PENDENCY_RESPONSE':return{title:'Resposta de pendência recebida',message:`${name} respondeu uma pendência`,context:payload.description||''};
    case 'COMPANY_CREATED':return{title:'Nova empresa na carteira',message:`${payload.title||name} foi cadastrada no escritório`,context:payload.status||''};
    case 'IMPORT_CREATED':return{title:'Importação iniciada',message:`Importação registrada para ${name}`,context:payload.description||''};
    case 'IMPORT_COMPLETED':return{title:'Importação concluída',message:`Importação de ${name} foi concluída`,context:payload.description||''};
    case 'IMPORT_FAILED':return{title:'Importação com erro',message:`A importação de ${name} falhou`,context:payload.note||payload.description||''};
    case 'CLIENT_PASSWORD_RESET_REQUESTED':{
      const who=payload.user_name||name;
      return{
        title:'Solicitação de redefinição de acesso',
        message:`${who} solicitou a redefinição de acesso ao Portal do Cliente.`,
        context:[name,payload.user_email].filter(Boolean).join(' · ')
      };
    }
    case 'PASSWORD_RESET_COMPLETED':{
      const who=payload.user_name||name;
      return{
        title:'Senha redefinida com sucesso',
        message:`${who} concluiu a redefinição de senha no Portal do Cliente.`,
        context:[name,payload.user_email].filter(Boolean).join(' · ')
      };
    }
    case 'PASSWORD_RESET_FAILED':{
      const who=payload.user_name||name;
      return{
        title:'Falha na redefinição de senha',
        message:`Não foi possível concluir a redefinição de senha de ${who}.`,
        context:[name,payload.user_email,payload.note].filter(Boolean).join(' · ')
      };
    }
    default:return{title:'Atualização',message:name,context:''};
  }
}

function createEventBus({db,id,one,qRows,exec,realtime,notificationService}){
  function prefOn(userId,eventType){
    const row=one('SELECT in_app_enabled FROM notification_preferences WHERE user_id=? AND event_type=?',userId,eventType);
    if(!row)return true;
    return Number(row.in_app_enabled)===1;
  }

  function officeRecipients(tenantId,actorUserId,eventType){
    if(
      eventType===EVENT_TYPES.CLIENT_PASSWORD_RESET_REQUESTED ||
      eventType===EVENT_TYPES.PASSWORD_RESET_COMPLETED ||
      eventType===EVENT_TYPES.PASSWORD_RESET_FAILED
    ){
      return qRows("SELECT id FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT') AND active=1",tenantId).map(u=>u.id);
    }
    return qRows("SELECT id FROM users WHERE tenant_id=? AND role IN('OWNER','ACCOUNTANT','STAFF') AND active=1",tenantId).map(u=>u.id);
  }

  function companyClients(tenantId,companyId){
    return qRows("SELECT id FROM users WHERE tenant_id=? AND company_id=? AND role='CLIENT' AND active=1",tenantId,companyId).map(u=>u.id);
  }

  function insertNotification({tenantId,companyId,eventId,eventType,recipientId,entityType,entityId,title,message,context}){
    const nid=id();
    exec('INSERT OR IGNORE INTO notifications(id,tenant_id,user_id,type,title,message,event_id,company_id,recipient_user_id,entity_type,entity_id,context) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      nid,tenantId,recipientId,eventType,title,message,eventId,companyId||null,recipientId,entityType,entityId,context||null);
    if(realtime&&typeof realtime.publish==='function'){
      try{
        realtime.publish(recipientId,'notification',{
          id:nid,
          type:eventType,
          title,
          message,
          context:context||null,
          company_id:companyId||null,
          entity_type:entityType||null,
          entity_id:entityId||null,
          event_id:eventId||null,
          created_at:new Date().toISOString()
        });
      }catch{/* realtime best-effort */}
    }
    return nid;
  }

  function fanOut(event,companyName,payload){
    const recipients=new Map();
    const add=(uid,audience)=>{
      if(!uid||recipients.has(uid))return;
      if(uid===event.actor_user_id&&event.event_type===EVENT_TYPES.REQUEST_MESSAGE_CREATED)return;
      if(!prefOn(uid,event.event_type))return;
      recipients.set(uid,audience);
    };
    if(event.event_type===EVENT_TYPES.REQUEST_MESSAGE_CREATED){
      const actor=event.actor_user_id?one('SELECT id,role FROM users WHERE id=? AND tenant_id=?',event.actor_user_id,event.tenant_id):null;
      // Cliente → escritório já notifica via REQUEST_UPDATED (compat). Aqui só escritório → cliente.
      if(actor&&actor.role!=='CLIENT'&&event.company_id){
        for(const uid of companyClients(event.tenant_id,event.company_id))add(uid,'company_client');
      }
    }else if(event.event_type===EVENT_TYPES.DOCUMENT_UPLOADED){
      const actor=event.actor_user_id?one('SELECT id,role FROM users WHERE id=? AND tenant_id=?',event.actor_user_id,event.tenant_id):null;
      if(actor&&actor.role==='CLIENT'){
        // Cliente enviou → notificar escritório
        for(const uid of officeRecipients(event.tenant_id,event.actor_user_id,event.event_type))add(uid,'office');
      }else if(event.company_id){
        // Escritório enviou → notificar CLIENTES da empresa
        for(const uid of companyClients(event.tenant_id,event.company_id))add(uid,'company_client');
      }
    }else{
      if(OFFICE_EVENTS.has(event.event_type)){
        for(const uid of officeRecipients(event.tenant_id,event.actor_user_id,event.event_type))add(uid,'office');
      }
      if(CLIENT_CONFIRM_EVENTS.has(event.event_type)&&event.actor_user_id){
        const actor=one('SELECT id,role,active FROM users WHERE id=? AND tenant_id=?',event.actor_user_id,event.tenant_id);
        if(actor&&actor.role==='CLIENT'&&Number(actor.active)===1)add(actor.id,'client_actor');
      }
      if(COMPANY_CLIENT_EVENTS.has(event.event_type)&&event.company_id){
        for(const uid of companyClients(event.tenant_id,event.company_id))add(uid,'company_client');
      }
    }
    const insertMany=db.transaction(list=>{
      for(const [uid,audience] of list){
        const copy=copyFor(event.event_type,companyName,payload,audience);
        insertNotification({
          tenantId:event.tenant_id,
          companyId:event.company_id,
          eventId:event.id,
          eventType:event.event_type,
          recipientId:uid,
          entityType:event.entity_type,
          entityId:event.entity_id,
          title:copy.title,
          message:copy.message,
          context:copy.context
        });
      }
    });
    insertMany([...recipients.entries()]);
  }

  function emitEvent(input){
    const tenantId=input.tenantId;
    const eventType=input.eventType;
    if(!tenantId||!Object.values(EVENT_TYPES).includes(eventType))return null;
    const entityType=String(input.entityType||'');
    const entityId=String(input.entityId||'');
    if(!entityType||!entityId)return null;
    const payload=sanitizePayload(input.payload);
    const eventId=id();
    const companyId=input.companyId||null;
    const actorUserId=input.actorUserId||null;
    try{
      const result=exec(
        'INSERT INTO domain_events(id,tenant_id,company_id,event_type,actor_user_id,entity_type,entity_id,payload_json,status,processed_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
        eventId,tenantId,companyId,eventType,actorUserId,entityType,entityId,JSON.stringify(payload),'PROCESSED'
      );
      if(!result.changes)return one('SELECT * FROM domain_events WHERE tenant_id=? AND event_type=? AND entity_type=? AND entity_id=?',tenantId,eventType,entityType,entityId);
    }catch(err){
      if(String(err.message||'').includes('UNIQUE')){
        return one('SELECT * FROM domain_events WHERE tenant_id=? AND event_type=? AND entity_type=? AND entity_id=?',tenantId,eventType,entityType,entityId);
      }
      throw err;
    }
    const event=one('SELECT * FROM domain_events WHERE id=?',eventId);
    const company=companyId?one('SELECT name,trade_name FROM companies WHERE id=? AND tenant_id=?',companyId,tenantId):null;
    const companyName=company?(company.trade_name||company.name):null;
    try{
      fanOut(event,companyName,payload);
    }catch(err){
      console.error('notification_handler_failed',{event_type:eventType,tenant_id:tenantId,company_id:companyId,entity_type:entityType,entity_id:entityId});
    }
    // Motor central: Web Push como canal (não origem). Falha não cancela o evento.
    if(notificationService&&typeof notificationService.deliverPushForDomainEvent==='function'){
      setImmediate(()=>{
        try{
          Promise.resolve(notificationService.deliverPushForDomainEvent(event,companyName,payload))
            .catch(err=>console.error('notification_push_domain_failed',err&&err.message));
        }catch(err){
          console.error('notification_push_domain_failed',err&&err.message);
        }
      });
    }
    return event;
  }

  return {emitEvent,EVENT_TYPES,UNIQUE_ONCE};
}

module.exports={createEventBus,EVENT_TYPES,UNIQUE_ONCE};
