'use strict';

const {createEmailProvider}=require('../../email/provider');
const {normalizeResult}=require('../communication-provider');

function createSmtpEmailProvider(options){
  const inner=typeof options.send==='function'||typeof options.sendInvitation==='function'?options:createEmailProvider(options||{});
  const name=inner.name||'smtp';

  async function send(message){
    if(typeof inner.send==='function'){
      const r=await inner.send(message);
      if(r&&typeof r==='object'&&(r.status||r.accepted!==undefined||r.code))return normalizeResult(r,name);
      return {accepted:true,provider:name,status:'accepted',code:'EMAIL_ACCEPTED'};
    }
    throw new Error('SMTP send indisponível');
  }

  async function verify(){
    if(typeof inner.verify==='function')return inner.verify();
    return {ok:!!(inner.configured&&inner.configured()),status:inner.configured&&inner.configured()?'ok':'not_configured'};
  }

  function getStatus(){
    const ok=inner.configured?inner.configured():false;
    return {provider:name,status:ok?'AVAILABLE':'NOT_CONFIGURED',available:ok,configured:ok};
  }

  return {
    name,
    send,
    verify,
    getStatus,
    configured:()=>inner.configured?inner.configured():false,
    diagnose:inner.diagnose,
    sendTest:inner.sendTest,
    sendInvitation:inner.sendInvitation?inner.sendInvitation.bind(inner):undefined
  };
}

module.exports={createSmtpEmailProvider};
