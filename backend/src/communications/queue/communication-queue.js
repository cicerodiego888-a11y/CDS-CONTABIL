'use strict';

const {isPermanent,stripSecrets}=require('../communication-errors');

function isoNow(){return new Date().toISOString()}
function isoPlus(ms){return new Date(Date.now()+ms).toISOString()}

function createCommunicationQueue(deps){
  const {id,one,qRows,exec,auditSystem,backoffMs}=deps;
  const maxAttempts=Math.max(1,Number(process.env.CDS_EMAIL_MAX_ATTEMPTS||3)||3);
  function backoff(attempt){
    if(typeof backoffMs==='function')return backoffMs(attempt);
    return [15000,60000,180000][Math.min(Math.max(attempt,1)-1,2)];
  }

  function insertEmailJob(row){
    const jobId=row.id||id();
    try{
      exec('INSERT INTO communication_jobs(id,tenant_id,company_id,event_id,notification_id,recipient_user_id,channel,destination,template_key,payload_json,status,attempts,max_attempts,next_attempt_at,last_error,provider,event_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        jobId,row.tenant_id,row.company_id||null,row.event_id||null,row.notification_id||null,row.recipient_user_id,'EMAIL',row.destination||null,row.template_key||null,JSON.stringify(row.payload||{}),row.status||'PENDING',row.attempts||0,row.max_attempts||maxAttempts,row.next_attempt_at||isoNow(),row.last_error||null,row.provider||null,row.event_type||null);
      if(auditSystem)auditSystem(row.tenant_id,row.actor_user_id||null,'COMMUNICATION_CREATED','COMMUNICATION',jobId,{channel:'EMAIL',event_type:row.event_type||null,provider:row.provider||null,status:row.status||'PENDING'});
      return jobId;
    }catch(err){
      if(String(err.message||'').includes('UNIQUE'))return null;
      throw err;
    }
  }

  function mark(job,patch){
    exec("UPDATE communication_jobs SET status=?,attempts=?,last_error=?,provider=?,provider_message_id=?,next_attempt_at=?,sent_at=?,failed_at=?,locked_at=NULL,locked_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?",
      patch.status,patch.attempts,patch.last_error||null,patch.provider||job.provider||null,patch.provider_message_id||null,patch.next_attempt_at||isoNow(),patch.sent_at||null,patch.failed_at||null,job.id,job.tenant_id);
    return one('SELECT * FROM communication_jobs WHERE id=? AND tenant_id=?',job.id,job.tenant_id);
  }

  function applyResult(job,result,attempts){
    const provider=result&&result.provider||job.provider;
    if(result&&result.accepted){
      const updated=mark(job,{status:'ACCEPTED',attempts,last_error:null,provider,provider_message_id:result.provider_message_id,sent_at:isoNow()});
      if(auditSystem)auditSystem(job.tenant_id,job.recipient_user_id,'COMMUNICATION_ACCEPTED','COMMUNICATION',job.id,{channel:'EMAIL',provider,status:'ACCEPTED'});
      return updated;
    }
    const code=result&&result.code||'EMAIL_SEND_FAILED';
    const permanent=isPermanent(code,result&&result.retryable);
    if(permanent||attempts>=Number(job.max_attempts||maxAttempts)){
      const updated=mark(job,{status:'FAILED',attempts,last_error:code,provider,failed_at:isoNow()});
      if(auditSystem)auditSystem(job.tenant_id,job.recipient_user_id,'COMMUNICATION_FAILED','COMMUNICATION',job.id,{channel:'EMAIL',provider,status:'FAILED',code});
      return updated;
    }
    return mark(job,{status:'PENDING',attempts,last_error:code,provider,next_attempt_at:isoPlus(backoff(attempts))});
  }

  function listRecent(tenantId,limit){
    return qRows("SELECT j.id,j.created_at,j.channel,j.event_type,j.template_key,j.destination,j.provider,j.status,j.attempts,u.email recipient_email FROM communication_jobs j LEFT JOIN users u ON u.id=j.recipient_user_id WHERE j.tenant_id=? AND j.channel='EMAIL' ORDER BY j.created_at DESC LIMIT ?",tenantId,Math.min(50,Math.max(1,limit||15)));
  }

  function sanitizeJobError(err,secrets){
    return stripSecrets(err&&err.message||err,secrets).slice(0,180);
  }

  return {insertEmailJob,applyResult,mark,listRecent,sanitizeJobError,maxAttempts};
}

module.exports={createCommunicationQueue};
