'use strict';

/** PENDING no banco = PENDING_APPROVAL (aguardando aprovação). */
const PENDING_APPROVAL = 'PENDING';

const STATUSES = Object.freeze({
  NEEDS_CLASSIFICATION: 'NEEDS_CLASSIFICATION',
  PENDING_APPROVAL,
  PENDING: PENDING_APPROVAL,
  POSTED: 'POSTED',
  REJECTED: 'REJECTED'
});

const ALLOWED = Object.freeze({
  NEEDS_CLASSIFICATION: [PENDING_APPROVAL],
  PENDING: ['POSTED', 'REJECTED'],
  REJECTED: ['NEEDS_CLASSIFICATION', PENDING_APPROVAL],
  POSTED: []
});

function isPosted(status){
  return status==='POSTED';
}

function isLocked(status){
  return status==='POSTED';
}

function canApprove(status){
  return status===PENDING_APPROVAL;
}

function canReject(status){
  return status===PENDING_APPROVAL;
}

function canReclassify(status){
  return status==='NEEDS_CLASSIFICATION'||status===PENDING_APPROVAL||status==='REJECTED';
}

function canTransition(from,to){
  return (ALLOWED[from]||[]).includes(to);
}

function assertTransition(from,to){
  if(!canTransition(from,to)){
    const err=new Error('Transição de situação contábil não permitida.');
    err.code='INVALID_TRANSITION';
    err.http=409;
    err.from=from;
    err.to=to;
    throw err;
  }
}

module.exports={
  STATUSES,
  PENDING_APPROVAL,
  ALLOWED,
  isPosted,
  isLocked,
  canApprove,
  canReject,
  canReclassify,
  canTransition,
  assertTransition
};
