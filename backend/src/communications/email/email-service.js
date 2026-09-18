'use strict';

const {createCdsEmailProvider}=require('./cds-email-provider');
const {createSmtpEmailProvider}=require('./smtp-email-provider');
const {createEmailResolver}=require('./resolver');
const templates=require('./templates');

module.exports={createCdsEmailProvider,createSmtpEmailProvider,createEmailResolver,templates};
