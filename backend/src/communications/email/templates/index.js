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
  const who=String(vars.name||'olá');
  const link=String(vars.url||'');
  const text=['Olá, '+who+'.','','Redefina sua senha no CDS Contábil:','',link,''].join('\n');
  const html=wrapHtml(`<h1 style="margin:0 0 16px;font-size:22px">Redefinir senha</h1><p>Olá, ${escapeHtml(who)}.</p><p><a href="${escapeHtml(link)}">Criar nova senha</a></p>`,vars.branding);
  return {subject:'Redefinição de senha — CDS Contábil',text,html};
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
  if(key==='document-received'||key==='DOCUMENT_UPLOADED')return documentReceived(vars||{});
  if(key==='expense-received'||key==='EXPENSE_CREATED')return expenseReceived(vars||{});
  if(key==='EMAIL_TEST'||key==='email-test')return testEmail({to:(vars&&vars.to)||''});
  return genericNotification(vars||{});
}

module.exports={render,userInvite,passwordReset,documentReceived,expenseReceived,genericNotification,testEmail,invitationEmail};
