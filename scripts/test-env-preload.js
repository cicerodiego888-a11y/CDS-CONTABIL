'use strict';
// Pré-carga dos testes: desliga workers/pipeline automático que competem com suites legadas.
if (process.env.CDS_DOCUMENT_PIPELINE == null) process.env.CDS_DOCUMENT_PIPELINE = 'off';
if (process.env.CDS_COMMS_WORKER == null) process.env.CDS_COMMS_WORKER = 'off';
if (process.env.CDS_PROCESS_SCHEDULER == null) process.env.CDS_PROCESS_SCHEDULER = 'off';

// Isola SMTP/CDS do .env do desenvolvedor — suites controlam o provider via setEmailProvider / env próprio.
process.env.CDS_EMAIL_PROVIDER = 'off';
process.env.CDS_EMAIL_HOST = '';
process.env.CDS_EMAIL_USER = '';
process.env.CDS_EMAIL_PASSWORD = '';
process.env.CDS_EMAIL_FROM = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';
process.env.SMTP_FROM = '';
process.env.CDS_EMAIL_API_URL = '';
process.env.CDS_EMAIL_API_KEY = '';
