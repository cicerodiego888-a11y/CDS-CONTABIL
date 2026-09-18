'use strict';

function asString(value){
  if(value===undefined||value===null)return null;
  const s=String(value).trim();
  return s?s:null;
}

function stripCnpj(value){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function normalizeCnpjKey(value){
  const key=stripCnpj(value);
  return key||null;
}

function isPlausibleCnpj(value){
  const key=normalizeCnpjKey(value);
  return !!(key&&key.length===14);
}

function formatCnpjDisplay(value){
  const key=normalizeCnpjKey(value);
  if(!key)return '';
  if(key.length===14)return key.slice(0,2)+'.'+key.slice(2,5)+'.'+key.slice(5,8)+'/'+key.slice(8,12)+'-'+key.slice(12);
  return key;
}

function normalizeCep(value){
  const digits=String(value??'').replace(/\D/g,'');
  if(!digits)return null;
  return digits.padStart(8,'0').slice(-8);
}

function formatCepDisplay(value){
  const d=normalizeCep(value);
  if(!d)return null;
  return d.slice(0,5)+'-'+d.slice(5);
}

function normalizeUf(value){
  const s=asString(value);
  if(!s)return null;
  const uf=s.replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,2);
  return uf.length===2?uf:null;
}

function normalizePhone(value){
  const digits=String(value??'').replace(/\D/g,'');
  return digits||null;
}

function normalizeDate(value){
  const s=asString(value);
  if(!s)return null;
  const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso)return iso[1]+'-'+iso[2]+'-'+iso[3];
  const br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(br)return br[3]+'-'+br[2]+'-'+br[1];
  return s;
}

function normalizeSituacao(value){
  const s=asString(value);
  if(!s)return null;
  return s.replace(/\s+/g,' ').trim().toUpperCase();
}

function cnaeLabel(code,desc){
  const c=asString(code);
  const d=asString(desc);
  if(c&&d)return c+' — '+d;
  return c||d||null;
}

function emptyCadastro(cnpj){
  return {
    cnpj:cnpj||null,
    razao_social:null,
    nome_fantasia:null,
    situacao_cadastral:null,
    data_abertura:null,
    natureza_juridica:null,
    cnae_principal:null,
    cnaes_secundarios:null,
    logradouro:null,
    numero:null,
    complemento:null,
    bairro:null,
    cep:null,
    municipio:null,
    uf:null,
    telefone:null,
    email:null,
    porte:null,
    capital_social:null,
    simples_nacional:null,
    mei:null
  };
}

function mapBrasilApi(raw,cnpjKey){
  const src=raw&&typeof raw==='object'?raw:{};
  const secundarios=Array.isArray(src.cnaes_secundarios)
    ?src.cnaes_secundarios.map(x=>cnaeLabel(x.codigo||x.code,x.descricao||x.description)).filter(Boolean)
    :null;
  const cadastro=emptyCadastro(formatCnpjDisplay(src.cnpj||cnpjKey));
  cadastro.razao_social=asString(src.razao_social||src.nome);
  cadastro.nome_fantasia=asString(src.nome_fantasia||src.fantasia);
  cadastro.situacao_cadastral=normalizeSituacao(src.descricao_situacao_cadastral||src.situacao_cadastral||src.descricao_situacao);
  cadastro.data_abertura=normalizeDate(src.data_inicio_atividade||src.data_abertura);
  cadastro.natureza_juridica=asString(src.natureza_juridica||src.codigo_natureza_juridica);
  cadastro.cnae_principal=cnaeLabel(src.cnae_fiscal||src.cnae,src.cnae_fiscal_descricao);
  cadastro.cnaes_secundarios=secundarios&&secundarios.length?secundarios:null;
  cadastro.logradouro=asString([src.descricao_tipo_de_logradouro,src.logradouro].filter(Boolean).join(' ')||src.logradouro);
  cadastro.numero=asString(src.numero);
  cadastro.complemento=asString(src.complemento);
  cadastro.bairro=asString(src.bairro);
  cadastro.cep=formatCepDisplay(src.cep);
  cadastro.municipio=asString(src.municipio||src.cidade);
  cadastro.uf=normalizeUf(src.uf||src.estado);
  cadastro.telefone=normalizePhone(src.ddd_telefone_1||src.telefone);
  cadastro.email=asString(src.email)?String(src.email).trim().toLowerCase():null;
  cadastro.porte=asString(src.porte||src.descricao_porte);
  cadastro.capital_social=src.capital_social===undefined||src.capital_social===null?null:String(src.capital_social);
  cadastro.simples_nacional=typeof src.opcao_pelo_simples==='boolean'?src.opcao_pelo_simples:null;
  cadastro.mei=typeof src.opcao_pelo_mei==='boolean'?src.opcao_pelo_mei:null;
  return cadastro;
}

function toCompanyFields(cadastro){
  const c=cadastro||emptyCadastro(null);
  return {
    name:c.razao_social||null,
    trade_name:c.nome_fantasia||null,
    cnpj:normalizeCnpjKey(c.cnpj),
    email:c.email||null,
    phone:c.telefone||null,
    address:c.logradouro||null,
    address_number:c.numero||null,
    complement:c.complemento||null,
    neighborhood:c.bairro||null,
    city:c.municipio||null,
    state:c.uf||null,
    zip:c.cep?normalizeCep(c.cep):null,
    cadastral_status:c.situacao_cadastral||null,
    opened_on:c.data_abertura||null,
    legal_nature:c.natureza_juridica||null,
    main_cnae:c.cnae_principal||null,
    company_size:c.porte||null,
    share_capital:c.capital_social||null,
    simples_nacional:c.simples_nacional,
    mei:c.mei
  };
}

function inactiveCadastral(status){
  const s=normalizeSituacao(status);
  if(!s)return false;
  return /BAIXADA|INAPTA|SUSPENSA|NULA/.test(s);
}

module.exports={
  asString,
  stripCnpj,
  normalizeCnpjKey,
  isPlausibleCnpj,
  formatCnpjDisplay,
  normalizeCep,
  formatCepDisplay,
  normalizeUf,
  normalizePhone,
  normalizeDate,
  normalizeSituacao,
  cnaeLabel,
  emptyCadastro,
  mapBrasilApi,
  toCompanyFields,
  inactiveCadastral
};
