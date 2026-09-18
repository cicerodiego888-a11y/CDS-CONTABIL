'use strict';

const CODES = Object.freeze({
  PORTAL_CLIENTE: 'PORTAL_CLIENTE',
  PORTAL_ESCRITORIO: 'PORTAL_ESCRITORIO',
  CDS_SISTEMAS: 'CDS_SISTEMAS',
  IMPORTACAO_CONTABIL: 'IMPORTACAO_CONTABIL',
  IMPORTACAO_FISCAL: 'IMPORTACAO_FISCAL',
  OUTRA_ORIGEM_FUTURA: 'OUTRA_ORIGEM_FUTURA'
});

const LABELS = Object.freeze({
  PORTAL_CLIENTE: 'Portal do Cliente',
  PORTAL_ESCRITORIO: 'Portal do Escritório',
  CDS_SISTEMAS: 'CDS Sistemas',
  IMPORTACAO_CONTABIL: 'Importação Contábil',
  IMPORTACAO_FISCAL: 'Importação Fiscal',
  OUTRA_ORIGEM_FUTURA: 'Outra origem'
});

const IMPORT_ORIGINS = new Set([CODES.CDS_SISTEMAS, CODES.IMPORTACAO_CONTABIL, CODES.IMPORTACAO_FISCAL, CODES.OUTRA_ORIGEM_FUTURA]);
const IMPORT_STATUS = Object.freeze({
  PENDENTE: 'PENDENTE',
  PROCESSANDO: 'PROCESSANDO',
  CONCLUIDA: 'CONCLUIDA',
  CONCLUIDA_COM_ERROS: 'CONCLUIDA_COM_ERROS',
  ERRO: 'ERRO'
});

function isValid(code){
  return !!CODES[String(code||'').toUpperCase()];
}

function normalize(code, fallback){
  const raw=String(code||'').trim().toUpperCase();
  return isValid(raw)?raw:(fallback||CODES.PORTAL_CLIENTE);
}

function label(code){
  return LABELS[normalize(code)]||LABELS.PORTAL_CLIENTE;
}

function publicOrigin(code){
  const origin=normalize(code);
  return {origin, origin_label:LABELS[origin]};
}

module.exports={CODES,LABELS,IMPORT_ORIGINS,IMPORT_STATUS,isValid,normalize,label,publicOrigin};
