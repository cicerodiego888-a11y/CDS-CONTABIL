const state={token:(()=>{try{return localStorage.getItem('ccc_client_token')||localStorage.getItem('ccc_token')}catch{return null}})(),user:null,company:null,page:'home',categories:[],banks:[],filters:{},push:{ready:false,reason:null,checked:false,permission:'default'},unread:0,notifications:[],branding:null,brandingLogoSrc:null};
const root=document.querySelector('#portal');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=c=>Number(c||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function ApiError(message,status,code){this.name='ApiError';this.message=message;this.status=status||0;this.code=code||null}ApiError.prototype=Object.create(Error.prototype);
function humanApiError(status,payload,network){if(network)return 'Não foi possível conectar ao servidor.';if(status===401)return payload.message||'Sua sessão expirou. Entre novamente para continuar.';if(status===403)return payload.message||'Você não tem permissão para acessar este recurso.';if(status===404)return payload.message||'Registro não encontrado.';if(status===409)return payload.message||'Não foi possível concluir a operação.';if(status===422)return payload.message||'Os dados informados são inválidos.';if(status===429)return payload.message||'Muitas tentativas. Tente novamente em instantes.';if(status>=500)return payload.message||'Não foi possível concluir a operação.';return payload.message||payload.error||'Não foi possível concluir a operação.'}
function setClientToken(token){state.token=token;try{if(token){localStorage.setItem('ccc_client_token',token);localStorage.removeItem('ccc_token')}else localStorage.removeItem('ccc_client_token')}catch{}}
function clearSession(msg){if(window.__cdsPortalEs){try{window.__cdsPortalEs.close()}catch{}window.__cdsPortalEs=null}if(state.brandingLogoSrc){try{URL.revokeObjectURL(state.brandingLogoSrc)}catch{}}state.branding=null;state.brandingLogoSrc=null;try{localStorage.removeItem('ccc_client_token');localStorage.removeItem('ccc_token')}catch{}/* Sprint 28.3: não remove ccc_office_token */state.token=null;state.user=null;state.company=null;state.unread=0;toast(msg||'Sua sessão expirou. Entre novamente para continuar.','warning');login()}
const api=async(path,opt={})=>{const headers=opt.body instanceof FormData?{}:{'Content-Type':'application/json'};if(state.token)headers.Authorization='Bearer '+state.token;let r;try{r=await fetch('/api'+path,{...opt,headers:{...headers,...(opt.headers||{})}})}catch{throw new ApiError('Não foi possível conectar ao servidor.',0,'NETWORK')}let body={};try{body=await r.json()}catch{}if(!r.ok){const err=new ApiError(humanApiError(r.status,body),r.status,body.error);if(r.status===401&&path!=='/auth/login')clearSession(err.message);throw err}return body};
const toast=(message,type='info')=>{const x=document.createElement('div');x.className='toast toast-'+type;x.setAttribute('role','status');x.textContent=message;document.body.append(x);setTimeout(()=>x.remove(),3600)};
const statusLabel=s=>({PENDING:'Pendente',NEEDS_CLASSIFICATION:'Pendente',APPROVED:'Aprovada',POSTED:'Aprovada',REJECTED:'Reprovada',ACCOUNTED:'Aprovada',OPEN:'Aguardando cliente',AGUARDANDO_CLIENTE:'Aguardando cliente',AGUARDANDO_ESCRITORIO:'Aguardando escritório',RESPONDED:'Aguardando escritório',CONCLUDED:'Concluída',CONCLUIDA:'Concluída',CANCELLED:'Cancelada',CANCELADA:'Cancelada','Precisa de informação':'Precisa de informação','Em análise':'Pendente',Pendente:'Pendente',Aprovada:'Aprovada',Rejeitada:'Reprovada',Reprovada:'Reprovada',PENDING_REVIEW:'Pendente de análise',ACTIVE:'Pendente de análise',EXPENSE:'Despesa',REVENUE:'Receita'}[s]||'-');
function statusTone(s){const v=String(s||'');if(['POSTED','APPROVED','ACCOUNTED','Aprovada'].includes(v))return 'ok';if(['REJECTED','Rejeitada','Reprovada'].includes(v))return 'alert';return ''}
const payOptions=[['PIX','PIX'],['DINHEIRO','Dinheiro'],['DEBITO','Cartão de débito'],['CREDITO','Cartão de crédito'],['TRANSFERENCIA','Transferência'],['BOLETO','Boleto'],['OUTRO','Outro']];
const payLabel=v=>{if(!v)return '-';const hit=payOptions.find(([k])=>k===v);return hit?hit[1]:(statusLabel(v)==='-'?'-':statusLabel(v))};
function clientCan(key){const u=state.user||{};if(Array.isArray(u.permissions)&&u.permissions.includes(key))return true;const p=u.profile;if(['client.expenses.create','client.expenses.edit','client.documents.upload','client.pending.respond','client.requests.respond'].includes(key))return p==='CLIENT_ADMIN'||p==='CLIENT_FINANCE';return false}
function closePortalModal(){document.querySelector('#modal')?.remove()}
function browserLabel(){if(window.CdsPush&&typeof CdsPush.detectBrowser==='function')return CdsPush.detectBrowser();const ua=navigator.userAgent||'';if(navigator.brave)return 'Brave';if(/Edg\//.test(ua))return 'Microsoft Edge';if(/Firefox\//.test(ua))return 'Firefox';if(/Chrome\//.test(ua)&&!/Edg\//.test(ua))return 'Google Chrome';if(/Safari\//.test(ua)&&!/Chrome\//.test(ua))return 'Safari';return 'este navegador'}
function pushSecureOk(){return !!(window.isSecureContext||location.hostname==='localhost'||location.hostname==='127.0.0.1')}
function pushHelpText(reason,browser){
  const b=browser||browserLabel();
  if(reason==='insecure')return 'Este navegador só libera notificações em HTTPS (ou localhost). Abra o Portal pelo endereço seguro.';
  if(reason==='denied')return `As notificações estão bloqueadas no ${b}. Clique no cadeado/ícone ao lado da URL → Notificações → Permitir, e depois em Tentar novamente.`;
  if(reason==='dismissed')return `A janela de permissão foi fechada sem permitir. Clique em Permitir neste navegador e escolha Permitir.`;
  if(reason==='brave_push_blocked'||(b==='Brave'&&(reason==='push_blocked'||reason==='error'))){
    return 'No Brave, abra brave://settings/privacy → ative "Use Google services for push messaging", e em brave://settings/content/notifications permita localhost. Depois clique em Tentar novamente.';
  }
  if(reason==='push_blocked')return `O ${b} bloqueou o serviço de push. Libere notificações nas configurações do site e tente de novo.`;
  return `Cada navegador precisa autorizar separadamente. Sem isso, as mensagens do escritório não chegam com o Portal fechado.`;
}
function pushFailToast(reason){
  const b=browserLabel();
  if(reason==='denied')return 'Permissão negada. Libere nas configurações do site e tente de novo.';
  if(reason==='dismissed')return 'Clique em Permitir na janela do navegador (não feche sem escolher).';
  if(reason==='brave_push_blocked'||(b==='Brave'&&reason==='push_blocked')){
    return 'Brave bloqueou o push. Ative "Use Google services for push messaging" em brave://settings/privacy.';
  }
  if(reason==='push_blocked')return 'Serviço de push bloqueado neste navegador. Verifique as configurações de notificação.';
  return 'Não foi possível ativar as notificações neste navegador.';
}
async function syncPortalPush(opts){
  if(!window.CdsPush||!state.token)return;
  try{
    if(!pushSecureOk()){
      state.push.checked=true;state.push.ready=false;state.push.reason='insecure';state.push.permission='unsupported';
      return;
    }
    const r=await CdsPush.ensurePushReady(api,opts||{});
    state.push.checked=true;
    state.push.permission=(r&&r.permission)||(typeof Notification!=='undefined'?Notification.permission:'default');
    state.push.ready=!!(r&&(r.synced||r.subscribed)&&r.permission==='granted');
    state.push.reason=(r&&r.reason)||null;
    if(r&&r.permission==='granted'&&!r.synced)state.push.ready=false;
    if(state.push.ready){
      try{
        const local=await CdsPush.localSubscription();
        if(!local){state.push.ready=false;state.push.reason='needs_permission'}
      }catch{state.push.ready=false;state.push.reason='needs_permission'}
    }
    if(state.push.ready)state.push.reason=null;
  }catch(e){
    state.push.checked=true;
    state.push.ready=false;
    state.push.reason=(e&&e.code)||(e&&e.message)||'error';
  }
}
function pushBannerHtml(){
  if(state.push.ready||!state.push.checked)return '';
  if(state.push.reason==='not_configured'||state.push.reason==='unsupported')return '';
  const denied=state.push.reason==='denied'||state.push.reason==='brave_push_blocked'||state.push.reason==='push_blocked';
  const insecure=state.push.reason==='insecure';
  const browser=esc(browserLabel());
  return `<div class="panel push-enable-banner" id="pushEnableBanner">
    <strong>Permitir notificações no ${browser}</strong>
    <p style="margin:6px 0 10px">${esc(pushHelpText(state.push.reason,browserLabel()))}</p>
    ${insecure?'':`<button type="button" class="btn" id="pushEnableNow">${denied?'Tentar novamente':'Permitir notificações'}</button>`}
  </div>`;
}
function showPushPermissionModal(){
  if(state.push.ready||!state.push.checked)return;
  if(state.push.reason==='not_configured'||state.push.reason==='unsupported'||state.push.reason==='insecure')return;
  if(document.querySelector('#pushPermissionModal'))return;
  try{if(sessionStorage.getItem('cds_push_modal_skip')==='1'&&state.push.reason!=='denied'&&state.push.reason!=='brave_push_blocked')return}catch{}
  const denied=state.push.reason==='denied'||state.push.reason==='brave_push_blocked'||state.push.reason==='push_blocked';
  const browser=esc(browserLabel());
  const help=esc(pushHelpText(state.push.reason,browserLabel()));
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="pushPermissionModal" role="dialog" aria-modal="true" style="z-index:1200">
    <div class="form-card modal-md" style="max-width:460px">
      <h2>Ativar notificações</h2>
      <p style="line-height:1.5;margin:10px 0 6px">Para receber avisos do escritório <b>neste ${browser}</b>, o navegador precisa da sua permissão.</p>
      <p class="muted" style="line-height:1.45;margin:0 0 14px">${help}</p>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button type="button" class="btn light" id="pushPermLater">Agora não</button>
        <button type="button" class="btn" id="pushPermAllow">${denied?'Tentar novamente':'Permitir neste navegador'}</button>
      </div>
    </div>
  </div>`);
  document.querySelector('#pushPermLater').onclick=()=>{
    try{sessionStorage.setItem('cds_push_modal_skip','1')}catch{}
    document.querySelector('#pushPermissionModal')?.remove();
  };
  document.querySelector('#pushPermAllow').onclick=async()=>{
    const btn=document.querySelector('#pushPermAllow');
    if(btn){btn.disabled=true;btn.textContent='Solicitando...'}
    try{
      await syncPortalPush({prompt:true});
      if(state.push.ready){
        document.querySelector('#pushPermissionModal')?.remove();
        toast('Notificações ativadas neste navegador.','success');
        render();
      }else{
        toast(pushFailToast(state.push.reason));
        // Atualiza texto do modal com a causa real (ex.: Brave)
        const muted=document.querySelector('#pushPermissionModal .muted');
        if(muted)muted.textContent=pushHelpText(state.push.reason,browserLabel());
        if(btn){btn.disabled=false;btn.textContent='Tentar novamente'}
      }
    }catch(e){
      toast(e.message||'Não foi possível ativar as notificações.');
      if(btn){btn.disabled=false;btn.textContent='Permitir neste navegador'}
    }
  };
}
function bindPushBanner(){
  const btn=document.querySelector('#pushEnableNow');
  if(btn){
    btn.onclick=async()=>{
      try{
        await syncPortalPush({prompt:true});
        if(state.push.ready){toast('Notificações ativadas neste navegador.','success');render()}
        else{
          showPushPermissionModal();
          toast(pushFailToast(state.push.reason));
        }
      }catch(e){toast(e.message||'Não foi possível ativar as notificações.')}
    };
  }
  showPushPermissionModal();
}
async function loadClientBranding(){
  if(state.brandingLogoSrc){try{URL.revokeObjectURL(state.brandingLogoSrc)}catch{}state.brandingLogoSrc=null}
  state.branding=null;
  try{
    const payload=await api('/client/branding');
    state.branding=payload||null;
    if(!payload||!(payload.configured||payload.has_logo))return;
    const r=await fetch('/api/client/branding/logo'+(payload.updated_at?('?v='+encodeURIComponent(payload.updated_at)):''),{headers:{Authorization:'Bearer '+state.token}});
    if(!r.ok)return;
    state.brandingLogoSrc=URL.createObjectURL(await r.blob());
  }catch(e){if(e&&e.status===401)throw e}
}
function portalNavLogoHtml(){
  const name=(state.branding&&state.branding.office_name)||'Escritório';
  if(state.brandingLogoSrc){
    return `<div class="logo portal-office-logo"><img src="${state.brandingLogoSrc}" alt="Logo ${esc(name)}"><small>CDS Contábil Connect</small></div>`;
  }
  return `<div class="logo cds-product-logo"><img src="/assets/cds-pwa-192.png?v=s28-4-2" alt="CDS Contábil Connect"><small>PORTAL DO CLIENTE</small></div>`;
}
async function boot(){if(!state.token)return login();try{state.user=await api('/auth/me');if(state.user.role!=='CLIENT'){if(String(location.port)==='3334'){location.href=location.protocol+'//'+location.hostname+':3333/';return}location.href='/';return}try{if(state.token&&!localStorage.getItem('ccc_client_token')){localStorage.setItem('ccc_client_token',state.token);if(localStorage.getItem('ccc_token')===state.token)localStorage.removeItem('ccc_token')}}catch{}state.canWrite=clientCan('client.expenses.create');const d=await api('/client/dashboard').catch(e=>{if(e&&e.status===401)throw e;return null});if(d&&d.company)state.company=d.company;await loadClientBranding();await syncPortalPush({prompt:false});await refreshClientNotifBadge().catch(()=>{});if(typeof window.__cdsStartPortalRealtime==='function')window.__cdsStartPortalRealtime();await render()}catch(e){if(e&&e.status===401)return;toast(e.message||'Não foi possível concluir a operação.');if(state.user)return render();root.innerHTML=`<div class="form-card login-card"><h1>Não foi possível carregar o portal</h1><p>${esc(e.message||'Não foi possível concluir a operação.')}</p><button class="btn" id="retryPortal" style="margin-top:12px">Tentar novamente</button></div>`;document.querySelector('#retryPortal').onclick=()=>boot()}}
function clientProfileLabel(){return({CLIENT_ADMIN:'Administrador',CLIENT_FINANCE:'Financeiro',CLIENT_VIEWER:'Visualizador'}[state.user&&state.user.profile]||(state.user&&state.user.profile)||'Perfil')}
function timeAgo(iso){if(!iso)return '';const t=new Date(iso).getTime();if(Number.isNaN(t))return iso;const s=Math.max(0,Math.round((Date.now()-t)/1000));if(s<60)return 'Há poucos segundos';if(s<3600)return 'Há '+Math.floor(s/60)+' min';if(s<86400)return 'Há '+Math.floor(s/3600)+' h';return 'Há '+Math.floor(s/86400)+' d'}
function applyClientNotifBadge(unread){const n=Number(unread||0)||0;state.unread=n;const badge=document.querySelector('#notifBadge');if(badge){badge.textContent=n||'';badge.hidden=!(n>0)}const label=document.querySelector('#notifLabel');if(label)label.textContent='Notificações'+(n?` (${n})`:'');const toggle=document.querySelector('#notifToggle');if(toggle)toggle.setAttribute('aria-label',n?`Notificações (${n})`:'Notificações')}
async function refreshClientNotifBadge(){if(!state.token||!state.user||state.user.role!=='CLIENT')return;try{const data=await api('/notificacoes/nao-lidas');applyClientNotifBadge(data.unread||data.unread_total||0)}catch{/* badge nunca derruba o portal */}}
function clientNotifDeepLink(n){
  if(n&&n.url)return n.url;
  const t=String(n&&(n.type||n.event_type)||'');
  if(/REQUEST/.test(t)&&n.entity_id)return '/portal/?solicitacao='+encodeURIComponent(n.entity_id);
  if(/DOCUMENT/.test(t))return '/portal/?page=documentos';
  if(/EXPENSE/.test(t))return '/portal/?page=despesas';
  if(/PENDENCY|PENDENCIA/.test(t))return '/portal/?page=pendencias';
  return '/portal/?page=notificacoes';
}
function followClientDeepLink(url){
  try{
    const u=new URL(url,location.origin);
    if(u.origin!==location.origin){location.href=url;return}
    const q=u.searchParams;
    const rid=q.get('solicitacao')||q.get('request')||q.get('request_id');
    if(rid){state.page='requests';state.requestView=rid;render();return}
    const page=q.get('page');
    if(page==='documentos'||page==='documents'){state.page='documents';render();return}
    if(page==='despesas'||page==='expenses'){state.page='expenses';render();return}
    if(page==='pendencias'||page==='pending'){state.page='pending';render();return}
    if(page==='notificacoes'||page==='notifications'){state.page='notifications';render();return}
    if(page==='solicitacoes'||page==='requests'){state.page='requests';render();return}
  }catch{}
  state.page='notifications';render();
}
async function openClientNotification(id){
  const n=(state.notifications||[]).find(x=>x.id===id);
  try{await api('/notificacoes/'+id+'/read',{method:'PATCH'})}catch{}
  const panel=document.querySelector('#notifPanel');if(panel)panel.hidden=true;
  await refreshClientNotifBadge();
  if(!n){if(state.page==='notifications')notifications();return}
  followClientDeepLink(clientNotifDeepLink(n));
}
async function drawClientNotifList(){
  const box=document.querySelector('#notifList');if(!box)return;
  box.innerHTML='<div class="empty">Carregando...</div>';
  try{
    const data=await api('/client/notificacoes');
    const list=Array.isArray(data)?data:(data.items||[]);
    state.notifications=list;
    if(!list.length){box.innerHTML='<div class="empty-state"><h3>Nenhuma notificação</h3><p>Você está em dia.</p></div>';return}
    box.innerHTML=list.slice(0,20).map(n=>{
      const company=esc(n.company_name||(state.company&&(state.company.trade_name||state.company.name))||'');
      const preview=esc(n.preview||n.context||'');
      const body=esc(n.body||n.message||'');
      return `<button type="button" class="notif-item ${n.read_at?'read':'unread'}" data-id="${esc(n.id)}"><b>${esc(n.title||'Notificação')}</b>${company?`<span class="notif-co">${company}</span>`:''}<span>${body}</span>${preview?`<small class="notif-preview">"${preview}"</small>`:''}<small>${esc(timeAgo(n.created_at))}${n.read_at?' · lida':' · não lida'}</small><small class="notif-open-hint">Abrir</small></button>`;
    }).join('');
    box.querySelectorAll('.notif-item').forEach(btn=>btn.onclick=()=>openClientNotification(btn.dataset.id));
  }catch(e){box.innerHTML=`<div class="empty">Erro: ${esc(e.message)}</div>`}
}
function bindClientHeader(){
  const panel=document.querySelector('#notifPanel'),toggle=document.querySelector('#notifToggle');
  if(toggle&&panel){
    toggle.onclick=e=>{e.stopPropagation();const open=panel.hidden;panel.hidden=!open;if(open)drawClientNotifList()};
  }
  const readAll=document.querySelector('#notifReadAll');
  if(readAll)readAll.onclick=async()=>{try{await api('/notificacoes/read-all',{method:'PATCH'});await drawClientNotifList();await refreshClientNotifBadge();if(state.page==='notifications')notifications()}catch(err){toast(err.message)}};
  if(!window.__cdsClientNotifDocBound){
    window.__cdsClientNotifDocBound=true;
    document.addEventListener('click',e=>{const w=document.querySelector('#notifWrap'),p=document.querySelector('#notifPanel');if(w&&p&&!w.contains(e.target))p.hidden=true});
  }
  const drop=document.querySelector('#userDropdown'),btn=document.querySelector('#userMenuBtn');
  if(btn&&drop){
    drop.hidden=true;
    btn.setAttribute('aria-expanded','false');
    btn.onclick=e=>{
      e.stopPropagation();
      const open=drop.hidden;
      drop.hidden=!open;
      btn.setAttribute('aria-expanded',open?'true':'false');
    };
    if(!window.__cdsClientUserMenuBound){
      window.__cdsClientUserMenuBound=true;
      document.addEventListener('click',e=>{
        const menu=document.querySelector('#userMenu');
        const d=document.querySelector('#userDropdown');
        const b=document.querySelector('#userMenuBtn');
        if(d&&menu&&!menu.contains(e.target)){d.hidden=true;if(b)b.setAttribute('aria-expanded','false')}
      });
    }
  }
  const goProfile=document.querySelector('#goProfile');if(goProfile)goProfile.onclick=()=>{state.page='profile';render()};
  const logoutTop=document.querySelector('#logoutTop');if(logoutTop)logoutTop.onclick=()=>document.querySelector('#logout')&&document.querySelector('#logout').click();
  const help=document.querySelector('#helpBtn');if(help)help.onclick=()=>toast('Use o menu para navegar. O sino mostra avisos do escritório.');
  const gs=document.querySelector('#globalSearch');
  if(gs)gs.onkeydown=e=>{if(e.key!=='Enter')return;const q=gs.value.trim().toLowerCase();if(!q)return;if(/despesa|expense/.test(q)){state.page='expenses';render();return}if(/pendenc/.test(q)){state.page='pending';render();return}if(/solicita|mensagem|conversa/.test(q)){state.page='requests';render();return}if(/notif/.test(q)){state.page='notifications';render();return}state.page='documents';render()};
}
function shell(content){
  const links=[['home','Início'],['expenses','Despesas'],['new-expense','Nova despesa'],['documents','Documentos'],['pending','Pendências'],['requests','Solicitações'],['notifications','Notificações'],['profile','Meu perfil']];
  const allowed=links.filter(x=>x[0]!=='new-expense'||state.canWrite);
  const companyName=(state.company&&(state.company.trade_name||state.company.name))||'Empresa';
  const header=window.CdsAppHeader?CdsAppHeader.render({
    mode:'CLIENT',
    eyebrow:'EMPRESA ATIVA',
    title:companyName,
    searchPlaceholder:'Pesquisar documentos, despesas, pendências...',
    userName:(state.user&&state.user.name)||'',
    userRole:clientProfileLabel(),
    unread:state.unread||0,
    showHelp:true,
    showMenu:true
  }):'';
  root.innerHTML=`<div class="portal-shell"><aside class="portal-nav">${portalNavLogoHtml()}<div class="nav-links">${allowed.map(x=>`<button class="${state.page===x[0]?'active':''}" data-page="${x[0]}">${x[1]}</button>`).join('')}</div><button class="logout" id="logout">Sair</button></aside><main class="portal-main">${header}${pushBannerHtml()}${content}</main><div class="mobile-nav">${allowed.map(x=>`<button class="${state.page===x[0]?'active':''}" data-page="${x[0]}">${x[1]}</button>`).join('')}</div></div>`;
  document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>{state.page=x.dataset.page;render()});
  document.querySelector('#logout').onclick=()=>{if(window.__cdsPortalEs){try{window.__cdsPortalEs.close()}catch{}window.__cdsPortalEs=null}fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+(state.token||'')}}).catch(()=>{});if(state.brandingLogoSrc){try{URL.revokeObjectURL(state.brandingLogoSrc)}catch{}}state.branding=null;state.brandingLogoSrc=null;try{localStorage.removeItem('ccc_client_token');localStorage.removeItem('ccc_token')}catch{}state.token=null;state.user=null;state.company=null;state.push={ready:false,reason:null,checked:false};state.unread=0;login()};
  bindPushBanner();
  bindClientHeader();
  refreshClientNotifBadge().catch(()=>{});
}
function rememberedLogin(){try{return{tenant:localStorage.getItem('ccc_last_tenant')||'',email:localStorage.getItem('ccc_last_email')||''}}catch{return{tenant:'',email:''}}}
function rememberLogin(tenant,email){try{if(tenant)localStorage.setItem('ccc_last_tenant',String(tenant).trim());if(email)localStorage.setItem('ccc_last_email',String(email).trim())}catch{/* ignore */}}
function login(){
  const rem=rememberedLogin();
  const demoTenant='demo';
  const demoEmail='cliente@cremolia.com.br';
  const demoPass='Client@123';
  const guessDemo=!rem.tenant&&!rem.email;
  root.innerHTML=`<div class="form-card login-card"><div class="login-office-brand" id="loginOfficeBrand"><div class="brand login-cds-fallback"><img class="login-cds-mark" src="/assets/cds-pwa-192.png?v=s28-4-2" alt="CDS"><span class="eyebrow">CDS Contábil Connect</span></div></div><h1>Portal do cliente</h1><p>Envie as informações financeiras da sua empresa para o escritório.</p><form id="loginForm"><div class="field"><label>Código do escritório</label><input name="tenant" required autocomplete="organization" value="${esc(rem.tenant||(guessDemo?demoTenant:''))}"></div><div class="field"><label>E-mail</label><input name="email" type="email" required value="${esc(rem.email||(guessDemo?demoEmail:''))}"></div><div class="field"><label>Senha</label><input name="password" type="password" required value="${guessDemo?esc(demoPass):''}"></div><label class="muted" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" name="remember" ${rem.tenant||rem.email?'checked':''}> Lembrar-me</label><p class="muted demo-hint" ${guessDemo?'':'hidden'}>Demonstração: <b>${demoTenant}</b> / <b>${demoEmail}</b> / <b>${demoPass}</b></p><button class="btn" style="margin-top:18px;width:100%">Entrar</button></form><p style="margin-top:14px;text-align:center"><button type="button" class="btn light" id="forgotPassword" style="background:transparent;border:0;color:inherit;text-decoration:underline;cursor:pointer;padding:0">Esqueci minha senha</button></p><p style="margin-top:10px;text-align:center" class="muted">Solicitar acesso — fale com seu escritório contábil.</p><div id="forgotBox" hidden style="margin-top:16px;padding:14px;border:1px solid #d8e0dc;border-radius:10px;background:#f7faf8"><p style="margin:0;line-height:1.5">Solicite a redefinição de acesso ao seu escritório contábil.</p><p style="margin:10px 0 0;line-height:1.5" class="muted">Usaremos o código do escritório e o e-mail preenchidos acima.</p><button type="button" class="btn" id="forgotSubmit" style="margin-top:14px;width:100%">Solicitar redefinição</button><p id="forgotResult" hidden style="margin:12px 0 0;line-height:1.5"></p></div></div>`;
  const brandBox=document.querySelector('#loginOfficeBrand');
  let brandSeq=0;
  const paintLoginBrand=(data)=>{
    if(!brandBox)return;
    if(data&&data.configured&&data.logo_url){
      brandBox.innerHTML=`<img class="login-office-logo" src="${esc(data.logo_url)}" alt="Logo ${esc(data.office_name||'do escritório')}"><div class="login-cds-soft muted">CDS Contábil Connect</div>`;
      return;
    }
    brandBox.innerHTML=`<div class="brand login-cds-fallback"><img class="login-cds-mark" src="/assets/cds-pwa-192.png?v=s28-4-2" alt="CDS"><span class="eyebrow">CDS Contábil Connect</span></div>`;
  };
  const loadLoginBrand=()=>{
    const f=document.querySelector('#loginForm');
    const code=String((f&&f.tenant&&f.tenant.value)||'').trim();
    if(!code){paintLoginBrand(null);return}
    const seq=++brandSeq;
    fetch('/api/public/branding?tenant='+encodeURIComponent(code)).then(r=>r.json()).then(data=>{if(seq!==brandSeq)return;paintLoginBrand(data)}).catch(()=>{if(seq===brandSeq)paintLoginBrand(null)});
  };
  const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
  const f0=document.querySelector('#loginForm');
  if(f0&&f0.tenant){f0.tenant.addEventListener('input',debounce(loadLoginBrand,350));f0.tenant.addEventListener('change',loadLoginBrand);loadLoginBrand()}
  fetch('/api/health').then(r=>r.json()).then(h=>{
    const f=document.querySelector('#loginForm');
    const hint=document.querySelector('.demo-hint');
    if(!f)return;
    if(h&&h.demo){
      if(!f.tenant.value)f.tenant.value=demoTenant;
      if(!f.email.value)f.email.value=demoEmail;
      if(!f.password.value)f.password.value=demoPass;
      if(hint)hint.hidden=false;
      loadLoginBrand();
      return;
    }
    if(guessDemo){
      if(f.tenant.value===demoTenant)f.tenant.value='';
      if(f.email.value===demoEmail)f.email.value='';
      if(f.password.value===demoPass)f.password.value='';
      if(hint)hint.hidden=true;
      loadLoginBrand();
    }
  }).catch(()=>{});
  document.querySelector('#forgotPassword').onclick=()=>{
    const box=document.querySelector('#forgotBox');
    if(box)box.hidden=!box.hidden;
  };
  document.querySelector('#forgotSubmit').onclick=async()=>{
    const f=document.querySelector('#loginForm');
    const result=document.querySelector('#forgotResult');
    const btn=document.querySelector('#forgotSubmit');
    if(!f||!result)return;
    const tenant=String(f.tenant.value||'').trim();
    const email=String(f.email.value||'').trim();
    if(!tenant||!email){toast('Informe o código do escritório e o e-mail.');return}
    if(btn){btn.disabled=true;btn.textContent='Enviando...'}
    try{
      const r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant,email})});
      const body=await r.json().catch(()=>({}));
      result.hidden=false;
      result.textContent=body.message||'Solicitação enviada ao escritório. Aguarde o contato ou o novo convite de acesso.';
      toast('Solicitação enviada ao escritório. Aguarde o contato ou o novo convite de acesso.','success');
    }catch{
      result.hidden=false;
      result.textContent='Solicitação enviada ao escritório. Aguarde o contato ou o novo convite de acesso.';
    }finally{
      if(btn){btn.disabled=false;btn.textContent='Solicitar redefinição'}
    }
  };
  document.querySelector('#loginForm').onsubmit=async event=>{
    event.preventDefault();
    try{
      const body=Object.fromEntries(new FormData(event.target));
      const remember=!!body.remember;delete body.remember;
      const x=await api('/auth/login',{method:'POST',body:JSON.stringify(body)});
      if(remember)rememberLogin(body.tenant,body.email);
      else{try{localStorage.removeItem('ccc_last_tenant');localStorage.removeItem('ccc_last_email')}catch{}}
      state.token=x.token;
      setClientToken(x.token);
      try{sessionStorage.removeItem('cds_push_modal_skip')}catch{}
      // Não pedir permissão aqui: Chrome exige clique explícito (modal após o boot)
      boot();
    }catch(error){toast(error.message)}
  };
}
async function render(){try{if(state.page==='new-expense'&&!state.canWrite)state.page='expenses';if(state.page==='new-revenue'||state.page==='revenues')state.page='home';if(state.page==='new-expense'){state.page='expenses';await transactions('despesas');return transactionForm()}if(state.page==='home')return await home();if(state.page==='expenses')return await transactions('despesas');if(state.page==='documents')return await documents();if(state.page==='pending')return await pending();if(state.page==='requests')return await requests();if(state.page==='notifications')return await notifications();if(state.page==='profile')return profile();return await home()}catch(e){if(e&&e.status===401)return;if(state.user){shell(`<div class="panel empty-state"><h3>Não foi possível carregar</h3><p>${esc(e.message||'Não foi possível concluir a operação.')}</p><button class="btn" id="retryPage">Tentar novamente</button></div>`);document.querySelector('#retryPage')&&(document.querySelector('#retryPage').onclick=()=>render())}else toast(e.message||'Não foi possível concluir a operação.')}}
async function home(){const [d,reqs]=await Promise.all([api('/client/dashboard'),api('/client/solicitacoes').catch(()=>[])]);const name=d.company.trade_name||d.company.name;shell(`<div class="topline"><div><div class="eyebrow">Portal do cliente</div><h1>Olá, ${esc(name)}</h1><p>Veja o que precisa da sua atenção.</p></div>${state.canWrite?`<button class="btn" onclick="go('new-expense')">+ Nova despesa</button>`:''}</div><div class="grid"><div class="metric"><label>Despesas enviadas</label><strong>${money(d.expenses_cents)}</strong></div><button type="button" class="metric metric-link" onclick="go('documents')" aria-label="Abrir Documentos"><label>Documentos</label><strong>${d.documents}</strong></button><button type="button" class="metric metric-link accent" onclick="go('pending')" aria-label="Abrir Pendências"><label>Pendências</label><strong>${d.pending}</strong></button><button type="button" class="metric metric-link" onclick="go('requests')" aria-label="Abrir Solicitações"><label>Solicitações</label><strong>${Array.isArray(reqs)?reqs.length:0}</strong></button></div><div class="panel"><h2>Atividade recente</h2>${(d.recent||[]).filter(x=>x.source_type!=='REVENUE').map(x=>`<div class="recent-row"><span>${esc(x.occurred_on)}</span><span>${esc(x.description)}</span><b>${money(x.amount_cents)}</b><span>${esc(payLabel(x.method))}</span><span class="status ${statusTone(x.status)}">${esc(statusLabel(x.status_label||x.status))}</span></div>`).join('')||'<div class="empty-state"><h3>Nenhuma movimentação ainda</h3><p>Quando você enviar uma despesa, ela aparece aqui.</p></div>'}</div>`)}
function filterBar(type){const f=state.filters[type]||{};return `<form class="filters" id="filters"><input type="date" name="from" value="${esc(f.from||'')}"><input type="date" name="to" value="${esc(f.to||'')}"><select name="category_id"><option value="">Categoria</option>${(state.categories||[]).map(x=>`<option value="${x.id}" ${f.category_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select name="${type==='despesas'?'payment_method':'receipt_method'}"><option value="">${type==='despesas'?'Forma de pagamento':'Forma de recebimento'}</option>${payOptions.map(([v,l])=>`<option value="${v}" ${f[type==='despesas'?'payment_method':'receipt_method']===v?'selected':''}>${l}</option>`).join('')}</select><select name="status"><option value="">Situação</option><option value="PENDING">Pendente</option><option value="NEEDS_CLASSIFICATION">Pendente</option><option value="POSTED">Aprovada</option><option value="REJECTED">Reprovada</option></select><button class="btn light" type="submit">Filtrar</button></form>`}
async function transactions(type){[state.categories]=await Promise.all([api('/client/categorias')]);const f=state.filters[type]||{};const qs=new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([,v])=>v))).toString();const list=await api('/client/'+type+(qs?'?'+qs:''));shell(`<div class="topline"><div><div class="eyebrow">Movimentações</div><h1>Despesas</h1></div>${state.canWrite?`<button class="btn" onclick="go('new-expense')">+ Nova despesa</button>`:''}</div>${filterBar(type)}<div class="panel table-wrap"><table class="table"><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Categoria</th><th>Pagamento</th><th>Documento</th><th>Situação</th><th></th></tr></thead><tbody>${list.map(x=>`<tr><td>${x.occurred_on}</td><td>${esc(x.description)}</td><td>${money(x.amount_cents)}</td><td>${esc(x.category_name||'Outros')}</td><td>${esc(payLabel(x.payment_method)||'-')}</td><td>${x.has_document||x.document_id?'📎':'-'}</td><td><span class="status ${statusTone(x.status)}">${statusLabel(x.status_label||x.status)}</span></td><td><button class="btn light" onclick="detail('${x.id}')">Visualizar</button></td></tr>`).join('')}</tbody></table>${list.length?'':'<div class="empty">Nenhum registro ainda.</div>'}</div>`);document.querySelector('#filters').onsubmit=e=>{e.preventDefault();state.filters[type]=Object.fromEntries(new FormData(e.target));transactions(type)}}
async function transactionForm(type){
  if(!state.canWrite){toast('Você não tem permissão para lançar despesa.');state.page='expenses';return transactions('despesas')}
  [state.categories,state.banks]=await Promise.all([api('/client/categorias'),api('/client/bancos')]);
  if(!state.company){const d=await api('/client/dashboard').catch(()=>null);if(d&&d.company)state.company=d.company}
  closePortalModal();
  if(window.CdsSmartExpense){
    return CdsSmartExpense.open({
      mode:'client',
      token:state.token,
      companyId:state.company&&state.company.id||null,
      companyName:(state.company&&(state.company.trade_name||state.company.name))||'',
      categories:state.categories||[],
      banks:state.banks||[],
      api:async(path,opt={})=>{
        if(path.startsWith('/api/')){
          const headers=opt.body instanceof FormData
            ?{Authorization:'Bearer '+state.token}
            :{'Content-Type':'application/json',Authorization:'Bearer '+state.token};
          const r=await fetch(path,{...opt,headers:{...headers,...(opt.headers||{})}});
          let body={};try{body=await r.json()}catch{}
          if(!r.ok)throw Object.assign(new Error(body.message||body.error||'Erro'),{status:r.status});
          return body;
        }
        return api(path,opt);
      },
      toast,
      uploadUrl:'/api/client/documentos',
      analyzeUrl:id=>'/api/client/documentos/'+id+'/analise-despesa',
      reanalyzeUrl:id=>'/api/client/documentos/'+id+'/analise-despesa/reler',
      saveUrl:'/api/client/despesas',
      viewUrlFor:id=>'/api/client/documentos/'+id+'/view',
      onSaved:()=>go('expenses')
    });
  }
  toast('Não foi possível abrir a nova despesa.');
}
async function detail(id){try{const x=await api('/client/transacoes/'+id);const locked=x.status==='APPROVED'||x.status==='POSTED'||x.status==='ACCOUNTED';shell(`<div class="topline"><div><div class="eyebrow">Detalhe</div><h1>${esc(x.description)}</h1><p>${x.occurred_on} · ${money(x.amount_cents)}</p></div><button class="btn light" onclick="go('${x.source_type==='EXPENSE'?'expenses':'revenues'}')">Voltar</button></div><div class="panel"><p>Categoria: ${esc(x.category_name||'Outros')} · ${esc(payLabel(x.payment_method||x.receipt_method))} · Banco / Caixa: ${esc(x.bank_name||'Não informado')}</p>${x.notes?`<p>${esc(x.notes)}</p>`:''}<span class="status ${statusTone(x.status)}">${statusLabel(x.status_label||x.status)}</span>${x.document?`<p>📎 ${esc(x.document.original_name)} <button class="btn light" type="button" onclick="viewClientDocument('${x.document.id}','${esc(x.document.original_name)}','${esc(x.document.mime_type||'')}',${x.document.size_bytes||0})">Visualizar</button></p>`:''}${state.canWrite&&!locked?`<button class="btn light" style="margin-top:16px" onclick="editTx('${x.id}','${x.source_type}')">Editar</button>`:locked?'<p class="muted">Movimentação aprovada. Para alterar, utilize uma solicitação.</p>':''}<div class="timeline" style="margin-top:20px">${(x.history||[]).map(h=>`<div><b>${statusLabel(h.status_label||h.status)}</b><br>${h.occurred_on}</div>`).join('')||'<div>Enviada para o escritório.</div>'}</div></div>`)}catch(error){toast(error.message)}}
async function editTx(id,source){const type=source==='EXPENSE'?'despesas':'receitas';const x=await api('/client/transacoes/'+id);[state.categories,state.banks]=await Promise.all([api('/client/categorias'),api('/client/bancos')]);shell(`<form class="form-card" id="editForm"><h1>Editar ${type.slice(0,-1)}</h1><div class="form-grid"><div class="field"><label>Data</label><input type="date" name="occurred_on" value="${esc(x.occurred_on)}" required></div><div class="field"><label>Valor</label><input name="amount" value="${(x.amount_cents/100).toFixed(2).replace('.',',')}" required></div><div class="field full"><label>Descrição</label><input name="description" value="${esc(x.description)}" required></div><div class="field"><label>${type==='despesas'?'Forma de pagamento':'Forma de recebimento'}</label><select name="${type==='despesas'?'payment_method':'receipt_method'}">${payOptions.map(([v,l])=>`<option value="${v}" ${(x.payment_method||x.receipt_method)===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label>Banco / Caixa</label><select name="bank_id"><option value="">Não informado</option>${state.banks.map(b=>`<option value="${b.id}" ${x.bank_id===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div><div class="field full"><label>Observação</label><textarea name="notes" rows="3">${esc(x.notes||'')}</textarea></div></div><button class="btn">Salvar</button></form>`);document.querySelector('#editForm').onsubmit=async e=>{e.preventDefault();try{await api('/client/'+type+'/'+id,{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Movimentação atualizada.');detail(id)}catch(error){toast(error.message)}}}
async function documents(){const f=state.filters.docs||{};const qs=new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([,v])=>v))).toString();const list=await api('/client/documentos'+(qs?'?'+qs:''));shell(`<div class="topline"><div><div class="eyebrow">Arquivos</div><h1>Documentos</h1></div>${state.canWrite?'<button class="btn" id="send">+ Enviar documento</button>':''}</div><form class="filters" id="docFilters"><input type="date" name="from" value="${esc(f.from||'')}"><input type="date" name="to" value="${esc(f.to||'')}"><select name="type"><option value="">Tipo</option><option value="pdf" ${f.type==='pdf'?'selected':''}>PDF</option><option value="image" ${f.type==='image'?'selected':''}>Imagem</option></select><select name="status"><option value="">Situação</option><option value="PENDING_REVIEW" ${f.status==='PENDING_REVIEW'?'selected':''}>Pendente de análise</option><option value="ACTIVE" ${f.status==='ACTIVE'?'selected':''}>Associado</option></select><select name="linked"><option value="">Associado / não associado</option><option value="1" ${f.linked==='1'?'selected':''}>Associado</option><option value="0" ${f.linked==='0'?'selected':''}>Não associado</option></select><button class="btn light" type="submit">Filtrar</button></form><div class="panel table-wrap"><table class="table"><thead><tr><th>Documento</th><th>Origem</th><th>Data</th><th>Tipo</th><th>Movimentação</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${list.map(x=>`<tr><td><div>${esc(x.original_name)}</div><small>${esc(x.source_label||'')}</small></td><td>${esc(x.source_label||'-')}</td><td>${esc(x.created_at)}</td><td>${esc((x.mime_type||'').includes('pdf')?'PDF':'Imagem')}</td><td>${esc(x.movement?.description||'Não associado')}</td><td>${esc(statusLabel(x.status_label||x.status))}</td><td><button class="btn light" data-doc-view="${x.id}" data-doc-name="${esc(x.original_name)}" data-doc-mime="${esc(x.mime_type||'')}" data-doc-size="${x.size_bytes||0}">Visualizar</button> <button class="btn light" data-doc-dl="${x.id}" data-doc-name="${esc(x.original_name)}">Baixar</button>${x.can_delete?` <button class="btn light" data-doc-del="${x.id}">Excluir</button>`:''}</td></tr>`).join('')}</tbody></table>${list.length?'':'<div class="empty">Nenhum documento enviado.</div>'}</div>`);document.querySelector('#docFilters').onsubmit=e=>{e.preventDefault();state.filters.docs=Object.fromEntries(new FormData(e.target));documents()};bindClientDocViewers();document.querySelectorAll('[data-doc-dl]').forEach(btn=>{btn.onclick=()=>downloadClientDocument(btn.dataset.docDl,btn.dataset.docName)});document.querySelectorAll('[data-doc-del]').forEach(btn=>{btn.onclick=()=>confirmClientDocumentDelete(btn.dataset.docDel)});const send=document.querySelector('#send');if(send)send.onclick=()=>documentModal()}
function confirmClientDocumentDelete(id){root.insertAdjacentHTML('beforeend',`<div class="modal-back" id="modal"><div class="form-card modal-md"><h2>Excluir documento?</h2><p>Você está prestes a excluir este documento. Essa ação será registrada no histórico.</p><div class="form-actions"><button type="button" class="btn light" id="closeDel">Cancelar</button><button type="button" class="btn" id="confirmDocDelete">Excluir documento</button></div></div></div>`);document.querySelector('#closeDel').onclick=()=>document.querySelector('#modal').remove();document.querySelector('#confirmDocDelete').onclick=async()=>{try{await api('/client/documentos/'+id,{method:'DELETE'});toast('Documento excluído.','success');document.querySelector('#modal').remove();documents()}catch(error){toast(error.message)}}}
async function downloadClientDocument(id,name){try{const r=await fetch('/api/client/documentos/'+id+'/download',{headers:{Authorization:'Bearer '+state.token}});if(!r.ok){let body={};try{body=await r.json()}catch{}throw new Error(body.message||'Não foi possível baixar o documento.')}const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name||'documento';a.click();URL.revokeObjectURL(u)}catch(error){toast(error.message)}}
function documentModal(){root.insertAdjacentHTML('beforeend',`<div class="modal-back" id="modal"><form class="form-card modal-md" id="docForm"><h2>Enviar documento</h2><p>Arraste o arquivo ou clique na área de envio. PDF, JPG ou PNG.</p><div class="dropzone" id="docDrop"><strong>Arraste o arquivo aqui</strong><span>ou clique para selecionar</span><small>PDF, JPG ou PNG</small><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></div><div class="field" style="margin-top:12px"><label>Observação</label><textarea name="notes" rows="3"></textarea></div><div class="form-actions"><button type="button" class="btn light" id="close">Cancelar</button><button class="btn" id="docSubmit">Enviar documento</button></div></form></div>`);const drop=document.querySelector('#docDrop');if(drop){drop.onclick=e=>{if(e.target.name!=='file')drop.querySelector('input')?.click()};drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');const input=drop.querySelector('input');if(e.dataTransfer.files[0]){const dt=new DataTransfer();dt.items.add(e.dataTransfer.files[0]);input.files=dt.files;toast('Documento anexado com sucesso.','success')}};const fileInp=drop.querySelector('input');if(fileInp)fileInp.onchange=e=>{if(e.target.files&&e.target.files[0])toast('Documento anexado com sucesso.','success')}}document.querySelector('#close').onclick=()=>document.querySelector('#modal').remove();document.querySelector('#docForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const btn=document.querySelector('#docSubmit');if(btn){btn.disabled=true;btn.textContent='Enviando...'}try{await api('/client/documentos',{method:'POST',body:fd});toast('Documento enviado com sucesso.','success');document.querySelector('#modal').remove();documents()}catch(error){toast(error.message);if(btn){btn.disabled=false;btn.textContent='Enviar documento'}}}}
async function pending(){const list=await api('/client/pendencias');shell(`<div class="topline"><div><div class="eyebrow">Acompanhar</div><h1>Pendências</h1></div></div>${list.map(x=>`<div class="panel"><span class="status alert">Precisamos de uma informação.</span><h2 style="margin-top:12px">${esc(x.reason)}</h2>${x.movement?`<p>Movimentação: ${esc(x.movement.description)} · ${x.movement.occurred_on}</p>`:''}${x.document?`<p>Documento: ${esc(x.document.original_name)}</p>`:''}${(x.responses||[]).map(r=>`<p><b>Sua resposta:</b> ${esc(r.message)}</p>`).join('')}${state.canWrite?`<form data-pendency="${x.id}" class="reply-form"><div class="field"><textarea name="message" rows="2" placeholder="Escreva uma resposta" required></textarea></div><button class="btn" style="margin-top:10px">Responder</button></form>`:''}</div>`).join('')||'<div class="panel empty-state"><h3>Nenhuma pendência</h3><p>Está tudo em dia por aqui.</p></div>'}`);document.querySelectorAll('.reply-form').forEach(form=>form.onsubmit=async e=>{e.preventDefault();try{await api('/client/pendencias/'+form.dataset.pendency+'/resposta',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});toast('Resposta enviada');pending()}catch(error){toast(error.message)}})}
async function requests(){
  if(state.requestView)return requestConversation(state.requestView);
  const list=await api('/client/solicitacoes');
  const unread=list.reduce((n,x)=>n+(Number(x.unread_count||0)>0?1:0),0);
  shell(`<div class="topline"><div><div class="eyebrow">Do escritório</div><h1>Solicitações${unread?' 🔴 '+unread:''}</h1></div></div>${list.map(x=>{
    const closed=['CONCLUDED','CANCELLED','CONCLUIDA','CANCELADA'].includes(String(x.status||'').toUpperCase());
    const unreadRow=Number(x.unread_count||0)>0;
    const last=x.last_message?esc((x.last_message.role==='CLIENT'?'Você: ':'Escritório: ')+String(x.last_message.message||'').slice(0,100)):esc(x.description||'Sem mensagens');
    return `<div class="panel ${unreadRow?'req-row-unread':''}"><span class="status">${statusLabel(x.status)}</span><h2 style="margin-top:12px">${unreadRow?'🔴 ':''}${esc(x.title)}</h2><p>${last}</p><button type="button" class="btn" data-open-req="${esc(x.id)}" style="margin-top:10px">Abrir conversa</button></div>`;
  }).join('')||'<div class="panel empty">Nenhuma solicitação.</div>'}`);
  document.querySelectorAll('[data-open-req]').forEach(btn=>btn.onclick=()=>{state.requestView=btn.dataset.openReq;requests()});
}
async function requestConversation(requestId){
  try{
    const [req,messages]=await Promise.all([
      api('/client/solicitacoes/'+requestId),
      api('/client/solicitacoes/'+requestId+'/mensagens')
    ]);
    const closed=['CONCLUDED','CANCELLED','CONCLUIDA','CANCELADA'].includes(String(req.status||'').toUpperCase());
    const bubbles=(messages||[]).map(m=>{
      const office=!m.role||m.role!=='CLIENT';
      return `<div class="req-bubble ${office?'office':'client'}"><div class="req-bubble-meta">${office?'ESCRITÓRIO':'CLIENTE'}${m.user_name?' · '+esc(m.user_name):''}</div><div class="req-bubble-text">${esc(m.message)}</div><div class="req-bubble-time">${esc(m.created_at||'')}</div></div>`;
    }).join('')||'<div class="muted">Nenhuma mensagem.</div>';
    const composer=closed||!state.canWrite
      ?`<div class="req-composer muted">${closed?'Solicitação encerrada.':'Sem permissão para responder.'}</div>`
      :`<form class="req-composer" id="reqMsgForm"><textarea name="message" rows="2" placeholder="Digite uma mensagem..." required></textarea><button class="btn" type="submit">Enviar</button></form>`;
    shell(`<div class="req-chat"><div class="req-chat-head"><button type="button" class="btn light" id="reqBack">← Solicitações</button><div><h1>${esc(req.title)}</h1><p>${statusLabel(req.status)}</p></div></div><div class="req-chat-thread" id="reqThread">${bubbles}</div>${composer}</div>`);
    document.querySelector('#reqBack').onclick=()=>{state.requestView=null;requests()};
    const thread=document.querySelector('#reqThread');if(thread)thread.scrollTop=thread.scrollHeight;
    const form=document.querySelector('#reqMsgForm');
    if(form)form.onsubmit=async e=>{
      e.preventDefault();
      try{
        await api('/client/solicitacoes/'+requestId+'/mensagens',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
        toast('Mensagem enviada','success');
        requestConversation(requestId);
      }catch(error){toast(error.message)}
    };
  }catch(error){toast(error.message);state.requestView=null;requests()}
}
async function notifications(){
  const data=await api('/client/notificacoes');
  const list=Array.isArray(data)?data:(data.items||[]);
  state.notifications=list;
  let prefs={requests_enabled:true,documents_enabled:true,expenses_enabled:true,push_enabled:true};
  let pushInfo={configured:false};
  try{prefs=await api('/push/prefs')}catch{}
  try{pushInfo=await api('/push/public-key')}catch{}
  shell(`<div class="topline"><div><div class="eyebrow">Avisos</div><h1>Notificações</h1></div><button type="button" class="btn light" id="notifMarkAllPage">Marcar todas</button></div>
    <div class="panel" style="margin-bottom:16px">
      <h2>Preferências</h2>
      <p>Receba avisos do escritório no portal e no navegador.</p>
      <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="prefRequests" ${prefs.requests_enabled!==false?'checked':''}> Solicitações</label>
      <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="prefDocuments" ${prefs.documents_enabled!==false?'checked':''}> Documentos</label>
      <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="prefExpenses" ${prefs.expenses_enabled!==false?'checked':''}> Despesas</label>
      <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="prefPush" ${prefs.push_enabled!==false?'checked':''}> Notificar com Portal fechado</label>
      <div class="form-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn" id="savePushPrefs">Salvar preferências</button>
        <button type="button" class="btn light" id="enableClientPush">Ativar push no navegador</button>
      </div>
      <p class="muted" style="margin-top:8px">${pushInfo.configured?'VAPID configurado. Ative o push neste dispositivo para receber mensagens do escritório.':'Web Push aguardando chaves VAPID no servidor.'}</p>
    </div>
    <div class="panel">${list.map(x=>{
      const company=esc(x.company_name||'');
      const preview=esc(x.preview||x.context||'');
      return `<div class="notice ${x.read_at?'':'unread'}"><b>${esc(x.title)}</b>${company?`<div class="notif-co">${company}</div>`:''}<p>${esc(x.body||x.message||'')}</p>${preview?`<small class="notif-preview">"${preview}"</small>`:''}<small>${esc(timeAgo(x.created_at)||x.created_at)}</small><div class="row-actions" style="margin-top:8px;display:flex;gap:8px">${!x.read_at?`<button class="btn light" onclick="readNotification('${x.id}')">Marcar como lida</button>`:''}<button class="btn" onclick="openClientNotification('${x.id}')">Abrir</button></div></div>`;
    }).join('')||'<div class="empty">Nenhuma notificação.</div>'}</div>`);
  document.querySelector('#notifMarkAllPage')&&(document.querySelector('#notifMarkAllPage').onclick=async()=>{try{await api('/notificacoes/read-all',{method:'PATCH'});toast('Todas marcadas como lidas.','success');notifications();refreshClientNotifBadge()}catch(error){toast(error.message)}});
  document.querySelector('#savePushPrefs')&&(document.querySelector('#savePushPrefs').onclick=async()=>{
    try{
      await api('/push/prefs',{method:'PUT',body:JSON.stringify({
        requests_enabled:!!document.querySelector('#prefRequests')?.checked,
        documents_enabled:!!document.querySelector('#prefDocuments')?.checked,
        expenses_enabled:!!document.querySelector('#prefExpenses')?.checked,
        push_enabled:!!document.querySelector('#prefPush')?.checked
      })});
      toast('Preferências salvas.','success');
    }catch(error){toast(error.message)}
  });
  document.querySelector('#enableClientPush')&&(document.querySelector('#enableClientPush').onclick=async()=>{
    try{
      if(!window.CdsPush)throw new Error('Cliente Push indisponível.');
      await syncPortalPush({prompt:true});
      if(state.push.ready)toast('Notificações do navegador ativadas.','success');
      else throw new Error(state.push.reason==='denied'?'Permissão de notificação negada.':'Não foi possível ativar o push.');
      notifications();
    }catch(error){toast(error.message)}
  });
}
function more(){profile()}
async function profile(){
  const p=({CLIENT_ADMIN:'Administrador',CLIENT_FINANCE:'Financeiro',CLIENT_VIEWER:'Visualizador'}[state.user.profile]||state.user.profile||'Visualizador');
  shell(`<div class="topline"><div><div class="eyebrow">Conta</div><h1>Meu perfil</h1><p>Seu acesso está vinculado automaticamente à empresa. Você não escolhe empresa neste portal.</p></div></div><div class="panel form-card"><div class="form-grid"><div class="field"><label>Nome</label><input value="${esc(state.user.name)}" disabled></div><div class="field"><label>E-mail</label><input value="${esc(state.user.email)}" disabled></div><div class="field"><label>Perfil</label><input value="${esc(p)}" disabled></div><div class="field"><label>Empresa</label><input value="${esc((state.company&&(state.company.trade_name||state.company.name))||'')}" disabled></div></div></div>
  <div class="panel form-card" style="margin-top:16px"><h2>Notificações push</h2><p>Ative para receber mensagens do escritório com o Portal fechado.</p><button type="button" class="btn" id="enableClientPushProfile" style="margin-top:10px">Ativar push no navegador</button></div>
  <form class="panel form-card" id="pwForm" style="margin-top:16px"><h2>Alterar senha</h2><div class="form-grid"><div class="field"><label>Senha atual</label><input name="current" type="password" required></div><div class="field"><label>Nova senha</label><input name="password" type="password" required></div></div><button class="btn" style="margin-top:14px">Salvar senha</button></form>`);
  document.querySelector('#enableClientPushProfile')&&(document.querySelector('#enableClientPushProfile').onclick=async()=>{
    try{
      if(!window.CdsPush)throw new Error('Cliente Push indisponível.');
      await syncPortalPush({prompt:true});
      if(state.push.ready){toast('Notificações do navegador ativadas.','success');profile()}
      else throw new Error(state.push.reason==='denied'?'Permissão de notificação negada.':'Não foi possível ativar o push.');
    }catch(error){toast(error.message)}
  });
  const pw=document.querySelector('#pwForm');
  if(pw)pw.onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));try{await api('/auth/password',{method:'POST',body:JSON.stringify(body)});toast('Senha atualizada.','success');e.target.reset()}catch(error){toast(error.message)}}
}
function showClientRequestAlert(){/* Sprint 28.3: popup HTML legado removido — sino + Push nativo */}
function showClientDocumentAlert(){/* Sprint 28.3: popup HTML legado removido — sino + Push nativo */}
function applyPortalDeepLink(){
  try{
    const q=new URLSearchParams(location.search);
    const rid=q.get('solicitacao')||q.get('request')||q.get('request_id');
    if(rid){state.page='requests';state.requestView=rid;history.replaceState({},'',location.pathname)}
    const page=q.get('page');
    if(page==='documents'||page==='documentos'){state.page='documents';history.replaceState({},'',location.pathname)}
    if(page==='despesas'||page==='expenses'){state.page='expenses';history.replaceState({},'',location.pathname)}
    if(page==='pendencias'||page==='pending'){state.page='pending';history.replaceState({},'',location.pathname)}
    if(page==='notificacoes'||page==='notifications'){state.page='notifications';history.replaceState({},'',location.pathname)}
    if(page==='solicitacoes'||page==='requests'){state.page='requests';history.replaceState({},'',location.pathname)}
  }catch{}
}
window.go=page=>{if(page==='new-expense'){if(!state.canWrite){toast('Você não tem permissão para lançar despesa.');return}transactionForm();return}state.page=page;render()};window.detail=detail;window.editTx=editTx;function viewClientDocument(id,name,mime,size){CdsDocumentViewer.open({fileName:name||'Documento',mimeType:mime,sizeBytes:size,viewUrl:'/api/client/documentos/'+id+'/view',downloadUrl:'/api/client/documentos/'+id+'/download',headers:()=>({Authorization:'Bearer '+state.token})})}function bindClientDocViewers(){document.querySelectorAll('[data-doc-view]').forEach(btn=>{btn.onclick=()=>viewClientDocument(btn.dataset.docView,btn.dataset.docName,btn.dataset.docMime,btn.dataset.docSize)})}window.viewClientDocument=viewClientDocument;window.downloadDoc=viewClientDocument;window.openClientNotification=openClientNotification;window.readNotification=async id=>{try{await api('/notificacoes/'+id+'/read',{method:'PATCH'});await refreshClientNotifBadge();if(state.page==='notifications')notifications()}catch(error){toast(error.message)}};
if(!window.__cdsPortalPushBound){
  window.__cdsPortalPushBound=true;
  if(navigator.serviceWorker){
    navigator.serviceWorker.addEventListener('message',ev=>{
      const d=ev&&ev.data;
      if(!d||d.type!=='CDS_PUSH_OPEN')return;
      if(d.request_id){state.page='requests';state.requestView=d.request_id;render()}
      else if(d.page==='documents'||(d.url&&String(d.url).indexOf('page=documents')>=0)||(d.url&&String(d.url).indexOf('page=documentos')>=0)){state.page='documents';render()}
      else if(d.url)followClientDeepLink(d.url);
    });
  }
  window.__cdsPortalNotifSeen=window.__cdsPortalNotifSeen||new Set();
  let portalNotifBootstrapped=false;
  async function bootstrapPortalNotifSeen(){
    if(portalNotifBootstrapped||!state.token)return;
    portalNotifBootstrapped=true;
    try{
      const data=await api('/client/notificacoes');
      const list=Array.isArray(data)?data:(data.items||[]);
      for(const n of list){if(n&&n.id)window.__cdsPortalNotifSeen.add(n.id)}
    }catch{}
  }
  function handlePortalNotification(n){
    if(!n||!n.id||window.__cdsPortalNotifSeen.has(n.id))return;
    window.__cdsPortalNotifSeen.add(n.id);
    refreshClientNotifBadge().catch(()=>{});
    if(n.type==='REQUEST_MESSAGE_CREATED'||n.type==='REQUEST_CREATED'||n.type==='REQUEST_MESSAGE'){
      if(state.requestView&&n.entity_id===state.requestView){
        if(state.page==='requests')requestConversation(state.requestView);
        return;
      }
      if(state.page==='requests'&&!state.requestView)requests();
      if(state.page==='notifications')notifications();
      return;
    }
    if(state.page==='notifications')notifications();
    if(state.page==='documents'&&(n.type==='DOCUMENT_UPLOADED'||n.type==='DOCUMENT_RECEIVED'))documents();
  }
  function startPortalRealtime(){
    if(window.__cdsPortalEs||window.__cdsPortalEsStarting)return;
    if(!state.token||!window.CdsRealtime)return;
    window.__cdsPortalEsStarting=true;
    bootstrapPortalNotifSeen().then(()=>{
      window.__cdsPortalEs=CdsRealtime.connect(state.token,{
        onNotification:n=>handlePortalNotification(n)
      });
    }).finally(()=>{window.__cdsPortalEsStarting=false});
  }
  // Fallback poll (badge + inbox; sem popup HTML)
  setInterval(async()=>{
    if(!state.token||!state.user||state.user.role!=='CLIENT')return;
    try{
      await refreshClientNotifBadge();
      const data=await api('/client/notificacoes');
      const list=Array.isArray(data)?data:(data.items||[]);
      for(const n of list){
        if(!n||n.read_at)continue;
        handlePortalNotification(n);
      }
    }catch{}
  },12000);
  window.__cdsStartPortalRealtime=startPortalRealtime;
}
if(window.CdsPush){CdsPush.ensureServiceWorker().catch(()=>{})}
applyPortalDeepLink();
boot();
