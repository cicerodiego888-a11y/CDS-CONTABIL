'use strict';

function createWhatsAppService(engine){
  return {
    enqueueForEvent:(event)=>engine.enqueueForEvent(event),
    processDueJobs:(n,w)=>engine.processDueJobs(n,w),
    publicConfig:(tenantId)=>engine.publicConfig(tenantId)
  };
}

module.exports={createWhatsAppService};
