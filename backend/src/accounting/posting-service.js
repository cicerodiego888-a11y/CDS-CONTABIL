'use strict';

const {canApprove,isLocked,assertTransition}=require('./entry-states');

function domainError(message,code,http){
  const e=new Error(message);
  e.code=code;
  e.http=http||409;
  return e;
}

function createPostingService({id,one,exec,qRows,assertPostableAccount}){
  function linesOf(entryId){
    return qRows('SELECT l.*,a.account_code,a.description account_description,a.active,a.account_type,a.is_postable FROM entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=? ORDER BY l.side,l.id',entryId);
  }

  function assertBalanced(lines){
    if(!lines||lines.length<2)throw domainError('Informe ao menos duas linhas.','INVALID_ENTRY',422);
    const debit=lines.filter(l=>l.side==='D').reduce((a,l)=>a+Number(l.amount_cents||0),0);
    const credit=lines.filter(l=>l.side==='C').reduce((a,l)=>a+Number(l.amount_cents||0),0);
    if(debit<=0||credit<=0||debit!==credit)throw domainError('Lançamento desbalanceado.','ENTRY_MUST_BE_BALANCED',422);
    return{debit,credit};
  }

  function validateForPosting(entry,lines){
    if(!entry)throw domainError('Lançamento não encontrado.','NOT_FOUND',404);
    if(isLocked(entry.status))return{idempotent:true};
    if(!canApprove(entry.status)){
      if(entry.status==='NEEDS_CLASSIFICATION')throw domainError('Classifique a movimentação antes de aprovar.','INVALID_TRANSITION',409);
      throw domainError('Esta movimentação não está aguardando aprovação.','INVALID_TRANSITION',409);
    }
    assertTransition('PENDING','POSTED');
    const totals=assertBalanced(lines);
    for(const l of lines)assertPostableAccount(entry.tenant_id,l.account_id);
    return{idempotent:false,...totals,lineCount:lines.length};
  }

  function postFromApproval({entry,userId,generatedByWorkflow}){
    const lines=linesOf(entry.id);
    const check=validateForPosting(entry,lines);
    if(check.idempotent)return{alreadyPosted:true,entryId:entry.id,lines};
    const claimed=exec("UPDATE entries SET status='POSTED',approved_by=?,approved_at=CURRENT_TIMESTAMP,posted_by=?,posted_at=CURRENT_TIMESTAMP,generated_by_workflow=?,rejected_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='PENDING'",userId,userId,generatedByWorkflow?1:0,entry.id,entry.tenant_id);
    if(!claimed.changes){
      const cur=one('SELECT status FROM entries WHERE id=? AND tenant_id=?',entry.id,entry.tenant_id);
      if(cur&&isLocked(cur.status))return{alreadyPosted:true,entryId:entry.id,lines:linesOf(entry.id)};
      throw domainError('Não foi possível efetivar o lançamento.','POSTING_CONFLICT',409);
    }
    exec('INSERT INTO approvals(id,tenant_id,entry_id,action,user_id) VALUES(?,?,?,?,?)',id(),entry.tenant_id,entry.id,'APPROVE',userId);
    exec("UPDATE pendencies SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND entity_type='ENTRY' AND entity_id=? AND status='OPEN'",entry.tenant_id,entry.id);
    return{alreadyPosted:false,entryId:entry.id,lineCount:check.lineCount,debit:check.debit,credit:check.credit,lines,generatedByWorkflow:!!generatedByWorkflow};
  }

  return{linesOf,validateForPosting,postFromApproval,assertBalanced};
}

module.exports={createPostingService};
