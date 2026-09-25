'use strict';

const {invitationEmail,testEmail,escapeHtml}=require('../../../email/template');

function brandHeader(branding){
  const office=escapeHtml((branding&&(branding.office_name||branding.name))||'CDS Contábil');
  return office;
}

function wrapHtml(inner,branding){
  const office=brandHeader(branding);
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f6f5;font-family:Inter,Segoe UI,Arial,sans-serif;color:#14242c">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3ebe8;border-radius:16px;padding:32px 28px">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6d73;font-weight:700">${office}</p>
    ${inner}
  </div>
</body></html>`;
}

function userInvite(vars){
  return invitationEmail({name:vars.name,company:vars.company,url:vars.url,cta:vars.cta});
}

function passwordReset(vars){
  const who=String(vars.name||'olá').trim()||'olá';
  const link=String(vars.url||'').trim();
  const text=[
    'Olá, '+who+'.',
    '',
    'Recebemos uma solicitação de redefinição do seu acesso',
    'ao CDS Contábil Connect.',
    '',
    'Clique no link abaixo para criar uma nova senha.',
    '',
    link,
    '',
    'Este link é individual, possui validade limitada e pode ser',
    'utilizado uma única vez.',
    '',
    'Se você não solicitou esta redefinição, ignore este e-mail',
    'ou fale com seu escritório contábil.',
    '',
    'CDS Contábil Connect'
  ].join('\n');
  const html=wrapHtml(
    `<h1 style="margin:0 0 16px;font-size:22px">Redefinição de acesso</h1>
    <p style="margin:0 0 12px;line-height:1.5">Olá, ${escapeHtml(who)}.</p>
    <p style="margin:0 0 20px;line-height:1.5">Recebemos uma solicitação de redefinição do seu acesso ao CDS Contábil Connect.</p>
    <p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f5f59;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:650" target="_blank" rel="noopener noreferrer">Criar nova senha</a></p>
    <p style="margin:0 0 20px;font-size:13px;line-height:1.5;word-break:break-all">Se o botão não abrir, use este link:<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></p>
    <p style="margin:0 0 12px;font-size:13px;color:#5b6d73;line-height:1.5">Este link é individual, possui validade limitada e pode ser utilizado uma única vez.</p>
    <p style="margin:0;font-size:13px;color:#5b6d73;line-height:1.5">Se você não solicitou esta redefinição, ignore este e-mail ou fale com seu escritório contábil.</p>
    <p style="margin:16px 0 0;font-size:13px;color:#5b6d73">CDS Contábil Connect</p>`,
    vars.branding
  );
  return {subject:'Redefinição de acesso — CDS Contábil Connect',text,html};
}

function documentReceived(vars){
  const office=brandHeader(vars.branding);
  const company=String(vars.company||'Uma empresa');
  const text=company+' enviou um novo documento.';
  const html=wrapHtml(`<h1 style="margin:0 0 16px;font-size:22px">Novo documento</h1><p>${escapeHtml(text)}</p>`,vars.branding);
  return {subject:office+' — Novo documento',text,html};
}

function expenseReceived(vars){
  const office=brandHeader(vars.branding);
  const company=String(vars.company||'Uma empresa');
  const text=company+' enviou uma nova despesa.';
  const html=wrapHtml(`<h1 style="margin:0 0 16px;font-size:22px">Nova despesa</h1><p>${escapeHtml(text)}</p>`,vars.branding);
  return {subject:office+' — Nova despesa',text,html};
}

function genericNotification(vars){
  const office=brandHeader(vars.branding);
  const title=String(vars.title||'Atualização');
  const body=String(vars.text||vars.message||'Há uma atualização no CDS Contábil.');
  const html=wrapHtml(`<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>`,vars.branding);
  return {subject:office+' — '+title,text:body,html};
}

function render(templateKey,vars){
  const key=String(templateKey||'generic-notification');
  if(key==='user-invite'||key==='USER_INVITE'||key==='USER_INVITE_RESEND')return userInvite(vars||{});
  if(key==='password-reset'||key==='PASSWORD_RESET')return passwordReset(vars||{});
  if(key==='office-signup'||key==='OFFICE_SIGNUP')return officeSignup(vars||{});
  if(key==='document-received'||key==='DOCUMENT_UPLOADED')return documentReceived(vars||{});
  if(key==='expense-received'||key==='EXPENSE_CREATED')return expenseReceived(vars||{});
  if(key==='EMAIL_TEST'||key==='email-test')return testEmail({to:(vars&&vars.to)||''});
  return genericNotification(vars||{});
}

function officeSignup(vars){
  const who=String(vars.name||'olá').trim()||'olá';
  const office=String(vars.office_name||'seu escritório').trim();
  const link=String(vars.url||'').trim();
  const text=[
    'Olá, '+who+'.',
    '',
    'Recebemos o cadastro do escritório '+office+' no CDS Contábil Connect.',
    '',
    'Clique no link abaixo para confirmar o e-mail e ativar sua conta.',
    '',
    link,
    '',
    'Este link é individual, possui validade limitada e pode ser utilizado uma única vez.',
    '',
    'Se você não solicitou este cadastro, ignore este e-mail.',
    '',
    'CDS Contábil Connect'
  ].join('\n');
  const html=wrapHtml(
    `<h1 style="margin:0 0 16px;font-size:22px">Confirme seu e-mail</h1>
    <p style="margin:0 0 12px;line-height:1.5">Olá, ${escapeHtml(who)}.</p>
    <p style="margin:0 0 20px;line-height:1.5">Recebemos o cadastro do escritório <b>${escapeHtml(office)}</b> no CDS Contábil Connect.</p>
    <p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f5f59;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:650" target="_blank" rel="noopener noreferrer">Confirmar e-mail e ativar conta</a></p>
    <p style="margin:0 0 20px;font-size:13px;line-height:1.5;word-break:break-all">Se o botão não abrir, use este link:<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></p>
    <p style="margin:0;font-size:13px;color:#5b6d73;line-height:1.5">Este link é individual, possui validade limitada e pode ser utilizado uma única vez.</p>`,
    vars.branding
  );
  return {subject:'Confirme seu cadastro — CDS Contábil Connect',text,html};
}

module.exports={render,userInvite,passwordReset,officeSignup,documentReceived,expenseReceived,genericNotification,testEmail,invitationEmail};
