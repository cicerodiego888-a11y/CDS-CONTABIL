'use strict';

function normalizeResult(raw,provider){
  const r=raw&&typeof raw==='object'?raw:{};
  const accepted=r.accepted===true||r.status==='accepted'||r.status==='sent'||r.status==='ok'||r.email_sent===true;
  const name=String(r.provider||provider||'off');
  if(accepted){
    return {accepted:true,provider:name,provider_message_id:r.provider_message_id||r.messageId||null,status:'accepted',code:r.code||'EMAIL_ACCEPTED'};
  }
  const status=r.status==='not_configured'||r.code==='EMAIL_NOT_CONFIGURED'?'failed':(r.status||'failed');
  return {
    accepted:false,
    provider:name,
    status:status==='not_configured'?'failed':status,
    code:r.code||'EMAIL_SEND_FAILED',
    message:r.message||null,
    retryable:r.retryable===true
  };
}

module.exports={normalizeResult};
