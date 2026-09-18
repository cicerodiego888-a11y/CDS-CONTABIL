'use strict';

function digitsOnly(value){
  return String(value??'').replace(/\D/g,'');
}

function normalizeWhatsAppPhone(value){
  if(value===undefined||value===null)return null;
  const s=String(value).trim();
  if(!s)return null;
  let d=digitsOnly(s);
  if(!d)return null;
  if(d.startsWith('00'))d=d.slice(2);
  if(d.length===10||d.length===11)d='55'+d;
  if(d.length<12||d.length>15)return null;
  if(!/^\d+$/.test(d))return null;
  return d;
}

function isValidWhatsAppPhone(value){
  const n=normalizeWhatsAppPhone(value);
  return !!(n&&n.length>=12&&n.length<=15);
}

function formatPhoneDisplay(value){
  const n=normalizeWhatsAppPhone(value);
  if(!n)return '';
  if(n.startsWith('55')&&n.length===13)return '+55 ('+n.slice(2,4)+') '+n.slice(4,9)+'-'+n.slice(9);
  if(n.startsWith('55')&&n.length===12)return '+55 ('+n.slice(2,4)+') '+n.slice(4,8)+'-'+n.slice(8);
  return '+'+n;
}

module.exports={digitsOnly,normalizeWhatsAppPhone,isValidWhatsAppPhone,formatPhoneDisplay};
