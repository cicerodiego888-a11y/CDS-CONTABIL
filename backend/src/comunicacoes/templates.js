'use strict';

const EVENT_LABELS={
  EXPENSE_CREATED:'Nova despesa',
  REVENUE_CREATED:'Nova receita',
  DOCUMENT_UPLOADED:'Novo documento',
  CLASSIFICATION_REQUIRED:'Classificação pendente',
  REQUEST_CREATED:'Nova solicitação',
  REQUEST_UPDATED:'Resposta de solicitação',
  ENTRY_APPROVED:'Lançamento aprovado',
  ENTRY_POSTED:'Lançamento efetivado',
  ENTRY_REJECTED:'Lançamento rejeitado',
  PENDENCY_RESPONSE:'Resposta de pendência',
  COMPANY_CREATED:'Nova empresa',
  CLASSIFICATION_COMPLETED:'Classificação concluída',
  ENTRY_CREATED:'Lançamento gerado',
  IMPORT_CREATED:'Importação iniciada',
  IMPORT_COMPLETED:'Importação concluída',
  IMPORT_FAILED:'Importação com erro'
};

const DEFAULT_WHATSAPP_ON=new Set([
  'EXPENSE_CREATED','REVENUE_CREATED','DOCUMENT_UPLOADED','CLASSIFICATION_REQUIRED','REQUEST_UPDATED'
]);

const TEMPLATES={
  EXPENSE_CREATED:'{{company_name}} enviou uma nova despesa.\n{{amount}} · {{payment_method}}',
  REVENUE_CREATED:'{{company_name}} enviou uma nova receita.\n{{amount}} · {{receipt_method}}',
  DOCUMENT_UPLOADED:'{{company_name}} enviou um novo documento.',
  CLASSIFICATION_REQUIRED:'Nova classificação pendente para {{company_name}}.',
  REQUEST_CREATED:'{{company_name}} enviou uma nova solicitação.',
  REQUEST_UPDATED:'{{company_name}} respondeu uma solicitação.',
  ENTRY_APPROVED:'Um lançamento de {{company_name}} foi aprovado.',
  ENTRY_POSTED:'Um lançamento de {{company_name}} foi efetivado após a aprovação.',
  ENTRY_REJECTED:'Um lançamento de {{company_name}} foi rejeitado.',
  PENDENCY_RESPONSE:'{{company_name}} respondeu uma pendência.',
  COMPANY_CREATED:'{{company_name}} foi cadastrada no escritório.',
  CLASSIFICATION_COMPLETED:'Uma movimentação de {{company_name}} foi classificada.',
  ENTRY_CREATED:'Novo lançamento de {{company_name}}.',
  IMPORT_CREATED:'Importação registrada para {{company_name}}.',
  IMPORT_COMPLETED:'Importação de {{company_name}} concluída.',
  IMPORT_FAILED:'A importação de {{company_name}} falhou.'
};

function sanitizeField(value){
  if(value===undefined||value===null)return '';
  return String(value).replace(/[<>`]/g,'').replace(/\s+/g,' ').trim().slice(0,180);
}

function interpolate(template,data){
  const src=String(template||'');
  return src.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_,key)=>sanitizeField(data&&data[key])).replace(/[<>`]/g,'').trim();
}

function renderTemplate(eventType,data){
  const tpl=TEMPLATES[eventType]||'Atualização de {{company_name}}.';
  const text=interpolate(tpl,data||{}).trim();
  return text.slice(0,900);
}

function moneyLabel(cents){
  const n=Number(cents||0)/100;
  if(!Number.isFinite(n))return '';
  return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}

function templateVars(event,companyName,payload){
  const p=payload&&typeof payload==='object'?payload:{};
  return {
    company_name:companyName||'Empresa',
    amount:p.amount_cents!=null?moneyLabel(p.amount_cents):'',
    payment_method:p.payment_method||p.method||'',
    receipt_method:p.receipt_method||p.method||'',
    file_name:'',
    title:p.title||'',
    status:p.status||''
  };
}

module.exports={EVENT_LABELS,DEFAULT_WHATSAPP_ON,TEMPLATES,interpolate,renderTemplate,templateVars,sanitizeField,moneyLabel};
