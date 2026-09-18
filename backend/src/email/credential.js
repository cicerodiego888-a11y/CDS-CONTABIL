'use strict';

const crypto=require('crypto');

function encryptionSecret(){
  return String(process.env.CDS_EMAIL_SECRET||process.env.JWT_SECRET||'').trim();
}

function encryptPassword(plain){
  const secret=encryptionSecret();
  if(!secret)throw Object.assign(new Error('Chave de proteção de e-mail ausente.'),{http:500,code:'EMAIL_SECRET_MISSING'});
  const salt=crypto.randomBytes(16);
  const key=crypto.scryptSync(secret,salt,32);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const enc=Buffer.concat([cipher.update(String(plain||''),'utf8'),cipher.final()]);
  return {
    password_cipher:enc.toString('base64'),
    password_iv:iv.toString('base64'),
    password_tag:cipher.getAuthTag().toString('base64'),
    password_salt:salt.toString('base64')
  };
}

function decryptPassword(row){
  if(!row||!row.password_cipher)return '';
  const secret=encryptionSecret();
  if(!secret)return '';
  try{
    const key=crypto.scryptSync(secret,Buffer.from(row.password_salt,'base64'),32);
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(row.password_iv,'base64'));
    decipher.setAuthTag(Buffer.from(row.password_tag,'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.password_cipher,'base64')),decipher.final()]).toString('utf8');
  }catch{
    return '';
  }
}

function hasStoredCredential(row){
  return !!(row&&row.password_cipher&&row.password_iv&&row.password_tag&&row.password_salt);
}

module.exports={encryptPassword,decryptPassword,hasStoredCredential,encryptionSecret};
