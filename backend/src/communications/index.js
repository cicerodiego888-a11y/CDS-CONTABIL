'use strict';

const {createCommunicationService}=require('./communication-service');
const {createEmailResolver,createCdsEmailProvider,createSmtpEmailProvider}=require('./email/email-service');
const {COMMUNICATION_EVENTS,eventLabel}=require('./communication-events');
const {createWhatsAppService}=require('./whatsapp/whatsapp-service');

module.exports={
  createCommunicationService,
  createEmailResolver,
  createCdsEmailProvider,
  createSmtpEmailProvider,
  createWhatsAppService,
  COMMUNICATION_EVENTS,
  eventLabel
};
