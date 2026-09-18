'use strict';

const CODES=Object.freeze({
  NOT_CONFIGURED:'EMAIL_NOT_CONFIGURED',
  AUTH_FAILED:'EMAIL_AUTH_FAILED',
  SEND_FAILED:'EMAIL_SEND_FAILED',
  VERIFY_FAILED:'EMAIL_VERIFY_FAILED',
  PERMANENT:'EMAIL_PERMANENT',
  TEMPORARY:'EMAIL_TEMPORARY'
});

function isPermanent(code,retryable){
  if(retryable===false)return true;
  return ['EMAIL_NOT_CONFIGURED','EMAIL_AUTH_FAILED','INVALID_EMAIL','PROVIDER_OFF','NOT_CONFIGURED'].includes(String(code||''));
}

function stripSecrets(value,secrets){
  let s=String(value||'');
  for(const secret of secrets||[]){
    if(secret)s=s.split(secret).join('***');
  }
  return s.replace(/Bearer\s+\S+/gi,'Bearer ***').replace(/[a-f0-9]{32,}/gi,'[redacted]');
}

module.exports={CODES,isPermanent,stripSecrets};
