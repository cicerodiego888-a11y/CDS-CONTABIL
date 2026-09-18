'use strict';

const SUBJECT='Ative seu acesso ao CDS Contábil';

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function invitationEmail({name,company,url}){
  const who=String(name||'olá').trim()||'olá';
  const empresa=String(company||'sua empresa').trim()||'sua empresa';
  const link=String(url||'').trim();
  const text=[
    'Olá, '+who+'.',
    '',
    'A empresa '+empresa+' criou um acesso para você no CDS Contábil.',
    '',
    'Ative seu acesso:',
    link,
    '',
    'Ao abrir o link, crie a sua senha. Nenhuma senha é enviada por e-mail.',
    '',
    'Se você não esperava este convite, ignore esta mensagem.'
  ].join('\n');
  const html=`<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f6f5;font-family:Inter,Segoe UI,Arial,sans-serif;color:#14242c">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3ebe8;border-radius:16px;padding:32px 28px">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6d73;font-weight:700">CDS Contábil</p>
    <h1 style="margin:0 0 16px;font-size:22px">Ative seu acesso</h1>
    <p style="margin:0 0 12px;line-height:1.5">Olá, ${escapeHtml(who)}.</p>
    <p style="margin:0 0 20px;line-height:1.5">A empresa <strong>${escapeHtml(empresa)}</strong> criou um acesso para você no CDS Contábil.</p>
    <p style="margin:0 0 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f5f59;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:650">Ativar meu acesso</a></p>
    <p style="margin:0;font-size:13px;color:#5b6d73;line-height:1.5">Ao clicar, você criará a própria senha. Nenhuma senha é enviada por e-mail.</p>
  </div>
</body></html>`;
  return {subject:SUBJECT,text,html};
}

function testEmail({to}){
  const dest=String(to||'').trim();
  const text=['Este é um e-mail de teste do CDS Contábil.','','Se você recebeu esta mensagem, o servidor SMTP está funcionando.',dest?('Destinatário: '+dest):''].filter(Boolean).join('\n');
  const html=`<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f6f5;font-family:Inter,Segoe UI,Arial,sans-serif;color:#14242c">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3ebe8;border-radius:16px;padding:32px 28px">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6d73;font-weight:700">CDS Contábil</p>
    <h1 style="margin:0 0 16px;font-size:22px">E-mail de teste</h1>
    <p style="margin:0;line-height:1.5">Se você recebeu esta mensagem, o servidor SMTP está funcionando.</p>
  </div>
</body></html>`;
  return {subject:'E-mail de teste — CDS Contábil',text,html};
}

module.exports={SUBJECT,invitationEmail,testEmail,escapeHtml};
