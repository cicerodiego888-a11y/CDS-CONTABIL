const state={token:(()=>{try{return localStorage.getItem('ccc_office_token')||localStorage.getItem('ccc_token')}catch{return null}})(),user:null,page:'dashboard',companies:[],accounts:[],plans:[],categories:[],banks:[],rules:[],selectedCompany:null,branding:null,brandingLogoSrc:null,commsTab:'email',emailEditing:false,settingsSection:'geral',dashPreset:'month',dashActivity:'7d',dashFrom:'',dashTo:'',docFilters:{q:'',company_id:'',source:'',status:'',extraction:'',period:'',from:'',to:''}};
function setOfficeToken(token){state.token=token;try{if(token){localStorage.setItem('ccc_office_token',token);localStorage.removeItem('ccc_token')}else localStorage.removeItem('ccc_office_token')}catch{}}
function clearSession(msg){if(window.__cdsOfficeEs){try{window.__cdsOfficeEs.close()}catch{}window.__cdsOfficeEs=null}if(state.brandingLogoSrc){try{URL.revokeObjectURL(state.brandingLogoSrc)}catch{}}state.branding=null;state.brandingLogoSrc=null;try{localStorage.removeItem('ccc_office_token');localStorage.removeItem('ccc_token')}catch{}/* Sprint 28.3: não remove ccc_client_token */state.token=null;state.user=null;state.selectedCompany=null;toast(msg||'Sua sessão expirou. Entre novamente para continuar.','warning');login()}
/** Sprint 32 — navegação de retorno central (CdsBackNav). */
function cdsRemember(meta){try{if(window.CdsBackNav)CdsBackNav.remember(state,meta||{})}catch{/* ignore */}}
function cdsBackBtn(id,label){return window.CdsBackNav?CdsBackNav.buttonHtml(id||'cdsBack',label||'← Voltar'):`<button type="button" class="btn secondary cds-back-btn" id="${id||'cdsBack'}">← Voltar</button>`}
function cdsStackBackHtml(){return(window.CdsBackNav&&CdsBackNav.depth())?cdsBackBtn('cdsBack'):''}
function cdsGoBack(opts){
  opts=opts||{};
  if(!window.CdsBackNav){
    if(typeof opts.clear==='function')opts.clear();
    if(typeof opts.after==='function')opts.after({source:'legacy'});
    else render();
    return{ok:true,source:'legacy'};
  }
  return CdsBackNav.back({
    state,
    fallbackPage:opts.fallbackPage,
    clear:opts.clear,
    after:opts.after||(()=>render()),
    syncHistory:url=>{if(!url)return;try{history.pushState({},'',url)}catch{/* ignore */}},
    ensureCompany:async companyId=>{
      if(!companyId){return}
      if(state.selectedCompany&&state.selectedCompany.id===companyId)return;
      try{state.selectedCompany=await api('/empresas/'+companyId)}catch{/* keep */}}
  });
}
function cdsBindBack(id,opts){return window.CdsBackNav?CdsBackNav.bind(id||'cdsBack',Object.assign({state,after:()=>render(),syncHistory:url=>{if(url)try{history.pushState({},'',url)}catch{}},ensureCompany:async companyId=>{if(!companyId)return;if(state.selectedCompany&&state.selectedCompany.id===companyId)return;try{state.selectedCompany=await api('/empresas/'+companyId)}catch{}}},opts||{})):false}
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));const money=c=>(Number(c||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function ApiError(message,status,code){this.name='ApiError';this.message=message;this.status=status||0;this.code=code||null}ApiError.prototype=Object.create(Error.prototype);
function humanApiError(status,payload,network){if(network)return 'Não foi possível conectar ao servidor.';if(status===401)return payload.message||'Sua sessão expirou. Entre novamente para continuar.';if(status===403)return payload.message||'Você não tem permissão para acessar este recurso.';if(status===404)return payload.message||'Registro não encontrado.';if(status===409)return payload.message||'Não foi possível concluir a operação.';if(status===422)return payload.message||'Os dados informados são inválidos.';if(status===429)return payload.message||'Muitas tentativas. Tente novamente em instantes.';if(status>=500)return payload.message||'Não foi possível concluir a operação.';return payload.message||payload.error||'Não foi possível concluir a operação.'}
function isTenantScopedPath(path){return /^\/(configuracoes|comunicacoes|tenant|auditoria|auth|notificacoes|push)(\/|$)/.test(path)}
const api=async(path,opt={})=>{const h={'Content-Type':'application/json',...(opt.headers||{})};if(state.token)h.Authorization='Bearer '+state.token;if(state.selectedCompany?.id&&!isTenantScopedPath(path))h['X-Company-Id']=state.selectedCompany.id;let r;try{r=await fetch('/api'+path,{...opt,headers:h})}catch{throw new ApiError('Não foi possível conectar ao servidor.',0,'NETWORK')}if(!r.ok){let e={};try{e=await r.json()}catch{}const err=new ApiError(humanApiError(r.status,e),r.status,e.error);if(r.status===401&&!String(path).startsWith('/auth/login')&&path!=='/auth/password')clearSession(err.message);throw err}return r.status===204?null:r.json()};
const toast=(m,type='info')=>{const x=document.createElement('div');const kinds={success:'toast-success',info:'toast-info',warning:'toast-warning',error:'toast-error'};x.className='toast '+(kinds[type]||kinds.info);x.setAttribute('role','status');x.textContent=m;document.body.append(x);setTimeout(()=>x.remove(),3600)};
const listItems=d=>Array.isArray(d)?d:(d&&d.items)||[];
function debounce(fn,ms=350){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
let pickerSeq=0;
function pagerHtml(d,key){d=d||{};const page=d.page||1,pages=d.pages||1,total=d.total||0;return `<div class="pager" data-pager="${key}"><span>${total?`${d.from}–${d.to} de ${total}`:'Nenhum registro encontrado.'}</span><div class="row-actions"><button type="button" class="btn secondary" data-dir="-1" ${page<=1?'disabled':''}>Anterior</button><span>Página ${page} de ${pages}</span><button type="button" class="btn secondary" data-dir="1" ${page>=pages?'disabled':''}>Próxima</button></div></div>`}
function bindPager(key,onChange){document.querySelectorAll(`[data-pager="${key}"] [data-dir]`).forEach(btn=>{btn.onclick=()=>{if(btn.disabled)return;onChange(Number(btn.dataset.dir))}})}
function emptyState(title,desc,action=''){return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${icon('file')}</div><h3>${title}</h3><p>${desc}</p>${action}</div>`}
function skeletonPage(){return `<div class="skeleton-page" aria-busy="true" aria-live="polite"><div class="sk-row"></div><div class="sk-grid"><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div></div><div class="sk-table"></div></div>`}
async function withList(c,loader,draw){c.innerHTML=skeletonPage();try{draw(await loader())}catch(e){c.innerHTML=emptyState('Não foi possível carregar',esc(e.message))}}
function authHeaders(path){const h={};if(state.token)h.Authorization='Bearer '+state.token;if(state.selectedCompany?.id&&!isTenantScopedPath(path||''))h['X-Company-Id']=state.selectedCompany.id;return h}
function rememberedLogin(){try{return{email:localStorage.getItem('ccc_last_email')||'',envKey:localStorage.getItem('ccc_last_env_key')||''}}catch{return{email:'',envKey:''}}}
function rememberLogin(email,envKey){try{if(email)localStorage.setItem('ccc_last_email',String(email).trim());else localStorage.removeItem('ccc_last_email');if(envKey)localStorage.setItem('ccc_last_env_key',String(envKey).trim());else localStorage.removeItem('ccc_last_env_key')}catch{/* ignore */}}
function clearRememberedLogin(){try{localStorage.removeItem('ccc_last_email');localStorage.removeItem('ccc_last_env_key');localStorage.removeItem('ccc_last_tenant')}catch{/* ignore */}}
function loginCdsMarkHtml(){return `<div class="login-office-placeholder" aria-hidden="true"><span class="login-bars"></span><div><strong>SUA CONTABILIDADE</strong><small>SOLUÇÕES PARA SEU CRESCIMENTO</small></div></div>`}
function loginOfficeBrandHtml(office){
  if(office&&(office.logo_url||office.name||office.cnpj)){
    const logo=office.logo_url?`<img class="login-office-logo" src="${esc(office.logo_url)}" alt="Logo ${esc(office.name||'da contabilidade')}">`:'';
    const name=office.name?`<strong class="login-office-name">${esc(office.name)}</strong>`:'';
    const cnpj=office.cnpj?`<span class="login-office-cnpj">CNPJ: ${esc(office.cnpj)}</span>`:'';
    return `${logo}${name}${cnpj}`;
  }
  return '';
}
function loginHeroOfficeHtml(office){
  if(office&&office.logo_url)return `<img class="login-hero-office-logo" src="${esc(office.logo_url)}" alt="Logo ${esc(office.name||'da contabilidade')}">`;
  return `<div class="login-hero-office-slot" aria-hidden="true"></div>`;
}
function showOfficePinGate(){
  document.body.innerHTML='<div class="login"><div class="login-shell" style="grid-template-columns:1fr"><div class="login-pane"><div class="login-card" id="officePinGate"></div></div></div></div>';
  const card=$('#officePinGate');
  if(!window.CdsAccessPin){card.innerHTML='<h1>Crie seu PIN de acesso</h1><p>Atualize a página para continuar.</p>';return}
  CdsAccessPin.mountBlocking(card,{
    api,
    showForgot:true,
    onForgot:async()=>{
      try{
        const r=await api('/auth/pin/reset-request',{method:'POST',body:'{}'});
        toast(r.message||'Use a recuperação de conta para definir nova senha e um novo PIN.','info');
      }catch(err){toast(err.message,'error')}
    },
    onSuccess:async()=>{
      toast('PIN cadastrado com sucesso. Seu acesso está protegido.','success');
      if(state.user){state.user.pin_configured=true;state.user.requires_pin_setup=false}
      render();
    }
  });
}
function applyLoginSession(x,remember,email,envKey){
  if(remember)rememberLogin(email,envKey||'');
  else clearRememberedLogin();
  state.token=x.token;
  setOfficeToken(x.token);
  state.user=x.user;
  if(x.office)state.loginOffice=x.office;
  if(x.user.role==='CLIENT'){window.location.href='/portal/';return}
  render();
}
function login(){
  const rem=rememberedLogin();
  const demoEmail='admin@demo.local';
  const demoPass='Admin@123';
  const guessDemo=!rem.email;
  const feat=(name,title,desc)=>`<li><span class="login-feat-ico" aria-hidden="true">${icon(name)}</span><div><b>${title}</b><small>${desc}</small></div></li>`;
  document.body.innerHTML=`<div class="login"><div class="login-shell"><aside class="login-hero"><div class="login-hero-top"><div class="login-hero-office" id="loginHeroOffice">${loginHeroOfficeHtml(null)}</div></div><div class="login-hero-mid"><h2 class="login-hero-lead">CONTABILIDADE<br><em>MAIS PRÓXIMA</em><br>DO SEU NEGÓCIO</h2><ul class="login-hero-list">${feat('chart','Gestão simplificada','Informações sempre à mão')}${feat('shield','Mais segurança','Seus dados protegidos')}${feat('users','Conexão em tempo real','Você e seu contador mais próximos')}</ul></div><div class="login-hero-bottom"><img class="login-hero-cds" src="/assets/cds-wordmark.png?v=s36-2" alt="CDS Contábil Connect"></div></aside><div class="login-pane"><form class="login-card" id="login" autocomplete="off"><div class="login-office-brand" id="loginOfficeBrand" hidden></div><div id="loginMain"><h1>Acesse sua conta</h1><p>Entre para continuar no seu ambiente contábil</p><div class="field login-input"><label for="email">E-mail</label><span class="login-input-ico">${icon('mail')}</span><input id="email" name="email" type="email" required placeholder="seu@email.com" value="${esc(rem.email||(guessDemo?demoEmail:''))}" autocomplete="username"></div><div class="field login-input login-password"><label for="password">Senha</label><span class="login-input-ico">${icon('lock')}</span><input id="password" name="password" type="password" required placeholder="••••••••" value="${guessDemo?esc(demoPass):''}" autocomplete="current-password"><button type="button" class="login-pw-toggle" id="togglePassword" aria-label="Mostrar senha" title="Mostrar senha"><svg class="pw-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div><div class="login-row"><label class="login-remember"><input type="checkbox" name="remember" ${rem.email?'checked':''}> Lembrar-me</label><button type="button" class="login-link" id="forgotPassword">Esqueci minha senha</button></div><p class="muted demo-hint" ${guessDemo?'':'hidden'}>Conta de demonstração: <b>${demoEmail}</b> / <b>${demoPass}</b></p><button class="btn login-submit" type="submit">${icon('logIn')} Entrar</button><div class="login-or"><span>OU</span></div><button type="button" class="btn login-outline" id="requestAccess">${icon('userPlus')} Criar minha conta</button></div><div id="loginEnvPick" hidden><h1>Escolha seu ambiente</h1><p>Selecione a contabilidade para continuar</p><div class="login-env-list" id="loginEnvList"></div><button type="button" class="btn login-outline" id="backFromEnv">Voltar</button></div></form><form class="login-card" id="signup" hidden autocomplete="off"><div class="login-office-brand">${loginCdsMarkHtml()}</div><h1>Criar minha conta</h1><p>Cadastre seu escritório contábil</p><div class="field login-input"><label class="sr-only" for="office_name">Razão social do escritório</label><span class="login-input-ico">${icon('building')}</span><input id="office_name" name="office_name" required placeholder="Razão social do escritório" autocomplete="organization"></div><div class="field login-input"><label class="sr-only" for="office_cnpj">CNPJ</label><span class="login-input-ico">${icon('tag')}</span><input id="office_cnpj" name="cnpj" required placeholder="CNPJ do escritório" inputmode="numeric" autocomplete="off"></div><div class="field login-input"><label class="sr-only" for="office_email">E-mail do escritório</label><span class="login-input-ico">${icon('mail')}</span><input id="office_email" name="office_email" type="email" required placeholder="E-mail principal do escritório" autocomplete="email"></div><div class="field login-input"><label class="sr-only" for="owner_name">Nome do responsável</label><span class="login-input-ico">${icon('users')}</span><input id="owner_name" name="owner_name" required placeholder="Nome do responsável" autocomplete="name"></div><div class="field login-input"><label class="sr-only" for="owner_email">E-mail do responsável</label><span class="login-input-ico">${icon('mail')}</span><input id="owner_email" name="owner_email" type="email" required placeholder="E-mail do responsável" autocomplete="username"></div><div class="field login-input"><label class="sr-only" for="owner_password">Senha</label><span class="login-input-ico">${icon('lock')}</span><input id="owner_password" name="password" type="password" required placeholder="Senha (mín. 8, letras e números)" minlength="8" autocomplete="new-password"></div><button class="btn login-submit" type="submit">${icon('userPlus')} Enviar cadastro</button><div class="login-or"><span>OU</span></div><button type="button" class="btn login-outline" id="backToLogin">Voltar ao login</button></form><footer class="login-legal"><nav><button type="button" class="login-legal-link" data-legal="termos">Termos de uso</button><button type="button" class="login-legal-link" data-legal="privacidade">Política de privacidade</button><button type="button" class="login-legal-link" data-legal="suporte">Suporte</button></nav><p>© 2026 CDS Contábil Connect. Todos os direitos reservados.</p></footer></div></div></div>`;
  const e=$('#email'),p=$('#password'),hint=document.querySelector('.demo-hint');
  const brandBox=$('#loginOfficeBrand');
  const heroOffice=$('#loginHeroOffice');
  const loginForm=$('#login'),signupForm=$('#signup');
  const loginMain=$('#loginMain'),envPick=$('#loginEnvPick'),envList=$('#loginEnvList');
  let pendingChoice=null;
  const showLogin=()=>{if(loginForm)loginForm.hidden=false;if(signupForm)signupForm.hidden=true;if(loginMain)loginMain.hidden=false;if(envPick)envPick.hidden=true;pendingChoice=null};
  const showSignup=()=>{if(loginForm)loginForm.hidden=true;if(signupForm)signupForm.hidden=false};
  const paintOffice=(office)=>{
    if(heroOffice)heroOffice.innerHTML=loginHeroOfficeHtml(office);
    if(!brandBox)return;
    const html=loginOfficeBrandHtml(office);
    if(html){brandBox.hidden=false;brandBox.innerHTML=html}
    else{brandBox.hidden=true;brandBox.innerHTML=''}
  };
  paintOffice(null);
  fetch('/api/health').then(r=>r.json()).then(h=>{
    if(h&&h.demo){
      if(e&&!e.value)e.value=demoEmail;
      if(p&&!p.value)p.value=demoPass;
      if(hint)hint.hidden=false;
      return;
    }
    if(guessDemo){
      if(e&&e.value===demoEmail)e.value='';
      if(p&&p.value===demoPass)p.value='';
      if(hint)hint.hidden=true;
    }
  }).catch(()=>{});
  $('#togglePassword')&&($('#togglePassword').onclick=()=>{
    if(!p)return;
    const show=p.type==='password';
    p.type=show?'text':'password';
    const btn=$('#togglePassword');
    btn.innerHTML=show
      ?'<svg class="pw-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.3 21.3 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/></svg>'
      :'<svg class="pw-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');
    btn.setAttribute('title',show?'Ocultar senha':'Mostrar senha');
  });
  const showEnvChoice=(payload)=>{
    pendingChoice=payload;
    if(loginMain)loginMain.hidden=true;
    if(envPick)envPick.hidden=false;
    const preferred=rem.envKey;
    const envs=(payload.environments||[]).slice().sort((a,b)=>{
      if(preferred&&a.key===preferred)return -1;
      if(preferred&&b.key===preferred)return 1;
      return String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    });
    if(envList){
      envList.innerHTML=envs.map(env=>{
        const logo=env.logo_url?`<img src="${esc(env.logo_url)}" alt="">`:'';
        const cnpj=env.cnpj?`<span>CNPJ: ${esc(env.cnpj)}</span>`:'';
        return `<button type="button" class="login-env-card" data-key="${esc(env.key)}">${logo}<div class="login-env-copy"><strong>${esc(env.name||'Contabilidade')}</strong>${cnpj}</div><span class="login-env-go">Entrar →</span></button>`;
      }).join('');
      envList.querySelectorAll('[data-key]').forEach(btn=>{
        btn.onclick=async()=>{
          const key=btn.getAttribute('data-key');
          try{
            const x=await api('/auth/login/choose',{method:'POST',body:JSON.stringify({choice_token:pendingChoice.choice_token,key})});
            const remember=!!(loginForm&&loginForm.remember&&loginForm.remember.checked);
            paintOffice(x.office||null);
            applyLoginSession(x,remember,String((e&&e.value)||'').trim(),key);
          }catch(err){toast(err.message,'error')}
        };
      });
    }
  };
  $('#backFromEnv')&&($('#backFromEnv').onclick=()=>{pendingChoice=null;if(loginMain)loginMain.hidden=false;if(envPick)envPick.hidden=true});
  loginForm&&(loginForm.onsubmit=async ev=>{
    ev.preventDefault();
    try{
      const fd=new FormData(ev.target);
      const remember=fd.get('remember')==='on';
      const body={email:fd.get('email'),password:fd.get('password')};
      const x=await api('/auth/login',{method:'POST',body:JSON.stringify(body)});
      if(x&&x.needs_environment_choice){showEnvChoice(x);return}
      paintOffice(x.office||null);
      applyLoginSession(x,remember,String(body.email||'').trim(),'');
    }catch(err){toast(err.message,'error')}
  });
  $('#forgotPassword')&&($('#forgotPassword').onclick=async()=>{
    const email=String((e&&e.value)||'').trim();
    if(!email){toast('Informe o e-mail.','warning');return}
    const msg='Enviamos as instruções para o seu e-mail cadastrado. Verifique sua caixa de entrada para criar uma nova senha.';
    try{
      const r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      const data=await r.json().catch(()=>({}));
      toast(data.message||msg,'info');
    }catch{toast(msg,'info')}
  });
  $('#requestAccess')&&($('#requestAccess').onclick=()=>showSignup());
  $('#backToLogin')&&($('#backToLogin').onclick=()=>showLogin());
  signupForm&&(signupForm.onsubmit=async ev=>{
    ev.preventDefault();
    try{
      const fd=new FormData(ev.target);
      const body={
        office_name:fd.get('office_name'),
        cnpj:fd.get('cnpj'),
        office_email:fd.get('office_email'),
        owner_name:fd.get('owner_name'),
        owner_email:fd.get('owner_email'),
        password:fd.get('password')
      };
      const r=await fetch('/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){toast(data.message||'Não foi possível concluir o cadastro.','error');return}
      toast(data.message||'Cadastro recebido. Verifique seu e-mail para confirmar e ativar a conta.','info');
      showLogin();
      if(e&&body.owner_email)e.value=String(body.owner_email);
    }catch(err){toast(err.message||'Não foi possível concluir o cadastro.','error')}
  });
  document.querySelectorAll('[data-legal]').forEach(btn=>btn.onclick=()=>toast('Fale com o escritório para receber este documento.','info'));
}
const originLabel=o=>({PORTAL_CLIENTE:'Portal do Cliente',PORTAL_ESCRITORIO:'Portal do Escritório',CDS_SISTEMAS:'CDS Sistemas',IMPORTACAO_CONTABIL:'Importação Contábil',IMPORTACAO_FISCAL:'Importação Fiscal',OUTRA_ORIGEM_FUTURA:'Outra origem',EXPENSE:'Despesa',REVENUE:'Receita',MANUAL:'Lançamento manual',CLIENT:'Portal do Cliente',OFFICE:'Portal do Escritório',BOTH:'Despesa e receita',PIX:'PIX',DINHEIRO:'Dinheiro',DEBITO:'Cartão de débito',CREDITO:'Cartão de crédito',TRANSFERENCIA:'Transferência',BOLETO:'Boleto',OUTRO:'Outro',OPEN:'Aberta',CONCLUDED:'Concluída',CANCELLED:'Cancelada',DOCUMENT:'Documento',QUESTION:'Dúvida',GENERAL:'Geral',PENDING_REVIEW:'Pendente de análise',ACTIVE:'Ativo',INACTIVE:'Inativo',HIGH:'Alta',LOW:'Baixa',NORMAL:'Normal',URGENTE:'Urgente',COMPLETED:'Concluída',PENDENTE:'Pendente',PROCESSANDO:'Processando',CONCLUIDA:'Concluída',CONCLUIDA_COM_ERROS:'Concluída com erros',ERRO:'Erro',EMAIL:'E-mail',WHATSAPP:'WhatsApp',SMS:'SMS',PENDING:'Aguardando aprovação',PENDING_APPROVAL:'Aguardando aprovação',POSTED:'Lançado',REJECTED:'Rejeitado',ACCOUNTED:'Contabilizado',NEEDS_CLASSIFICATION:'Aguardando classificação',SENT:'Enviado',FAILED:'Falhou',QUEUED:'Na fila',PROCESSING:'Processando',DELIVERED:'Entregue',META:'Meta',SMTP:'SMTP',CDS:'CDS',dominio:'Domínio',contaazul:'Conta Azul',alterdata:'Alterdata',fortes:'Fortes',questor:'Questor',sci:'SCI',RULE:'Regra contábil',CATEGORY:'Categoria',BANK:'Banco ou caixa'}[o]||'-');
function classificationReasonLabel(text){const raw=String(text||'').trim();if(!raw)return '';const map={'Nenhuma regra ou fallback suficiente.':'Não encontramos uma regra contábil para esta movimentação. Informe débito e crédito.','Classificação ambígua ou com evidência insuficiente; revisão do contador.':'Há mais de uma possibilidade. Confira as contas e confirme o lançamento.','Revisão do motor':'Informe débito e crédito desta movimentação.','Categoria vinculada a conta analítica':'Sugestão pela categoria da movimentação.','Banco/caixa vinculado a conta analítica':'Sugestão pelo banco ou caixa informado.','Somente categoria vinculada; falta contraparte':'A despesa possui categoria com conta, mas o banco ainda não possui conta contábil vinculada.','Somente banco/caixa vinculado; falta contraparte':'A despesa ainda não possui categoria contábil configurada.'};if(map[raw])return map[raw];if(/fallback/i.test(raw))return 'Não encontramos uma regra contábil para esta movimentação. Informe débito e crédito.';return raw}
function classificationReasonsText(cls){const list=(cls&&((cls.reasons&&cls.reasons.length)?cls.reasons:[cls.reason])||[]).filter(Boolean);return [...new Set(list.map(classificationReasonLabel).filter(Boolean))].join(' ')}
function classificationSourceLabel(c){if(c&&c.rule_name)return c.rule_name;return({RULE:'Regra contábil',CATEGORY:'Sugestão pela categoria',BANK:'Sugestão pelo banco ou caixa'}[c&&c.source]||'Sugestão')}
function classificationScoreLabel(score){const n=Number(score);if(!Number.isFinite(n)||n<=0)return '';const pct=n<=1?Math.round(n*100):Math.round(n);return 'Confiança '+pct+'%'}
function classificationCandidatesHtml(cls){const cands=(cls&&cls.candidates)||[];const complete=cands.filter(c=>c.debit_account_id&&c.credit_account_id);const incomplete=cands.some(c=>!(c.debit_account_id&&c.credit_account_id));const hint=incomplete&&!complete.length?'<p class="muted">Há categoria ou banco nesta despesa, mas ainda faltam as duas contas da partida. Preencha débito e crédito abaixo.</p>':'';return hint+complete.map(c=>{const i=cands.indexOf(c);const score=classificationScoreLabel(c.score);return `<button type="button" class="btn secondary cand" data-i="${i}">Usar: ${esc(classificationSourceLabel(c))}${score?' · '+score:''}</button>`}).join('')}
function confidencePct(x){const n=Number((x&&(x.confidence??x.score))??0);if(!Number.isFinite(n)||n<=0)return 0;return n<=1?Math.round(n*100):Math.round(n)}
function suggestionPanel(cls){const cands=(cls&&cls.candidates)||[];const best=cands.find(c=>c.debit_account_id&&c.credit_account_id);const pct=confidencePct(best||cls);const acc=id=>(state.accounts||[]).find(a=>a.id===id);const d=best&&acc(best.debit_account_id);const low=!best||pct<70;const title=low?'Revisão necessária':'Sugestão do sistema';const dx=(cls&&cls.diagnosis&&cls.diagnosis.messages)||[];const diag=dx.length?`<ul class="muted">${dx.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:'';const detail=best&&d?`${esc(d.description)}<br><code>${esc(d.account_code)}</code>${pct?` · Confiança ${pct}%`:''}`:esc(classificationReasonsText(cls)||'Informe débito e crédito.');return `<div class="panel" style="margin-bottom:12px"><b>${title}</b><div class="muted">${detail}</div>${diag}${classificationCandidatesHtml(cls)}</div>`}
function queueBanner(total,kpi,hint){return `<div class="grid cards" style="grid-template-columns:minmax(140px,180px) 1fr;align-items:center;margin-bottom:14px"><div class="card kpi-card"><div class="value">${total||0}</div><div class="label">${esc(kpi)}</div></div><p class="muted">${hint}</p></div>`}
function queueFiltersHtml(id,f){f=f||{};return `<form class="filters" id="${id}"><input type="date" name="from" aria-label="Início do período" value="${esc(f.from||'')}"><input type="date" name="to" aria-label="Fim do período" value="${esc(f.to||'')}"><input name="q" aria-label="Busca" placeholder="Busca" value="${esc(f.q||'')}"><button class="btn light" type="submit">Filtrar</button></form>`}
function timelineHtml(items,status){const map={CREATE:'Recebido',ENTRY_CREATED:'Recebido',RECLASSIFY:'Classificado',CLASSIFICATION_COMPLETED:'Classificado',ENTRY_APPROVED:'Classificação aprovada',ENTRY_POSTED:'Lançamento efetivado',ENTRY_REJECTED:'Rejeitado',CLASSIFICATION_REQUIRED:'Aguardando classificação'};const rows=(items||[]).map(x=>{const label=map[x.action];if(!label)return '';return `<div>${esc(label)}${x.user_name?' por '+esc(x.user_name):''}</div>`}).filter(Boolean);if(rows.length)return `<div class="muted">${rows.join('<div>↓</div>')}</div>`;const fallback={NEEDS_CLASSIFICATION:'Recebido → Aguardando classificação',PENDING:'Recebido → Classificado → Aguardando aprovação',POSTED:'Recebido → Classificado → Aprovado → Lançamento efetivado'}[status];return fallback?`<div class="muted">${fallback}</div>`:''}
function nLinesHtml(e){const lines=e.lines||[];const d=lines.filter(l=>l.side==='D'),c=lines.filter(l=>l.side==='C');const row=l=>`<li>${esc(l.account_code||'')} — ${esc(l.account_description||'')} · ${money(l.amount_cents)}</li>`;return `<div class="form-grid"><div><b>Débitos</b><ul>${d.map(row).join('')||'<li class="muted">—</li>'}</ul><p>Total Débitos: ${money(e.debit||0)}</p></div><div><b>Créditos</b><ul>${c.map(row).join('')||'<li class="muted">—</li>'}</ul><p>Total Créditos: ${money(e.credit||0)}</p></div></div><p>${e.balanced?'<span class="badge approved">Balanceado</span>':'<span class="badge rejected">Não balanceado</span>'}</p>`}
function entryDocKind(d){const mime=String(d&&d.mime_type||'').toLowerCase();const name=String(d&&d.original_name||'').toLowerCase();if(mime.startsWith('image/')||/\.(png|jpe?g|gif|webp|bmp)$/i.test(name))return 'image';if(mime==='application/pdf'||name.endsWith('.pdf'))return 'pdf';return 'other'}
function revokeEntryDocPreview(){if(state.entryDocObjectUrl){try{URL.revokeObjectURL(state.entryDocObjectUrl)}catch{}state.entryDocObjectUrl=null}}
function entryDocumentHtml(e){const d=e&&e.document;if(!d)return '<p class="muted">Nenhum documento vinculado.</p>';const kind=entryDocKind(d);const preview=kind==='other'?`<div class="entry-doc-preview entry-doc-preview--empty" id="entryDocPreview"><p class="muted">Pré-visualização indisponível para este tipo de arquivo.</p></div>`:`<div class="entry-doc-preview" id="entryDocPreview" data-kind="${kind}" aria-busy="true"><div class="entry-doc-preview-loading muted">Carregando pré-visualização…</div></div>`;return `${preview}<p class="entry-doc-name"><b>${esc(d.original_name)}</b></p><div class="row-actions"><button type="button" class="btn secondary" id="viewEntryDoc">Visualizar</button></div>`}
function bindEntryDoc(e){const d=e&&e.document;const b=$('#viewEntryDoc');if(b&&d)b.onclick=()=>viewOfficeDocument(d.id,d.original_name,d.mime_type||'',d.size_bytes||0);const box=$('#entryDocPreview');if(!box||!d)return;const kind=box.dataset.kind||entryDocKind(d);if(kind==='other')return;revokeEntryDocPreview();(async()=>{try{const r=await fetch('/api/documentos/'+d.id+'/view',{headers:authHeaders('/documentos/'+d.id+'/view'),cache:'no-store'});if(!r.ok)throw Error('Falha ao carregar documento');const blob=await r.blob();const url=URL.createObjectURL(blob);state.entryDocObjectUrl=url;if(!$('#entryDocPreview')){URL.revokeObjectURL(url);state.entryDocObjectUrl=null;return}if(kind==='image')box.innerHTML=`<img src="${url}" alt="Pré-visualização de ${esc(d.original_name)}">`;else box.innerHTML=`<iframe title="Pré-visualização do PDF" src="${url}#toolbar=0"></iframe>`;box.setAttribute('aria-busy','false')}catch{if($('#entryDocPreview')){$('#entryDocPreview').innerHTML='<p class="muted">Não foi possível carregar a pré-visualização.</p>';$('#entryDocPreview').setAttribute('aria-busy','false')}}})()}
function reviewChecksHtml(e){const items=[[!!(e.lines&&e.lines.length>=2),'Classificação definida'],[e.balanced,'Débito = Crédito'],[!!e.company_id||!!e.company_name,'Empresa identificada'],[!!e.document,'Documento disponível']];return `<ul class="muted">${items.map(([ok,l])=>`<li>${ok?'✓':'⚠'} ${l}</li>`).join('')}${e.balanced?'':'<li>⚠ Necessário revisar classificação</li>'}</ul>`}
function movementFactsHtml(e){const m=e.movement||{};return `<p><b>${esc(e.description)}</b></p><p class="muted">${esc(e.company_name||'-')} · ${esc(e.occurred_on||'-')} · ${money(m.amount_cents||e.debit||e.source_cents||0)}</p><p class="muted">Pagamento: ${esc(originLabel(m.method||'-'))} · Banco: ${esc(m.bank_name||'Não informado')} · Origem: ${esc(originLabel(e.origin||e.source_type))}</p>`}
const menuGroups=[{title:'GESTÃO',items:[['empresas','Empresas','building'],['usuarios','Equipe e acessos','users'],['processos','Processos','check'],['documentos','Documentos','file'],['pendencias','Pendências','message'],['solicitacoes','Solicitações','message'],['importacoes','Importações','file'],['despesas','Despesas','arrowDown']]},{title:'CONFIGURAÇÕES',items:[['comunicacoes','Comunicações','message'],['ia','Inteligência Artificial','settings']]},{title:'FILAS DE TRABALHO',items:[['classificacao','Classificação','tag'],['aprovacao','Aprovação','check']]},{title:'CONFIGURAÇÕES CONTÁBEIS',items:[['plano','Plano de Contas','book'],['categorias','Categorias','tag'],['bancos','Bancos','bank'],['regras','Regras Contábeis','settings']]},{title:'RELATÓRIOS',items:[['exportacoes','Exportações','chart'],['fechamento','Fechamento Contábil','check']]},{title:'SISTEMA',items:[['configuracoes','Configurações','settings'],['auditoria','Auditoria','shield']]}];
const contextMenuGroups=[{title:'OPERAÇÃO',items:[['dashboard','Visão geral','home'],['despesas','Despesas','arrowDown'],['documentos','Documentos','file'],['solicitacoes','Solicitações','message']]},{title:'CONTÁBIL',items:[['classificacao','Classificação','tag'],['lancamentos','Lançamentos','book'],['aprovacao','Aprovação','check'],['fechamento','Fechamento Contábil','check'],['integracoes','Integrações','settings']]},{title:'IMPORTAÇÃO',items:[['importacoes','Importações','file']]},{title:'ACESSO',items:[['usuarios','Usuários','users']]}];
const companyContextNav=contextMenuGroups.flatMap(g=>g.items.map(([p,l])=>[p,l]));
const officeOnly=['aprovacao','plano','regras','exportacoes','fechamento','usuarios','auditoria','comunicacoes'];
function activeNavGroups(){return state.selectedCompany?contextMenuGroups:menuGroups}
function navLabel(page){const hit=activeNavGroups().flatMap(g=>g.items).find(x=>x[0]===page);if(hit)return hit[1];return page==='dashboard'?'Início':page}
const icon=(name,cls='')=>{const paths={building:'<path d="M3 21h18M5 21V5l7-3 7 3v16M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-3a3 3 0 0 1 0 6m4 7v-2a4 4 0 0 0-3-3"/>',file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h6"/>',message:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.4 9.4 0 0 1-4-.9L3 21l1.9-4A8.4 8.4 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>',arrowDown:'<path d="M12 3v14m-5-5 5 5 5-5M5 21h14"/>',arrowUp:'<path d="M12 21V7m5 5-5-5-5 5M5 3h14"/>',book:'<path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3Zm0 0v17m3-14h9"/>',check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',tag:'<path d="m20 13-7 7-10-10V3h7l10 10Z"/><circle cx="7" cy="7" r="1"/>',bank:'<path d="m3 10 9-7 9 7M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18"/>',settings:'<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2A2 2 0 0 0 5.8 18l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a2 2 0 0 0-1.4-3.4h-.3a2 2 0 1 1 0-4h.2A2 2 0 0 0 3 4.4l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a2 2 0 0 0 3.4-1.4v-.3a2 2 0 1 1 4 0v.2A2 2 0 0 0 16.6 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0 1.4 3.4h.3a2 2 0 1 1 0 4h-.2a2 2 0 0 0-1.5 3.8Z"/>',chart:'<path d="M4 19V5m0 14h16M8 16v-4m4 4V8m4 8V5"/>',shield:'<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',logIn:'<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',userPlus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-4v6m3-3h-6"/>',home:'<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6"/>',bell:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a1.8 1.8 0 0 0 3.4 0"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',chevron:'<path d="m9 18 6-6-6-6"/>',collapse:'<path d="m15 18-6-6 6-6"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4m.05 3h.1"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};return `<svg class="menu-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.file}</svg>`};
const initials=name=>String(name||'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'US';const roleLabel=role=>({OWNER:'Administrador',ACCOUNTANT:'Contador',STAFF:'Equipe',CLIENT:'Cliente'}[role]||role);const translateRoleOptions=()=>document.querySelectorAll('select[name="role"] option').forEach(option=>{const label=roleLabel(option.value||option.textContent);if(option.textContent!==label)option.textContent=label});new MutationObserver(translateRoleOptions).observe(document.body,{childList:true,subtree:true});
const sidebarCounters={};
async function loadBase(){const keep=p=>p.catch(e=>{if(e&&e.status===401)throw e;return null});const [plans,categories,banks,rules,tenant,branding]=await Promise.all([keep(api('/plano-contas')),keep(api('/categorias')),keep(api('/bancos')),keep(api('/regras-contabeis')),keep(api('/tenant')),keep(api('/tenant/branding'))]);state.plans=plans||[];state.categories=categories||[];state.banks=banks||[];state.rules=rules||[];state.tenant=tenant||state.tenant||null;state.companies=[];await applyBranding(branding);if(state.plans[0])state.accounts=await keep(api('/plano-contas/'+state.plans[0].id+'/accounts'))||[]}
async function applyBranding(payload){state.branding=payload||null;if(state.brandingLogoSrc){try{URL.revokeObjectURL(state.brandingLogoSrc)}catch{}state.brandingLogoSrc=null}if(!payload||!(payload.has_logo||payload.configured))return;try{const url=payload.logo_url&&payload.logo_url.startsWith('/api/')?payload.logo_url:'/api/tenant/branding/logo';const r=await fetch(url,{headers:authHeaders('/tenant/branding/logo')});if(!r.ok)return;state.brandingLogoSrc=URL.createObjectURL(await r.blob())}catch(e){if(e&&e.status===401)throw e}}
function officeIdentityHtml(){const b=state.branding||{};const name=b.office_name||(state.tenant&&state.tenant.name)||state.user&&state.user.tenant_name||'Escritório';const copy=`<div><small>ESCRITÓRIO</small><strong>${esc(name)}</strong>${b.slogan?`<small>${esc(b.slogan)}</small>`:state.brandingLogoSrc?'':`<small>Configure a identidade do seu escritório</small>`}</div>`;if(state.brandingLogoSrc)return `<aside class="office-identity side-office-card" id="officeIdentity"><img src="${state.brandingLogoSrc}" alt="Logo do escritório ${esc(name)}">${copy}</aside>`;return `<aside class="office-identity placeholder side-office-card" id="officeIdentity"><div class="office-mark">${esc(initials(name))}</div>${copy}</aside>`}
async function loadSidebarCounters(){const safe=promise=>promise.catch(e=>{if(e&&e.status===401)throw e;return{items:[],total:0,length:0,unread_total:0}});const [dash,companies,reqs]=await Promise.all([safe(api('/dashboard')),safe(api('/empresas?page=1&page_size=1')),safe(api('/solicitacoes/nao-lidas'))]);sidebarCounters.empresas=companies.total||0;sidebarCounters.documentos=dash.documents_received||dash.documents||null;sidebarCounters.solicitacoes=Number(reqs.unread_total||0)||null;sidebarCounters.pendencias=dash.companies_with_pendencies||null;sidebarCounters.despesas=null;sidebarCounters.receitas=null;sidebarCounters.aprovacao=Number(dash.entries_awaiting_approval||dash.pending||0)||null;sidebarCounters.classificacao=Number(dash.expenses_awaiting_classification||0)||null;sidebarCounters.lancamentos=null;sidebarCounters.usuarios=null}
function greetUser(){const h=new Date().getHours();const g=h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';return `${g}, ${esc((state.user.name||'').split(' ')[0]||'olá')}!`}
function officeClockHtml(){const now=new Date();const date=now.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});const time=now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});return `<div class="ops-clock" aria-label="${esc(date)}, ${esc(time)}"><span>${esc(date)}</span><strong>${esc(time)}</strong></div>`}
function systemStatusHtml(){return `<span class="ops-sys-status" title="Sistema operacional"><i aria-hidden="true"></i> Sistema online</span>`}
function originBars(origins){const rows=origins&&origins.length?origins.slice():[];if(!rows.some(x=>x.origin==='CDS_SISTEMAS'||x.origin_label==='CDS Sistemas'))rows.push({origin:'CDS_SISTEMAS',origin_label:'CDS Sistemas',count:0});const max=Math.max(1,...rows.map(x=>Number(x.count||0)));return rows.map(x=>`<div class="origin-bar"><span>${esc(x.origin_label||originLabel(x.origin))}</span><div class="bar" aria-hidden="true"><i style="width:${Math.round(100*Number(x.count||0)/max)}%"></i></div><b>${Number(x.count||0)}</b></div>`).join('')}
function donutHtml(parts){const total=parts.reduce((a,p)=>a+Number(p.value||0),0);if(!total)return emptyState('Sem série histórica','Ainda não há dados suficientes para o gráfico da carteira.');let acc=0;const circ=2*Math.PI*36;const rings=parts.filter(p=>p.value>0).map(p=>{const frac=p.value/total;const len=circ*frac;const dash=len+' '+(circ-len);const rot=(acc/total)*360-90;acc+=p.value;return `<circle cx="50" cy="50" r="36" fill="none" stroke="${p.color}" stroke-width="12" stroke-dasharray="${dash}" stroke-linecap="round" transform="rotate(${rot} 50 50)"/>`}).join('');return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="36" fill="none" stroke="#e7eeec" stroke-width="12"/>${rings}</svg><div class="legend">${parts.map(p=>`<div><span class="badge ${p.cls}">${esc(p.label)}</span><b>${p.value}</b></div>`).join('')}</div></div>`}
function renderBadge(page){const value=Number(sidebarCounters[page]||0);return value>0?`<span class="menu-badge">${value}</span>`:''}
function renderMenuItem(item){const [page,label,iconName]=item;const allowed=!officeOnly.includes(page)||['OWNER','ACCOUNTANT','STAFF'].includes(state.user.role);if(!allowed)return '';return `<button class="menu-item ${state.page===page?'active':''}" data-page="${page}" title="${esc(label)}" aria-label="Abrir ${esc(label)}">${icon(iconName)}<span class="menu-label">${esc(label)}</span>${renderBadge(page)}${icon('chevron','menu-chevron')}</button>`}
function renderSidebar(){
  const groups=activeNavGroups();
  const office=esc(roleLabel(state.user.role));
  const b=state.branding||{};
  const officeName=b.office_name||(state.tenant&&state.tenant.name)||state.user.tenant_name||'Escritório';
  const headLogo=state.brandingLogoSrc
    ?`<img class="brand-mark brand-mark-office" src="${state.brandingLogoSrc}" alt="Logo ${esc(officeName)}" width="40" height="40">`
    :`<img class="brand-mark" src="/assets/cds-pwa-192.png?v=s28-4-2" alt="CDS Contábil Connect" width="40" height="40">`;
  const headTitle=state.brandingLogoSrc||b.office_name||(state.tenant&&state.tenant.name)
    ?`<strong>${esc(officeName)}</strong><small>${esc(b.slogan||'Escritório contábil')}</small>`
    :`<strong>CONTÁBIL CONNECT</strong><small>Conectando empresas ao futuro contábil</small>`;
  return `<aside class="side" id="sidebar"><div class="sidebar-head">${headLogo}<div class="brand-copy">${headTitle}</div><button class="icon-button sidebar-toggle" id="collapseSidebar" aria-label="Recolher menu" title="Recolher menu">${icon('collapse')}</button></div><div class="profile-card"><div class="avatar">${initials(state.user.name)}</div><div class="profile-copy"><strong>${esc(state.user.name)}</strong><small>${office}</small><small>${esc(state.user.tenant_name||'Escritório contábil')}</small></div></div><div class="menu-search"><label for="menuSearch" class="sr-only">Buscar no menu</label>${icon('search')}<input id="menuSearch" placeholder="Buscar no menu..." autocomplete="off"><kbd>Ctrl K</kbd></div><nav class="sidebar-nav" id="sidebarNav">${state.selectedCompany?'':`<button class="menu-item dashboard-link ${state.page==='dashboard'?'active':''}" data-page="dashboard" title="Início" aria-label="Abrir Início">${icon('home')}<span class="menu-label">Início</span>${icon('chevron','menu-chevron')}</button>`}${groups.map(group=>`<section class="menu-group"><h2>${group.title}</h2>${group.items.map(renderMenuItem).join('')}</section>`).join('')}</nav><footer class="sidebar-footer"><button class="footer-action logout-link" id="logout" aria-label="Sair do sistema">${icon('shield')}<span class="menu-label">Sair do sistema</span></button></footer></aside>`;
}
async function restoreCompanyFromUrl(){
  const deep=location.pathname.match(/^\/empresas\/([^/]+)\/solicitacoes\/([^/]+)\/?$/);
  if(deep){
    const companyId=deep[1], requestId=deep[2];
    try{
      const x=await api('/empresas/'+companyId);
      state.selectedCompany={id:x.id,name:x.name,trade_name:x.trade_name,cnpj:x.cnpj,status:x.status};
      state.page='solicitacoes';
      state.requestView=requestId;
      return;
    }catch{history.replaceState({},'','/');state.page='empresas';toast('Não foi possível acessar esta empresa.');return}
  }
  const m=location.pathname.match(/^\/empresas\/([^/]+)\/?$/);
  if(!m){state.selectedCompany=null;return}
  if(state.selectedCompany?.id===m[1])return;
  state.selectedCompany=null;
  try{
    const x=await api('/empresas/'+m[1]);
    state.selectedCompany={id:x.id,name:x.name,trade_name:x.trade_name,cnpj:x.cnpj,status:x.status};
    if(!state.page||state.page==='empresas')state.page='dashboard';
  }catch{history.replaceState({},'','/');state.page='empresas';toast('Não foi possível acessar esta empresa.')}
}
async function enterCompany(id,page){
  const requestId=arguments.length>2?arguments[2]:null;
  try{
    state.selectedCompany=null;
    const x=await api('/empresas/'+id);
    state.selectedCompany={id:x.id,name:x.name,trade_name:x.trade_name,cnpj:x.cnpj,status:x.status};
    state.companyView=null;
    state.companyUsers=null;
    state.page=page||'dashboard';
    if(requestId){
      state.requestView=requestId;
      state.page='solicitacoes';
      history.pushState({company:x.id,request:requestId},'','/empresas/'+x.id+'/solicitacoes/'+requestId);
    }else{
      state.requestView=null;
      history.pushState({company:x.id},'', '/empresas/'+x.id);
    }
    await render();
  }catch(err){toast(err.message)}
}
function openRequestConversation(companyId,requestId){
  cdsRemember({fallbackPage:'solicitacoes',label:'Solicitações',kind:'requestView'});
  if(state.selectedCompany&&state.selectedCompany.id===companyId){
    state.requestView=requestId;
    state.page='solicitacoes';
    history.pushState({company:companyId,request:requestId},'','/empresas/'+companyId+'/solicitacoes/'+requestId);
    return render();
  }
  return enterCompany(companyId,'solicitacoes',requestId);
}
function leaveCompany(){try{if(window.CdsBackNav)CdsBackNav.clear()}catch{}state.selectedCompany=null;state.page='empresas';state.requestView=null;history.pushState({},'','/');render()}
function requestStatusLabel(s){
  const n=String(s||'').toUpperCase();
  return({AGUARDANDO_CLIENTE:'Aguardando cliente',AGUARDANDO_ESCRITORIO:'Aguardando escritório',CONCLUDED:'Concluída',CONCLUIDA:'Concluída',CANCELLED:'Cancelada',CANCELADA:'Cancelada',OPEN:'Aguardando cliente',RESPONDED:'Aguardando escritório',PENDING:'Aguardando cliente'}[n]||originLabel(s)||n||'-');
}
function isRequestClosed(s){return ['CONCLUDED','CANCELLED','CONCLUIDA','CANCELADA'].includes(String(s||'').toUpperCase())}
function requestPreview(x){
  const m=x.last_message;
  if(!m||!m.message)return 'Sem mensagens ainda';
  const who=m.role==='CLIENT'?'Cliente':'Escritório';
  const text=String(m.message).length>80?String(m.message).slice(0,80)+'…':m.message;
  return who+': '+text;
}
function fmtMsgTime(ts){
  if(!ts)return '';
  try{
    const d=new Date(String(ts).replace(' ','T'));
    if(Number.isNaN(d.getTime()))return String(ts).slice(0,16);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  }catch{return String(ts).slice(0,16)}
}
function showRequestAlert(payload){
  showCenterAlert({
    headline:'Nova mensagem',
    company_name:payload.company_name,
    description:payload.title?('respondeu à solicitação · '+payload.title):'respondeu à solicitação.',
    preview:payload.preview||'Nova mensagem na solicitação.',
    actionLabel:'Abrir conversa',
    dedupeKey:(payload.request_id||'')+'|'+(payload.message_id||payload.preview||''),
    onOpen:()=>{if(payload.company_id&&payload.request_id)openRequestConversation(payload.company_id,payload.request_id)}
  });
}
function showCenterAlert(payload){
  const dedupeKey=payload.dedupeKey||(payload.type||'')+'|'+(payload.entity_id||'')+'|'+(payload.preview||payload.headline||'');
  if(window.__cdsCenterAlertKey===dedupeKey)return;
  window.__cdsCenterAlertKey=dedupeKey;
  const existing=$('#reqMsgAlert');
  if(existing)existing.remove();
  const company=esc(payload.company_name||'');
  const headline=esc(payload.headline||'Atualização');
  const description=esc(payload.description||payload.message||'');
  const preview=esc(payload.preview||'');
  const actionLabel=esc(payload.actionLabel||'Abrir');
  document.body.insertAdjacentHTML('beforeend',`<div class="req-msg-alert" id="reqMsgAlert" role="status"><div class="req-msg-alert-inner"><div class="req-msg-alert-brand"><img src="/assets/cds-pwa-192.png" alt="" width="36" height="36"><div><strong>CDS Contábil Connect</strong><small>${headline}</small></div></div><div class="req-msg-alert-body">${company?`<div class="req-msg-alert-co">${company}</div>`:''}${description?`<div>${description}</div>`:''}${preview?`<div class="muted req-msg-alert-preview">"${preview}"</div>`:''}</div><div class="req-msg-alert-actions"><button type="button" class="btn" id="reqMsgOpen">${actionLabel}</button><button type="button" class="btn secondary" id="reqMsgDismiss">Fechar</button></div></div></div>`);
  $('#reqMsgDismiss').onclick=()=>{$('#reqMsgAlert')?.remove();window.__cdsCenterAlertKey=null};
  $('#reqMsgOpen').onclick=()=>{$('#reqMsgAlert')?.remove();window.__cdsCenterAlertKey=null;if(typeof payload.onOpen==='function')payload.onOpen()};
  setTimeout(()=>{$('#reqMsgAlert')?.classList.add('fade');setTimeout(()=>{$('#reqMsgAlert')?.remove();window.__cdsCenterAlertKey=null},400)},12000);
}
function notifActionPage(n){
  const t=String(n.type||'');
  if(/REQUEST/.test(t)||n.entity_type==='request')return 'solicitacoes';
  if(/DOCUMENT/.test(t)||n.entity_type==='document')return 'documentos';
  if(/EXPENSE|REVENUE/.test(t)||n.entity_type==='expense'||n.entity_type==='revenue')return 'despesas';
  if(/CLASSIFICATION|ENTRY_CREATED/.test(t))return 'classificacao';
  if(/APPROVAL|ENTRY_APPROVED|ENTRY_REJECTED|ENTRY_POSTED/.test(t))return 'aprovacao';
  if(/PROCESS/.test(t))return 'processos';
  if(/IMPORT|INTEGRATION/.test(t))return 'importacoes';
  if(/PENDENCY/.test(t))return 'pendencias';
  return entityPage[n.entity_type]||'dashboard';
}
function pendencyKind(x){const type=String(x.entity_type||'').toUpperCase();const reason=String(x.reason||'').toLowerCase();const st=String(x.entry_status||x.related_status||'').toUpperCase();if(type==='DOCUMENT'||type==='DOCUMENTS'||/documento/.test(reason))return 'DOCUMENT';if(type==='REQUEST'||type==='SOLICITACAO'||/solicita/.test(reason))return 'REQUEST';if(type==='IMPORT'||type==='MOVEMENT_IMPORT'||/importa/.test(reason))return 'IMPORT';if(type==='EXPENSE'||(type!=='ENTRY'&&/despesa/.test(reason)))return 'EXPENSE';if(st==='PENDING'||st==='PENDING_APPROVAL'||/aprova/.test(reason))return 'APPROVAL';if(type==='ENTRY'||st==='NEEDS_CLASSIFICATION'||/classific/.test(reason))return 'CLASSIFICATION';return 'UNKNOWN'}
function pendencyCopy(x){const kind=pendencyKind(x);const happened=x.reason||x.title||x.description||'-';return({CLASSIFICATION:{happened:happened||'Movimentação aguardando classificação',need:'Classificar a movimentação'},APPROVAL:{happened:'Classificação aguardando aprovação',need:'Revisar e aprovar a classificação'},DOCUMENT:{happened,need:'Conferir o documento'},REQUEST:{happened,need:'Responder a solicitação'},IMPORT:{happened,need:'Conferir a importação'},EXPENSE:{happened,need:'Conferir a despesa'},UNKNOWN:{happened,need:x.status==='OPEN'?'Informar ou regularizar o item.':'Acompanhar o andamento.'}}[kind])}
function pendencyAction(x,inCompany){const kind=pendencyKind(x);const dest={CLASSIFICATION:{page:'classificacao',label:'Classificar →'},APPROVAL:{page:'aprovacao',label:'Aprovar →'},DOCUMENT:{page:'documentos',label:'Ver documento →'},REQUEST:{page:'solicitacoes',label:'Ver solicitação →'},IMPORT:{page:'importacoes',label:'Ver importação →'},EXPENSE:{page:'despesas',label:'Ver despesa →'},UNKNOWN:{page:null,label:'Ver detalhes'}}[kind];if(!inCompany)return{page:dest.page,label:'Acessar empresa →',enter:true};return dest}
function openPendency(x){const inCompany=!!(state.selectedCompany&&x.company_id&&state.selectedCompany.id===x.company_id);const act=pendencyAction(x,inCompany);if(inCompany){if(act.page){state.page=act.page;render()}return}if(x.company_id)enterCompany(x.company_id,act.page||(pendencyKind(x)==='CLASSIFICATION'?'classificacao':'pendencias'))}
function timeAgo(iso){if(!iso)return '';const t=new Date(iso).getTime();if(Number.isNaN(t))return iso;const s=Math.max(0,Math.round((Date.now()-t)/1000));if(s<60)return 'há instantes';if(s<3600)return 'há '+Math.floor(s/60)+' min';if(s<86400)return 'há '+Math.floor(s/3600)+' h';return 'há '+Math.floor(s/86400)+' d'}
const entityPage={expense:'despesas',revenue:'receitas',document:'documentos',entry:'lancamentos',request:'solicitacoes',pendency:'pendencias'};
const NOTIF_POLL_VISIBLE_MS=5000;
const NOTIF_POLL_HIDDEN_MS=30000;
function dedupeNotifications(items){const seen=new Set();const out=[];for(const n of items||[]){if(!n||!n.id||seen.has(n.id))continue;seen.add(n.id);out.push(n)}return out}
async function loadNotifications(since,opts){const unreadOnly=opts&&opts.unreadOnly;const q='?page=1&page_size=25'+(since?'&since='+encodeURIComponent(since):'')+(unreadOnly?'&unread=1':'');const data=await api('/notificacoes'+q);data.items=dedupeNotifications(data.items||[]);state.notifications=data;state.unread=data.unread||0;return data}
function paintNotifList(items){const box=$('#notifList');if(!box)return;const list=dedupeNotifications(items).filter(n=>!n.read_at);if(!list.length){box.innerHTML=emptyState('Nenhuma notificação','Você está em dia. Novos avisos aparecerão aqui.');return}box.innerHTML=list.map(n=>`<button type="button" class="notif-item unread" data-id="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.message)}</span>${n.context?`<small>${esc(n.context)}</small>`:''}<small>${esc(timeAgo(n.created_at))} · não lida</small>${n.occurrence_id?'<small><b>Abrir processo →</b></small>':''}</button>`).join('');box.querySelectorAll('.notif-item').forEach(btn=>btn.onclick=()=>openNotification(btn.dataset.id))}
function applyNotifBadge(data){const unread=data&&data.unread||0;const badge=$('#notifBadge');if(badge){badge.textContent=unread||'';badge.hidden=!(unread>0)}const label=$('#notifLabel');if(label)label.textContent='Notificações'+(unread?` (${unread})`:'');const toggle=$('#notifToggle');if(toggle)toggle.setAttribute('aria-label',unread?`Notificações (${unread})`:'Notificações')}
async function refreshNotifBadge(){if(!state.token||!state.user||state.user.role==='CLIENT')return;try{const data=await loadNotifications(null,{unreadOnly:true});applyNotifBadge(data);const panel=$('#notifPanel');if(panel&&!panel.hidden)paintNotifList(data.items||[])}catch{/* inbox poll must never take down the portal */}}
function startNotifPoll(){if(window.__cdsNotifTimer){clearInterval(window.__cdsNotifTimer);window.__cdsNotifTimer=null}if(window.__cdsNotifVisBound){document.removeEventListener('visibilitychange',window.__cdsNotifVisBound);window.__cdsNotifVisBound=null}const arm=()=>{if(window.__cdsNotifTimer)clearInterval(window.__cdsNotifTimer);const ms=document.hidden?NOTIF_POLL_HIDDEN_MS:NOTIF_POLL_VISIBLE_MS;window.__cdsNotifTimer=setInterval(()=>refreshNotifBadge(),ms)};window.__cdsNotifVisBound=()=>{arm();if(!document.hidden)refreshNotifBadge()};document.addEventListener('visibilitychange',window.__cdsNotifVisBound);arm();refreshNotifBadge()}
function notifHtml(){const unread=state.unread||0;return `<div class="notif-wrap" id="notifWrap"><button type="button" class="icon-button notif-bell" id="notifToggle" aria-label="${unread?`Notificações (${unread})`:'Notificações'}">${icon('bell')}${unread?`<span class="notif-badge" id="notifBadge">${unread}</span>`:'<span class="notif-badge" id="notifBadge" hidden></span>'}</button><div class="notif-panel" id="notifPanel" hidden><div class="notif-head"><strong id="notifLabel">Notificações${unread?` (${unread})`:''}</strong><div class="notif-head-actions"><button type="button" class="btn secondary" id="notifHistory">Histórico</button><button type="button" class="btn secondary" id="notifReadAll">Marcar todas</button></div></div><div id="notifList" class="notif-list"><div class="empty-state"><h3>Carregando avisos</h3><p>Buscando notificações do escritório.</p></div></div></div></div>`}
async function drawNotifList(){const box=$('#notifList');if(!box)return;box.innerHTML='<div class="empty">Carregando...</div>';try{const data=await loadNotifications(null,{unreadOnly:true});applyNotifBadge(data);paintNotifList(data.items||[])}catch(e){box.innerHTML=`<div class="empty">Erro: ${esc(e.message)}</div>`}}
function formatNotifDateTime(iso){if(!iso)return{date:'-',time:'-'};const d=new Date(iso);if(Number.isNaN(d.getTime()))return{date:String(iso),time:''};return{date:d.toLocaleDateString('pt-BR'),time:d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}}
async function openNotifHistory(){
  try{
    const data=await api('/notificacoes?page=1&page_size=50');
    const list=dedupeNotifications(data.items||[]);
    const rows=list.map(n=>{
      const dt=formatNotifDateTime(n.created_at);
      const origin=n.company_name||n.context||'-';
      const entity=[n.entity_type,n.entity_id].filter(Boolean).join(' · ')||'-';
      return `<tr><td><b>${esc(n.title||'')}</b><div class="muted">${esc(n.message||'')}</div></td><td>${esc(dt.date)}<br><small>${esc(dt.time)}</small></td><td>${esc(n.type||'-')}</td><td>${esc(origin)}</td><td><small>${esc(entity)}</small></td><td>${n.read_at?'Lida':'Não lida'}</td></tr>`;
    }).join('')||`<tr><td colspan="6">${emptyState('Histórico vazio','As notificações lidas permanecerão aqui.')}</td></tr>`;
    modal(`${modalHead('Histórico de notificações','Avisos lidos e não lidos. O dropdown principal mostra apenas não lidas.')}<div class="modal-body"><div class="panel table-wrap"><table class="table"><thead><tr><th>Título / mensagem</th><th>Data</th><th>Tipo</th><th>Origem</th><th>Entidade</th><th>Leitura</th></tr></thead><tbody>${rows}</tbody></table></div></div>${modalFoot('<button type="button" class="btn" onclick="closeModal()">Fechar</button>')}`,'lg');
  }catch(err){toast(err.message||'Não foi possível abrir o histórico.')}
}
async function openNotification(id){const n=(state.notifications?.items||[]).find(x=>x.id===id);try{await api('/notificacoes/'+id+'/lida',{method:'POST',body:'{}'})}catch{}
  $('#notifPanel')&&($('#notifPanel').hidden=true);
  await refreshNotifBadge();
  if(!n)return;
  if(n.occurrence_id){
    try{state.selectedCompany=null;state.processView=null;state.page='processos';history.pushState({},'','/');await render();await occurrenceViewModal(n.occurrence_id)}catch(err){toast('Este processo não está mais disponível.','warning')}
    return;
  }
  if(n.type==='CLIENT_PASSWORD_RESET_REQUESTED'||n.type==='PASSWORD_RESET_COMPLETED'||n.type==='PASSWORD_RESET_FAILED'||n.entity_type==='client_user'){
    const userId=n.target_user_id||n.entity_id||n.reference_id;
    if(!n.company_id||!userId){toast('Não foi possível abrir o usuário desta solicitação.','warning');return}
    try{
      state.focusClientUserId=userId;
      state.focusResetRequest=true;
      await enterCompany(n.company_id,'usuarios');
    }catch(err){toast(err.message||'Registro indisponível.')}
    return;
  }
  const next=entityPage[n.entity_type]||'dashboard';
  if((n.type==='REQUEST_MESSAGE_CREATED'||n.type==='REQUEST_UPDATED'||n.type==='REQUEST_CREATED'||n.entity_type==='request')&&n.company_id&&n.entity_id){
    try{await openRequestConversation(n.company_id,n.entity_id)}catch(err){toast(err.message||'Registro indisponível.')}
    return;
  }
  if(n.company_id){
    if(state.selectedCompany&&state.selectedCompany.id!==n.company_id){toast('Esta notificação pertence a outra empresa.');}
    try{if(!state.selectedCompany||state.selectedCompany.id!==n.company_id){state.page=next;await enterCompany(n.company_id);return}state.page=next;await render()}catch(err){toast(err.message||'Registro indisponível.')}
    return;
  }
  state.page=next;await render();
}
function bindNotifications(){const wrap=$('#notifWrap'),panel=$('#notifPanel'),toggle=$('#notifToggle');if(!toggle)return;toggle.onclick=e=>{e.stopPropagation();if(window.CdsOverlayMenu){const open=panel.hidden;window.CdsOverlayMenu.toggle(toggle,panel,open?drawNotifList:null);return}const open=panel.hidden;panel.hidden=!open;if(open)drawNotifList()};$('#notifHistory')&&($('#notifHistory').onclick=e=>{e.stopPropagation();openNotifHistory()});$('#notifReadAll')&&($('#notifReadAll').onclick=async()=>{try{await api('/notificacoes/lidas',{method:'POST',body:'{}'});await drawNotifList();await refreshNotifBadge()}catch(err){toast(err.message)}});if(!window.CdsOverlayMenu&&!window.__cdsNotifDocBound){window.__cdsNotifDocBound=true;document.addEventListener('click',e=>{const w=document.querySelector('#notifWrap'),p=document.querySelector('#notifPanel');if(w&&p&&!w.contains(e.target))p.hidden=true})}}
async function render(){if(!state.token)return login();try{state.user=state.user||await api('/auth/me');if(state.user.requires_pin_setup)return showOfficePinGate();if(state.user.role==='CLIENT'){window.location.href='/portal/';return}try{if(state.token&&!localStorage.getItem('ccc_office_token')){localStorage.setItem('ccc_office_token',state.token);if(localStorage.getItem('ccc_token')===state.token)localStorage.removeItem('ccc_token')}}catch{}await restoreCompanyFromUrl();await loadBase();await loadSidebarCounters()}catch(e){if(e&&e.status===401)return;if(!state.user){toast(e.message||'Não foi possível concluir a operação.','error');return}toast(e.message||'Não foi possível concluir a operação.','error')}
try{const ctx=state.selectedCompany;const ctxNav=ctx?`<nav class="context-nav" aria-label="Contexto da empresa">${companyContextNav.map(([p,l])=>`<button type="button" class="chip ${state.page===p?'active':''}" data-page="${p}">${l}</button>`).join('')}</nav>`:'';const ctxBar=ctx?`<div class="context-bar"><button type="button" class="btn secondary" id="leaveCompany">← Empresas</button><div><strong>${esc(ctx.trade_name||ctx.name)}</strong><small>CNPJ ${esc(formatCnpj(ctx.cnpj)||'-')}</small> ${companyStatusBadge(ctx.status)}${ctxNav}</div></div>`:'';const isDash=state.page==='dashboard';const searchHtml=isDash?'':`<div class="top-search"><label class="sr-only" for="globalSearch">Pesquisa global</label>${icon('search')}<input id="globalSearch" class="search-input" placeholder="Pesquisar empresas, documentos, pendências..." autocomplete="off"><kbd>Ctrl K</kbd></div>`;const periodHtml=isDash?opsPeriodSelectHtml():'';const clockHtml=isDash?officeClockHtml():'';const sysHtml=isDash?systemStatusHtml():'';const crumbTitle=ctx?esc(ctx.trade_name||ctx.name):(isDash?`${greetUser()} <span aria-hidden="true">👋</span>`:esc(navLabel(state.page)));const crumbSub=!ctx&&isDash?`<small class="dash-head-sub">Veja o resumo da operação do seu escritório.</small>`:'';document.body.innerHTML=`<div class="app-shell"><div class="sidebar-overlay" id="sidebarOverlay"></div>${renderSidebar()}<main class="main"><header class="top"><button class="mobile-menu" id="mobileMenu" aria-label="Abrir menu">${icon('menu')}</button><div class="breadcrumb${isDash?' dash-crumb':''}"><span>${ctx?'EMPRESA ATIVA':'VISÃO GERAL DO ESCRITÓRIO'}</span><strong>${crumbTitle}</strong>${crumbSub}</div>${searchHtml}<div class="top-actions top-user">${clockHtml}${notifHtml()}<button type="button" class="icon-button" id="helpBtn" aria-label="Ajuda" title="Ajuda">${icon('help')}</button><div class="user-menu" id="userMenu"><button type="button" class="user-chip" id="userMenuBtn" aria-haspopup="true" aria-expanded="false"><div class="top-avatar">${initials(state.user.name)}</div><span>${esc(state.user.name)}<small>${esc(roleLabel(state.user.role))}</small></span></button><div class="user-dropdown" id="userDropdown" hidden><button type="button" id="goProfile">Perfil</button><button type="button" id="goConfig">Configurações</button><button type="button" id="logoutTop">Sair</button></div></div>${sysHtml}${periodHtml}</div></header>${ctxBar}<section class="content" id="content"></section></main></div>`;bindSidebar();bindNotifications();startNotifPoll();if(typeof window.__cdsStartOfficeRealtime==='function')window.__cdsStartOfficeRealtime();const leave=$('#leaveCompany');if(leave)leave.onclick=leaveCompany;bindChrome();bindDashPeriod();try{await page()}catch(err){if(err&&err.status===401)return;const box=$('#content');if(box)box.innerHTML=emptyState('Não foi possível carregar',esc(err.message||'Não foi possível concluir a operação.'),'<button type="button" class="btn" id="retryPage">Tentar novamente</button>');$('#retryPage')&&($('#retryPage').onclick=()=>render())}}catch(e){if(e&&e.status===401)return;toast(e.message||'Não foi possível concluir a operação.','error')}}
function bindSidebar(){const side=$('#sidebar'),setPage=page=>{try{if(window.CdsBackNav)CdsBackNav.clear()}catch{}if(page==='comunicacoes')state.commsTab='email';if(['comunicacoes','configuracoes','auditoria','ia'].includes(page)&&state.selectedCompany){state.selectedCompany=null;history.pushState({},'','/')}state.page=page;render()};document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{setPage(b.dataset.page);side.classList.remove('mobile-open');$('#sidebarOverlay')?.classList.remove('visible')});const toggle=()=>{const collapsed=side.classList.toggle('collapsed');localStorage.setItem('cds_admin_sidebar_collapsed',collapsed?'1':'0')};if(localStorage.getItem('cds_admin_sidebar_collapsed')==='1')side.classList.add('collapsed');$('#collapseSidebar').onclick=toggle;$('#logout').onclick=()=>{if(confirm('Tem certeza que deseja sair?')){fetch('/api/auth/logout',{method:'POST',headers:authHeaders()}).catch(()=>{});clearSession('Você saiu do sistema.')}};const search=$('#menuSearch');const filter=()=>{const q=search.value.toLowerCase().trim();document.querySelectorAll('.menu-item').forEach(item=>{item.hidden=!!q&&!item.textContent.toLowerCase().includes(q)});document.querySelectorAll('.menu-group').forEach(group=>{group.hidden=!!q&&!Array.from(group.querySelectorAll('.menu-item')).some(item=>!item.hidden)})};search.oninput=filter;search.onkeydown=e=>{if(e.key==='Enter'){const first=[...document.querySelectorAll('.menu-item')].find(x=>!x.hidden);if(first)first.click()}if(e.key==='Escape'){search.value='';filter();search.blur()}};document.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();($('#globalSearch')||search).focus()}};$('#mobileMenu').onclick=()=>{side.classList.add('mobile-open');$('#sidebarOverlay').classList.add('visible')};$('#sidebarOverlay').onclick=()=>{side.classList.remove('mobile-open');$('#sidebarOverlay').classList.remove('visible')}}
function bindChrome(){const gs=$('#globalSearch');if(gs){gs.onkeydown=e=>{if(e.key==='Enter'){const q=gs.value.trim();state.companySearch=q;state.page='empresas';state.selectedCompany=null;history.pushState({},'','/');render()}}}
  const drop=$('#userDropdown'),btn=$('#userMenuBtn');if(btn&&drop){btn.onclick=e=>{e.stopPropagation();if(window.CdsOverlayMenu){window.CdsOverlayMenu.toggle(btn,drop);return}drop.hidden=!drop.hidden;btn.setAttribute('aria-expanded',drop.hidden?'false':'true')};if(!window.CdsOverlayMenu)document.addEventListener('click',()=>{drop.hidden=true},{once:true})}
  if(window.CdsOverlayMenu)window.CdsOverlayMenu.bindKebabs(document);
  $('#goProfile')&&($('#goProfile').onclick=()=>{state.selectedCompany=null;history.pushState({},'','/');state.page='configuracoes';render()});
  $('#goConfig')&&($('#goConfig').onclick=()=>{state.selectedCompany=null;history.pushState({},'','/');state.page='configuracoes';render()});
  $('#logoutTop')&&($('#logoutTop').onclick=()=>$('#logout')&&$('#logout').click());
  $('#helpBtn')&&($('#helpBtn').onclick=()=>modal(`${modalHead('Ajuda','Navegação da carteira e atalhos.')}<div class="modal-body"><p class="modal-desc">Use o menu para navegar pela carteira. No contexto de uma empresa, o cabeçalho mantém a empresa ativa sem nova seleção. Atalho Ctrl K abre a pesquisa.</p></div>${modalFoot('<button type="button" class="btn" onclick="closeModal()">Entendi</button>')}`,'sm'));
}
const screenHelp={
  empresas:{title:'Como funciona: Empresas',html:'<p>Aqui fica a <b>carteira de empresas</b> do escritório. Cada empresa é um cliente com CNPJ, status e acesso próprio ao Portal.</p><p><b>Nova empresa.</b> Cadastre razão social, CNPJ e dados básicos. Depois você entra no contexto dela para documentos, despesas, usuários e fechamento.</p><p><b>Status.</b> Ativa opera normalmente; bloqueada ou arquivada sai do fluxo operacional, mas o histórico permanece.</p><p>Clique em uma empresa para trabalhar no contexto dela: o menu e as telas passam a filtrar só aquela empresa.</p>'},
  usuarios:{title:'Como funciona: Usuários da empresa',html:'<p>Esta tela controla quem acessa o <b>Portal do cliente</b> desta empresa.</p><p><b>Perfis.</b> Definem o que o usuário pode ver e enviar (ex.: financeiro, visualizador, administrador da empresa).</p><p><b>Convite.</b> Ao salvar, o sistema envia o link de ativação por e-mail. O usuário cria a senha (e o PIN, quando exigido) no primeiro acesso.</p><p>Use reenviar convite ou redefinir senha quando o cliente perder o acesso. Isso não altera o plano de contas nem o Motor Contábil.</p>'},
  despesas:{title:'Como funciona: Despesas',html:'<p>Lista as <b>despesas</b> enviadas pelas empresas (Portal, Smart Expense ou escritório).</p><p>Cada despesa segue o fluxo: recebimento → classificação → aprovação → lançamento efetivado. O valor, a data e a forma de pagamento alimentam o Motor Contábil.</p><p><b>Nova despesa.</b> Use quando o escritório registra o gasto em nome da empresa. Comprovantes podem ser anexados na mesma operação.</p>'},
  receitas:{title:'Como funciona: Receitas',html:'<p>Lista as <b>receitas</b> que entraram por importação ou integração. Nesta versão o escritório não cria receita manual pela mesma tela de despesa.</p><p>As receitas também passam por classificação e aprovação antes de virar lançamento efetivado e entrar na exportação.</p>'},
  lancamentos:{title:'Como funciona: Lançamentos',html:'<p>Mostra os <b>lançamentos contábeis</b> (partidas D/C) gerados a partir de despesas, receitas, importações ou lançamento manual.</p><p>Situações comuns: aguardando classificação, aguardando aprovação ou lançado (efetivado). Só os efetivados entram na exportação e no fechamento.</p><p>Abra um lançamento para ver linhas, documentos e histórico da decisão.</p>'},
  classificacao:{title:'Como funciona: Classificação',html:'<p>Fila das movimentações que <b>ainda não têm débito e crédito definidos</b> com segurança.</p><p>O Motor Contábil tenta sugerir contas com regras, categoria e banco. Se a evidência for fraca ou houver conflito, a item fica aqui para o contador revisar.</p><p><b>Sua tarefa.</b> Abrir o item, conferir a sugestão, ajustar as contas se preciso e enviar para aprovação.</p>'},
  aprovacao:{title:'Como funciona: Aprovação',html:'<p>Fila das classificações <b>prontas para o contador aprovar</b>.</p><p>Ao aprovar, o lançamento é efetivado (status lançado) e passa a valer para exportação e fechamento. Ao rejeitar, a movimentação volta ao fluxo de correção.</p><p>Revise débito, crédito, valor e histórico antes de confirmar.</p>'},
  pendencias:{title:'Como funciona: Pendências',html:'<p>Central de <b>itens que precisam de ação</b>: documento faltando, classificação parada, solicitação aberta, etc.</p><p>Cada linha indica o que aconteceu, quem deve agir e um atalho para a tela certa. No contexto de uma empresa, a lista fica restrita a ela.</p><p>Resolver a pendência na origem (documento, classificação, solicitação) a remove desta fila.</p>'},
  documentos:{title:'Como funciona: Documentos',html:'<p>Repositório de <b>comprovantes e anexos</b> das empresas (PDF, imagens, XML).</p><p>Documentos podem passar por extração inteligente e alimentar a classificação. Eles não criam lançamento sozinhos: servem de evidência para o fluxo contábil.</p><p><b>Enviar documento.</b> Vincule à empresa correta. Depois você pode analisar, classificar ou anexar a uma despesa/solicitação.</p>'},
  processos:{title:'Como funciona: Processos',html:'<p>Cadastro de <b>modelos de processos</b> do escritório (ex.: apuração mensal) e das <b>ocorrências por competência</b>.</p><p>Use para organizar prazos e etapas internas. Não substitui o fechamento contábil nem a exportação Domínio, mas ajuda o escritório a acompanhar o que falta em cada empresa/mês.</p>'},
  solicitacoes:{title:'Como funciona: Solicitações',html:'<p>Canal de <b>conversa contextual</b> entre escritório e empresa (Portal).</p><p>Abra uma solicitação para pedir documento, esclarecer um lançamento ou responder o cliente. As mensagens ficam ligadas à empresa e aparecem nas notificações.</p><p>Não gera lançamento contábil automaticamente; é comunicação operacional.</p>'},
  importacoes:{title:'Como funciona: Importações',html:'<p>Registra uma <b>carga de movimentações</b> (contábil ou fiscal) no próprio CDS Contábil Connect.</p><p>Informe empresa, origem, período e as linhas (despesa/receita, data, valor, forma). Após importar, os itens seguem o mesmo fluxo de classificação e aprovação.</p><p>CDS Sistemas aparece como origem opcional; nesta versão não há integração externa automática.</p>'},
  exportacoes:{title:'Como funciona: Exportações',html:'<p>Esta tela gera o <b>arquivo de lançamentos</b> para importar no sistema contábil do escritório (Domínio, Conta Azul, Alterdata, Fortes, Questor ou SCI).</p><p><b>O que entra.</b> Somente lançamentos <b>efetivados</b> (já aprovados e postados). Pendentes de classificação, aguardando aprovação ou rejeitados <b>não</b> entram no arquivo.</p><p><b>Como gerar.</b> Escolha a empresa, o sistema destino e o período. Em Domínio, o Connect usa o layout Excel 3.1 (código 11758), com prévia de totais e contas mapeadas. Contas sem mapeamento bloqueiam a geração até você configurar em Integrações.</p><p><b>Depois de gerar.</b> O histórico da tela lista cada arquivo. Use <b>Baixar</b> para obter o arquivo e importá-lo no software do cliente. A exportação não altera os lançamentos no CDS.</p>'},
  fechamento:{title:'Como funciona: Fechamento Contábil',html:'<p>Controla a <b>competência contábil</b> de cada empresa (mês YYYY-MM): conferência, exportação Domínio e fechamento do período.</p><p><b>Ciclo.</b> Aberta → Em conferência → Pronta para exportação → Exportada → Fechada. <b>Exportar não é fechar:</b> gerar o arquivo Domínio marca a competência como exportada; o fechamento bloqueia alterações no período.</p><p><b>Nova competência.</b> Informe empresa e mês. Na ficha, use o checklist (documentos, lançamentos, mapeamento Domínio) antes de avançar.</p><p><b>Fechada.</b> O sistema bloqueia novos lançamentos, reclassificações e exportações daquele mês até uma reabertura controlada (com motivo). Reabrir volta para conferência e preserva o histórico.</p>'},
  integracoes:{title:'Como funciona: Integrações',html:'<p>Mapeia cada <b>conta analítica do CDS</b> para o <b>código reduzido do Domínio</b> (ou layout equivalente).</p><p>Sem mapeamento, a exportação Domínio é bloqueada. Informe o código externo, salve e volte à Exportação ou ao Fechamento para gerar o arquivo.</p><p>Abra esta tela no contexto de uma empresa (menu da empresa → Integrações).</p>'},
  comunicacoes:{title:'Como funciona: Comunicações',html:'<p>Configura os <b>canais de comunicação</b> do escritório: e-mail (convites e avisos) e WhatsApp opcional.</p><p>As notificações internas do CDS continuam ativas mesmo com WhatsApp desligado. Tokens e credenciais sensíveis ficam no servidor e não são exibidos por completo na tela.</p><p>Use as abas para revisar eventos enviados e o status do provedor.</p>'},
  ia:{title:'Como funciona: Inteligência Artificial',html:'<p>Painel de <b>controle da IA</b> do escritório. A IA é opcional: classificação, extração e sugestões internas continuam sem ela.</p><p>Aqui você define autonomia, limites e se a IA pode sugerir ou apenas auxiliar. Nada nesta tela substitui a aprovação do contador nos lançamentos.</p>'},
  auditoria:{title:'Como funciona: Auditoria',html:'<p>Histórico de <b>operações sensíveis</b>: quem fez o quê, em qual entidade e quando.</p><p>Use para rastrear importações de plano, fechamentos, alterações de acesso e outras ações críticas. É consulta; não altera dados contábeis.</p>'},
  configuracoes:{title:'Como funciona: Configurações',html:'<p>Hub de <b>administração do escritório</b>: identidade visual, preferências e atalhos para áreas do sistema.</p><p>Altere nome, slogan e logo do escritório na identidade. Outras seções levam a comunicações, equipe, IA e auditoria conforme o seu perfil.</p>'},
  bancos:{title:'Como funciona: Bancos',html:'<p>Esta tela não cadastra um banco real (agência, conta ou integração). Ela cadastra um <b>banco/caixa do escritório</b> para o Motor Contábil saber qual conta do plano usar quando uma despesa ou receita vem com aquele banco marcado.</p><p><b>Para que serve.</b> Quando alguém lança uma movimentação e escolhe um banco, o motor tenta montar a partida:</p><ul><li><b>Despesa:</b> débito na conta da categoria, crédito na conta do banco/caixa (saída de dinheiro).</li><li><b>Receita:</b> débito no banco/caixa, crédito na conta da categoria (entrada).</li></ul><p>Se o banco e a categoria tiverem conta analítica, o motor pode classificar sozinho. Se faltar um dos dois, a movimentação vai para revisão.</p><p><b>Campos.</b> O nome é o rótulo nas telas. A empresa define o alcance: Global vale para toda a carteira; senão, o banco fica só da empresa escolhida. A conta contábil precisa ser analítica e postável; “Não vinculada” grava o cadastro, mas o motor não usa esse banco como contraparte.</p>'},
  categorias:{title:'Como funciona: Categorias',html:'<p>Categoria é a <b>natureza da movimentação</b> (frete, aluguel, venda, etc.). Não é o plano de contas: ela aponta para uma conta do plano, para o Motor Contábil saber o outro lado da partida junto com o banco/caixa.</p><p><b>Tipo.</b> Despesa entra em gastos; Receita em entradas; Ambos nas duas filas.</p><p><b>Empresa.</b> Global / escritório vale para toda a carteira. Sem o global, a categoria fica só da empresa buscada. Se você já estiver dentro de uma empresa, o campo vem fixo nela.</p><p><b>Conta contábil.</b> Precisa ser analítica e postável para o motor usá-la. Sem vínculo, a categoria aparece nas telas, mas não fecha a partida sozinha.</p><p>Com categoria e banco vinculados, o motor tenta classificar automaticamente. Esta tela só alimenta o cadastro; o Motor Contábil não é alterado aqui.</p>'},
  regras:{title:'Como funciona: Regras Contábeis',html:'<p>Uma regra diz ao Motor Contábil: <b>se a movimentação bater nestas condições, use este débito e este crédito</b>. Regras específicas da empresa pesam mais que regras globais do escritório.</p><p><b>Prioridade.</b> Número menor entra primeiro na avaliação. A confiança (em percentual) reforça o peso da sugestão.</p><p><b>Condições.</b> “Descrição contém” e forma de pagamento filtram quando a regra vale. Débito e crédito devem ser contas analíticas do plano.</p><p>Se uma regra for clara o bastante, o lançamento segue classificado. Se várias regras competirem ou a evidência for fraca, a fila de Classificação pede revisão do contador. Esta tela configura as regras; o motor em si não muda.</p>'},
  plano:{title:'Como funciona: Plano de Contas',html:'<p>O plano de contas é o <b>elenco de contas deste escritório</b>. Bancos, categorias e regras só funcionam bem quando apontam para contas deste plano.</p><p><b>Importar.</b> Envie PDF, CSV ou TXT. A prévia mostra contas reconhecidas e problemas. “Importar definitivamente” grava o plano.</p><p><b>Código e tipo.</b> Contas sintéticas (S) agrupam; analíticas (A) recebem lançamento. O motor recusa conta sintética, inativa ou de outro escritório.</p><p>Abra as contas para conferir código, classificação e descrição. Sem plano importado, os cadastros de banco e categoria ficam sem conta para vincular.</p>'}
};
function helpCircle(key){return `<button type="button" class="screen-help-btn" data-screen-help="${esc(key)}" aria-label="Como funciona" title="Como funciona">${icon('help')}</button>`}
function closeScreenHelp(){$('#screenHelpBack')?.remove()}
function showScreenHelp(key){const h=screenHelp[key];if(!h)return;closeScreenHelp();document.body.insertAdjacentHTML('beforeend',`<div class="help-back" id="screenHelpBack" role="dialog" aria-modal="true" aria-labelledby="screenHelpTitle"><div class="help-card"><div class="help-card-head"><strong id="screenHelpTitle">${esc(h.title)}</strong><button type="button" class="btn secondary" id="screenHelpClose">Fechar</button></div><div class="help-card-body">${h.html}</div></div></div>`);$('#screenHelpClose').onclick=closeScreenHelp;$('#screenHelpBack').onclick=e=>{if(e.target.id==='screenHelpBack')closeScreenHelp()}}
if(!window.__cdsScreenHelpBound){window.__cdsScreenHelpBound=true;document.addEventListener('click',e=>{const btn=e.target.closest('[data-screen-help]');if(!btn)return;e.preventDefault();e.stopPropagation();showScreenHelp(btn.getAttribute('data-screen-help'))})}
function head(title,desc,actions='',helpKey){return `<div class="page-head"><div><h1>${title}${helpKey?helpCircle(helpKey):''}</h1><p>${desc}</p></div><div class="actions">${actions}</div></div>`}function companyField(required=true){const ctx=state.selectedCompany;if(ctx)return `<div class="field"><label>Empresa</label><input value="${esc(ctx.trade_name||ctx.name)}" disabled><input type="hidden" name="company_id" value="${esc(ctx.id)}"><small class="muted">Você está trabalhando em: ${esc(ctx.trade_name||ctx.name)}</small></div>`;const picked=state.pickedCompany;return `<div class="field company-picker"><label>Empresa</label>${required?'':`<label class="muted" style="font-weight:400"><input type="checkbox" id="pickerGlobal"> Global / escritório</label>`}<input type="hidden" name="company_id" id="pickedCompanyId" value="${esc(picked?.id||'')}" ${required?'required':''}><input id="companyPickerSearch" autocomplete="off" placeholder="Digite para buscar..." value="${esc(picked?(picked.trade_name||picked.name):'')}"><div id="companyPickerResults" class="picker-results"></div>${picked?`<small>${esc(formatCnpj(picked.cnpj)||picked.cnpj||'')}</small>`:''}</div>`}
function bindCompanyPicker(){const input=$('#companyPickerSearch'),hidden=$('#pickedCompanyId'),box=$('#companyPickerResults');if(!input||!hidden)return;const glob=$('#pickerGlobal');if(glob)glob.onchange=()=>{if(glob.checked){hidden.value='';hidden.removeAttribute('required');input.disabled=true;if(box)box.innerHTML='';state.pickedCompany=null}else{hidden.setAttribute('required','required');input.disabled=false}};const run=async()=>{const q=input.value.trim(),n=++pickerSeq;if(q.length<2){if(box)box.innerHTML='<div class="muted">Digite ao menos 2 caracteres.</div>';return}if(box)box.innerHTML='<div class="muted">Buscando...</div>';try{const data=await api('/empresas?page=1&page_size=15&status=ACTIVE&q='+encodeURIComponent(q));if(n!==pickerSeq)return;const items=listItems(data);if(!items.length){if(box)box.innerHTML='<div class="muted">Nenhuma empresa encontrada.</div>';return}if(box){box.innerHTML=items.map(x=>`<button type="button" class="picker-item" data-id="${esc(x.id)}"><span>${esc(x.trade_name||x.name)}</span><small>${esc(formatCnpj(x.cnpj)||x.cnpj||'')}</small></button>`).join('');box.querySelectorAll('.picker-item').forEach(btn=>{btn.onclick=()=>{const x=items.find(i=>i.id===btn.dataset.id);if(!x)return;state.pickedCompany=x;hidden.value=x.id;input.value=x.trade_name||x.name;box.innerHTML=''}})}}catch(e){if(n!==pickerSeq)return;if(box)box.innerHTML=`<div class="muted">${esc(e.message)}</div>`}};input.oninput=debounce(run,350)}function accountOptions(){return `<option value="">Selecione a conta</option>`+(state.accounts||[]).filter(a=>a.is_postable).map(a=>`<option value="${a.id}">${esc(a.account_code)} — ${esc(a.description)}</option>`).join('')}function badge(s){const m={PENDING:['pending','Aguardando aprovação'],PENDING_APPROVAL:['pending','Aguardando aprovação'],NEEDS_CLASSIFICATION:['need','Aguardando classificação'],POSTED:['approved','Lançado'],REJECTED:['rejected','Rejeitado']};const x=m[s]||['pending',originLabel(s)];return `<span class="badge ${x[0]}">${x[1]}</span>`}
function txBadge(s){const v=String(s||'');if(['POSTED','ACCOUNTED'].includes(v))return '<span class="badge approved">Aprovada</span>';if(v==='REJECTED')return '<span class="badge rejected">Reprovada</span>';return '<span class="badge pending">Pendente</span>'}
async function page(){const c=$('#content');if(state.page==='dashboard')return dashboard(c);if(state.page==='empresas')return crudCompanies(c);if(state.page==='despesas'||state.page==='receitas')return transactions(c,state.page);if(state.page==='lancamentos')return entries(c);if(state.page==='aprovacao')return approval(c);if(state.page==='pendencias')return pendenciesPage(c);if(state.page==='classificacao')return classificationPage(c);if(state.page==='plano')return plan(c);if(state.page==='categorias')return simple(c,'Categorias','categorias');if(state.page==='bancos')return simple(c,'Bancos','bancos');if(state.page==='regras')return rules(c);if(state.page==='documentos')return documents(c);if(state.page==='solicitacoes')return requests(c);if(state.page==='processos')return processesPage(c);if(state.page==='exportacoes')return exportsPage(c);if(state.page==='fechamento')return fechamentoPage(c);if(state.page==='integracoes')return dominioIntegrationsPage(c);if(state.page==='importacoes')return importsPage(c);if(state.page==='usuarios')return state.selectedCompany?companyUsersPage(c,state.selectedCompany.id):users(c);if(state.page==='comunicacoes')return commsPage(c);if(state.page==='ia')return aiSettingsPage(c);if(state.page==='configuracoes')return settingsPage(c);if(state.page==='auditoria')return auditPage(c)}
function opsPeriodSelectHtml(){
  const cur=state.dashPreset||'month';
  const opts=[['today','Hoje'],['7d','Últimos 7 dias'],['30d','Últimos 30 dias'],['month','Mês atual'],['previous_month','Mês anterior'],['custom','Personalizado']];
  return `<label class="ops-period"><span class="sr-only">Período</span><select id="dashPeriod" aria-label="Período">${opts.map(([v,l])=>`<option value="${v}" ${cur===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
}
function scheduleDashRefresh(){
  clearTimeout(window.__cdsDashRt);
  window.__cdsDashRt=setTimeout(()=>{if(typeof window.__cdsRefreshDashboard==='function')window.__cdsRefreshDashboard()},500);
}
function bindDashPeriod(){
  const sel=$('#dashPeriod');
  if(!sel)return;
  sel.onchange=()=>{
    state.dashPreset=sel.value;
    if(sel.value==='custom'){
      const from=state.dashFrom||new Date().toISOString().slice(0,10);
      const to=state.dashTo||from;
      const nextFrom=window.prompt('Data inicial (AAAA-MM-DD)',from);
      const nextTo=window.prompt('Data final (AAAA-MM-DD)',to);
      if(nextFrom&&/^\d{4}-\d{2}-\d{2}$/.test(nextFrom))state.dashFrom=nextFrom;
      if(nextTo&&/^\d{4}-\d{2}-\d{2}$/.test(nextTo))state.dashTo=nextTo;
    }
    const box=$('#content');
    if(box)dashboard(box);
  };
}
function dashQuery(){
  const preset=state.dashPreset||'month';
  const act=state.dashActivity||'7d';
  let q=`/dashboard?preset=${encodeURIComponent(preset)}&activity=${encodeURIComponent(act)}`;
  if(preset==='custom'&&state.dashFrom&&state.dashTo)q+=`&from=${encodeURIComponent(state.dashFrom)}&to=${encodeURIComponent(state.dashTo)}`;
  return q;
}
function dashSkeleton(){
  const sk=n=>Array.from({length:n},()=>'<div class="sk-card"></div>').join('');
  return `<div class="ops-dash" aria-busy="true"><div class="sk-row" style="width:40%"></div><div class="ops-kpis">${sk(5)}</div><div class="sk-card" style="height:220px;margin-top:16px"></div><div class="ops-split">${sk(2)}</div><div class="ops-split">${sk(2)}</div></div>`;
}
function opsBlockError(id,title,msg){
  return `<div class="panel ops-block" id="${id}"><h3>${title}</h3>${emptyState(title,esc(msg||'Não foi possível carregar.'),'<button type="button" class="btn secondary ops-retry" id="retryActivity" data-retry="'+id+'">Tentar novamente</button>')}</div>`;
}
function periodCaption(summary){
  if(!summary||!summary.from)return '';
  const [y,m]=String(summary.from).split('-');
  const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const idx=Number(m)-1;
  if(state.dashPreset==='month'&&months[idx])return `${months[idx]} ${y}`;
  return `${summary.from} — ${summary.to}`;
}
function opsKpiHtml(key,label,kpi){
  kpi=kpi||{};
  const page=kpi.page||'';
  const ico={companies:'building',documents:'file',pendencies:'check',requests:'message',processes:'book'}[key]||'file';
  return `<button type="button" class="card kpi-card ops-kpi kpi-link ops-kpi-${esc(key)}" data-page="${esc(page)}" aria-label="Abrir ${label}"><span class="ops-kpi-ico" aria-hidden="true">${icon(ico)}</span><div class="ops-kpi-copy"><div class="label">${label}</div><div class="value">${kpi.value??0}</div><div class="ops-kpi-hint">${esc(kpi.hint||'—')}</div></div></button>`;
}
function formatChartBucket(bucket){
  const s=String(bucket||'');
  if(/\d{2}:00$/.test(s))return s.slice(-5,-3)+'h';
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(8,10)+'/'+s.slice(5,7);
  return s;
}
function opsChartSvg(series){
  series=Array.isArray(series)?series:[];
  if(!series.length)return emptyState('Nenhuma atividade registrada no período.','Os eventos do escritório aparecerão neste gráfico.');
  const w=720,h=248,l=40,r=12,t=14,b=32;
  const keys=[['documents','Documentos','ops-line-documents'],['expenses','Despesas','ops-line-expenses'],['revenues','Receitas','ops-line-revenues'],['requests','Solicitações','ops-line-requests'],['classifications','Classificações','ops-line-class']];
  const max=Math.max(1,...series.flatMap(p=>keys.map(([k])=>Number(p[k]||0))));
  const n=Math.max(1,series.length-1);
  const xy=(i,k)=>{
    const x=l+(i*(w-l-r))/n;
    const y=t+((h-t-b)*(1-Number(series[i][k]||0)/max));
    return [x,y];
  };
  const pathFor=k=>series.map((_,i)=>{const [x,y]=xy(i,k);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');
  const area=(()=>{
    const d=pathFor('documents');
    const last=xy(series.length-1,'documents');
    const first=xy(0,'documents');
    return `${d} L${last[0].toFixed(1)},${(h-b).toFixed(1)} L${first[0].toFixed(1)},${(h-b).toFixed(1)} Z`;
  })();
  const grid=[0,.25,.5,.75,1].map(f=>{
    const y=t+(h-t-b)*(1-f);
    return `<line class="ops-grid" x1="${l}" x2="${w-r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ops-axis" x="${l-6}" y="${(y+3).toFixed(1)}">${Math.round(max*f)}</text>`;
  }).join('');
  const step=series.length>12?Math.ceil(series.length/8):1;
  const xlabels=series.map((p,i)=>{
    if(i%step&&i!==series.length-1)return '';
    const [x]=xy(i,'documents');
    return `<text class="ops-axis ops-axis-x" x="${x.toFixed(1)}" y="${h-8}">${esc(formatChartBucket(p.bucket))}</text>`;
  }).join('');
  const lines=keys.map(([k,label,cls])=>`<path class="${cls}" d="${pathFor(k)}" fill="none" stroke-width="2.2" aria-label="${label}"/>`).join('');
  const summary=`Série com ${series.length} pontos. Máximo ${max}.`;
  return `<div class="ops-chart-wrap"><div class="ops-tip" id="opsChartTip" hidden></div><svg class="ops-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Atividade do escritório. ${esc(summary)}">${grid}${xlabels}<path class="ops-area-documents" d="${area}"/>${lines}</svg><ul class="ops-legend">${keys.map(([,label,cls])=>`<li><i class="${cls}"></i>${label}</li>`).join('')}</ul></div>`;
}
function bindOpsChart(root,series){
  const svg=root.querySelector('.ops-chart');
  const tip=root.querySelector('#opsChartTip');
  if(!svg||!tip||!series||!series.length)return;
  const keys=[['documents','Documentos'],['expenses','Despesas'],['revenues','Receitas'],['requests','Solicitações'],['classifications','Classificações']];
  svg.onmousemove=e=>{
    const rect=svg.getBoundingClientRect();
    const i=Math.round(((e.clientX-rect.left)/Math.max(1,rect.width))*(series.length-1));
    const p=series[Math.max(0,Math.min(series.length-1,i))];
    if(!p)return;
    tip.hidden=false;
    tip.style.left=Math.min(rect.width-200,Math.max(8,e.clientX-rect.left+8))+'px';
    tip.style.top=Math.max(8,e.clientY-rect.top-12)+'px';
    tip.innerHTML=`<b>${esc(formatChartBucket(p.bucket))}</b>`+keys.map(([k,l])=>`<div>${l}: ${Number(p[k]||0)}</div>`).join('');
  };
  svg.onmouseleave=()=>{tip.hidden=true};
}
function opsHealthHtml(health){
  health=health||{};
  const ok=Number(health.companies_ok||0);
  const pend=Number(health.companies_with_pendencies||0);
  const total=ok+pend;
  const pct=n=>total?Math.round((n/total)*100)+'%':'';
  let donut='';
  if(total){
    const circ=2*Math.PI*36;
    let acc=0;
    const slice=(value,color)=>{
      if(!value)return '';
      const frac=value/total;
      const len=circ*frac;
      const rot=(acc/total)*360-90;
      acc+=value;
      return `<circle cx="50" cy="50" r="36" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="${len} ${circ-len}" transform="rotate(${rot} 50 50)"/>`;
    };
    donut=`<div class="ops-health-viz"><div class="ops-donut"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="36" fill="none" stroke="var(--color-border)" stroke-width="12"/>${slice(ok,'var(--color-success)')}${slice(pend,'var(--color-warning)')}</svg><div class="ops-donut-center"><b>${total}</b><small>Empresas</small></div></div><ul class="ops-health-legend"><li><i class="ops-dot ops-dot-ok"></i> Em dia <b>${ok}</b> <span>${pct(ok)}</span></li><li><i class="ops-dot ops-dot-warn"></i> Com pendências <b>${pend}</b> <span>${pct(pend)}</span></li></ul></div>`;
  }else donut=emptyState('Tudo em dia.','Nenhuma empresa da carteira precisa de atenção agora.');
  const rows=[
    ['ok','empresas',`${ok} empresas em dia`],
    ['warn','pendencias',`${pend} empresas com pendências`],
    ['bad','processos',`${health.processes_overdue||0} processos atrasados`],
    ['warn','processos',`${health.processes_due_soon||0} processos vencendo`],
    ['bad','classificacao',`${health.documents_attention||0} documentos aguardando atenção`]
  ];
  const alert=pend?`<div class="ops-health-alert"><p><b>${pend} empresas precisam de atenção</b><br><span class="muted">Existem pendências que podem impactar prazos e obrigações.</span></p><button type="button" class="btn secondary ops-health-item" data-page="pendencias">Ver pendências</button></div>`:'';
  return `${donut}<ul class="ops-health">${rows.map(([tone,page,label])=>`<li><button type="button" class="ops-health-item" data-page="${page}"><span class="ops-dot ops-dot-${tone}" aria-hidden="true"></span><span>${esc(label)}</span></button></li>`).join('')}</ul>${alert}`;
}
function activityIconName(n){
  const t=n.type||n.event_type||'';
  if(/DOCUMENT/.test(t))return 'file';
  if(/EXPENSE/.test(t))return 'arrowDown';
  if(/REVENUE/.test(t))return 'arrowUp';
  if(/REQUEST/.test(t))return 'message';
  if(/CLASS/.test(t))return 'check';
  return 'bell';
}
function deadlineStatusLabel(item){
  const st=item.status||'NO_PRAZO';
  if(st==='ATRASADO'||st==='ATRASADA')return 'Atrasado';
  const days=Number(item.days);
  if(Number.isFinite(days)&&days===0)return 'Vence hoje';
  if(Number.isFinite(days)&&days>0)return `Em ${days} dia${days===1?'':'s'}`;
  if(st==='VENCENDO')return 'Vencendo';
  return 'No prazo';
}
function monthShort(iso){
  const m=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const d=String(iso||'').slice(5,7);
  return m[Number(d)-1]||'';
}
function activityHref(n){
  if(n.occurrence_id||n.entity_type==='process_occurrence')return 'processos';
  const t=n.type||n.event_type||'';
  if(/DOCUMENT/.test(t))return 'documentos';
  if(/EXPENSE|CLASSIFICATION/.test(t))return 'classificacao';
  if(/REVENUE|ENTRY|APPROV/.test(t))return 'aprovacao';
  if(/REQUEST/.test(t))return 'solicitacoes';
  if(/PENDENCY/.test(t))return 'pendencias';
  return 'dashboard';
}
async function dashboard(c){
  c.innerHTML=dashSkeleton();
  const ctx=state.selectedCompany;
  if(ctx){
    try{
      const d=await api(dashQuery());
      const op=await api('/empresas/'+ctx.id+'/operacional').catch(()=>({activity:[],origins:[],imports:[]}));
      const kpi=([page,label,value])=>`<button type="button" class="card kpi-card kpi-link" data-page="${page}" aria-label="Abrir ${label}"><div class="label">${label}</div><div class="value">${value}</div></button>`;
      c.innerHTML=head(esc(ctx.trade_name||ctx.name),'Visão operacional desta empresa. As telas usam automaticamente a empresa ativa.','','empresas')+`<div class="grid cards">${kpi(['despesas','Despesas',op.expenses??d.expense_count??0])}${kpi(['documentos','Documentos',d.documents||0])}${kpi(['pendencias','Pendências',op.pendencies??0])}${kpi(['solicitacoes','Solicitações',op.requests??0])}${kpi(['classificacao','Classificações',op.classifications??0])}${kpi(['aprovacao','Aprovações',op.approvals??0])}</div><div class="grid ops-split"><div class="panel"><h3>Atividade recente</h3>${(op.activity||[]).map(x=>`<div class="activity-item"><b>${esc(({EXPENSE_CREATED:'Nova despesa enviada pelo cliente',DOCUMENT_UPLOADED:'Novo documento recebido',IMPORT_COMPLETED:'Importação concluída',IMPORT_CREATED:'Importação registrada',REVENUE_CREATED:'Receita recebida por importação ou integração'}[x.event_type]||x.event_type))}</b><div class="muted">${esc(x.payload&&(x.payload.description||x.payload.original_name)||'')}</div><small>${esc(timeAgo(x.created_at))}</small></div>`).join('')||emptyState('Sem atividade recente','Os eventos desta empresa aparecerão aqui.')}</div><div class="panel"><h3>Movimentações por origem</h3>${originBars(op.origins||[])}</div></div>`;
      c.querySelectorAll('.kpi-link[data-page]').forEach(btn=>{btn.onclick=()=>{state.page=btn.dataset.page;render()}});
      return;
    }catch(err){
      if(err&&err.status===401)throw err;
      c.innerHTML=emptyState('Não foi possível carregar',esc(err.message),'<button type="button" class="btn" id="retryDash">Tentar novamente</button>');
      $('#retryDash')&&($('#retryDash').onclick=()=>dashboard(c));
      return;
    }
  }
  const seq=(state.dashSeq=(state.dashSeq||0)+1);
  const [dashRes, procRes, dueRes, notifRes]=await Promise.allSettled([
    api(dashQuery()),
    api('/processos/dashboard'),
    api('/processos/dashboard/proximos-prazos?limit=8'),
    loadNotifications().catch(e=>{if(e&&e.status===401)throw e;return{_error:e.message||'Não foi possível carregar agora.',items:[]}})
  ]);
  if(seq!==state.dashSeq)return;
  const d=dashRes.status==='fulfilled'?dashRes.value:null;
  const dashErr=dashRes.status==='rejected'?dashRes.reason:null;
  if(dashErr&&dashErr.status===401)throw dashErr;
  if(!d){
    c.innerHTML=emptyState('Não foi possível carregar o dashboard',esc(dashErr&&dashErr.message||'Tente novamente.'),'<button type="button" class="btn" id="retryDash">Tentar novamente</button>');
    $('#retryDash')&&($('#retryDash').onclick=()=>dashboard(c));
    return;
  }
  const proc=procRes.status==='fulfilled'?procRes.value:{};
  const dues=dueRes.status==='fulfilled'?(dueRes.value.items||[]):[];
  const dueErr=dueRes.status==='rejected'?dueRes.reason:null;
  const notifs=notifRes.status==='fulfilled'?notifRes.value:{items:[],_error:'Não foi possível carregar agora.'};
  const k=d.kpis||{};
  const sum=d.summary||{};
  const health=d.health||{};
  const rate=sum.processing_rate;
  const rateHtml=rate==null?'':`<div class="ops-rate"><div class="ops-rate-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rate}" aria-label="Taxa de processamento ${rate}%"><i style="width:${rate}%"></i></div><div class="ops-rate-meta"><b>${rate}%</b><span>Taxa de processamento</span></div></div>`;
  const chartHtml=opsChartSvg(d.activity_series||[]);
  const actRange=state.dashActivity||'7d';
  const actCaption=actRange==='24h'?'Movimentação nas últimas 24 horas em tempo real.':actRange==='30d'?'Movimentação nos últimos 30 dias.':'Movimentações recentes';
  const actItems=(notifs.items||[]).slice(0,8);
  c.innerHTML=`<div class="ops-dash">
    <div class="ops-kpis">${opsKpiHtml('companies','Empresas',k.companies)}${opsKpiHtml('documents','Documentos',k.documents)}${opsKpiHtml('pendencies','Pendências',k.pendencies)}${opsKpiHtml('requests','Solicitações',k.requests)}${opsKpiHtml('processes','Processos',k.processes)}</div>
    <section class="panel ops-summary"><div class="ops-summary-head"><div><h3>Resumo Contábil do Período</h3><p class="muted">Visão consolidada da movimentação contábil no período selecionado.</p></div><span class="muted">${esc(periodCaption(sum))}</span></div>
      <div class="ops-summary-tiles">
        <div class="ops-tile ops-tile-docs"><span class="ops-kpi-ico" aria-hidden="true">${icon('file')}</span><span>Documentos recebidos</span><b>${sum.documents_received||0}</b></div>
        <div class="ops-tile ops-tile-ok"><span class="ops-kpi-ico" aria-hidden="true">${icon('check')}</span><span>Classificados</span><b>${sum.documents_processed||0}</b></div>
        <div class="ops-tile ops-tile-warn"><span class="ops-kpi-ico" aria-hidden="true">${icon('tag')}</span><span>Pendentes</span><b>${sum.documents_pending||0}</b></div>
      </div>
      <div class="ops-summary-extra muted"><span>Aprovações pendentes <b>${sum.approvals_pending||0}</b></span><span>Lançamentos efetivados <b>${sum.entries_posted||0}</b></span><span>Processos ${proc.pendentes||0} pendentes · ${proc.em_andamento||0} em andamento</span></div>
      ${rateHtml}</section>
    <div class="ops-split">
      <section class="panel ops-chart-panel" id="opsChartBlock"><div class="ops-summary-head"><div><h3>Atividade do Escritório</h3><p class="muted">${esc(actCaption)}</p></div><div class="row-actions ops-range">${[['24h','Últimas 24 horas'],['7d','Últimos 7 dias'],['30d','Últimos 30 dias']].map(([v,l])=>`<button type="button" class="btn ${actRange===v?'':'secondary'} ops-act" data-act="${v}" aria-pressed="${actRange===v?'true':'false'}">${l}</button>`).join('')}</div></div>${chartHtml}<p class="sr-only">O gráfico mostra documentos, despesas, receitas, solicitações e classificações no intervalo selecionado. ${esc(actCaption)}</p></section>
      <section class="panel" id="opsHealthBlock"><div class="ops-summary-head"><div><h3>Saúde Contábil do Escritório</h3><p class="muted">Situação atual das empresas sob sua gestão.</p></div></div>${opsHealthHtml(health)}</section>
    </div>
    <div class="ops-split">
      ${dueErr?opsBlockError('opsDeadlines','Próximos Prazos',dueErr.message):`<section class="panel" id="opsDeadlines"><div class="ops-summary-head"><h3>Próximos Prazos</h3><button type="button" class="btn secondary" id="opsDeadlinesAll">Ver todos</button></div>${dues.length?`<ul class="ops-deadlines">${dues.map(item=>`<li><button type="button" class="ops-deadline" data-page="processos"><span class="ops-deadline-date"><b>${esc(String(item.due_date||'').slice(8,10))}</b><small>${esc(monthShort(item.due_date))}</small></span><span class="ops-deadline-body"><b>${esc(item.type_label||item.step_name||'Prazo')}</b><small>${esc(item.company_name||'—')}</small></span><span class="ops-deadline-st">${esc(deadlineStatusLabel(item))}</span></button></li>`).join('')}</ul>`:emptyState('Não há próximos prazos.','Quando houver obrigações no Motor de Processos, elas aparecerão aqui.')}</section>`}
      ${notifs._error?opsBlockError('opsActivity','Últimas atividades',notifs._error):`<section class="panel" id="opsActivity"><div class="ops-summary-head"><h3>Últimas Atividades</h3><button type="button" class="btn secondary" id="opsActivityAll">Ver todas</button></div>${actItems.length?actItems.map(n=>`<button type="button" class="activity-item ops-activity" data-nid="${esc(n.id)}" data-page="${activityHref(n)}" data-company="${esc(n.company_id||'')}"><span class="ops-act-ico" aria-hidden="true">${icon(activityIconName(n))}</span><span><b>${esc(n.title)}</b><div class="muted">${esc(n.company_name||n.context||n.message||'')}</div><small>${esc(timeAgo(n.created_at))}</small></span></button>`).join('') : emptyState('Nenhuma atividade registrada no período.','Quando houver eventos da carteira, eles aparecerão aqui.')}</section>`}
    </div>
  </div>`;
  c.querySelectorAll('.kpi-link[data-page], .ops-health-item[data-page], .ops-deadline[data-page]').forEach(btn=>{btn.onclick=()=>{state.page=btn.dataset.page;render()}});
  $('#opsDeadlinesAll')&&($('#opsDeadlinesAll').onclick=()=>{state.page='processos';render()});
  $('#opsActivityAll')&&($('#opsActivityAll').onclick=()=>{const p=$('#notifPanel');if(p){p.hidden=false;if(typeof drawNotifList==='function')drawNotifList()}});
  c.querySelectorAll('.ops-act').forEach(btn=>btn.onclick=()=>{state.dashActivity=btn.dataset.act;dashboard(c)});
  c.querySelectorAll('.ops-retry').forEach(btn=>btn.onclick=()=>dashboard(c));
  c.querySelectorAll('.ops-activity').forEach(btn=>btn.onclick=()=>{
    const page=btn.dataset.page||'dashboard';
    const company=btn.dataset.company;
    if(company)enterCompany(company,page);
    else{state.page=page;render()}
  });
  bindOpsChart(c,d.activity_series||[]);
  window.__cdsRefreshDashboard=()=>{if(state.page==='dashboard'){const box=$('#content');if(box)dashboard(box)}};
}
async function crudCompanies(c){if(state.companyUsers)return companyUsersPage(c,state.companyUsers);if(state.companyView)return companyViewPage(c,state.companyView);const q=state.companySearch||'';const status=state.companyStatus||'';const page=state.companyPage||1;state.companyListSeq=(state.companyListSeq||0)+1;const seq=state.companyListSeq;const data=await api('/empresas?page='+page+'&page_size=25'+ (q?'&q='+encodeURIComponent(q):'')+(status?'&status='+encodeURIComponent(status):''));if(seq!==state.companyListSeq)return;const list=data.items||[];c.innerHTML=head('Empresas','Gerencie a carteira de empresas do escritório.','<button class="btn" id="new">+ Nova empresa</button>','empresas')+`<div class="panel" style="margin-bottom:14px"><input id="companySearch" placeholder="Pesquisar empresa ou CNPJ..." value="${esc(q)}" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:10px"><div class="row-actions">${[['','Todas'],['ACTIVE','Ativas'],['BLOCKED','Bloqueadas'],['ARCHIVED','Arquivadas']].map(([v,l])=>`<button type="button" class="btn ${status===v?'':'secondary'}" data-status="${v}">${l}</button>`).join('')}</div></div><div class="panel table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>CNPJ</th><th>Situação</th><th>Última atividade</th><th>Pendências</th><th>Ações</th></tr></thead><tbody>${list.map(x=>`<tr><td data-label="Empresa"><b>${esc(x.trade_name||x.name)}</b><div class="muted">${esc(x.name)}</div>${x.assignee_names?`<div class="muted">Equipe: ${esc(x.assignee_names)}</div>`:''}</td><td data-label="CNPJ">${esc(formatCnpj(x.cnpj)||'-')}</td><td data-label="Situação">${companyStatusBadge(x.status)}</td><td data-label="Última atividade">${esc(x.last_activity_at?timeAgo(x.last_activity_at):'sem registro')}</td><td data-label="Pendências">${x.pending_count??0}</td><td data-label="Ações"><div class="row-actions">${x.status==='ARCHIVED'?`<button class="btn secondary" onclick="viewCompany('${x.id}')">Cadastro</button>`:`<button class="btn" onclick="enterCompany('${x.id}')">Acessar empresa</button>`}<div class="more-wrap"><button type="button" class="icon-button more-btn" aria-label="Mais ações">⋮</button><div class="more-menu" hidden><button type="button" onclick="viewCompany('${x.id}')">Cadastro</button><button type="button" onclick="editCompany('${x.id}')">Editar</button><button type="button" onclick="openCompanyUsers('${x.id}')">Usuários</button>${Number(state.tenant&&state.tenant.assign_staff_companies)&&(state.user.role==='OWNER'||state.user.role==='ACCOUNTANT')?`<button type="button" onclick="assignCompanyStaff('${x.id}')">Designar equipe</button>`:''}${x.status==='ARCHIVED'?((state.user.role==='OWNER'||state.user.role==='ACCOUNTANT')?`<button type="button" class="ok" onclick="restoreCompany('${x.id}')">Restaurar</button>`:''):`<button type="button" class="${x.status==='BLOCKED'?'ok':'danger'}" onclick="toggleCompany('${x.id}','${x.status}')">${x.status==='BLOCKED'?'Desbloquear':'Bloquear'}</button>${(state.user.role==='OWNER'||state.user.role==='ACCOUNTANT')?`<button type="button" onclick="archiveCompany('${x.id}')">Arquivar</button>`:''}`}${(state.user.role==='OWNER'||state.user.role==='ACCOUNTANT')?`<button type="button" class="danger" onclick="deleteCompany('${x.id}')">Excluir</button>`:''}</div></div></div></td></tr>`).join('')||`<tr><td colspan="6">${emptyState('Nenhuma empresa encontrada.','Não encontramos empresas com os filtros atuais.','<button type="button" class="btn secondary" id="clearCompanyFilters">Limpar filtros</button>')}</td></tr>`}</tbody></table></div><div class="panel" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px"><span>${data.from||0}–${data.to||0} de ${data.total||0} empresas</span><div class="row-actions"><button class="btn secondary" id="prevPage" ${page<=1?'disabled':''}>Anterior</button><span>Página ${data.page||1} de ${data.pages||1}</span><button class="btn secondary" id="nextPage" ${page>=(data.pages||1)?'disabled':''}>Próxima</button></div></div>`;$('#new').onclick=()=>companyWizard();bindMoreMenus(c);document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{state.companyStatus=b.dataset.status;state.companyPage=1;crudCompanies(c)});const search=$('#companySearch');search.onkeydown=e=>{if(e.key==='Enter'){state.companySearch=search.value.trim();state.companyPage=1;crudCompanies(c)}};search.oninput=debounce(()=>{state.companySearch=search.value.trim();state.companyPage=1;crudCompanies(c)},350);$('#prevPage').onclick=()=>{state.companyPage=Math.max(1,page-1);crudCompanies(c)};$('#nextPage').onclick=()=>{state.companyPage=page+1;crudCompanies(c)};$('#clearCompanyFilters')&&($('#clearCompanyFilters').onclick=()=>{state.companySearch='';state.companyStatus='';state.companyPage=1;crudCompanies(c)});window.viewCompany=id=>{cdsRemember({fallbackPage:'empresas',label:'Empresas',kind:'companyView'});state.companyView=id;state.companyUsers=null;crudCompanies(c)};window.editCompany=async id=>{const x=list.find(i=>i.id===id)||await api('/empresas/'+id);companyWizard(x)};window.openCompanyUsers=id=>enterCompany(id,'usuarios');window.toggleCompany=async(id,st)=>{try{await api('/empresas/'+id+(st==='BLOCKED'?'/desbloquear':'/bloquear'),{method:'POST',body:'{}'});toast(st==='BLOCKED'?'Empresa desbloqueada.':'Empresa bloqueada.');crudCompanies(c)}catch(err){toast(err.message)}};window.archiveCompany=id=>confirmArchiveCompany(id,()=>crudCompanies(c));window.restoreCompany=async id=>{try{await api('/empresas/'+id+'/desarquivar',{method:'POST',body:'{}'});toast('Empresa restaurada.');crudCompanies(c)}catch(err){toast(err.message)}};window.deleteCompany=id=>confirmDeleteCompany(id,()=>crudCompanies(c));window.assignCompanyStaff=id=>assignCompanyStaff(id)}
async function assignCompanyStaff(id){if(!(state.user.role==='OWNER'||state.user.role==='ACCOUNTANT'))return;try{const [team,current]=await Promise.all([api('/usuarios?page=1&page_size=100'),api('/empresas/'+id+'/responsaveis')]);const staff=(team.items||[]).filter(u=>u.role==='STAFF'&&u.active!==0);const selected=new Set((current.assignees||[]).map(a=>a.user_id));modal(`<form id="assignStaffForm">${modalHead('Designar equipe','Empresa sem responsável fica visível a toda a equipe. Com responsável, só esses funcionários veem, além do administrador e do contador.')}<div class="modal-body">${staff.length?staff.map(u=>`<label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="user_ids" value="${esc(u.id)}" ${selected.has(u.id)?'checked':''}><span>${esc(u.name)} <small class="muted">${esc(u.email||'')}</small></span></label>`).join(''):'<p class="muted">Cadastre usuários com perfil Equipe para designar empresas.</p>'}</div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Salvar</button>')}</form>`,'md');$('#assignStaffForm').onsubmit=async e=>{e.preventDefault();const user_ids=[...e.target.querySelectorAll('input[name="user_ids"]:checked')].map(i=>i.value);try{await api('/empresas/'+id+'/responsaveis',{method:'PUT',body:JSON.stringify({user_ids})});closeModal();toast('Equipe designada.','success');await crudCompanies($('#content'))}catch(err){toast(err.message)}}}catch(err){toast(err.message)}}
function confirmArchiveCompany(id,after){modal(`<form id="archCompanyForm">${modalHead('Arquivar empresa?','A empresa sai da listagem operacional. Consulte-a em Arquivadas quando precisar.')}<div class="modal-body"><div class="field"><label>Motivo *</label><textarea name="reason" rows="3" required placeholder="Informe o motivo do arquivamento."></textarea></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Arquivar empresa</button>')}</form>`,'md');$('#archCompanyForm').onsubmit=async e=>{e.preventDefault();const reason=String(new FormData(e.target).get('reason')||'').trim();if(reason.length<3){toast('Informe o motivo do arquivamento.');return}try{await api('/empresas/'+id+'/arquivar',{method:'POST',body:JSON.stringify({reason})});closeModal();toast('Empresa arquivada.','success');if(state.selectedCompany&&state.selectedCompany.id===id){state.selectedCompany=null;history.replaceState({},'','/')}state.companyView=null;if(typeof after==='function')await after();else await render()}catch(err){toast(err.message)}}}
function confirmDeleteCompany(id,after){modal(`<form id="delCompanyForm">${modalHead('Excluir empresa?','A empresa será removida do banco de dados. Quem excluiu e o motivo ficam no histórico de auditoria.')}<div class="modal-body"><div class="field"><label>Motivo *</label><textarea name="reason" rows="3" required placeholder="Informe o motivo da exclusão."></textarea></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Excluir empresa</button>')}</form>`,'md');$('#delCompanyForm').onsubmit=async e=>{e.preventDefault();const reason=String(new FormData(e.target).get('reason')||'').trim();if(reason.length<3){toast('Informe o motivo da exclusão.');return}try{await api('/empresas/'+id,{method:'DELETE',body:JSON.stringify({reason})});closeModal();toast('Empresa excluída.','success');if(state.selectedCompany&&state.selectedCompany.id===id){state.selectedCompany=null;history.replaceState({},'','/')}state.companyView=null;if(typeof after==='function')await after();else await render()}catch(err){toast(err.message)}}}
function companyStatusBadge(status){return({ACTIVE:'<span class="badge approved">Ativa</span>',BLOCKED:'<span class="badge rejected">Bloqueada</span>',ARCHIVED:'<span class="badge pending">Arquivada</span>'}[status]||'<span class="badge pending">-</span>')}
function profileLabel(profile){return({CLIENT_ADMIN:'Administrador',CLIENT_FINANCE:'Financeiro',CLIENT_VIEWER:'Visualizador'}[profile]||'Visualizador')}
function invitationLabel(status){return({PENDING:'Pendente',ACCEPTED:'Aceito',EXPIRED:'Expirado',REVOKED:'Revogado'}[status]||'-')}
function clientAccessLabel(x){if(!x.active&&(x.invitation_status==='PENDING'||x.invitation_status==='EXPIRED'||x.invitation_status==='REVOKED'||!x.invitation_status))return 'Pendente';return x.active?'Ativo':'Bloqueado'}
function userStatusLabel(active){return active?'Ativo':'Bloqueado'}
function formatCnpj(v){const k=String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');return k.length===14?k.slice(0,2)+'.'+k.slice(2,5)+'.'+k.slice(5,8)+'/'+k.slice(8,12)+'-'+k.slice(12):(v||'')}
function formatDate(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('pt-BR')}
function autoField(auto){return auto?' field-auto':''}
function autoHelp(auto){return auto?'<span class="field-help">Preenchido automaticamente</span>':''}
function cepDigits(v){return String(v||'').replace(/\D/g,'')}
function formatCepInput(v){const d=cepDigits(v);return d.length===8?d.slice(0,5)+'-'+d.slice(5):(v||'')}
function fillEmptyInput(el,val){if(!el||val==null||val==='')return false;if(String(el.value||'').trim())return false;el.value=val;return true}
function bindCepLookup(){
  const form=$('#companyForm');const input=form&&form.querySelector('[name="zip"]');if(!input)return;
  const msg=$('#cepLookupMsg');
  let lastKey='';let timer=null;let busy=false;
  const setCepMsg=(text,ok)=>{if(!msg)return;msg.className='cep-hint'+(ok?' cep-ok':'');msg.textContent=text||''};
  const consult=async()=>{
    const key=cepDigits(input.value);
    if(key.length!==8)return;
    if(key===lastKey||busy)return;
    busy=true;lastKey=key;input.value=formatCepInput(key);setCepMsg('Consultando CEP...');
    try{
      const r=await fetch('/api/empresas/consulta-cep',{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({cep:key})});
      const data=await r.json().catch(()=>({}));
      if(r.status===404){setCepMsg(data.message||'CEP não encontrado.');return}
      if(!r.ok){lastKey='';setCepMsg(data.message||'Não foi possível consultar o CEP. Preencha o endereço manualmente.');return}
      const e=data.endereco||{};
      fillEmptyInput(form.querySelector('[name="address"]'),e.logradouro);
      fillEmptyInput(form.querySelector('[name="neighborhood"]'),e.bairro);
      fillEmptyInput(form.querySelector('[name="city"]'),e.municipio);
      fillEmptyInput(form.querySelector('[name="state"]'),e.uf);
      if(e.cep)input.value=formatCepInput(e.cep);
      setCepMsg('Endereço preenchido automaticamente',true);
    }catch{lastKey='';setCepMsg('Não foi possível consultar o CEP. Preencha o endereço manualmente.')}
    finally{busy=false}
  };
  input.oninput=()=>{const key=cepDigits(input.value);if(key!==lastKey)lastKey='';clearTimeout(timer);if(key.length===8)timer=setTimeout(consult,400)};
  input.onblur=()=>{clearTimeout(timer);if(cepDigits(input.value).length===8)consult()};
}
function companyFormFields(x={},opts={}){
  const lookup=!x.id&&opts.lookup!==false;const auto=!!opts.auto;
  const cnpjRow=lookup?`<div class="field span2"><label>CNPJ *</label><div class="row-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input name="cnpj" id="cnpjInput" value="${esc(x.cnpj||'')}" placeholder="41.049.807/0001-04" autocomplete="off" style="flex:1;min-width:180px"><button type="button" class="btn secondary" id="cnpjLookup">Consultar CNPJ</button></div><div id="cnpjLookupMsg">${auto?'<div class="cnpj-ok">✓ Empresa encontrada<br><span style="font-weight:500">Dados preenchidos automaticamente.</span></div>':''}</div></div>`:`<div class="field"><label>CNPJ</label><input name="cnpj" value="${esc(x.cnpj||'')}"></div>`;
  return `<section class="form-section"><h3>Identificação da empresa</h3><div class="form-grid">${cnpjRow}<div class="field${autoField(auto)}"><label>Razão Social *</label><input name="name" required value="${esc(x.name||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Nome Fantasia</label><input name="trade_name" value="${esc(x.trade_name||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Situação cadastral</label><input name="cadastral_status" value="${esc(x.cadastral_status||'')}" placeholder="Informada pela fonte">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Data de abertura</label><input name="opened_on" value="${esc(x.opened_on||'')}" placeholder="AAAA-MM-DD">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Natureza jurídica</label><input name="legal_nature" value="${esc(x.legal_nature||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>CNAE principal</label><input name="main_cnae" value="${esc(x.main_cnae||'')}">${autoHelp(auto)}</div></div></section><section class="form-section"><h3>Informações complementares</h3><div class="form-grid"><div class="field"><label>Situação no escritório</label><select name="status"><option value="ACTIVE" ${!x.status||x.status==='ACTIVE'?'selected':''}>Ativa</option><option value="BLOCKED" ${x.status==='BLOCKED'?'selected':''}>Bloqueada</option><option value="ARCHIVED" ${x.status==='ARCHIVED'?'selected':''}>Arquivada</option></select></div><div class="field${autoField(auto)}"><label>Telefone</label><input name="phone" value="${esc(x.phone||'')}">${autoHelp(auto)}</div><div class="field span2${autoField(auto)}"><label>E-mail</label><input name="email" type="email" value="${esc(x.email||'')}">${autoHelp(auto)}<span class="field-error" id="emailFieldError" hidden>Informe um endereço de e-mail válido.</span></div><div class="field span2${autoField(auto)}"><label>Endereço</label><input name="address" value="${esc(x.address||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Número</label><input name="address_number" value="${esc(x.address_number||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Complemento</label><input name="complement" value="${esc(x.complement||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Bairro</label><input name="neighborhood" value="${esc(x.neighborhood||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>Município</label><input name="city" value="${esc(x.city||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>UF</label><input name="state" maxlength="2" value="${esc(x.state||'')}">${autoHelp(auto)}</div><div class="field${autoField(auto)}"><label>CEP</label><input name="zip" id="cepInput" value="${esc(x.zip||'')}" placeholder="00000-000" inputmode="numeric" autocomplete="postal-code"><div id="cepLookupMsg" class="cep-hint"></div>>${autoHelp(auto)}</div></div></section>`
}

function companyWizard(x={}){
  const editing=!!x.id;let step=1,draft={},consultedKey='',lookupBusy=false;
  const cnpjKey=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const filled=()=>['name','trade_name','address','email','phone','city'].some(k=>String(draft[k]||x[k]||'').trim());
  const applyCadastro=cad=>{
    const f=cad||{};
    Object.assign(draft,{
      cnpj:f.cnpj||draft.cnpj,name:f.razao_social||draft.name,trade_name:f.nome_fantasia||draft.trade_name,
      cadastral_status:f.situacao_cadastral||'',opened_on:f.data_abertura||'',legal_nature:f.natureza_juridica||'',
      main_cnae:f.cnae_principal||'',address:f.logradouro||'',address_number:f.numero||'',complement:f.complemento||'',
      neighborhood:f.bairro||'',city:f.municipio||'',state:f.uf||'',zip:f.cep||'',phone:f.telefone||draft.phone,email:f.email||draft.email
    });
  };
  const setMsg=(text,cls)=>{const el=$('#cnpjLookupMsg');if(!el)return;el.className=cls||'muted';el.textContent=text||''};
  const bindLookup=()=>{
    const btn=$('#cnpjLookup'),input=$('#cnpjInput');if(!btn||!input)return;
    input.oninput=()=>{
      const next=cnpjKey(input.value);
      if(consultedKey&&next&&next!==consultedKey){
        if(filled()&&!confirm('Os dados preenchidos serão substituídos pelos dados encontrados para o novo CNPJ. Deseja continuar?')){input.value=formatCnpj(consultedKey);return}
        consultedKey='';['name','trade_name','cadastral_status','opened_on','legal_nature','main_cnae','address','address_number','complement','neighborhood','city','state','zip'].forEach(k=>draft[k]='');
        setMsg('CNPJ alterado. Consulte novamente antes de cadastrar.','muted');
      }
    };
    btn.onclick=async()=>{
      if(lookupBusy)return;
      const raw=input.value;
      if(consultedKey&&filled()&&cnpjKey(raw)!==consultedKey&&!confirm('Os dados preenchidos serão substituídos pelos dados encontrados para o novo CNPJ. Deseja continuar?'))return;
      lookupBusy=true;btn.textContent='Consultando...';btn.disabled=true;setMsg('Consultando...','muted');
      try{
        const r=await fetch('/api/empresas/consulta-cnpj',{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({cnpj:raw})});
        const data=await r.json().catch(()=>({}));
        if(r.status===409){setMsg(data.message||'Esta empresa já está cadastrada','muted');toast(data.message||'Esta empresa já está cadastrada');return}
        if(!r.ok){setMsg(data.message||'Não foi possível consultar o cadastro do CNPJ agora. Tente novamente.','muted');toast(data.message||'Não foi possível consultar o cadastro do CNPJ agora. Tente novamente.');return}
        consultedKey=cnpjKey(data.cadastro&&data.cadastro.cnpj||raw);
        applyCadastro(data.cadastro||{});
        closeModal();draw();
        setTimeout(()=>{if(data.alerta)toast(data.alerta)},0);
      }catch(err){setMsg('Não foi possível consultar o cadastro do CNPJ agora. Tente novamente.','muted')}
      finally{lookupBusy=false;const b=$('#cnpjLookup');if(b){b.textContent='Consultar CNPJ';b.disabled=false}}
    };
  };
  const draw=()=>{
    const headTitle=editing?'Editar empresa':(step===1?'Nova empresa':'Primeiro usuário');
    const headDesc=editing?'Atualize os dados da empresa na carteira.':(step===1?'Cadastre uma nova empresa na carteira do escritório.':'Convite de ativação para o primeiro usuário da empresa.');
    const body=step===1?companyFormFields({...x,...draft},{auto:!!consultedKey}):`<p class="muted">Etapa 2 de 2. O acesso é ativado por convite. Não informe senha nesta tela.</p><div class="form-grid"><div class="field"><label>Nome *</label><input name="user_name" required value="${esc(draft.user_name||'')}"></div><div class="field"><label>E-mail *</label><input name="user_email" type="email" required value="${esc(draft.user_email||'')}"><span class="field-error" id="emailFieldError" hidden>Informe um endereço de e-mail válido.</span></div><div class="field span2"><label>Perfil</label><select name="user_profile"><option value="CLIENT_ADMIN" ${draft.user_profile==='CLIENT_ADMIN'?'selected':''}>Administrador</option><option value="CLIENT_FINANCE" ${draft.user_profile==='CLIENT_FINANCE'?'selected':''}>Financeiro</option><option value="CLIENT_VIEWER" ${draft.user_profile==='CLIENT_VIEWER'?'selected':''}>Visualizador</option></select></div></div>`;
    const primary=editing?'Salvar':(step===2?'Cadastrar empresa':'Continuar');
    modal(`<form id="companyForm" class="modal-form">${modalHead(headTitle,headDesc)}<div class="modal-body">${body}</div>${modalFoot(`${!editing&&step===2?'<button type="button" class="btn secondary" id="wizBack">Voltar</button>':'<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button>'}<button class="btn" id="companySubmit">${primary}</button>`)}</form>`,'lg');
    if(step===1){bindLookup();bindCepLookup()}
    $('#companyForm').onsubmit=async e=>{
      e.preventDefault();const body=Object.fromEntries(new FormData(e.target));Object.assign(draft,body);
      const emailVal=String(draft.email||draft.user_email||'');const errEl=$('#emailFieldError');if(emailVal&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)){if(errEl){errEl.hidden=false;errEl.closest('.field')&&errEl.closest('.field').classList.add('invalid')}return}if(errEl){errEl.hidden=true;errEl.closest('.field')&&errEl.closest('.field').classList.remove('invalid')}
      const submit=$('#companySubmit');if(submit){submit.disabled=true;submit.classList.add('busy');submit.textContent=editing?'Salvando...':(step===2?'Cadastrando...':'Continuando...')}
      try{
        if(editing){await api('/empresas/'+x.id,{method:'PATCH',body:JSON.stringify(draft)});toast('Empresa atualizada.');closeModal();state.companiesPage=await api('/empresas?page=1&page_size=25&status=ACTIVE');state.companies=state.companiesPage.items||[];await crudCompanies($('#content'));return}
        if(step===1){const key=cnpjKey(draft.cnpj);if(key&&consultedKey&&key!==consultedKey){toast('CNPJ alterado. Consulte novamente antes de cadastrar.');if(submit){submit.disabled=false;submit.classList.remove('busy');submit.textContent='Continuar'}return}step=2;closeModal();draw();return}
        const company=await api('/empresas',{method:'POST',body:JSON.stringify(draft)});
        await api('/empresas/'+company.id+'/users',{method:'POST',body:JSON.stringify({name:draft.user_name,email:draft.user_email,profile:draft.user_profile})});
        toast('Empresa e usuário criados.');closeModal();state.companiesPage=await api('/empresas?page=1&page_size=25&status=ACTIVE');state.companies=state.companiesPage.items||[];await enterCompany(company.id,'usuarios');
      }catch(err){toast(err.message);const b=$('#companySubmit');if(b){b.disabled=false;b.classList.remove('busy');b.textContent=editing?'Salvar':(step===2?'Cadastrar empresa':'Continuar')}}
    };
    $('#wizBack')&&($('#wizBack').onclick=()=>{Object.assign(draft,Object.fromEntries(new FormData($('#companyForm'))));step=1;closeModal();draw()});
  };
  draw();
}
async function companyViewPage(c,id){const x=await api('/empresas/'+id);const officeMgr=state.user.role==='OWNER'||state.user.role==='ACCOUNTANT';const archived=x.status==='ARCHIVED';const canAssign=officeMgr&&Number(state.tenant&&state.tenant.assign_staff_companies);c.innerHTML=head(esc(x.trade_name||x.name),'Dados cadastrais da empresa cliente.',cdsBackBtn('cdsBack')+(archived?'':'<button class="btn" id="enter">Acessar empresa</button>')+'<button class="btn secondary" id="edit">Editar</button>'+(canAssign?'<button class="btn secondary" id="assignCo">Designar equipe</button>':'')+(officeMgr&&archived?'<button class="btn" id="restoreCo">Restaurar</button>':'')+(officeMgr&&!archived?'<button class="btn secondary" id="archCo">Arquivar</button>':'')+(officeMgr?'<button class="btn secondary" id="delCo">Excluir</button>':''))+`<div class="panel"><div class="form-grid"><div><small class="muted">Equipe responsável</small><div>${esc(x.assignee_names||'Toda a equipe')}</div></div><div><small class="muted">CNPJ</small><div>${esc(formatCnpj(x.cnpj)||'-')}</div></div><div><small class="muted">Razão Social</small><div>${esc(x.name)}</div></div><div><small class="muted">Nome Fantasia</small><div>${esc(x.trade_name||'-')}</div></div><div><small class="muted">Situação</small><div>${companyStatusBadge(x.status)}</div></div><div><small class="muted">Telefone</small><div>${esc(x.phone||'-')}</div></div><div><small class="muted">E-mail</small><div>${esc(x.email||'-')}</div></div><div class="span2"><small class="muted">Endereço</small><div>${esc([x.address,x.address_number,x.complement,x.neighborhood,x.city,x.state,x.zip].filter(Boolean).join(', ')||'-')}</div></div></div></div>`;$('#cdsBack').onclick=()=>cdsGoBack({fallbackPage:'empresas',clear(){state.companyView=null},after(){crudCompanies(c)}});$('#enter')&&($('#enter').onclick=()=>enterCompany(x.id));$('#edit').onclick=()=>companyWizard(x);$('#assignCo')&&($('#assignCo').onclick=()=>assignCompanyStaff(x.id));$('#restoreCo')&&($('#restoreCo').onclick=async()=>{try{await api('/empresas/'+x.id+'/desarquivar',{method:'POST',body:'{}'});toast('Empresa restaurada.');state.companyView=null;crudCompanies(c)}catch(err){toast(err.message)}});$('#archCo')&&($('#archCo').onclick=()=>confirmArchiveCompany(x.id,()=>{state.companyView=null;crudCompanies(c)}));$('#delCo')&&($('#delCo').onclick=()=>confirmDeleteCompany(x.id,()=>{state.companyView=null;crudCompanies(c)}))}
async function companyUsersPage(c,companyId){
  const company=state.companies.find(x=>x.id===companyId)||await api('/empresas/'+companyId);
  const list=await api('/empresas/'+companyId+'/users');
  const canReset=state.user&&(state.user.role==='OWNER'||state.user.role==='ACCOUNTANT');
  const focusId=state.focusClientUserId;
  let focusPanel='';
  if(focusId){
    const focused=list.find(x=>x.id===focusId)||await api('/empresas/'+companyId+'/users/'+focusId).catch(()=>null);
    if(focused){
      const resetStatus=focused.password_reset_status||({PENDING:'PENDENTE',ACCEPTED:'CONCLUIDA',REVOKED:'FALHA',EXPIRED:'FALHA'}[focused.invitation_status]||null);
      const statusBadge=resetStatus==='CONCLUIDA'?'<span class="badge approved">CONCLUÍDA</span>':resetStatus==='FALHA'?'<span class="badge rejected">FALHA</span>':resetStatus==='PENDENTE'?'<span class="badge pending">PENDENTE</span>':'';
      const showResetBtn=canReset&&resetStatus!=='CONCLUIDA';
      focusPanel=`<div class="panel" id="resetRequestPanel" style="margin-bottom:14px;border-color:var(--color-primary)"><h3 style="margin:0 0 8px">Solicitação de redefinição de acesso ${statusBadge}</h3><div class="form-grid"><div><small class="muted">Cliente</small><div>${esc(company.trade_name||company.name)}</div></div><div><small class="muted">Usuário</small><div>${esc(focused.name)}</div></div><div><small class="muted">E-mail</small><div>${esc(focused.email)}</div></div><div><small class="muted">Credencial</small><div>${esc(focused.credential_status||(focused.credential_configured?'CONFIGURADA':'NÃO CONFIGURADA'))}</div></div><div><small class="muted">Método</small><div>E-mail</div></div><div><small class="muted">Solicitada em</small><div>${esc(formatDate(focused.password_reset_requested_at||focused.invitation_created_at)||'-')}</div></div>${resetStatus==='CONCLUIDA'?`<div><small class="muted">Concluída em</small><div>${esc(formatDate(focused.password_reset_completed_at||focused.invitation_accepted_at)||'-')}</div></div>`:''}</div>${showResetBtn?'<div class="row-actions" style="margin-top:14px"><button type="button" class="btn" id="focusResetBtn">Redefinir acesso</button></div>':(resetStatus==='CONCLUIDA'?'<p class="muted" style="margin-top:12px">A senha já foi redefinida com sucesso. Nenhuma ação pendente.</p>':'')}</div>`;
    }
    state.focusClientUserId=null;
    state.focusResetRequest=false;
  }
  c.innerHTML=head('Usuários','Controle de acesso desta empresa.',(state.selectedCompany?'':cdsBackBtn('cdsBack'))+'<button class="btn" id="new">+ Novo usuário</button>','usuarios')+focusPanel+`<div class="panel table-wrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Credencial</th><th>Convite</th><th>Criação</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>${list.map(x=>`<tr${focusId&&x.id===focusId?' style="outline:2px solid var(--color-primary)"':''}><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${profileLabel(x.profile)}</td><td>${clientAccessLabel(x)}</td><td>${esc(x.credential_status||(x.credential_configured?'CONFIGURADA':'NÃO CONFIGURADA'))}</td><td>${invitationLabel(x.invitation_status)}</td><td>${formatDate(x.created_at)}</td><td>${formatDate(x.last_access_at)}</td><td><div class="row-actions"><button class="btn secondary" onclick="editClientUser('${companyId}','${x.id}')">Editar</button><div class="more-wrap"><button type="button" class="icon-button more-btn" aria-label="Mais ações">⋮</button><div class="more-menu" hidden><button type="button" onclick="viewClientUser('${companyId}','${x.id}')">Visualizar</button>${canReset?`<button type="button" onclick="resetClientAccess('${x.id}')">Redefinir acesso</button>`:''}<button type="button" onclick="resendInvite('${x.id}')">Reenviar convite</button><button type="button" onclick="revokeInvite('${x.id}')">Revogar convite</button><button type="button" class="${x.active?'danger':'ok'}" onclick="toggleClientUser('${x.id}',${x.active?1:0})">${x.active?'Bloquear':'Desbloquear'}</button></div></div></div></td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhum usuário.</td></tr>'}</tbody></table></div>`;
  $('#cdsBack')&&($('#cdsBack').onclick=()=>cdsGoBack({fallbackPage:'empresas',clear(){state.companyUsers=null},after(){crudCompanies(c)}}));
  $('#new').onclick=()=>clientUserModal(companyId);
  if($('#focusResetBtn')&&focusId)$('#focusResetBtn').onclick=()=>resetClientAccess(focusId);
  bindMoreMenus(c);
  window.viewClientUser=async(cid,uid)=>{const u=await api('/empresas/'+cid+'/users/'+uid);modal(`${modalHead('Usuário')}<p><b>${esc(u.name)}</b><br>${esc(u.email)}</p><p>Perfil: ${profileLabel(u.profile)}<br>Situação: ${userStatusLabel(u.active)}<br>Credencial: ${esc(u.credential_status||'-')}<br>Convite: ${invitationLabel(u.invitation_status)}<br>Criação: ${formatDate(u.created_at)}<br>Último acesso: ${formatDate(u.last_access_at)}</p>`)};
  window.editClientUser=async(cid,uid)=>clientUserModal(cid,await api('/empresas/'+cid+'/users/'+uid));
  window.resetClientAccess=async id=>{if(!confirm('Redefinir acesso deste usuário?\n\nA senha atual será invalidada e um novo e-mail será enviado para que o cliente crie uma nova senha.'))return;try{const r=await api('/client-users/'+id+'/redefinir-acesso',{method:'POST',body:'{}'});toast((r&&r.message)||'Novo acesso enviado.','success');companyUsersPage(c,companyId)}catch(err){toast(err.message,'error')}};
  window.resendInvite=async id=>{try{const r=await api('/client-users/'+id+'/resend-invitation',{method:'POST',body:'{}'});toast((r&&r.message)||'Novo convite enviado.');companyUsersPage(c,companyId)}catch(err){toast(err.message)}};
  window.revokeInvite=async id=>{if(!confirm('Revogar o convite pendente deste usuário?'))return;try{await api('/client-users/'+id+'/revoke-invitation',{method:'POST',body:'{}'});toast('Convite revogado.');companyUsersPage(c,companyId)}catch(err){toast(err.message)}};
  window.toggleClientUser=async(id,active)=>{try{await api('/client-users/'+id+(active?'/block':'/unblock'),{method:'POST',body:'{}'});toast(active?'Usuário bloqueado.':'Usuário desbloqueado.');companyUsersPage(c,companyId)}catch(err){toast(err.message)}}
}
function clientUserModal(companyId,x={}){const statusField=x.id?`<div class="field"><label>Situação</label><select name="active"><option value="1" ${x.active?'selected':''}>Ativo</option><option value="0" ${!x.active?'selected':''}>Pendente / inativo</option></select></div>`:'';const profile=x.id?(x.profile||'CLIENT_VIEWER'):(x.profile||'CLIENT_ADMIN');const pending=!x.id||!(x.invitation_status==='ACCEPTED'||x.credential_configured||x.last_access_at);modal(`<form id="clientUserForm">${modalHead(x.id?'Editar usuário':'Novo usuário',x.id?(pending?'Ao salvar, o convite de ativação é enviado automaticamente para o e-mail informado.':'Atualize o acesso desta empresa.'):'Ao salvar, o convite de ativação é enviado automaticamente por e-mail. A senha é criada pelo usuário.')}<div class="modal-body"><div class="form-grid"><div class="field"><label>Nome *</label><input name="name" required value="${esc(x.name||'')}"></div><div class="field"><label>E-mail *</label><input name="email" type="email" required value="${esc(x.email||'')}"></div><div class="field"><label>Perfil *</label><select name="profile"><option value="CLIENT_ADMIN" ${profile==='CLIENT_ADMIN'?'selected':''}>Administrador</option><option value="CLIENT_FINANCE" ${profile==='CLIENT_FINANCE'?'selected':''}>Financeiro</option><option value="CLIENT_VIEWER" ${profile==='CLIENT_VIEWER'?'selected':''}>Visualizador</option></select></div>${statusField}</div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">'+(x.id?'Salvar alterações':'Criar usuário')+'</button>')}</form>`,'md');$('#clientUserForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));if(body.active!==undefined)body.active=body.active==='1';try{if(x.id){const r=await api('/client-users/'+x.id,{method:'PATCH',body:JSON.stringify(body)});closeModal();const invite=r&&r.invitation;if(invite){toast(invite.message||(invite.email_sent?'Convite enviado para '+body.email+'.':'Usuário atualizado.'),invite.email_sent?'success':'warning')}else toast('Usuário atualizado.','success')}else{const r=await api('/empresas/'+companyId+'/users',{method:'POST',body:JSON.stringify(body)});closeModal();const invite=r&&r.invitation;toast((invite&&invite.message)||r.message||'Usuário cadastrado. Um convite de ativação foi enviado para o e-mail informado.',(invite&&invite.email_sent)?'success':'warning')}const content=$('#content');if(content)companyUsersPage(content,companyId)}catch(err){toast(err.message,'error')}}}
async function transactions(c,type){const title=type==='despesas'?'Despesas':'Receitas';const page=state.listPage?.[type]||1;await withList(c,()=>api('/'+type+'?page='+page+'&page_size=25'),data=>{const list=listItems(data);const newBtn=type==='despesas'?`<button class="btn" id="new">+ Nova despesa</button>`:'';c.innerHTML=head(title,type==='despesas'?'Informações financeiras fornecidas pelas empresas.':'Receitas entram por importação ou integração e seguem o fluxo contábil.',newBtn,type)+`<div class="panel table-wrap"><table class="table"><thead><tr><th>Data</th><th>Empresa</th><th>Descrição</th><th>Origem</th><th>Forma</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${list.map(x=>`<tr><td>${x.occurred_on}</td><td>${esc(x.company_name)}</td><td>${esc(x.description)}</td><td>${esc(originLabel(x.origin))}</td><td>${esc(originLabel(type==='despesas'?x.payment_method:x.receipt_method))}</td><td class="money">${money(x.amount_cents)}</td><td>${txBadge(x.workflow_status||x.status)}</td></tr>`).join('')}</tbody></table>${!list.length?'<div class="empty">Nenhum registro encontrado.</div>':''}</div>`+pagerHtml(data,type);$('#new')&&($('#new').onclick=()=>txModal(type));bindPager(type,dir=>{state.listPage={...state.listPage,[type]:Math.max(1,page+dir)};transactions(c,type)})})}
const payOptions=[['PIX','PIX'],['DINHEIRO','Dinheiro'],['DEBITO','Cartão de débito'],['CREDITO','Cartão de crédito'],['TRANSFERENCIA','Transferência'],['BOLETO','Boleto'],['OUTRO','Outro']];
function txModal(type){
  if(type==='despesas'&&window.CdsSmartExpense){
    const ctx=state.selectedCompany;
    return CdsSmartExpense.open({
      mode:'office',
      token:state.token,
      companyId:ctx&&ctx.id||null,
      companyName:ctx?(ctx.trade_name||ctx.name):'',
      categories:state.categories||[],
      banks:state.banks||[],
      api:async(path,opt={})=>{
        if(path.startsWith('/api/')){
          const headers=opt.body instanceof FormData?authHeaders():{...authHeaders(),'Content-Type':'application/json'};
          const r=await fetch(path,{...opt,headers:{...headers,...(opt.headers||{})}});
          const body=await r.json().catch(()=>({}));
          if(!r.ok)throw Object.assign(new Error(body.message||body.error||'Erro'),{status:r.status});
          return body;
        }
        return api(path,opt);
      },
      toast,
      uploadUrl:'/api/documentos/upload',
      deleteUrl:id=>'/api/documentos/'+id,
      analyzeUrl:id=>'/api/documentos/'+id+'/analise-despesa',
      reanalyzeUrl:id=>'/api/documentos/'+id+'/analise-despesa/reler',
      saveUrl:'/api/despesas',
      viewUrlFor:id=>'/api/documentos/'+id+'/view',
      onSaved:()=>render()
    });
  }
  const expense=type==='despesas';const cats=state.categories.filter(x=>x.kind==='BOTH'||x.kind===(expense?'EXPENSE':'REVENUE'));let file=null;modal(`<form id="txForm" class="tx-form">${modalHead(expense?'Nova despesa':'Nova receita',expense?'Informe descrição, valor, data, pagamento e comprovante.':'Informe os dados da receita.')}<div class="modal-body"><div class="form-grid">${companyField()}<div class="field span2"><label>Descrição *</label><input name="description" required placeholder="Ex.: Frete"></div><div class="field"><label>Valor *</label><input name="amount" required placeholder="R$ 120,00" inputmode="decimal"><span class="field-error" id="amountFieldError" hidden>Informe um valor válido.</span></div><div class="field"><label>Data *</label><input type="date" name="occurred_on" required value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>${expense?'Forma de pagamento':'Forma de recebimento'} *</label><select name="${expense?'payment_method':'receipt_method'}" required>${payOptions.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div><div class="field"><label>Banco / Caixa</label><select name="bank_id"><option value="">Não informado</option>${state.banks.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Categoria</label><select name="category_id"><option value="">Outros</option>${cats.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div></div><div class="doc-block"><h3>Comprovante</h3><p class="muted">Anexe o comprovante desta ${expense?'despesa':'receita'} (PDF, JPG ou PNG).</p><div class="dropzone" id="dropzone"><strong>Arraste e solte um arquivo aqui</strong><span>ou clique para selecionar</span><small>PDF, JPG ou PNG</small><input id="txFile" type="file" accept=".pdf,.jpg,.jpeg,.png" hidden><button type="button" class="btn secondary" id="pickFile">Selecionar arquivo</button></div><div id="attached" class="empty">Nenhum documento anexado ainda.</div></div></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" id="txSubmit">${expense?'Salvar despesa':'Salvar receita'}</button></div></form>`,'lg');bindCompanyPicker();const attached=$('#attached');const renderFile=()=>{if(!file){attached.className='empty';attached.textContent='Nenhum documento anexado ainda.';return}attached.className='file-card';attached.innerHTML=`<div>${(file.type||'').startsWith('image/')?'🖼':'📄'} ${esc(file.name)}<small>${Math.round(file.size/1024)} KB</small></div><div class="row-actions"><button type="button" class="btn secondary" id="previewFile">Visualizar</button><button type="button" class="btn secondary" id="removeFile">Remover</button></div>`;$('#removeFile').onclick=()=>{file=null;renderFile()};$('#previewFile').onclick=()=>window.open(URL.createObjectURL(file))};const setFile=f=>{if(!f)return;const ext=f.name.split('.').pop().toLowerCase();if(!['pdf','jpg','jpeg','png'].includes(ext)){toast('Formato não autorizado. Envie JPG, JPEG, PNG ou PDF.');return}file=f;renderFile();toast('Documento anexado com sucesso.','success')};$('#pickFile').onclick=()=>$('#txFile').click();$('#txFile').onchange=e=>setFile(e.target.files[0]);const zone=$('#dropzone');zone.ondragover=e=>{e.preventDefault();zone.classList.add('over')};zone.ondragleave=()=>zone.classList.remove('over');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');setFile(e.dataTransfer.files[0])};$('#txForm').onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target);const amtErr=$('#amountFieldError');if(!String(form.get('amount')||'').trim()){if(amtErr){amtErr.hidden=false;amtErr.closest('.field')&&amtErr.closest('.field').classList.add('invalid')}return}if(amtErr){amtErr.hidden=true;amtErr.closest('.field')&&amtErr.closest('.field').classList.remove('invalid')}const txBtn=$('#txSubmit');if(txBtn){txBtn.disabled=true;txBtn.classList.add('busy');txBtn.textContent='Salvando...'}try{let documentId=null,warning=null;if(file){try{const upload=new FormData();upload.append('file',file);upload.append('company_id',form.get('company_id'));const r=await fetch('/api/documentos/upload',{method:'POST',headers:authHeaders(),body:upload});const document=await r.json();if(!r.ok)throw Error(document.message||document.error||'Falha no upload');documentId=document.id}catch(err){warning=err.message}}const body=Object.fromEntries(form);if(documentId)body.document_id=documentId;await api('/'+type,{method:'POST',body:JSON.stringify(body)});closeModal();toast(expense?'Despesa registrada com sucesso. Ela foi enviada para análise da contabilidade.':'Receita registrada com sucesso. Ela foi enviada para análise da contabilidade.','success');if(warning)toast('A movimentação foi salva, mas o documento não pôde ser anexado: '+warning,'warning');await render()}catch(err){toast(err.message);const txBtn=$('#txSubmit');if(txBtn){txBtn.disabled=false;txBtn.classList.remove('busy');txBtn.textContent=expense?'Salvar despesa':'Salvar receita'}}}}
async function viewEntry(id){try{const e=await api('/lancamentos/'+id);modal(`${modalHead('Detalhes do lançamento',esc(e.company_name||''))}<div class="modal-body">${movementFactsHtml(e)}${nLinesHtml(e)}${e.classification?suggestionPanel(e.classification):''}<h3>Documentos</h3>${entryDocumentHtml(e)}<h3>Histórico</h3>${timelineHtml(e.timeline,e.status)}</div>${modalFoot('<button type="button" class="btn" onclick="closeModal()">Fechar</button>')}`,'lg');bindEntryDoc(e)}catch(err){toast(err.message)}}
window.viewEntry=viewEntry;
async function entries(c){const page=state.listPage?.lancamentos||1;const f=state.entryFilters||{};const qs=new URLSearchParams({page,page_size:'25'});if(f.from)qs.set('from',f.from);if(f.to)qs.set('to',f.to);if(f.origin)qs.set('origin',f.origin);if(f.source_type)qs.set('source_type',f.source_type);if(f.q)qs.set('q',f.q);await withList(c,()=>api('/lancamentos?'+qs.toString()),data=>{const list=listItems(data);const flow=list.filter(x=>x.source_type!=='MANUAL');const manuals=list.filter(x=>x.source_type==='MANUAL');const row=x=>`<tr class="click-row" onclick="viewEntry('${x.id}')"><td data-label="Empresa">${esc(x.company_name)}</td><td data-label="Data">${x.occurred_on}</td><td data-label="Histórico">${esc(x.description)}</td><td data-label="Origem">${esc(originLabel(x.origin||x.source_type))}</td><td data-label="Valor" class="money">${money(x.debit_cents||x.source_cents||0)}</td><td data-label="Situação">${badge(x.status)}</td><td data-label="Usuário">${esc(x.posted_by_name||'-')}</td><td data-label="Ação"><button class="btn secondary" onclick="event.stopPropagation();viewEntry('${x.id}')">Ver linhas</button></td></tr>`;c.innerHTML=head('Lançamentos contábeis','Partidas contábeis efetivadas após aprovação.','<button class="btn" id="new">+ Lançamento manual</button>','lancamentos')+`<p class="muted">Resultado do processo contábil · a geração do lançamento ocorre automaticamente na aprovação.</p><form class="filters" id="entryFilters"><input type="date" name="from" value="${esc(f.from||'')}"><input type="date" name="to" value="${esc(f.to||'')}"><select name="origin"><option value="">Origem</option><option value="PORTAL_CLIENTE" ${f.origin==='PORTAL_CLIENTE'?'selected':''}>Portal do Cliente</option><option value="PORTAL_ESCRITORIO" ${f.origin==='PORTAL_ESCRITORIO'?'selected':''}>Portal do Escritório</option><option value="IMPORTACAO_CONTABIL" ${f.origin==='IMPORTACAO_CONTABIL'?'selected':''}>Importação Contábil</option></select><select name="source_type"><option value="">Tipo</option><option value="EXPENSE" ${f.source_type==='EXPENSE'?'selected':''}>Despesa</option><option value="REVENUE" ${f.source_type==='REVENUE'?'selected':''}>Receita</option><option value="MANUAL" ${f.source_type==='MANUAL'?'selected':''}>Manual</option></select><input name="q" placeholder="Busca" value="${esc(f.q||'')}"><button class="btn light" type="submit">Filtrar</button></form><div class="panel table-wrap"><h3 style="padding:16px 16px 0">Lançamentos do fluxo</h3><table class="table"><thead><tr><th>Empresa</th><th>Data</th><th>Histórico</th><th>Origem</th><th>Valor</th><th>Situação</th><th>Usuário</th><th>Ações</th></tr></thead><tbody>${flow.map(row).join('')||`<tr><td colspan="8">${emptyState('Nenhum lançamento efetivado','Aprove classificações para gerar os lançamentos automaticamente.')}</td></tr>`}</tbody></table></div><div class="panel table-wrap" style="margin-top:16px"><h3 style="padding:16px 16px 0">Lançamento manual</h3><table class="table"><thead><tr><th>Empresa</th><th>Data</th><th>Histórico</th><th>Origem</th><th>Valor</th><th>Situação</th><th>Usuário</th><th>Ações</th></tr></thead><tbody>${manuals.map(row).join('')||`<tr><td colspan="8"><div class="empty">Nenhum lançamento manual neste filtro.</div></td></tr>`}</tbody></table></div>`+pagerHtml(data,'lancamentos');$('#new').onclick=()=>manualEntry();const ff=$('#entryFilters');if(ff)ff.onsubmit=e=>{e.preventDefault();state.entryFilters=Object.fromEntries(new FormData(e.target));state.listPage={...state.listPage,lancamentos:1};entries(c)};bindPager('lancamentos',dir=>{state.listPage={...state.listPage,lancamentos:Math.max(1,page+dir)};entries(c)})})}
function manualEntry(prefill){const start=prefill&&prefill.lines&&prefill.lines.length?prefill.lines:[{side:'D',account_id:'',amount:''},{side:'C',account_id:'',amount:''}];modal(`<form id="entryForm">${modalHead(prefill?'Classificar movimentação':'Lançamento N linhas',prefill?'Após classificar, a movimentação seguirá para aprovação.':'Débito, crédito e totais da partida.')}<div class="modal-body">${prefill?`${movementFactsHtml(prefill)}${prefill.classification?suggestionPanel(prefill.classification):'<div class="panel" style="margin-bottom:12px"><b>Revisão necessária</b><p class="muted">Informe débito e crédito.</p></div>'}<h3>Documentos</h3>${entryDocumentHtml(prefill)}<h3>Histórico</h3>${timelineHtml(prefill.timeline,prefill.status)}`:''}<div class="form-grid">${prefill?(prefill.company_id?`<input type="hidden" name="company_id" value="${esc(prefill.company_id)}">`:''):companyField()}<div class="field"><label>Data</label><input name="occurred_on" type="date" required value="${esc(prefill?.occurred_on||new Date().toISOString().slice(0,10))}"></div><div class="field span2"><label>Histórico</label><input name="description" required value="${esc(prefill?.description||'')}"></div></div><div id="entryLines"></div><div class="row-actions" style="margin:10px 0"><button type="button" class="btn secondary" id="addLine">+ Adicionar linha</button><span id="entryTotals" class="entry-totals"></span></div><div class="field"><label>Observação</label><input name="note" placeholder="Opcional"></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" id="saveEntry">'+(prefill?'Concluir classificação':'Salvar')+'</button>')}</form>`,'lg');bindCompanyPicker();bindEntryDoc(prefill||{});const rows=start.map(l=>({side:l.side,account_id:l.account_id||'',amount:l.amount_cents!=null?(l.amount_cents/100).toFixed(2).replace('.',','):(l.amount||'')}));const draw=()=>{$('#entryLines').innerHTML=`<table class="table"><tr><th>D/C</th><th>Conta</th><th>Valor</th><th></th></tr>${rows.map((l,i)=>`<tr><td><select data-k="side" data-i="${i}"><option value="D" ${l.side==='D'?'selected':''}>D</option><option value="C" ${l.side==='C'?'selected':''}>C</option></select></td><td><select data-k="account_id" data-i="${i}">${accountOptions()}</select></td><td><input data-k="amount" data-i="${i}" value="${esc(l.amount)}" placeholder="0,00"></td><td><button type="button" class="btn secondary" data-del="${i}">Remover</button></td></tr>`).join('')}</table>`;rows.forEach((l,i)=>{const sel=$(`#entryLines select[data-k="account_id"][data-i="${i}"]`);if(sel){if(l.account_id)sel.value=l.account_id;else rows[i].account_id=sel.value||''}});document.querySelectorAll('#entryLines [data-k]').forEach(el=>el.onchange=el.oninput=()=>{rows[Number(el.dataset.i)][el.dataset.k]=el.value;totals()});document.querySelectorAll('#entryLines [data-del]').forEach(b=>b.onclick=()=>{rows.splice(Number(b.dataset.del),1);draw()});totals()};const parseAmt=v=>{const n=Number(String(v||'0').replace(/\./g,'').replace(',','.'));return Math.round(n*100)};const totals=()=>{const d=rows.filter(x=>x.side==='D').reduce((a,x)=>a+parseAmt(x.amount),0),c=rows.filter(x=>x.side==='C').reduce((a,x)=>a+parseAmt(x.amount),0);const sameAcct=(()=>{const deb=rows.filter(x=>x.side==='D'&&x.account_id);const cre=rows.filter(x=>x.side==='C'&&x.account_id);return deb.length===1&&cre.length===1&&deb[0].account_id===cre[0].account_id})();$('#entryTotals').textContent=`Débitos: ${money(d)} · Créditos: ${money(c)} · Diferença: ${money(Math.abs(d-c))}${sameAcct?' · Débito e crédito iguais':''}`;const btn=$('#saveEntry');if(btn)btn.disabled=d<=0||d!==c||sameAcct||rows.some(x=>!x.account_id)};draw();$('#addLine').onclick=()=>{rows.push({side:'D',account_id:'',amount:''});draw()};document.querySelectorAll('.cand').forEach(b=>b.onclick=()=>{const c=(prefill.classification.candidates||[])[Number(b.dataset.i)];if(!c)return;const amt=prefill.movement?.amount_cents||prefill.debit||0;rows.splice(0,rows.length,{side:'D',account_id:c.debit_account_id,amount:(amt/100).toFixed(2).replace('.',',')},{side:'C',account_id:c.credit_account_id,amount:(amt/100).toFixed(2).replace('.',',')});draw()});$('#entryForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const lines=rows.map(l=>({account_id:l.account_id,side:l.side,amount_cents:parseAmt(l.amount)}));if(lines.some(l=>!l.account_id)){toast('Selecione a conta em todas as linhas.');return}const dLine=lines.find(l=>l.side==='D'),cLine=lines.find(l=>l.side==='C');if(dLine&&cLine&&dLine.account_id===cLine.account_id){toast('Débito e crédito não podem ser a mesma conta.');return}try{if(prefill&&prefill.id)await api('/lancamentos/'+prefill.id+'/reclassificar',{method:'POST',body:JSON.stringify({lines,reason:f.note||'Decisão manual'})});else await api('/lancamentos',{method:'POST',body:JSON.stringify({company_id:f.company_id,occurred_on:f.occurred_on,description:f.description,note:f.note,lines})});closeModal();if(prefill&&prefill.id)await afterClassification(prefill.id);else{toast('Lançamento gravado.');await render()}}catch(err){toast(err.message)}}}
async function afterClassification(doneId){toast('Classificação concluída. A movimentação foi para Aprovação.','success');const data=await api('/lancamentos?status=NEEDS_CLASSIFICATION&page=1&page_size=25');const next=listItems(data).find(x=>x.id!==doneId);modal(`${modalHead('Classificação concluída','Próximo passo: Aprovação')}<div class="modal-body"><p>A movimentação saiu da fila de Classificação e está em <b>Aprovação</b> (não em Lançamentos — o lançamento só aparece lá depois de aprovado).</p><p>${next?'Há outra movimentação na fila de classificação.':'Nenhuma outra movimentação aguardando classificação.'}</p></div>${modalFoot(`<button type="button" class="btn secondary" id="backQueue">Continuar na fila</button><button type="button" class="btn" id="goApproval">Ir para Aprovação</button>${next?`<button type="button" class="btn secondary" id="nextClassif">Próxima classificação →</button>`:''}`)}`,'md');$('#backQueue').onclick=()=>{closeModal();state.page='classificacao';render()};$('#goApproval').onclick=()=>{closeModal();state.page='aprovacao';render()};if(next)$('#nextClassif').onclick=()=>{closeModal();classifyEntry(next.id)}}
async function classificationPage(c){const page=state.listPage?.classificacao||1;const f=state.classifFilters||{};const qs=new URLSearchParams({status:'NEEDS_CLASSIFICATION',page,page_size:'25'});if(f.from)qs.set('from',f.from);if(f.to)qs.set('to',f.to);if(f.q)qs.set('q',f.q);await withList(c,()=>api('/lancamentos?'+qs.toString()),data=>{const list=listItems(data);const total=data.total||list.length;const empty=emptyState('Nenhuma movimentação aguardando classificação.','A fila está em dia.');const table=`<div class="panel table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Movimentação</th><th>Valor</th><th>Data</th><th>Documento</th><th>Confiança</th><th>Ação</th></tr></thead><tbody>${list.map(x=>`<tr><td data-label="Empresa">${esc(x.company_name)}</td><td data-label="Movimentação">${esc(x.description)}</td><td data-label="Valor">${money(x.debit_cents||x.source_cents||0)}</td><td data-label="Data">${esc(x.occurred_on||'-')}</td><td data-label="Documento">${esc(x.document_name||'—')}</td><td data-label="Confiança">${confidencePct(x)}%</td><td data-label="Ação"><button class="btn" onclick="classifyEntry('${x.id}')">Classificar →</button></td></tr>`).join('')}</tbody></table></div>`+pagerHtml(data,'classificacao');c.innerHTML=head('Classificação','Movimentações que precisam de definição ou revisão contábil.','','classificacao')+queueFiltersHtml('classifFilters',f)+(list.length?queueBanner(total,'Aguardando classificação','① Classificação · Após classificar, a movimentação seguirá para aprovação.')+table:empty);const ff=$('#classifFilters');if(ff)ff.onsubmit=e=>{e.preventDefault();state.classifFilters=Object.fromEntries(new FormData(e.target));state.listPage={...state.listPage,classificacao:1};classificationPage(c)};if(list.length)bindPager('classificacao',dir=>{state.listPage={...state.listPage,classificacao:Math.max(1,page+dir)};classificationPage(c)});window.classifyEntry=async id=>{const e=await api('/lancamentos/'+id);manualEntry(e)}})}
async function reviewApproval(id){
  const e=await api('/lancamentos/'+id);
  const canAct=state.user.role==='OWNER'||state.user.role==='ACCOUNTANT';
  const pipe=e.pipeline||{};
  const sug=pipe.suggestion||{};
  const confPct=pipe.confidence!=null?Math.round(Number(pipe.confidence)*100):(e.classification?confidencePct(e.classification):null);
  const confBand=pipe.confidence_band||(confPct>=95?'ALTA':confPct>=80?'MÉDIA':'BAIXA');
  const nature=pipe.operation_type||sug.operation_type||'-';
  const debit=(e.lines||[]).find(l=>l.side==='D');
  const credit=(e.lines||[]).find(l=>l.side==='C');
  const leftDoc=e.document
    ? `<div class="panel approval-doc-pane"><h3>Documento</h3>${entryDocumentHtml(e)}<p class="muted" style="margin-top:8px">LANÇAMENTO PREPARADO — CONFIRA E APROVE.</p></div>`
    : `<div class="panel approval-doc-pane"><h3>Documento</h3><p class="muted">Nenhum documento vinculado.</p></div>`;
  const rightEntry=`<div class="panel approval-entry-pane"><h3>Lançamento sugerido</h3>
    <div class="form-grid" style="gap:8px">
      <div><small class="muted">Fornecedor</small><div><b>${esc((e.movement&&e.movement.supplier_name)||(pipe.fields&&pipe.fields.supplier_name&&pipe.fields.supplier_name.value)||'-')}</b></div></div>
      <div><small class="muted">Documento</small><div>${esc((e.document&&e.document.original_name)||'-')}</div></div>
      <div><small class="muted">Data</small><div>${esc(e.occurred_on||'-')}</div></div>
      <div><small class="muted">Valor</small><div><b>${money((e.movement&&e.movement.amount_cents)||e.debit||0)}</b></div></div>
      <div><small class="muted">Competência</small><div>${esc(sug.competence||(e.occurred_on||'').slice(0,7)||'-')}</div></div>
      <div><small class="muted">Natureza</small><div>${esc(nature)}</div></div>
      <div><small class="muted">Débito</small><div>${esc(debit?(debit.account_code+' — '+debit.account_description):'-')}</div></div>
      <div><small class="muted">Crédito</small><div>${esc(credit?(credit.account_code+' — '+credit.account_description):'-')}</div></div>
      <div style="grid-column:1/-1"><small class="muted">Histórico</small><div>${esc(sug.history||e.description||'-')}</div></div>
      <div><small class="muted">Centro de custo</small><div>${esc(sug.cost_center||'-')}</div></div>
      <div><small class="muted">Confiança</small><div><b>${confPct!=null?confPct+'%':'-'}</b> · ${esc(confBand)}</div></div>
    </div>
    ${pipe.confidence_reason?`<p class="muted" style="margin-top:10px">${esc(pipe.confidence_reason)}</p>`:''}
    ${nLinesHtml(e)}
    ${e.classification?suggestionPanel(e.classification):''}
    ${reviewChecksHtml(e)}
  </div>`;
  modal(`${modalHead('Revisar classificação','Lançamento preparado — confira e aprove. Após aprovar, o lançamento será efetivado automaticamente.')}<div class="modal-body"><div class="approval-split" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${leftDoc}${rightEntry}</div><h3 style="margin-top:14px">Histórico</h3>${timelineHtml(e.timeline,e.status)}</div>${modalFoot(`<button type="button" class="btn secondary" onclick="closeModal()">Fechar</button>${canAct?`<button type="button" class="btn secondary" id="revInfo">Solicitar informação</button><button type="button" class="btn danger" id="revReject">Rejeitar</button><button type="button" class="btn" id="revApprove">Aprovar</button>`:''}`)}`,'lg');
  bindEntryDoc(e);
  $('#revApprove')&&($('#revApprove').onclick=()=>approve(id));
  $('#revReject')&&($('#revReject').onclick=()=>reject(id));
  $('#revInfo')&&($('#revInfo').onclick=()=>{closeModal();state.page='solicitacoes';render();toast('Abra uma solicitação para pedir informação ao cliente.')});
}
async function approval(c){const page=state.listPage?.aprovacao||1;const f=state.approvalFilters||{};const qs=new URLSearchParams({page,page_size:'25'});if(f.from)qs.set('from',f.from);if(f.to)qs.set('to',f.to);if(f.q)qs.set('q',f.q);await withList(c,()=>api('/aprovacao/pendentes?'+qs.toString()),data=>{const list=listItems(data);const total=data.total||list.length;c.innerHTML=head('Aprovação','Classificações prontas para revisão e aprovação.','','aprovacao')+queueBanner(total,'Aguardando aprovação','② Aprovação · Após aprovar, o lançamento contábil será efetivado automaticamente.')+queueFiltersHtml('approvalFilters',f)+`<div class="panel table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Movimentação</th><th>Valor</th><th>Data</th><th>Classificação</th><th>Confiança</th><th>Ação</th></tr></thead><tbody>${list.map(x=>`<tr><td data-label="Empresa">${esc(x.company_name)}</td><td data-label="Movimentação">${esc(x.description)}</td><td data-label="Valor" class="money">${money(x.debit||0)}</td><td data-label="Data">${esc(x.occurred_on||'-')}</td><td data-label="Classificação">${esc((x.debit_accounts||'').split(' | ')[0]||'-')}</td><td data-label="Confiança">${confidencePct(x)}%</td><td data-label="Ação"><button class="btn" onclick="reviewApproval('${x.id}')">Revisar →</button></td></tr>`).join('')||`<tr><td colspan="7">${emptyState('Não há classificações aguardando aprovação.','A fila está em dia.')}</td></tr>`}</tbody></table></div>`+pagerHtml(data,'aprovacao');const ff=$('#approvalFilters');if(ff)ff.onsubmit=e=>{e.preventDefault();state.approvalFilters=Object.fromEntries(new FormData(e.target));state.listPage={...state.listPage,aprovacao:1};approval(c)};bindPager('aprovacao',dir=>{state.listPage={...state.listPage,aprovacao:Math.max(1,page+dir)};approval(c)});window.reviewApproval=reviewApproval;window.approve=async id=>{try{await api('/aprovacao/'+id+'/aprovar',{method:'POST',body:'{}'});closeModal();toast('Lançamento aprovado e efetivado.','success');approval(c)}catch(e){toast(e.message)}};window.reject=id=>{closeModal();modal(`<form id="rejForm">${modalHead('Rejeitar classificação','Informe o motivo da rejeição.')}<div class="modal-body"><div class="field"><label for="rejReason">Motivo</label><textarea id="rejReason" name="reason" rows="4" required placeholder="Classificação incorreta."></textarea></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn danger" type="submit">Rejeitar</button>')}</form>`,'md');$('#rejForm').onsubmit=async e=>{e.preventDefault();const reason=String(new FormData(e.target).get('reason')||'').trim();if(!reason){toast('Informe o motivo da rejeição.');return}try{await api('/aprovacao/'+id+'/rejeitar',{method:'POST',body:JSON.stringify({reason})});closeModal();toast('Classificação devolvida para revisão.','success');approval(c)}catch(err){toast(err.message)}}}})}
async function pendenciesPage(c){const page=state.listPage?.pendencias||1;await withList(c,()=>api('/pendencias?page='+page+'&page_size=25'),data=>{const list=listItems(data);const inCompany=!!state.selectedCompany;c.innerHTML=head('Pendências',inCompany?'Pendências da empresa ativa.':'Pendências abertas do escritório.','','pendencias')+`<div class="panel table-wrap"><table class="table"><thead><tr><th>O que aconteceu</th><th>Empresa</th><th>O que precisa ser feito</th><th>Quem deve agir</th><th>Data</th><th>Ação</th></tr></thead><tbody>${list.map(x=>{const r=String(x.reason||'').toLowerCase();const p=/urgente|bloque/.test(r)?'URGENTE':x.status==='OPEN'?'ATENÇÃO':'NORMAL';const copy=pendencyCopy(x);const act=pendencyAction(x,inCompany);const action=inCompany?(act.page?`<button class="btn" data-pendency-id="${esc(x.id)}">${esc(act.label)}</button>`:`<span class="muted">${esc(act.label)}</span>`):(x.company_id?`<button class="btn" data-pendency-id="${esc(x.id)}">${esc(act.label)}</button>`:'—');return `<tr><td data-label="O que aconteceu"><span class="badge pending">${p}</span> ${esc(copy.happened)}</td><td data-label="Empresa">${esc(x.company_name||'-')}</td><td data-label="O que precisa ser feito">${esc(copy.need)}</td><td data-label="Quem deve agir">${esc(x.assignee_name||'Escritório')}</td><td data-label="Data">${esc(x.created_at||'-')}</td><td data-label="Ação">${action}</td></tr>`}).join('')||`<tr><td colspan="6">${emptyState('Nenhuma pendência.','Está tudo em dia por aqui.')}</td></tr>`}</tbody></table></div>`+pagerHtml(data,'pendencias');document.querySelectorAll('[data-pendency-id]').forEach(b=>b.onclick=()=>{const x=list.find(i=>i.id===b.dataset.pendencyId);if(x)openPendency(x)});bindPager('pendencias',dir=>{state.listPage={...state.listPage,pendencias:Math.max(1,page+dir)};pendenciesPage(c)})})}
async function plan(c){const plans=state.plans;c.innerHTML=head('Plano de Contas','Plano próprio de cada escritório, com importação e validação.','<button class="btn" id="import">Importar PDF/CSV</button>','plano')+`<div class="panel">${plans.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)"><div><b>${esc(p.name)}</b><br><small class="muted">${p.account_count} contas · ${p.status}</small></div><button class="btn secondary" onclick="accounts('${p.id}')">Abrir contas</button></div>`).join('')||'<div class="empty">Nenhum plano importado.</div>'}</div>`;$('#import').onclick=()=>planImport()};window.accounts=async id=>{const a=await api('/plano-contas/'+id+'/accounts');modal(`${modalHead('Contas do plano','Contas importadas neste plano do escritório.','plano')}<input id="asearch" placeholder="Buscar código ou descrição" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;margin-bottom:10px"><div id="alist"></div>`);const draw=q=>$('#alist').innerHTML=`<div class="table-wrap"><table class="table"><tr><th>Código</th><th>Classificação</th><th>Tipo</th><th>Descrição</th></tr>${a.filter(x=>(x.description+' '+x.account_code+' '+x.classification_code).toLowerCase().includes(q.toLowerCase())).slice(0,500).map(x=>`<tr><td>${x.account_code}</td><td>${x.classification_code}</td><td>${x.account_type}</td><td>${esc(x.description)}</td></tr>`).join('')}</table></div>`;draw('');$('#asearch').oninput=e=>draw(e.target.value)};
function planImport(){
  let aiPreviewId=null,canImport=false,previewData=null;
  const planPreviewError=(status,body)=>{
    const code=String((body&&body.details&&body.details.code)||(body&&body.error)||'');
    const msg=String((body&&body.message)||'');
    if(/AI_|INTELIGENTE|intelligent/i.test(code+msg)&&!/PLAN_ACCOUNTS|PDF_|STRUCTURE|EXTRACTION|NO_ACCOUNTS|PREVIEW/i.test(code))return msg||'Sugestão inteligente indisponível.';
    if(status===422||status===400)return msg||'Não foi possível interpretar o plano de contas.';
    if(status>=500)return 'Não foi possível processar o arquivo.';
    return msg||'Não foi possível processar o arquivo.';
  };
  const drawChartPreviewTable=(r,q,sit)=>{
    const rows=(r.accounts||r.sample||[]).filter(x=>{
      const hay=`${x.code||x.account_code||''} ${x.classification_code||x.classificacao||''} ${x.description||''}`.toLowerCase();
      if(q&&!hay.includes(q.toLowerCase()))return false;
      const st=x.status||'OK';
      if(sit==='erro')return st==='ERRO';
      if(sit==='alerta')return st==='ALERTA';
      if(sit==='ok')return st==='OK';
      return true;
    });
    const shown=rows.slice(0,200);
    return `<div class="plan-preview-table table-wrap"><table class="table"><thead><tr><th>Código</th><th>Classificação</th><th>Descrição</th><th>Tipo</th><th>Situação</th></tr></thead><tbody>${shown.map(x=>`<tr><td>${esc(x.code||x.account_code||'')}</td><td>${esc(x.classification_code||x.classificacao||'')}</td><td>${esc(x.description||x.descricao||'')}</td><td>${esc(x.account_type==='S'?'Sintética':x.account_type==='A'?'Analítica':x.account_type||'')}</td><td>${esc(x.status||'OK')}</td></tr>`).join('')||`<tr><td colspan="5">Nenhuma conta neste filtro.</td></tr>`}</tbody></table></div>${rows.length>200?`<p class="muted">Mostrando 200 de ${rows.length}. Use a pesquisa para localizar.</p>`:''}`;
  };
  const renderPreview=(r)=>{
    previewData=r;
    const intelligent=r.source==='AI';
    aiPreviewId=intelligent?r.id:null;
    canImport=intelligent?r.status==='READY':Number(r.valid)>0;
    const alerts=r.repeated_classifications||0;
    const errs=r.rejected||(r.issues||[]).length||0;
    const title=errs&&canImport?'Plano reconhecido com alertas':canImport?'Plano de contas reconhecido':'Não foi possível interpretar o plano de contas.';
    $('#preview').innerHTML=`<div class="plan-preview">
      <p class="muted">✓ Arquivo carregado${r.file?`: ${esc(r.file)}`:''}</p>
      ${intelligent?'<p><span class="badge need">ESTRUTURA PROPOSTA PELA IA</span></p>':''}
      <h3>${esc(title)}</h3>
      ${r.company_name?`<p><b>Empresa:</b> ${esc(r.company_name)}</p>`:''}
      ${r.company_cnpj?`<p><b>CNPJ:</b> ${esc(r.company_cnpj)}</p>`:''}
      <p>${r.structure_recognized?'✓ Estrutura Código / Classificação / Descrição reconhecida':''}</p>
      <div class="plan-preview-stats"><div><small>CONTAS ENCONTRADAS</small><b>${r.valid||0}</b></div><div><small>ALERTAS</small><b>${alerts}</b></div><div><small>ERROS</small><b>${errs}</b></div></div>
      ${alerts?`<p class="muted">${alerts} classificações repetidas ·  ${r.exact_duplicates||0} duplicidades exatas. As classificações repetidas não impedem a importação quando pertencem a contas diferentes.</p>`:''}
      ${r.valid&&errs?`<p>${r.valid} linhas foram encontradas, mas ${errs} precisam de revisão.</p>`:''}
      ${canImport?`<p><b>${r.valid}</b> contas encontradas.</p>`:''}
      <div class="plan-preview-tools"><input id="planSearch" placeholder="Pesquisar código, classificação ou descrição"><select id="planSit"><option value="">Todas</option><option value="ok">OK</option><option value="alerta">Alertas</option><option value="erro">Erros</option></select></div>
      <div id="chartRows">${drawChartPreviewTable(r,'','')}</div>
      ${!canImport?'<p>O arquivo foi recebido, mas sua estrutura não pôde ser reconhecida.</p><button type="button" class="btn secondary" id="planRetry">Tentar novamente</button>':''}
    </div>`;
    const paint=()=>{$('#chartRows').innerHTML=drawChartPreviewTable(r,$('#planSearch')&&$('#planSearch').value||'',$('#planSit')&&$('#planSit').value||'')};
    $('#planSearch')&&($('#planSearch').oninput=paint);
    $('#planSit')&&($('#planSit').onchange=paint);
    $('#planRetry')&&($('#planRetry').onclick=()=>{$('#planfile').value='';$('#preview').innerHTML='';canImport=false;$('#importPlanSubmit').disabled=true});
    $('#importPlanSubmit').disabled=!canImport;
  };
  modal(`<form id="importForm">${modalHead('Importar plano de contas','PDF, CSV ou TXT. Confira a prévia antes de gravar.','plano')}<div class="modal-body"><div class="field"><label>Nome do plano</label><input name="name" placeholder="Plano de Contas 2026"></div><div class="drop"><input id="planfile" type="file" accept=".pdf,.csv,.txt" required><p>PDF, CSV ou TXT · até 25 MB</p></div><div id="preview"></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" id="importPlanSubmit" type="submit" disabled>Importar definitivamente</button>')}</form>`,'lg');
  $('#planfile').onchange=async e=>{
    aiPreviewId=null;canImport=false;previewData=null;$('#importPlanSubmit').disabled=true;
    const f=e.target.files[0];if(!f)return;
    $('#preview').innerHTML=`<div class="plan-steps" aria-busy="true"><p>Analisando arquivo...</p><p>✓ Arquivo recebido</p><p>• Extraindo texto...</p><p>• Identificando estrutura...</p><p>• Validando...</p></div>`;
    const fd=new FormData();fd.append('file',f);
    try{
      const response=await fetch('/api/plano-contas/preview',{method:'POST',headers:authHeaders('/plano-contas/preview'),body:fd});
      const r=await response.json();
      if(!response.ok){
        const msg=planPreviewError(response.status,r);
        $('#preview').innerHTML=`<div class="panel"><b>Não foi possível interpretar o plano de contas.</b><p>${esc(msg)}</p><button type="button" class="btn secondary" id="planRetry">Tentar novamente</button></div>`;
        $('#planRetry')&&($('#planRetry').onclick=()=>{$('#planfile').value='';$('#preview').innerHTML=''});
        if(!/inteligente/i.test(msg))toast(msg,'error');
        return;
      }
      if(r.source==='AI'&&r.status==='FAILED'){
        $('#preview').innerHTML=`<div class="panel"><b>Sugestão inteligente indisponível.</b><p class="muted">O parser determinístico não identificou contas neste arquivo.</p></div>`;
        toast(r.message||'Sugestão inteligente indisponível.','warning');
        return;
      }
      renderPreview(r);
    }catch(error){$('#preview').innerHTML=`<div class="panel"><b>Não foi possível processar o arquivo.</b><p>${esc(error.message)}</p><button type="button" class="btn secondary" id="planRetry">Tentar novamente</button></div>`;$('#planRetry')&&($('#planRetry').onclick=()=>{$('#planfile').value='';$('#preview').innerHTML=''});toast(error.message)}
  };
  $('#importForm').onsubmit=async e=>{
    e.preventDefault();if(!canImport)return toast('A importação exige uma prévia válida.');
    try{
      let r;
      if(aiPreviewId){
        const name=new FormData(e.target).get('name');
        r=await api('/plano-contas/preview-ia/'+aiPreviewId+'/importar',{method:'POST',body:JSON.stringify({name})});
      }else{
        const form=new FormData(e.target);form.append('file',$('#planfile').files[0]);
        r=await fetch('/api/plano-contas/import',{method:'POST',headers:authHeaders('/plano-contas/import'),body:form}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(planPreviewError(response.status,body));return body});
      }
      toast(`Importação concluída: ${r.imported} contas.`);closeModal();await render();
    }catch(error){toast(error.message)}
  }
}
async function simple(c,title,endpoint){const isCat=endpoint==='categorias';const list=isCat?state.categories:state.banks;const q=state.configSearch?.[endpoint]||'';const filtered=(list||[]).filter(x=>!q||`${x.name} ${x.account_code||''} ${x.account_description||''}`.toLowerCase().includes(q.toLowerCase()));c.innerHTML=head(title,isCat?'Categorias operacionais vinculadas a contas analíticas do plano.':'Bancos e caixas vinculados a contas analíticas do plano.',`<button class="btn" id="new">${isCat?'+ Nova categoria':'+ Novo banco'}</button>`,endpoint)+`<div class="panel" style="margin-bottom:14px"><input id="cfgSearch" placeholder="Buscar..." value="${esc(q)}" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px"></div><div class="panel table-wrap"><table class="table"><thead><tr><th>${isCat?'Categoria':'Banco'}</th><th>Conta contábil</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.account_code?`${x.account_code} — ${x.account_description}`:(isCat?'Não vinculada':'Não existe uma conta contábil analítica configurada para este banco.'))}</td><td>${x.active?'Ativa':'Inativa'}</td><td><div class="row-actions"><button type="button" class="btn secondary" data-edit="${x.id}">Editar</button><button type="button" class="btn secondary" data-toggle="${x.id}">${x.active?'Desativar':'Ativar'}</button></div></td></tr>`).join('')}</tbody></table>${!filtered.length?emptyState(isCat?'Nenhuma categoria':'Nenhum banco','Cadastre o vínculo com uma conta analítica do plano.'):''}</div>`;$('#new').onclick=()=>simpleModal(title,endpoint);c.querySelectorAll('[data-edit]').forEach(btn=>{btn.onclick=()=>simpleModal(title,endpoint,(list||[]).find(x=>x.id===btn.dataset.edit))});c.querySelectorAll('[data-toggle]').forEach(btn=>{btn.onclick=async()=>{const x=(list||[]).find(i=>i.id===btn.dataset.toggle);if(!x)return;try{await api('/'+endpoint+'/'+x.id,{method:'PATCH',body:JSON.stringify({active:!x.active})});toast(x.active?(isCat?'Categoria desativada.':'Banco desativado.'):(isCat?'Categoria atualizada com sucesso.':'Banco atualizado com sucesso.'),'success');await render()}catch(err){toast(err.message)}}});const search=$('#cfgSearch');if(search)search.oninput=debounce(()=>{state.configSearch={...state.configSearch,[endpoint]:search.value.trim()};simple(c,title,endpoint)},300)}
function bindAnalyticPicker(selected){const input=$('#analyticSearch'),hidden=$('#analyticAccountId'),box=$('#analyticResults'),hint=$('#analyticHint');if(!input||!hidden)return;if(selected&&selected.account_id){hidden.value=selected.account_id;input.value=selected.account_code?`${selected.account_code} — ${selected.account_description||''}`:''}const run=async()=>{const q=input.value.trim(),n=++pickerSeq;if(q.length<2){if(box)box.innerHTML='<div class="muted">Digite código ou descrição.</div>';return}if(box)box.innerHTML='<div class="muted">Buscando...</div>';try{const data=await api('/plano-contas/analiticas?page=1&page_size=25&q='+encodeURIComponent(q));if(n!==pickerSeq)return;const items=listItems(data);if(!items.length){if(box)box.innerHTML='<div class="muted">Não existe uma conta contábil analítica configurada para este banco.</div>';if(hint)hint.textContent='Não existe uma conta contábil analítica configurada para este banco.';return}if(hint)hint.textContent='Código | Descrição';if(box){box.innerHTML=items.map(x=>`<button type="button" class="picker-item" data-id="${esc(x.id)}"><span>${esc(x.account_code)} — ${esc(x.description)}</span></button>`).join('');box.querySelectorAll('.picker-item').forEach(btn=>{btn.onclick=()=>{const x=items.find(i=>i.id===btn.dataset.id);if(!x)return;hidden.value=x.id;input.value=`${x.account_code} — ${x.description}`;box.innerHTML=''}})}}catch(e){if(box)box.innerHTML=`<div class="muted">${esc(e.message)}</div>`}};input.oninput=debounce(run,300)}
function simpleModal(title,endpoint,row){const cat=endpoint==='categorias';const editing=!!(row&&row.id);modal(`<form id="simpleForm">${modalHead(editing?(cat?'Editar categoria':'Editar banco'):(cat?'Nova categoria':'Banco'),cat?'Vincule a categoria a uma conta analítica.':'Vincule o banco a uma conta analítica do plano.',endpoint)}<div class="modal-body"><div class="field"><label>${cat?'Nome da categoria':'Nome'}</label><input name="name" required value="${esc(row&&row.name||'')}"></div>${companyField(false)}<div class="field"><label>Conta contábil</label><input type="hidden" name="account_id" id="analyticAccountId" required value="${esc(row&&row.account_id||'')}"><input id="analyticSearch" placeholder="Pesquisar conta analítica..." autocomplete="off"><div id="analyticResults" class="picker-results"></div><small class="muted" id="analyticHint">Código | Descrição</small></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">'+(editing?(cat?'Salvar categoria':'Salvar banco'):(cat?'Salvar categoria':'Salvar'))+'</button>')}</form>`,'md');bindCompanyPicker();bindAnalyticPicker(row||null);$('#simpleForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.account_id){toast('Selecione uma conta contábil analítica.');return}try{if(editing){await api('/'+endpoint+'/'+row.id,{method:'PATCH',body:JSON.stringify({name:f.name,company_id:f.company_id||null,account_id:f.account_id,kind:cat?'EXPENSE':undefined})});toast(cat?'Categoria atualizada com sucesso.':'Banco atualizado com sucesso.','success')}else{await api('/'+endpoint,{method:'POST',body:JSON.stringify({name:f.name,company_id:f.company_id||null,account_id:f.account_id,kind:cat?'EXPENSE':undefined})});toast(cat?'Categoria criada com sucesso.':'Banco cadastrado com sucesso.','success')}closeModal();await render()}catch(err){toast(err.message)}}}
async function rules(c){const list=state.rules;c.innerHTML=head('Regras Contábeis','Regras configuráveis que determinam a partida automaticamente.','<button class="btn" id="new">+ Nova regra</button>','regras')+`<div class="panel table-wrap"><table class="table"><thead><tr><th>Prioridade</th><th>Regra</th><th>Condições</th><th>Débito</th><th>Crédito</th><th>Confiança</th></tr></thead><tbody>${list.map(x=>`<tr><td>${x.priority}</td><td><b>${esc(x.name)}</b></td><td><code>${esc(x.conditions_json)}</code></td><td>${esc(x.debit_code||'-')} — ${esc(x.debit_description||'')}</td><td>${esc(x.credit_code||'-')} — ${esc(x.credit_description||'')}</td><td>${Math.round(x.confidence*100)}%</td></tr>`).join('')}</tbody></table></div>`;$('#new').onclick=()=>ruleModal()}
function ruleModal(){modal(`<form id="ruleForm">${modalHead('Nova regra contábil','Condições e contas da partida automática.','regras')}<div class="modal-body"><div class="form-grid"><div class="field"><label>Nome</label><input name="name" required placeholder="Fretes pagos por PIX"></div><div class="field"><label>Prioridade</label><input name="priority" type="number" value="100"></div><div class="field"><label>Descrição contém</label><input name="description" placeholder="frete"></div><div class="field"><label>Forma de pagamento</label><select name="payment_method"><option value="">Qualquer</option><option value="PIX">PIX</option><option value="DINHEIRO">Dinheiro</option><option value="DEBITO">Cartão de débito</option><option value="CREDITO">Cartão de crédito</option></select></div><div class="field"><label>Débito</label><select name="debit_account_id" required>${accountOptions()}</select></div><div class="field"><label>Crédito</label><select name="credit_account_id" required>${accountOptions()}</select></div><div class="field"><label>Confiança (0 a 1)</label><input name="confidence" value="1"></div></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Criar regra</button>')}</form>`,'lg');$('#ruleForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.debit_account_id||!f.credit_account_id){toast('Informe as contas de débito e crédito.');return}if(f.debit_account_id===f.credit_account_id){toast('Débito e crédito não podem ser a mesma conta.');return}try{await api('/regras-contabeis',{method:'POST',body:JSON.stringify({name:f.name,priority:Number(f.priority),confidence:Number(f.confidence),debit_account_id:f.debit_account_id,credit_account_id:f.credit_account_id,conditions:{description:f.description,payment_method:f.payment_method}})});closeModal();await render()}catch(e){toast(e.message)}}}
function extractionFailureHelp(x){
  const code=String((x&&(x.error_code||x.extraction_error_code))||'').toUpperCase();
  const method=String((x&&x.extraction_method)||'').toUpperCase();
  const raw=String((x&&(x.error_message||x.extraction_error_message))||'').trim();
  if(code==='AI_DISABLED'){
    return{
      badge:'IA OFF',
      title:'Interpretação visual desligada',
      summary:raw||'A IA visual está desativada neste escritório.',
      detail:'PNG e JPG são lidos pela interpretação visual (OpenAI Vision). Sem a IA ligada, o preenchimento é manual.',
      next:'Ative a IA em Configurações → Inteligência Artificial, ou preencha data, valor e fornecedor em Ver análise.'
    };
  }
  if(code==='AI_LIMIT_REACHED'){
    return{
      badge:'LIMITE IA',
      title:'Limite mensal de IA atingido',
      summary:raw||'O limite mensal de consumo de IA foi atingido.',
      detail:'O arquivo foi recebido e permanece pendente de análise humana.',
      next:'Preencha data, valor e fornecedor manualmente em Ver análise, ou ajuste o limite no Centro de IA.'
    };
  }
  if(code==='AI_NOT_CONFIGURED'||code==='DOCUMENT_VISUAL_FORMAT_UNSUPPORTED'){
    return{
      badge:'SEM IA',
      title:'Interpretação visual indisponível',
      summary:raw||'A interpretação automática por IA não está disponível para este documento.',
      detail:'Imagens (PNG/JPG) usam a IA visual do produto — não há OCR local nesta instalação.',
      next:'Configure a credencial OpenAI (ambiente ou Cofre de IA), ative a IA do escritório, ou preencha os dados manualmente em Ver análise.'
    };
  }
  if(code==='EXTRACTION_UNAVAILABLE'||method==='OCR_UNAVAILABLE'||/OCR não está disponível/i.test(raw)){
    return{
      badge:'SEM IA',
      title:'Leitura automática indisponível',
      summary:'Não foi possível ler esta imagem automaticamente.',
      detail:'Imagens dependem da interpretação visual por IA. Sem credencial ou IA ativa, o preenchimento é manual.',
      next:'Abra Ver análise, visualize o original e preencha data, valor e fornecedor. Se possível, peça um PDF com texto selecionável.'
    };
  }
  if(code==='NO_TEXT_EXTRACTED'||/não possui texto|sem texto/i.test(raw)){
    return{
      badge:'SEM TEXTO',
      title:'Documento sem texto extraível',
      summary:'O arquivo não tem texto selecionável para leitura automática.',
      detail:raw||'PDFs só com imagem ou arquivos escaneados precisam de interpretação visual ou preenchimento manual.',
      next:'Visualize o original e preencha os campos manualmente, ou peça um PDF com texto.'
    };
  }
  return{
    badge:'FALHOU',
    title:'Análise automática falhou',
    summary:raw||'Não foi possível extrair o conteúdo automaticamente.',
    detail:'O arquivo foi recebido e permanece disponível para revisão.',
    next:'Abra Ver análise, visualize o original e complete os dados manualmente.'
  };
}
function extractionStatusBadge(status,meta){
  if(status==='FAILED'){
    const help=extractionFailureHelp(meta||{});
    return`<span class="badge rejected" title="${esc(help.summary)}">${esc(help.badge)}</span>`;
  }
  const map={PENDING:['pending','PENDENTE'],PROCESSING:['need','PROCESSANDO'],EXTRACTED:['approved','EXTRAÍDO'],REVIEWED:['approved','REVISADO']};
  const x=map[status];
  return x?`<span class="badge ${x[0]}">${x[1]}</span>`:'<span class="muted">Não analisado</span>';
}
const extractionFieldLabels={document_type:'Tipo',document_number:'Número',issue_date:'Data',supplier_name:'Fornecedor',supplier_document:'CPF/CNPJ',description:'Descrição',total_amount:'Valor total',payment_method:'Forma de pagamento'};
async function requestDocumentExtraction(id,reprocess=false){try{const r=await api('/documentos/'+id+'/extracao'+(reprocess?'/reprocessar':''),{method:'POST',body:'{}'});documentExtractionModal(id,r.extraction);toast(reprocess?'Reprocessamento solicitado.':'Análise solicitada.','success')}catch(e){toast(e.message)}}
async function documentExtractionModal(id,initial){let x=initial;try{x=x||await api('/documentos/'+id+'/extracao')}catch(e){if(e.status===404)return requestDocumentExtraction(id);return toast(e.message)}
  const fields=x.fields||{};const ready=['EXTRACTED','REVIEWED'].includes(x.status);const reviewed=x.status==='REVIEWED';const failed=x.status==='FAILED';const fieldHtml=Object.entries(extractionFieldLabels).map(([name,label])=>{const f=fields[name]||{};return `<div class="field"><label>${label}${f.confidence?` <small class="muted">Confiança ${Math.round(f.confidence*100)}%</small>`:''}</label><input name="${name}" value="${esc(f.value||'')}" ${ready?'':'disabled'}></div>`}).join('');
  const failHelp=failed?extractionFailureHelp(x):null;
  const failPanel=failHelp?`<div class="panel" style="border-color:rgba(200,16,46,.35);background:rgba(200,16,46,.04)"><b>${esc(failHelp.title)}</b><p>${esc(failHelp.summary)}</p><p class="muted">${esc(failHelp.detail)}</p><p><b>O que fazer:</b> ${esc(failHelp.next)}</p></div>`:'';
  const footActions=[
    '<button type="button" class="btn secondary" onclick="closeModal()">Fechar</button>',
    (failed||ready)?'<button type="button" class="btn secondary" id="reprocessExtraction">Tentar novamente</button>':'',
    ready?'<button type="button" class="btn secondary" id="saveExtraction">Salvar correções</button>':'',
    failed?'':(reviewed?'<button type="button" class="btn" id="requestAccountingAI">Classificação inteligente</button>':'<button class="btn" id="confirmExtraction">Confirmar dados</button>')
  ].join('');
  modal(`<form id="extractionForm">${modalHead('Inteligência Documental',esc(x.document_name||'Documento'))}<div class="modal-body"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px"><div>${extractionStatusBadge(x.status,x)} <span class="muted">${esc(failHelp?failHelp.title:(x.extraction_method||''))}</span></div><button type="button" class="btn secondary" id="viewExtractionDoc">Visualizar original</button></div>${failed?failPanel:`<div class="form-grid">${fieldHtml}</div>`}${x.extracted_text?`<details style="margin-top:14px"><summary>Texto original extraído</summary><pre style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(x.extracted_text)}</pre></details>`:''}<p class="muted">${failed?'O documento permanece na fila para análise humana. A confirmação automática fica indisponível até haver dados extraídos.':'A confirmação não cria lançamento contábil. Os dados ficam prontos para a próxima etapa de classificação.'}</p></div>${modalFoot(footActions)}</form>`,'lg');
  $('#viewExtractionDoc').onclick=()=>viewOfficeDocument(id,x.document_name||'documento','',0);
  $('#reprocessExtraction')&&($('#reprocessExtraction').onclick=()=>requestDocumentExtraction(id,true));
  $('#requestAccountingAI')&&($('#requestAccountingAI').onclick=()=>requestAccountingSuggestion(id));
  const submit=async confirm=>{const form=$('#extractionForm');const body={fields:Object.fromEntries(new FormData(form)),confirm};try{const updated=await api('/documentos/'+id+'/extracao',{method:'PATCH',body:JSON.stringify(body)});toast(confirm?'Dados confirmados. Prontos para classificação.':'Correções salvas.','success');documentExtractionModal(id,updated)}catch(e){toast(e.message)}};
  $('#saveExtraction')&&($('#saveExtraction').onclick=()=>submit(false));
  $('#extractionForm').onsubmit=e=>{e.preventDefault();submit(true)};
  if(['PENDING','PROCESSING'].includes(x.status))setTimeout(async()=>{if(!$('#extractionForm'))return;try{const next=await api('/documentos/'+id+'/extracao');documentExtractionModal(id,next)}catch{}},350)
}
window.documentExtractionModal=documentExtractionModal;
async function requestAccountingSuggestion(id,force=false){
  try{
    const result=await api('/documentos/'+id+'/sugestao-contabil'+(force?'/reprocessar':''),{method:'POST',body:'{}'});
    accountingSuggestionModal(id,result.suggestion);
  }catch(error){toast(error.message)}
}
function aiManualPrefill(suggestion){
  const document=suggestion.document||{};
  return {
    company_id:suggestion.company_id,
    occurred_on:document.issue_date||new Date().toISOString().slice(0,10),
    description:suggestion.history||document.description||document.supplier_name||'Documento analisado',
    amount_cents:Math.round(Number(document.total_amount||0)*100),
    lines:[]
  }
}
async function accountingDecision(id,body){
  try{
    const result=await api('/documentos/'+id+'/sugestao-contabil/decisao',{method:'POST',body:JSON.stringify(body)});
    toast(body.decision==='ACCEPTED'?'Sugestão aceita. Confira o lançamento antes de salvar.':body.decision==='OVERRIDDEN'?'Alteração registrada. Confira o lançamento.':'Sugestão rejeitada. A classificação manual continua disponível.','success');
    if(result.preparation)return manualEntry(result.preparation);
    accountingSuggestionModal(id,result.suggestion);
  }catch(error){toast(error.message)}
}
function accountingOverrideModal(id,suggestion){
  const categoryOptions=(state.categories||[]).map(x=>`<option value="${esc(x.id)}" ${suggestion.category?.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('');
  const bankOptions=(state.banks||[]).map(x=>`<option value="${esc(x.id)}" ${suggestion.bank?.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('');
  modal(`<form id="aiOverrideForm">${modalHead('Alterar classificação','A decisão será registrada para evolução futura.')}<div class="modal-body"><div class="field"><label>Conta contábil</label><select name="account_id" required>${accountOptions()}</select></div><div class="field"><label>Histórico</label><input name="history" value="${esc(suggestion.history||'')}"></div><div class="form-grid"><div class="field"><label>Categoria</label><select name="category_id"><option value="">Nenhuma</option>${categoryOptions}</select></div><div class="field"><label>Banco/caixa</label><select name="bank_id"><option value="">Nenhum</option>${bankOptions}</select></div></div><div class="field"><label>Motivo da alteração</label><input name="reason" placeholder="Opcional"></div></div>${modalFoot('<button type="button" class="btn secondary" id="backAISuggestion">Voltar</button><button class="btn">Usar classificação escolhida</button>')}</form>`,'md');
  const account=$('#aiOverrideForm [name="account_id"]');if(account)account.value=suggestion.primary_account?.id||'';
  $('#backAISuggestion').onclick=()=>accountingSuggestionModal(id,suggestion);
  $('#aiOverrideForm').onsubmit=e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));body.decision='OVERRIDDEN';accountingDecision(id,body)}
}
function accountingSuggestionModal(id,suggestion){
  if(!suggestion)return requestAccountingSuggestion(id);
  if(suggestion.status==='FAILED'){
    modal(`${modalHead('Classificação Inteligente','A IA é assistente; a classificação manual permanece disponível.')}<div class="modal-body"><div class="panel"><b>Sugestão inteligente indisponível.</b><p class="muted">O documento e o Motor Contábil continuam funcionando normalmente.</p></div></div>${modalFoot('<button type="button" class="btn secondary" id="aiManual">Classificar manualmente</button><button type="button" class="btn" id="retryAI">Tentar novamente</button>')}`,'md');
    $('#retryAI').onclick=()=>requestAccountingSuggestion(id,true);
    $('#aiManual').onclick=()=>manualEntry(aiManualPrefill(suggestion));
    return;
  }
  if(suggestion.status!=='COMPLETED'){
    const decision=suggestion.decision;
    modal(`${modalHead('Classificação Inteligente','Decisão humana registrada.')}<div class="modal-body"><p>${decision?`Decisão: <b>${esc(decision.decision)}</b>`:'Esta sugestão já foi revisada.'}</p><p class="muted">Nenhum lançamento foi postado automaticamente.</p></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Fechar</button><button type="button" class="btn" id="retryAI">Gerar nova sugestão</button>')}`,'md');
    $('#retryAI').onclick=()=>requestAccountingSuggestion(id,true);
    return;
  }
  const document=suggestion.document||{};
  const candidates=(suggestion.candidates||[]).map((candidate,index)=>`<tr><td>${index===0?'<span class="badge approved">PRINCIPAL</span>':index+1+'º'}</td><td><b>${esc(candidate.account_code)}</b><br>${esc(candidate.account_name)}</td><td>${Math.round(Number(candidate.confidence||0)*100)}%</td></tr>`).join('');
  modal(`${modalHead('Classificação Inteligente','A IA sugere, o CDS valida e o contador decide.')}<div class="modal-body"><div class="form-grid"><div><small class="muted">Fornecedor</small><p><b>${esc(document.supplier_name||'Não identificado')}</b></p></div><div><small class="muted">Valor</small><p><b>${document.total_amount?money(Math.round(Number(document.total_amount)*100)):'Não identificado'}</b></p></div></div><div class="panel"><small class="muted">SUGESTÃO PRINCIPAL</small><h3>${esc(suggestion.primary_account?.name||'')}</h3><p><code>${esc(suggestion.primary_account?.code||'')}</code> · Confiança ${Math.round(Number(suggestion.confidence||0)*100)}%</p><p><b>Motivo:</b> ${esc(suggestion.reason||'Não informado')}</p><p><b>Histórico:</b> ${esc(suggestion.history||'—')}</p></div><div class="table-wrap"><table class="table"><tr><th></th><th>Conta candidata</th><th>Confiança</th></tr>${candidates}</table></div><p class="muted">Aceitar prepara um lançamento para conferência; não cria lançamento POSTED.</p></div>${modalFoot('<button type="button" class="btn secondary" id="reviewAILater">Revisar depois</button><button type="button" class="btn secondary" id="rejectAI">Rejeitar</button><button type="button" class="btn secondary" id="overrideAI">Alterar</button><button type="button" class="btn" id="acceptAI">Aceitar</button>')}`,'lg');
  $('#reviewAILater').onclick=()=>closeModal();
  $('#rejectAI').onclick=()=>accountingDecision(id,{decision:'REJECTED',reason:'Rejeitada pelo contador'});
  $('#overrideAI').onclick=()=>accountingOverrideModal(id,suggestion);
  $('#acceptAI').onclick=()=>accountingDecision(id,{decision:'ACCEPTED'});
}
window.accountingSuggestionModal=accountingSuggestionModal;
async function documents(c){
  const page=state.listPage?.documentos||1;
  const f=state.docFilters||(state.docFilters={q:'',company_id:'',source:'',status:'',extraction:'',period:'',from:'',to:''});
  const localIso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const periodBounds=()=>{
    const now=new Date();const today=localIso(now);
    if(f.period==='today')return{from:today,to:today};
    if(f.period==='7d'){const x=new Date(now);x.setDate(x.getDate()-6);return{from:localIso(x),to:today}}
    if(f.period==='30d'){const x=new Date(now);x.setDate(x.getDate()-29);return{from:localIso(x),to:today}}
    if(f.period==='month')return{from:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`,to:today};
    return{from:f.from||'',to:f.to||''};
  };
  const listQuery=()=>{
    let q=`/documentos?page=${page}&page_size=25`;
    if(f.q)q+='&q='+encodeURIComponent(f.q);
    if(f.company_id&&!state.selectedCompany)q+='&company_id='+encodeURIComponent(f.company_id);
    if(f.source)q+='&source='+encodeURIComponent(f.source);
    if(f.status)q+='&status='+encodeURIComponent(f.status);
    if(f.extraction)q+='&extraction_status='+encodeURIComponent(f.extraction);
    const b=periodBounds();
    if(b.from)q+='&from='+encodeURIComponent(b.from);
    if(b.to)q+='&to='+encodeURIComponent(b.to);
    return q;
  };
  const fileKind=x=>{
    const m=String(x.mime_type||x.original_name||'').toLowerCase();
    return m.includes('pdf')||String(x.original_name||'').toLowerCase().endsWith('.pdf')?'pdf':'img';
  };
  const sizeLabel=n=>{const kb=Math.max(1,Math.round(Number(n||0)/1024));return kb>=1024?(Math.round(kb/102.4)/10)+' MB':kb+' KB'};
  const dateHtml=iso=>{
    const d=new Date(iso);if(Number.isNaN(d.getTime()))return `<span>${esc(iso||'-')}</span>`;
    const full=d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const day=d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
    const short=d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const tm=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return `<time datetime="${esc(iso)}" title="${esc(full)}"><span class="docs-date-full">${esc(day)}<br>${esc(tm)}</span><span class="docs-date-short">${esc(short)}<br>${esc(tm)}</span></time>`;
  };
  const situationHtml=x=>{
    const st=String(x.status||'ACTIVE');
    const pending=st==='PENDING_REVIEW'||st==='PENDING';
    const label=pending?'PENDENTE':(st==='ACTIVE'?'ATIVO':(originLabel(st)||st));
    const cls=pending?'pending':(st==='ACTIVE'?'approved':'need');
    return `<div class="docs-status"><span class="badge ${cls}">${esc(label)}</span><small>${extractionStatusBadge(x.extraction_status,x)}</small></div>`;
  };
  const originHtml=x=>{
    const src=String(x.source||'');
    const ico=src==='CLIENT'?'users':'building';
    return `<span class="docs-origin">${icon(ico)}<span>${esc(x.source_label||originLabel(x.origin)||'-')}</span></span>`;
  };
  const fileHtml=x=>`<div class="docs-file" title="${esc(x.original_name)}"><span class="docs-file-ico docs-file-${fileKind(x)}" aria-hidden="true">${icon('file')}</span><div><b>${esc(x.original_name)}</b><small class="muted">${esc(x.source_label||originLabel(x.origin)||'-')}</small></div></div>`;
  const companyHtml=x=>{
    const name=x.company_trade_name||x.company_name||'-';
    const sub=x.company_cnpj?formatCnpj(x.company_cnpj):'';
    return `<div class="docs-company"><b>${esc(name)}</b>${sub?`<small class="muted">${esc(sub)}</small>`:''}</div>`;
  };
  const actionsHtml=x=>{
    const primary=x.extraction_status?'Ver análise':'Analisar';
    return `<div class="docs-actions"><button type="button" class="btn docs-primary-action" data-doc-extract="${x.id}">${primary}</button><div class="more-wrap"><button type="button" class="icon-button more-btn" aria-label="Mais ações">⋮</button><div class="more-menu" hidden><button type="button" data-doc-view="${x.id}" data-doc-name="${esc(x.original_name)}" data-doc-mime="${esc(x.mime_type||'')}" data-doc-size="${x.size_bytes||0}">Visualizar</button><button type="button" data-doc-dl="${x.id}" data-doc-name="${esc(x.original_name)}">Baixar</button><button type="button" data-doc-extract="${x.id}">${x.extraction_status?'Ver análise':'Analisar'}</button>${x.can_delete?`<button type="button" data-doc-del="${x.id}" data-doc-name="${esc(x.original_name)}">Excluir</button>`:''}</div></div></div>`;
  };
  const bindDocActions=()=>{
    $('#new')&&($('#new').onclick=()=>docModal());
    c.querySelectorAll('[data-doc-extract]').forEach(btn=>{btn.onclick=()=>documentExtractionModal(btn.dataset.docExtract)});
    c.querySelectorAll('[data-doc-view]').forEach(btn=>{btn.onclick=()=>viewOfficeDocument(btn.dataset.docView,btn.dataset.docName,btn.dataset.docMime,btn.dataset.docSize)});
    c.querySelectorAll('[data-doc-dl]').forEach(btn=>{btn.onclick=()=>downloadOfficeDocument(btn.dataset.docDl,btn.dataset.docName)});
    c.querySelectorAll('[data-doc-del]').forEach(btn=>{btn.onclick=()=>confirmOfficeDocumentDelete(btn.dataset.docDel)});
    bindMoreMenus(c);
    bindPager('documentos',dir=>{state.listPage={...state.listPage,documentos:Math.max(1,page+dir)};documents(c)});
    const form=$('#docFilters');
    if(form)form.onsubmit=e=>{
      e.preventDefault();
      const fd=new FormData(form);
      state.docFilters={...f,q:String(fd.get('q')||'').trim(),company_id:String(fd.get('company_id')||''),source:String(fd.get('source')||''),status:String(fd.get('status')||''),extraction:String(fd.get('extraction')||''),period:String(fd.get('period')||'')};
      state.listPage={...state.listPage,documentos:1};
      documents(c);
    };
    $('#docClearFilters')&&($('#docClearFilters').onclick=()=>{state.docFilters={q:'',company_id:'',source:'',status:'',extraction:'',period:'',from:'',to:''};state.listPage={...state.listPage,documentos:1};documents(c)});
  };
  const filtered=!!(f.q||f.company_id||f.source||f.status||f.extraction||f.period||f.from||f.to);
  c.innerHTML=`<div class="docs-page" aria-busy="true">${head('Documentos','Comprovantes e anexos vinculados às empresas.','<button class="btn" id="new">+ Enviar documento</button>','documentos')}<div class="sk-card" style="height:64px"></div><div class="sk-table"></div></div>`;
  try{
    const firms=state.selectedCompany?{items:[]}:await api('/empresas?page=1&page_size=100&status=ACTIVE').catch(e=>{if(e&&e.status===401)throw e;return{items:[]}});
    const data=await api(listQuery());
    const list=listItems(data);
    const companyOpts=(firms.items||[]).map(co=>`<option value="${esc(co.id)}" ${f.company_id===co.id?'selected':''}>${esc(co.trade_name||co.name)}</option>`).join('');
    const empty=list.length?'':(filtered
      ?emptyState('Nenhum documento corresponde aos filtros.','Ajuste a pesquisa ou limpe os filtros.','<button type="button" class="btn secondary" id="docClearFilters">Limpar filtros</button>')
      :emptyState('Nenhum documento encontrado','Os documentos enviados pelo cliente ou pelo escritório aparecerão aqui.','<button type="button" class="btn" id="newEmpty">+ Enviar documento</button>'));
    const rows=list.map(x=>`<tr><td class="docs-col-file">${fileHtml(x)}</td><td class="docs-col-company">${companyHtml(x)}</td><td class="docs-col-origin">${originHtml(x)}</td><td class="docs-col-size">${sizeLabel(x.size_bytes)}</td><td class="docs-col-status">${situationHtml(x)}</td><td class="docs-col-date">${dateHtml(x.created_at)}</td><td class="docs-col-actions">${actionsHtml(x)}</td></tr>`).join('');
    const cards=list.map(x=>`<article class="docs-card"><div class="docs-card-head">${fileHtml(x)}${actionsHtml(x)}</div>${companyHtml(x)}${originHtml(x)}${situationHtml(x)}<div class="docs-card-meta">${dateHtml(x.created_at)} · ${sizeLabel(x.size_bytes)}</div><button type="button" class="btn docs-card-primary" data-doc-extract="${x.id}">${x.extraction_status?'Ver análise':'Analisar'}</button></article>`).join('');
    c.innerHTML=`<div class="docs-page">${head('Documentos','Comprovantes e anexos vinculados às empresas.','<button class="btn" id="new">+ Enviar documento</button>','documentos')}
      <form class="panel docs-filters" id="docFilters"><input name="q" value="${esc(f.q||'')}" placeholder="Pesquisar documento ou arquivo" aria-label="Pesquisar documento ou arquivo">${state.selectedCompany?'':`<select name="company_id" aria-label="Empresa"><option value="">Todas as empresas</option>${companyOpts}</select>`}<select name="source" aria-label="Origem"><option value="">Todas as origens</option><option value="CLIENT" ${f.source==='CLIENT'?'selected':''}>Cliente</option><option value="OFFICE" ${f.source==='OFFICE'?'selected':''}>Escritório</option><option value="IMPORT" ${f.source==='IMPORT'?'selected':''}>Importação</option></select><select name="status" aria-label="Situação"><option value="">Todas as situações</option><option value="ACTIVE" ${f.status==='ACTIVE'?'selected':''}>Ativo</option><option value="PENDING_REVIEW" ${f.status==='PENDING_REVIEW'?'selected':''}>Pendente</option></select><select name="extraction" aria-label="Análise"><option value="">Todas as análises</option><option value="NONE" ${f.extraction==='NONE'?'selected':''}>Não analisado</option><option value="EXTRACTED" ${f.extraction==='EXTRACTED'?'selected':''}>Extraído</option><option value="FAILED" ${f.extraction==='FAILED'?'selected':''}>Falhou</option></select><select name="period" aria-label="Período"><option value="">Todo o período</option><option value="today" ${f.period==='today'?'selected':''}>Hoje</option><option value="7d" ${f.period==='7d'?'selected':''}>Últimos 7 dias</option><option value="30d" ${f.period==='30d'?'selected':''}>Últimos 30 dias</option><option value="month" ${f.period==='month'?'selected':''}>Mês atual</option></select><button class="btn secondary" type="submit">Filtrar</button><button type="button" class="btn secondary" id="docClearFilters">Limpar filtros</button></form>
      <div class="panel docs-table-wrap table-wrap"><table class="table docs-table"><thead><tr><th>Arquivo</th><th>Empresa</th><th class="docs-col-origin">Origem</th><th class="docs-col-size">Tamanho</th><th>Situação</th><th>Data</th><th>Ações</th></tr></thead><tbody>${rows||''}</tbody></table></div>
      <div class="docs-cards">${cards}</div>
      ${empty}${pagerHtml(data,'documentos')}</div>`;
    bindDocActions();
    $('#newEmpty')&&($('#newEmpty').onclick=()=>docModal());
  }catch(err){
    if(err&&err.status===401)throw err;
    c.innerHTML=emptyState('Não foi possível carregar os documentos.',esc(err.message||'Tente novamente.'),'<button type="button" class="btn" id="retryDocs">Tentar novamente</button>');
    $('#retryDocs')&&($('#retryDocs').onclick=()=>documents(c));
  }
}
function viewOfficeDocument(id,name,mime,size){CdsDocumentViewer.open({fileName:name,mimeType:mime,sizeBytes:size,viewUrl:'/api/documentos/'+id+'/view',downloadUrl:'/api/documentos/'+id+'/download',headers:()=>authHeaders('/documentos/'+id+'/view')})}window.viewOfficeDocument=viewOfficeDocument;async function downloadOfficeDocument(id,name){try{const r=await fetch('/api/documentos/'+id+'/download',{headers:authHeaders()});if(!r.ok){let j={};try{j=await r.json()}catch{}throw Error(j.message||j.error||'Não foi possível baixar o documento.')}const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name||'documento';a.click();URL.revokeObjectURL(u)}catch(e){toast(e.message)}}function confirmOfficeDocumentDelete(id){modal(`${modalHead('Excluir documento?','Você está prestes a excluir este documento. Essa ação será registrada no histórico de auditoria.')}<div class="modal-body"><p>O documento sai da listagem operacional, mas o registro permanece auditado.</p></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button type="button" class="btn" id="confirmDocDelete">Excluir documento</button>')}`,'md');$('#confirmDocDelete').onclick=async()=>{try{await api('/documentos/'+id,{method:'DELETE'});closeModal();toast('Documento excluído.','success');await render()}catch(e){toast(e.message)}}}async function authDownload(e,id){e.preventDefault();await CdsDocumentViewer.open({fileName:'documento',viewUrl:'/api/documentos/'+id+'/view',downloadUrl:'/api/documentos/'+id+'/download',headers:()=>authHeaders('/documentos/'+id+'/view')});return false}function docModal(){modal(`<form id="docForm">${modalHead('Enviar documento','Arraste o arquivo ou clique na área de envio. PDF, JPG ou PNG.')}<div class="modal-body">${companyField()}<div class="dropzone" id="docDrop"><strong>Arraste o arquivo aqui</strong><span>ou clique para selecionar</span><small>PDF, JPG ou PNG</small><input name="file" type="file" required></div><div id="docUploadMsg" class="muted"></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" id="docSubmit">Enviar</button>')}</form>`,'md');bindCompanyPicker();const drop=$('#docDrop');if(drop){drop.onclick=e=>{if(e.target.name!=='file')drop.querySelector('input')?.click()};drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');const input=drop.querySelector('input');if(e.dataTransfer.files[0]){const dt=new DataTransfer();dt.items.add(e.dataTransfer.files[0]);input.files=dt.files;toast('Documento anexado com sucesso.','success')}};const fileInp=drop.querySelector('input');if(fileInp)fileInp.onchange=e=>{if(e.target.files&&e.target.files[0])toast('Documento anexado com sucesso.','success')}}
$('#docForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const btn=$('#docSubmit');if(btn){btn.disabled=true;btn.classList.add('busy');btn.textContent='Enviando...'}try{const r=await fetch('/api/documentos/upload',{method:'POST',headers:authHeaders(),body:fd});const j=await r.json();if(!r.ok)throw Error(j.message||j.error);closeModal();toast('Documento enviado com sucesso.','success');await render()}catch(e){toast(e.message);if(btn){btn.disabled=false;btn.classList.remove('busy');btn.textContent='Enviar'}}}}
async function processesPage(c){if(state.processView)return processDetailPage(c,state.processView);const q=state.processSearch||'';const page=state.listPage?.processos||1;const companyQ=state.selectedCompany?('&company_id='+encodeURIComponent(state.selectedCompany.id)):'';const data=await api('/processos?page='+page+'&page_size=25'+(q?'&q='+encodeURIComponent(q):'')+companyQ);const list=listItems(data);const occPage=state.listPage?.ocorrencias||1;const occ=await api('/processo-ocorrencias?page='+occPage+'&page_size=10'+companyQ).catch(()=>({items:[]}));const occList=listItems(occ);c.innerHTML=head('Processos','Modelos de processos do escritório e ocorrências por competência.','<button class="btn secondary" id="newOcc">+ Nova ocorrência</button><button class="btn" id="new">+ Novo processo</button>','processos')+`<div class="panel" style="margin-bottom:14px"><input id="processSearch" placeholder="Buscar processo, setor ou empresa..." value="${esc(q)}" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px"></div><div class="panel table-wrap"><table class="table"><thead><tr><th>Processo</th><th>Situação</th><th>Setor</th><th>Empresa</th><th>Etapas</th><th></th></tr></thead><tbody>${list.map(x=>`<tr><td data-label="Processo"><b>${esc(x.name)}</b><div class="muted">${esc(x.responsible_name||'-')}</div></td><td data-label="Situação">${processStatusBadge(x.status)}</td><td data-label="Setor">${esc(x.sector||'-')}</td><td data-label="Empresa">${esc(x.company_trade_name||x.company_name||'-')}</td><td data-label="Etapas">${x.step_count||0} etapas</td><td><button class="btn secondary" data-open="${esc(x.id)}">Abrir</button></td></tr>`).join('')||`<tr><td colspan="6">${emptyState('Nenhum processo','Cadastre o primeiro processo do escritório.')}</td></tr>`}</tbody></table></div>${pagerHtml(data,'processos')}<div class="panel table-wrap" style="margin-top:16px"><h3 style="padding:16px 16px 0">Ocorrências recentes</h3><table class="table"><thead><tr><th>Ocorrência</th><th>Competência</th><th>Situação</th><th>Etapas</th><th></th></tr></thead><tbody>${occList.map(x=>`<tr><td data-label="Ocorrência"><b>${esc(x.title)}</b><div class="muted">${esc(x.process_name||'')}</div></td><td data-label="Competência">${esc(x.competence)}</td><td data-label="Situação">${occurrenceStatusBadge(x.status)}</td><td data-label="Etapas">${x.step_count||0}</td><td><button class="btn secondary" data-occ="${esc(x.id)}">Ver</button></td></tr>`).join('')||`<tr><td colspan="5">${emptyState('Nenhuma ocorrência','Crie uma ocorrência manual a partir de um processo ativo.')}</td></tr>`}</tbody></table></div>`;
bindPager('processos',dir=>{state.listPage={...(state.listPage||{}),processos:Math.max(1,(state.listPage?.processos||1)+dir)};processesPage(c)});
$('#processSearch').onkeydown=e=>{if(e.key==='Enter'){state.processSearch=$('#processSearch').value.trim();state.listPage={...(state.listPage||{}),processos:1};processesPage(c)}};
$('#new').onclick=()=>processFormModal();
$('#newOcc').onclick=()=>occurrenceFormModal(list);
c.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{state.processView=b.dataset.open;processesPage(c)});
c.querySelectorAll('[data-occ]').forEach(b=>b.onclick=()=>occurrenceViewModal(b.dataset.occ))}
function processStatusBadge(s){return s==='ATIVO'?'<span class="badge approved">ATIVO</span>':'<span class="badge pending">INATIVO</span>'}
function occurrenceStatusBadge(s){const m={PENDENTE:['pending','PENDENTE'],EM_ANDAMENTO:['need','EM ANDAMENTO'],CONCLUIDA:['approved','CONCLUÍDA'],CANCELADA:['rejected','CANCELADA']};const x=m[s]||['pending',s||'-'];return `<span class="badge ${x[0]}">${x[1]}</span>`}
function dueLabel(n){return 'D+'+Number(n||0)}
async function processDetailPage(c,processId){const p=await api('/processos/'+processId);const team=await api('/usuarios?page=1&page_size=100').catch(()=>({items:[]}));const users=(team.items||[]).filter(u=>['OWNER','ACCOUNTANT','STAFF'].includes(u.role)&&u.active!==0);const steps=p.steps||[];c.innerHTML=head(esc(p.name),'Empresa: '+esc(p.company_trade_name||p.company_name||'-')+' · Responsável: '+esc(p.responsible_name||'-'),cdsBackBtn('cdsBack')+'<button class="btn secondary" id="toggleStatus">'+(p.status==='ATIVO'?'Desativar':'Ativar')+'</button><button class="btn" id="saveMeta">Salvar processo</button>')+`<div class="panel" style="margin-bottom:14px"><div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:12px"><div class="field"><label>Nome</label><input id="procName" value="${esc(p.name)}"></div><div class="field"><label>Setor</label><input id="procSector" value="${esc(p.sector||'')}" placeholder="Fiscal, Contábil..."></div><div class="field"><label>Situação</label><div>${processStatusBadge(p.status)}</div></div></div><div class="field"><label>Descrição</label><textarea id="procDesc" rows="2">${esc(p.description||'')}</textarea></div><div class="field"><label>Responsável principal</label><select id="procResp"><option value="">—</option>${users.map(u=>`<option value="${esc(u.id)}" ${u.id===p.responsible_user_id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></div></div><div class="panel table-wrap"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 0"><h3 style="margin:0">Etapas</h3><button class="btn" id="addStep">+ Adicionar etapa</button></div><table class="table"><thead><tr><th>#</th><th>Etapa</th><th>Responsável</th><th>Prazo</th><th></th></tr></thead><tbody>${steps.map(s=>`<tr><td>${s.step_order}</td><td><b>${esc(s.name)}</b>${Number(s.required)?'':' <span class="muted">(opcional)</span>'}</td><td>${esc(s.responsible_name||'-')}</td><td>${dueLabel(s.due_offset_days)}</td><td><div class="row-actions"><button class="btn secondary" data-edit-step="${esc(s.id)}">Editar</button><button class="btn secondary" data-del-step="${esc(s.id)}">Remover</button></div></td></tr>`).join('')||`<tr><td colspan="5">${emptyState('Sem etapas','Adicione a primeira etapa deste processo.')}</td></tr>`}</tbody></table></div>`;
$('#cdsBack').onclick=()=>cdsGoBack({fallbackPage:'processos',clear(){state.processView=null},after(){processesPage(c)}});
$('#saveMeta').onclick=async()=>{try{await api('/processos/'+processId,{method:'PATCH',body:JSON.stringify({name:$('#procName').value,sector:$('#procSector').value,description:$('#procDesc').value,responsible_user_id:$('#procResp').value||null})});toast('Processo salvo.','success');processDetailPage(c,processId)}catch(err){toast(err.message)}};
$('#toggleStatus').onclick=async()=>{try{await api('/processos/'+processId+(p.status==='ATIVO'?'/desativar':'/ativar'),{method:'POST',body:'{}'});toast(p.status==='ATIVO'?'Processo desativado.':'Processo ativado.','success');processDetailPage(c,processId)}catch(err){toast(err.message)}};
$('#addStep').onclick=()=>stepFormModal(processId,null,users,()=>processDetailPage(c,processId));
c.querySelectorAll('[data-edit-step]').forEach(b=>b.onclick=()=>{const s=steps.find(x=>x.id===b.dataset.editStep);stepFormModal(processId,s,users,()=>processDetailPage(c,processId))});
c.querySelectorAll('[data-del-step]').forEach(b=>b.onclick=async()=>{if(!confirm('Remover esta etapa do modelo? Ocorrências já criadas não serão alteradas.'))return;try{await api('/processos/'+processId+'/etapas/'+b.dataset.delStep,{method:'DELETE'});toast('Etapa removida.');processDetailPage(c,processId)}catch(err){toast(err.message)}})}
function processFormModal(){const ctx=state.selectedCompany;modal(`<form id="procForm">${modalHead('Novo processo','Cadastre o modelo. As etapas vêm na tela seguinte.')}<div class="modal-body">${companyField(true)}<div class="field"><label>Nome *</label><input name="name" required placeholder="Apuração Mensal"></div><div class="field"><label>Setor</label><input name="sector" placeholder="Fiscal"></div><div class="field"><label>Descrição</label><textarea name="description" rows="2"></textarea></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Criar processo</button>')}</form>`,'md');bindCompanyPicker();$('#procForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);try{const body={name:fd.get('name'),sector:fd.get('sector'),description:fd.get('description'),company_id:fd.get('company_id')||ctx?.id};const created=await api('/processos',{method:'POST',body:JSON.stringify(body)});closeModal();toast('Processo criado.','success');cdsRemember({fallbackPage:'processos',label:'Processos',kind:'processView'});state.processView=created.id;state.page='processos';render()}catch(err){toast(err.message)}}}
function stepFormModal(processId,step,users,after){modal(`<form id="stepForm">${modalHead(step?'Editar etapa':'Nova etapa','Prazo relativo em dias a partir do início da ocorrência (D+N).')}<div class="modal-body"><div class="field"><label>Nome *</label><input name="name" required value="${esc(step?.name||'')}"></div><div class="field"><label>Descrição</label><textarea name="description" rows="2">${esc(step?.description||'')}</textarea></div><div class="grid" style="grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>Ordem</label><input name="step_order" type="number" min="1" value="${esc(step?.step_order||'')}"></div><div class="field"><label>Prazo (D+)</label><input name="due_offset_days" type="number" min="0" value="${esc(step?.due_offset_days??1)}"></div></div><div class="field"><label>Responsável</label><select name="responsible_user_id"><option value="">—</option>${(users||[]).map(u=>`<option value="${esc(u.id)}" ${step&&u.id===step.responsible_user_id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></div><label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="required" ${(step?Number(step.required)!==0:true)?'checked':''}> Etapa obrigatória</label></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Salvar</button>')}</form>`,'md');$('#stepForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const body={name:fd.get('name'),description:fd.get('description'),due_offset_days:Number(fd.get('due_offset_days')||0),responsible_user_id:fd.get('responsible_user_id')||null,required:!!fd.get('required')};if(fd.get('step_order'))body.step_order=Number(fd.get('step_order'));try{if(step)await api('/processos/'+processId+'/etapas/'+step.id,{method:'PATCH',body:JSON.stringify(body)});else await api('/processos/'+processId+'/etapas',{method:'POST',body:JSON.stringify(body)});closeModal();toast('Etapa salva.','success');if(after)after()}catch(err){toast(err.message)}}}
async function occurrenceFormModal(processList){const list=processList&&processList.length?processList:listItems(await api('/processos?page=1&page_size=100&status=ATIVO'));const ativos=list.filter(p=>p.status==='ATIVO');modal(`<form id="occForm">${modalHead('Nova ocorrência','Copia as etapas do modelo. Alterações futuras no processo não afetam esta ocorrência.')}<div class="modal-body"><div class="field"><label>Processo *</label><select name="process_id" required><option value="">Selecione...</option>${ativos.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.company_trade_name||p.company_name||'')}</option>`).join('')}</select></div><div class="field"><label>Competência *</label><input name="competence" required placeholder="2026-09 ou 09/2026"></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Criar ocorrência</button>')}</form>`,'md');$('#occForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);try{await api('/processo-ocorrencias',{method:'POST',body:JSON.stringify({process_id:fd.get('process_id'),competence:fd.get('competence')})});closeModal();toast('Ocorrência criada.','success');state.processView=null;processesPage($('#content'))}catch(err){toast(err.message)}}}
async function occurrenceViewModal(id){try{const o=await api('/processo-ocorrencias/'+id);modal(`${modalHead(esc(o.title),'Competência '+esc(o.competence)+' · '+esc(o.company_trade_name||o.company_name||''))}<div class="modal-body"><p>${occurrenceStatusBadge(o.status)} · Responsável: ${esc(o.responsible_name||'-')}</p><div class="field"><label>Situação</label><select id="occStatus">${['PENDENTE','EM_ANDAMENTO','CONCLUIDA','CANCELADA'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s==='CONCLUIDA'?'CONCLUÍDA':s.replace('_',' ')}</option>`).join('')}</select></div><table class="table"><thead><tr><th>#</th><th>Etapa</th><th>Responsável</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>${(o.steps||[]).map(s=>`<tr><td>${s.step_order}</td><td>${esc(s.name)}</td><td>${esc(s.responsible_name||'-')}</td><td>${dueLabel(s.due_offset_days)}</td><td>${esc(s.status)}</td></tr>`).join('')||'<tr><td colspan="5">Sem etapas copiadas.</td></tr>'}</tbody></table></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Fechar</button><button type="button" class="btn" id="saveOcc">Salvar situação</button>')}`,'lg');$('#saveOcc').onclick=async()=>{try{await api('/processo-ocorrencias/'+id,{method:'PATCH',body:JSON.stringify({status:$('#occStatus').value})});closeModal();toast('Ocorrência atualizada.','success');processesPage($('#content'))}catch(err){toast(err.message)}}}catch(err){toast(err.message)}}
async function requests(c){
  if(state.requestView)return requestConversation(c,state.requestView);
  const page=state.listPage?.solicitacoes||1;
  const inCompany=!!state.selectedCompany;
  await withList(c,()=>api('/solicitacoes?page='+page+'&page_size=25'),data=>{
    const list=listItems(data);
    const unreadTotal=Number(data.unread_total||0);
    const cols=inCompany
      ?'<tr><th>Solicitação</th><th>Última mensagem</th><th>Atualização</th><th>Situação</th><th>Ação</th></tr>'
      :'<tr><th>Empresa</th><th>Solicitação</th><th>Última mensagem</th><th>Data</th><th>Situação</th><th>Ação</th></tr>';
    const rows=list.map(x=>{
      const unread=Number(x.unread_count||0)>0;
      const blink=unread?' req-row-unread':'';
      const titleCell=(unread?'<span class="req-unread-dot" title="Não lida">🔴</span> ':'')+'<b>'+esc(x.title)+'</b>';
      const updated=x.updated_at||x.last_message?.created_at||x.created_at;
      const action='<button type="button" class="btn" data-open-req="'+esc(x.id)+'" data-company="'+esc(x.company_id)+'">Abrir conversa</button>';
      if(inCompany){
        return '<tr class="'+blink+'"><td data-label="Solicitação">'+titleCell+'</td><td data-label="Última mensagem">'+esc(requestPreview(x))+'</td><td data-label="Atualização">'+esc(fmtMsgTime(updated))+'</td><td data-label="Situação">'+esc(requestStatusLabel(x.status))+'</td><td data-label="Ação">'+action+'</td></tr>';
      }
      return '<tr class="'+blink+'"><td data-label="Empresa">'+esc(x.company_trade_name||x.company_name||'-')+'</td><td data-label="Solicitação">'+titleCell+'</td><td data-label="Última mensagem">'+esc(requestPreview(x))+'</td><td data-label="Data">'+esc(fmtMsgTime(updated))+'</td><td data-label="Situação">'+esc(requestStatusLabel(x.status))+'</td><td data-label="Ação">'+action+'</td></tr>';
    }).join('');
    c.innerHTML=head('Solicitações'+(unreadTotal?' 🔴 '+unreadTotal:''),'Conversa contextual entre empresa e escritório.','<button class="btn" id="new">+ Nova solicitação</button>','solicitacoes')+'<div class="panel table-wrap"><table class="table">'+cols+rows+'</table>'+(!list.length?emptyState('Nenhuma solicitação','Quando o escritório ou o cliente pedirem algo, aparecerá aqui.'):'')+'</div>'+pagerHtml(data,'solicitacoes');
    $('#new').onclick=()=>requestModal();
    c.querySelectorAll('[data-open-req]').forEach(btn=>{btn.onclick=()=>openRequestConversation(btn.dataset.company,btn.dataset.openReq)});
    bindPager('solicitacoes',dir=>{state.listPage={...state.listPage,solicitacoes:Math.max(1,page+dir)};requests(c)});
  });
}
async function requestConversation(c,requestId){
  c.innerHTML=skeletonPage();
  try{
    const [req,messages]=await Promise.all([api('/solicitacoes/'+requestId),api('/solicitacoes/'+requestId+'/mensagens')]);
    state.activeRequestId=requestId;
    const closed=isRequestClosed(req.status);
    const bubbles=(messages||[]).map(m=>{
      const office=!m.role||m.role!=='CLIENT';
      return '<div class="req-bubble '+(office?'office':'client')+'"><div class="req-bubble-meta">'+esc(office?'ESCRITÓRIO':'CLIENTE')+(m.user_name?' · '+esc(m.user_name):'')+'</div><div class="req-bubble-text">'+esc(m.message)+'</div><div class="req-bubble-time">'+esc(fmtMsgTime(m.created_at))+'</div></div>';
    }).join('')||'<div class="muted" style="padding:16px">Nenhuma mensagem ainda.</div>';
    const composer=closed
      ?'<div class="req-composer muted">Solicitação '+esc(requestStatusLabel(req.status).toLowerCase())+'. Não é possível enviar novas mensagens.</div>'
      :'<form class="req-composer" id="reqMsgForm"><textarea name="message" rows="2" placeholder="Digite uma mensagem..." required></textarea><button class="btn" type="submit">Enviar</button></form>';
    const actions=['OWNER','ACCOUNTANT','STAFF'].includes(state.user.role)&&!closed
      ?'<button type="button" class="btn secondary" id="reqConclude">Concluir</button><button type="button" class="btn secondary" id="reqCancel">Cancelar</button>'
      :'';
    c.innerHTML='<div class="req-chat"><div class="req-chat-head">'+cdsBackBtn('reqBack','← Solicitações')+'<div><h1>'+esc(req.title)+'</h1><p>'+esc(requestStatusLabel(req.status))+(req.company_trade_name||req.company_name?' · '+esc(req.company_trade_name||req.company_name):'')+'</p></div><div class="row-actions">'+actions+'</div></div><div class="req-chat-thread" id="reqThread">'+bubbles+'</div>'+composer+'</div>';
    $('#reqBack').onclick=()=>cdsGoBack({
      fallbackPage:'solicitacoes',
      clear(){state.requestView=null;state.activeRequestId=null},
      after(){requests(c)}
    });
    const thread=$('#reqThread');if(thread)thread.scrollTop=thread.scrollHeight;
    $('#reqMsgForm')&&($('#reqMsgForm').onsubmit=async e=>{
      e.preventDefault();
      const message=String(new FormData(e.target).get('message')||'').trim();
      if(!message)return;
      try{
        await api('/solicitacoes/'+requestId+'/mensagens',{method:'POST',body:JSON.stringify({message})});
        e.target.reset();
        await requestConversation(c,requestId);
        loadSidebarCounters().catch(()=>{});
      }catch(err){toast(err.message)}
    });
    $('#reqConclude')&&($('#reqConclude').onclick=async()=>{
      try{await api('/solicitacoes/'+requestId,{method:'PATCH',body:JSON.stringify({status:'CONCLUDED'})});toast('Solicitação concluída.','success');requestConversation(c,requestId)}catch(err){toast(err.message)}
    });
    $('#reqCancel')&&($('#reqCancel').onclick=async()=>{
      if(!confirm('Cancelar esta solicitação?'))return;
      try{await api('/solicitacoes/'+requestId,{method:'PATCH',body:JSON.stringify({status:'CANCELLED'})});toast('Solicitação cancelada.','success');requestConversation(c,requestId)}catch(err){toast(err.message)}
    });
    loadSidebarCounters().catch(()=>{});
  }catch(err){
    state.requestView=null;
    toast(err.message||'Não foi possível abrir a conversa.');
    requests(c);
  }
}
function requestModal(){modal('<form id="reqForm">'+modalHead('Nova solicitação','Registre o pedido com empresa, tipo e descrição.')+'<div class="modal-body"><div class="form-grid">'+companyField()+'<div class="field"><label>Tipo</label><select name="type"><option value="DOCUMENT">Documento</option><option value="QUESTION">Dúvida</option><option value="GENERAL">Geral</option></select></div><div class="field span2"><label>Título</label><input name="title" required></div><div class="field span2"><label>Descrição</label><textarea name="description" rows="4"></textarea></div></div></div>'+modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Enviar</button>')+'</form>','md');bindCompanyPicker();$('#reqForm').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.target));const created=await api('/solicitacoes',{method:'POST',body:JSON.stringify(body)});closeModal();toast('Solicitação criada.','success');await openRequestConversation(created.company_id,created.id)}catch(err){toast(err.message)}}
}

async function importsPage(c){const page=state.listPage?.importacoes||1;await withList(c,()=>api('/importacoes?page='+page+'&page_size=25'),data=>{const list=listItems(data);c.innerHTML=head('Importações','Importação contábil mensal no próprio CDS Contábil Connect. CDS Sistemas é origem opcional, sem integração externa nesta versão.','<button class="btn" id="new">+ Nova importação</button>','importacoes')+`<div class="panel table-wrap"><table class="table"><tr><th>Empresa</th><th>Origem</th><th>Período</th><th>Registros</th><th>Situação</th><th>Data</th><th>Responsável</th></tr>${list.map(x=>`<tr><td data-label="Empresa">${esc(x.company_name)}</td><td data-label="Origem">${esc(x.origin_label)}${x.origin==='CDS_SISTEMAS'&&!x.imported_rows?' <span class="muted">· sem integração ativa</span>':''}</td><td data-label="Período">${esc((x.period_start||'-')+' → '+(x.period_end||'-'))}</td><td data-label="Registros">${x.imported_rows}/${x.total_rows}</td><td data-label="Situação">${esc(originLabel(x.status))}</td><td data-label="Data">${esc(x.created_at)}</td><td data-label="Responsável">${esc(x.created_by_name||'-')}</td></tr>`).join('')}</table>${!list.length?emptyState('Nenhuma importação','Registre uma importação contábil ou fiscal quando houver arquivo.'):''}</div>`+pagerHtml(data,'importacoes');$('#new').onclick=()=>importModal();bindPager('importacoes',dir=>{state.listPage={...state.listPage,importacoes:Math.max(1,page+dir)};importsPage(c)})})}
function importPaySelect(){return `<select data-imp="method" required aria-label="Forma">${payOptions.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>`}
function importRowHtml(){return `<tr class="import-row"><td><select data-imp="type" aria-label="Tipo"><option value="EXPENSE">Despesa</option><option value="REVENUE">Receita</option></select></td><td><input type="date" data-imp="occurred_on" required aria-label="Data"></td><td><input data-imp="description" required aria-label="Descrição" placeholder="Descrição"></td><td><input data-imp="amount" required inputmode="decimal" aria-label="Valor" placeholder="0,00"></td><td>${importPaySelect()}</td><td><button type="button" class="btn secondary import-remove">Remover</button></td></tr>`}
function collectImportMovements(form){return [...form.querySelectorAll('.import-row')].map(row=>{const type=row.querySelector('[data-imp="type"]').value;const method=row.querySelector('[data-imp="method"]').value;const mv={type,occurred_on:row.querySelector('[data-imp="occurred_on"]').value,description:String(row.querySelector('[data-imp="description"]').value||'').trim(),amount:String(row.querySelector('[data-imp="amount"]').value||'').trim()};if(type==='REVENUE')mv.receipt_method=method;else mv.payment_method=method;return mv}).filter(x=>x.description&&x.amount&&x.occurred_on)}
function importModal(){modal(`<form id="impForm">${modalHead('Nova importação','Informe a empresa, o período e as movimentações para conferência.')}<div class="modal-body"><section class="form-section"><h3>Empresa</h3><div class="form-grid">${companyField()}</div></section><section class="form-section"><h3>Origem e período</h3><div class="form-grid"><div class="field"><label>Origem</label><select name="origin" required><option value="IMPORTACAO_CONTABIL">Importação Contábil</option><option value="IMPORTACAO_FISCAL">Importação Fiscal</option><option value="CDS_SISTEMAS">CDS Sistemas</option></select></div><div class="field"><label>Início do período</label><input name="period_start" type="date"></div><div class="field"><label>Fim do período</label><input name="period_end" type="date"></div></div></section><section class="form-section"><h3>Conferência</h3><p class="muted">Revise as movimentações antes de importar.</p><div class="panel table-wrap"><table class="table"><thead><tr><th>Tipo</th><th>Data</th><th>Descrição</th><th>Valor</th><th>Forma</th><th></th></tr></thead><tbody id="importRows">${importRowHtml()}</tbody></table></div><button type="button" class="btn secondary" id="addImportRow" style="margin-top:10px">+ Adicionar movimentação</button></section></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" id="impSubmit">Importar</button>')}</form>`,'lg');bindCompanyPicker();const rows=$('#importRows');$('#addImportRow').onclick=()=>rows.insertAdjacentHTML('beforeend',importRowHtml());rows.onclick=e=>{const btn=e.target.closest('.import-remove');if(!btn)return;const tr=btn.closest('tr');if(rows.querySelectorAll('.import-row').length>1)tr.remove();else toast('Informe ao menos uma movimentação.')};$('#impForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const movements=collectImportMovements(e.target);if(!movements.length){toast('Informe ao menos uma movimentação.');return}const btn=$('#impSubmit');if(btn){btn.disabled=true;btn.classList.add('busy');btn.textContent='Importando...'}try{const r=await api('/importacoes',{method:'POST',body:JSON.stringify({company_id:f.company_id,origin:f.origin,period_start:f.period_start,period_end:f.period_end,movements})});toast((r.imported_rows||0)+' registros importados.');closeModal();await render()}catch(err){toast(err.message);if(btn){btn.disabled=false;btn.classList.remove('busy');btn.textContent='Importar'}}}}
async function exportsPage(c){const page=state.listPage?.exportacoes||1;await withList(c,()=>api('/exportacoes?page='+page+'&page_size=25'),data=>{const list=listItems(data);c.innerHTML=head('Exportações','Somente lançamentos efetivados entram no arquivo. Domínio usa layout 11758 com mapeamento de contas.','<button class="btn" id="new">+ Gerar exportação</button>','exportacoes')+`<div class="panel table-wrap"><table class="table"><tr><th>Data</th><th>Empresa</th><th>Sistema</th><th>Período</th><th>Situação</th><th></th></tr>${list.map(x=>`<tr><td>${x.created_at}</td><td>${esc(x.company_name)}</td><td>${esc(originLabel(x.system_key))}</td><td>${x.period_start} → ${x.period_end}</td><td>${esc(originLabel(x.status))}</td><td><button class="btn secondary" onclick="downloadExport('${x.id}')">Baixar</button></td></tr>`).join('')}</table>${!list.length?'<div class="empty">Nenhum registro encontrado.</div>':''}</div>`+pagerHtml(data,'exportacoes');$('#new').onclick=()=>exportModal();bindPager('exportacoes',dir=>{state.listPage={...state.listPage,exportacoes:Math.max(1,page+dir)};exportsPage(c)});window.downloadExport=async id=>{const r=await fetch('/api/exportacoes/'+id+'/download',{headers:authHeaders()});const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=(r.headers.get('content-disposition')||'').match(/filename="?([^";]+)"?/)?.[1]||'exportacao.txt';a.click();URL.revokeObjectURL(u)}})}

function periodStatusBadge(status,label){
  const cls={OPEN:'pending',IN_REVIEW:'need',READY_FOR_EXPORT:'pending',EXPORTED:'approved',CLOSED:'approved'}[status]||'pending';
  return `<span class="badge ${cls}">${esc(label||status)}</span>`;
}
function competenceIssueNav(issue){
  const nav=issue&&issue.navigate;if(!nav||!nav.page)return '';
  return `<button type="button" class="btn secondary issue-nav" data-page="${esc(nav.page)}" style="margin-left:8px">Abrir</button>`;
}
async function fechamentoPage(c){
  const canManage=state.user&&(state.user.role==='OWNER'||state.user.role==='ACCOUNTANT');
  const companyId=state.selectedCompany&&state.selectedCompany.id;
  const detailId=state.fechamentoId||null;
  c.innerHTML=skeletonPage();
  try{
    if(detailId){
      const [resumo,hist]=await Promise.all([
        api('/contabilidade/competencias/'+detailId+'/resumo'),
        api('/contabilidade/competencias/'+detailId+'/historico')
      ]);
      const ck=resumo.checklist||{};
      const checks=[
        [ck.documents_ok,'Documentos conferidos',resumo.document_pending_count,'documentos'],
        [ck.entries_approved,'Lançamentos aprovados',resumo.entry_pending_count,'aprovacao'],
        [ck.balanced,'Débitos = Créditos',resumo.unbalanced_entry_count,'lancamentos'],
        [ck.accounts_mapped,'Contas Domínio mapeadas',resumo.unmapped_account_count,'integracoes'],
        [ck.pendencies_resolved,'Pendências resolvidas',resumo.open_pendency_count,'pendencias'],
        [ck.export_ready,'Exportação pronta',resumo.export_id?0:1,'exportacoes']
      ];
      const issues=(resumo.issues||[]).map(i=>`<li>${esc(i.message||i.code)}${competenceIssueNav(i)}</li>`).join('');
      const events=(hist.events||[]).map(ev=>{
        const when=esc(String(ev.at||'').replace('T',' ').slice(0,19));
        return `<div class="activity-item"><b>${esc(ev.label||ev.type)}</b><div class="muted">${when}${ev.user_name?' · '+esc(ev.user_name):''}${ev.reason?' · Motivo: '+esc(ev.reason):''}</div></div>`;
      }).join('')||'<p class="muted">Sem histórico ainda.</p>';
      c.innerHTML=head('Fechamento Contábil',`${esc(resumo.company_name||'')} · Competência ${esc(resumo.competence_label||resumo.competence)}`,cdsBackBtn('fcBack'),'fechamento')+
        `<div class="panel" style="margin-bottom:14px"><div class="form-grid"><div><small class="muted">Empresa</small><div><b>${esc(resumo.company_name||'-')}</b></div></div><div><small class="muted">Competência</small><div><b>${esc(resumo.competence_label||resumo.competence)}</b></div></div><div><small class="muted">Status</small><div>${periodStatusBadge(resumo.status,resumo.status_label)}</div></div></div></div>`+
        `<div class="grid cards"><div class="card kpi-card"><div class="value">${resumo.document_count||0}</div><div class="label">Documentos</div></div><div class="card kpi-card"><div class="value">${resumo.entry_count||0}</div><div class="label">Lançamentos</div></div><div class="card kpi-card"><div class="value">${resumo.open_pendency_count||0}</div><div class="label">Pendências</div></div><div class="card kpi-card"><div class="value">${money(resumo.debit_total_cents||resumo.debit_total||0)}</div><div class="label">Débitos</div></div><div class="card kpi-card"><div class="value">${money(resumo.credit_total_cents||resumo.credit_total||0)}</div><div class="label">Créditos</div></div></div>`+
        `<div class="panel" style="margin:14px 0"><b>Status do balanceamento</b><p>${resumo.balanced?'<span class="badge approved">BALANCEADO</span>':'<span class="badge rejected">NÃO BALANCEADO</span>'}</p>${resumo.export_hint?`<p class="muted">${esc(resumo.export_hint)}</p>`:''}</div>`+
        `<div class="panel" style="margin-bottom:14px"><b>Checklist</b><ul class="muted">${checks.map(([ok,label,count,page])=>`<li>${ok?'✓':'⚠'} ${esc(label)}${!ok&&count?` · <button type="button" class="btn secondary check-nav" data-page="${page}" style="margin-left:6px">${count} pendente(s)</button>`:''}</li>`).join('')}</ul>${issues?`<div style="margin-top:10px"><b>Pendências impeditivas</b><ul>${issues}</ul></div>`:''}</div>`+
        `<div class="panel" style="margin-bottom:14px"><b>Histórico</b>${events}</div>`+
        `<div class="row-actions" style="flex-wrap:wrap;gap:8px">`+
        (canManage&&resumo.status==='OPEN'?`<button class="btn" id="fcReview">Iniciar conferência</button>`:'')+
        (canManage&&(resumo.status==='IN_REVIEW'||resumo.status==='OPEN')?`<button class="btn secondary" id="fcReady">Marcar pronta para exportação</button>`:'')+
        (canManage&&resumo.can_export?`<button class="btn" id="fcExport">Gerar exportação Domínio</button>`:'')+
        (canManage&&resumo.can_close?`<button class="btn" id="fcClose">Fechar competência</button>`:'')+
        (canManage&&resumo.status==='CLOSED'?`<button class="btn secondary" id="fcReopen">Reabrir competência</button>`:'')+
        `</div>`;
      $('#fcBack').onclick=()=>cdsGoBack({fallbackPage:'fechamento',clear(){state.fechamentoId=null},after(){fechamentoPage(c)}});
      c.querySelectorAll('.check-nav,.issue-nav').forEach(btn=>btn.onclick=()=>{state.page=btn.dataset.page;render()});
      const reload=()=>fechamentoPage(c);
      $('#fcReview')&&($('#fcReview').onclick=async()=>{try{await api('/contabilidade/competencias/'+detailId+'/iniciar-conferencia',{method:'POST',body:'{}'});toast('Conferência iniciada.');reload()}catch(e){toast(e.message)}});
      $('#fcReady')&&($('#fcReady').onclick=async()=>{try{await api('/contabilidade/competencias/'+detailId+'/pronta-exportacao',{method:'POST',body:'{}'});toast('Competência pronta para exportação.');reload()}catch(e){toast(e.message)}});
      $('#fcExport')&&($('#fcExport').onclick=async()=>{
        try{
          const r=await api('/exportacoes/gerar',{method:'POST',body:JSON.stringify({company_id:resumo.company_id,system_key:'dominio',period_start:resumo.period_start,period_end:resumo.period_end})});
          toast(`${r.count} lançamentos exportados.`);
          reload();
        }catch(e){toast(e.message)}
      });
      $('#fcClose')&&($('#fcClose').onclick=async()=>{
        if(!confirm('Fechar definitivamente a competência '+ (resumo.competence_label||resumo.competence)+'?'))return;
        try{await api('/contabilidade/competencias/'+detailId+'/fechar',{method:'POST',body:'{}'});toast('Competência fechada.');reload()}catch(e){toast(e.message)}
      });
      $('#fcReopen')&&($('#fcReopen').onclick=async()=>{
        const reason=prompt('Motivo da reabertura (obrigatório):');
        if(reason==null)return;
        try{await api('/contabilidade/competencias/'+detailId+'/reabrir',{method:'POST',body:JSON.stringify({reason})});toast('Competência reaberta.');reload()}catch(e){toast(e.message)}
      });
      return;
    }
    const qs=new URLSearchParams({page:'1',page_size:'50'});
    if(companyId)qs.set('company_id',companyId);
    const data=await api('/contabilidade/competencias?'+qs.toString());
    const list=listItems(data);
    c.innerHTML=head('Fechamento Contábil','Conferência da competência, exportação Domínio e fechamento do período.',canManage?'<button class="btn" id="fcNew">+ Nova competência</button>':'','fechamento')+
      `<div class="panel table-wrap"><table class="table"><tr><th>Empresa</th><th>Competência</th><th>Status</th><th>Período</th><th></th></tr>`+
      list.map(x=>`<tr><td>${esc(x.company_trade_name||x.company_name)}</td><td>${esc(x.competence_label||x.competence)}</td><td>${periodStatusBadge(x.status,x.status_label)}</td><td>${esc(x.period_start)} → ${esc(x.period_end)}</td><td><button class="btn secondary fc-open" data-id="${esc(x.id)}">Abrir</button></td></tr>`).join('')+
      `</table>${!list.length?'<div class="empty">Nenhuma competência registrada. Crie a competência do mês para iniciar a conferência.</div>':''}</div>`;
    c.querySelectorAll('.fc-open').forEach(btn=>btn.onclick=()=>{cdsRemember({fallbackPage:'fechamento',label:'Fechamento',kind:'fechamentoId'});state.fechamentoId=btn.dataset.id;fechamentoPage(c)});
    $('#fcNew')&&($('#fcNew').onclick=()=>{
      const now=new Date();
      const def=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      modal(`<form id="fcForm">${modalHead('Nova competência','Informe a empresa e o mês contábil (YYYY-MM).')}<div class="modal-body"><div class="form-grid">${companyField()}<div class="field"><label>Competência</label><input name="competence" required pattern="\\d{4}-\\d{2}" placeholder="YYYY-MM" value="${esc(def)}"></div></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Criar</button>')}</form>`,'md');
      bindCompanyPicker();
      $('#fcForm').onsubmit=async e=>{
        e.preventDefault();
        try{
          const body=Object.fromEntries(new FormData(e.target));
          const r=await api('/contabilidade/competencias',{method:'POST',body:JSON.stringify(body)});
          closeModal();
          state.fechamentoId=r.id;
          toast('Competência pronta.');
          fechamentoPage(c);
        }catch(err){toast(err.message)}
      };
    });
  }catch(err){
    c.innerHTML=head('Fechamento Contábil','Conferência e fechamento da competência contábil.','','fechamento')+`<div class="panel"><p class="muted">${esc(err.message||'Não foi possível carregar.')}</p></div>`;
  }
}
function exportModal(){modal(`<form id="exForm">${modalHead('Gerar exportação','Somente lançamentos efetivados entram no arquivo.')}<div class="modal-body"><div class="form-grid">${companyField()}<div class="field"><label>Sistema destino</label><select name="system_key" id="exSystem"><option value="dominio">Domínio</option><option value="contaazul">Conta Azul</option><option value="alterdata">Alterdata</option><option value="fortes">Fortes</option><option value="questor">Questor</option><option value="sci">SCI</option></select></div><div class="field"><label>Data inicial</label><input name="period_start" type="date" required></div><div class="field"><label>Data final</label><input name="period_end" type="date" required></div><div class="field" id="exDelimiterField"><label>Delimitador</label><select name="delimiter"><option>;</option><option>,</option></select></div></div><div id="exDominioInfo" class="panel" style="margin-top:12px" hidden><p><b>Layout: Excel (3.1) — Lançamentos Contábeis em Lote com Filial e Centro de Custos</b></p><p class="muted">Código 11758 · separador ; · decimal ,</p><div id="exPreview" class="muted">Selecione empresa e período para ver a prévia.</div><p style="margin-top:10px"><button type="button" class="btn secondary" id="exMapLink">Configurar mapeamento Domínio</button></p></div><p class="muted" id="exCanonicalHint">A exportação usa o formato canônico do Connect. O layout oficial de cada software deve ser homologado/configurado antes do uso operacional.</p></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit" id="exSubmit">Gerar arquivo</button>')}</form>`,'md');bindCompanyPicker();
  const sync=async()=>{
    const sys=$('#exSystem').value;
    const isDom=sys==='dominio';
    $('#exDelimiterField').hidden=isDom;
    $('#exDominioInfo').hidden=!isDom;
    $('#exCanonicalHint').hidden=isDom;
    $('#exSubmit').textContent=isDom?'Gerar arquivo para Domínio':'Gerar arquivo';
    if(!isDom){$('#exSubmit').disabled=false;return}
    const fd=new FormData($('#exForm'));
    const company_id=fd.get('company_id');const period_start=fd.get('period_start');const period_end=fd.get('period_end');
    if(!company_id||!period_start||!period_end){$('#exPreview').innerHTML='Informe empresa e período.';$('#exSubmit').disabled=true;return}
    try{
      const p=await api('/exportacoes/previa',{method:'POST',body:JSON.stringify({company_id,system_key:'dominio',period_start,period_end})});
      const unmapped=(p.unmapped_accounts||[]).map(a=>`<li><code>${esc(a.account_code)}</code> ${esc(a.description)} · ${a.entry_count} lanç.</li>`).join('');
      $('#exPreview').innerHTML=`<div class="form-grid" style="margin-top:8px"><div>Lançamentos encontrados<br><b>${p.entries_found||0}</b></div><div>Débitos<br><b>${money(p.debit_total_cents||0)}</b></div><div>Créditos<br><b>${money(p.credit_total_cents||0)}</b></div><div>Contas mapeadas<br><b>${p.mapped_accounts||0}</b></div><div>Contas sem mapeamento<br><b>${p.unmapped_count||0}</b></div><div>Lançamentos com erro<br><b>${p.entries_with_errors||0}</b></div></div>${unmapped?`<p style="margin-top:10px">${esc(p.message||'')}</p><ul class="muted">${unmapped}</ul>`:(p.message?`<p style="margin-top:10px">${esc(p.message)}</p>`:'')}`;
      $('#exSubmit').disabled=!p.can_generate;
    }catch(err){$('#exPreview').textContent=err.message;$('#exSubmit').disabled=true}
  };
  $('#exSystem').onchange=sync;
  $('#exForm').querySelectorAll('input[name="period_start"],input[name="period_end"],input[name="company_id"]').forEach(el=>el.addEventListener('change',sync));
  const picker=$('#companyPickerSearch');if(picker)picker.addEventListener('blur',()=>setTimeout(sync,200));
  $('#exMapLink')&&($('#exMapLink').onclick=()=>{const cid=String(new FormData($('#exForm')).get('company_id')||state.selectedCompany?.id||'');closeModal();if(cid){if(state.selectedCompany?.id===cid){state.page='integracoes';render()}else enterCompany(cid,'integracoes')}else toast('Selecione a empresa primeiro.')});
  sync();
  $('#exForm').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.target));if(body.system_key==='dominio')delete body.delimiter;const r=await api('/exportacoes/gerar',{method:'POST',body:JSON.stringify(body)});toast(`${r.count} lançamentos exportados${r.line_count!=null?' · '+r.line_count+' linhas':''}.`);closeModal();await render()}catch(err){toast(err.message)}}}
async function dominioIntegrationsPage(c){
  const companyId=state.selectedCompany?.id;
  if(!companyId){c.innerHTML=head('Integrações','Selecione uma empresa para mapear contas do Domínio.','','integracoes')+`<div class="panel"><p class="muted">Acesse uma empresa e abra Integrações no menu contábil.</p></div>`;return}
  c.innerHTML=skeletonPage();
  const data=await api('/empresas/'+companyId+'/integracoes/dominio/mapeamentos');
  const items=data.items||[];
  c.innerHTML=head('Integrações · Domínio',esc(data.layout_label||'Mapeamento de códigos reduzidos para o Domínio Thomson Reuters.'),'','integracoes')+`<div class="panel"><p class="muted">Informe o código Domínio de cada conta analítica. Sem mapeamento, a exportação é bloqueada.</p><div class="panel table-wrap" style="margin-top:12px"><table class="table"><tr><th>Conta CDS</th><th>Descrição</th><th>Código Domínio</th><th>Situação</th><th></th></tr>${items.map(x=>`<tr data-account="${esc(x.account_id)}"><td><code>${esc(x.account_code)}</code></td><td>${esc(x.description)}</td><td><input class="dom-code" value="${esc(x.external_code||'')}" placeholder="Ex.: 5" style="width:120px;padding:8px;border:1px solid var(--line);border-radius:8px"></td><td>${x.mapping_active?'Mapeada':'Pendente'}</td><td><button type="button" class="btn secondary dom-save">Salvar</button></td></tr>`).join('')}</table>${!items.length?'<div class="empty">Nenhuma conta analítica no plano.</div>':''}</div></div>`;
  c.querySelectorAll('.dom-save').forEach(btn=>btn.onclick=async()=>{
    const tr=btn.closest('tr');const account_id=tr.dataset.account;const external_code=tr.querySelector('.dom-code').value.trim();
    try{await api('/empresas/'+companyId+'/integracoes/dominio/mapeamentos',{method:'PUT',body:JSON.stringify({account_id,external_code})});toast('Mapeamento salvo.','success');dominioIntegrationsPage(c)}catch(err){toast(err.message)}
  });
}
async function users(c){const page=state.listPage?.usuarios||1;const q=state.userSearch||'';await withList(c,()=>api('/usuarios?page='+page+'&page_size=25'+(q?'&q='+encodeURIComponent(q):'')),data=>{const list=listItems(data);state.userList=list;c.innerHTML=head('Equipe e acessos','Gerencie os usuários que fazem parte do seu escritório.',cdsStackBackHtml()+'<button class="btn" id="new">+ Novo usuário</button>','usuarios')+`<div class="panel" style="margin-bottom:14px"><input id="userSearch" placeholder="Buscar por nome ou e-mail..." value="${esc(q)}" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px"></div><div class="panel table-wrap"><table class="table"><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Empresa</th><th>Situação</th><th></th></tr>${list.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${roleLabel(x.role)}</td><td>Escritório</td><td>${x.active?'Ativo':'Inativo'}</td><td><button class="btn secondary" onclick="editUser('${x.id}')">Editar</button></td></tr>`).join('')}</table>${!list.length?'<div class="empty">Nenhum registro encontrado.</div>':''}</div>`+pagerHtml(data,'usuarios');$('#new').onclick=()=>userModal();cdsBindBack('cdsBack',{fallbackPage:'configuracoes'});const search=$('#userSearch');search.oninput=debounce(()=>{state.userSearch=search.value.trim();state.listPage={...state.listPage,usuarios:1};users(c)},350);bindPager('usuarios',dir=>{state.listPage={...state.listPage,usuarios:Math.max(1,page+dir)};users(c)});window.editUser=id=>userModal(state.userList?.find(x=>x.id===id))})}function userModal(x={}){if(x.company_id&&x.company_name)state.pickedCompany={id:x.company_id,name:x.company_name};const roleOpts=state.user&&state.user.role==='OWNER'?['OWNER','ACCOUNTANT','STAFF']:['ACCOUNTANT','STAFF'];if(x.role==='OWNER'&&!roleOpts.includes('OWNER'))roleOpts.unshift('OWNER');modal(`<form id="uForm">${modalHead(x.id?'Editar usuário':'Novo usuário','Somente usuários internos do escritório. Perfis de empresa cliente não entram nesta tela.')}<div class="modal-body"><div class="form-grid"><div class="field"><label>Nome</label><input name="name" required value="${esc(x.name||'')}"></div><div class="field"><label>E-mail</label><input name="email" type="email" required value="${esc(x.email||'')}"></div>${x.id?'':'<div class="field"><label>Senha</label><input name="password" type="password" required></div>'}<div class="field"><label>Perfil</label><select name="role">${roleOpts.map(r=>`<option value="${r}" ${x.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select></div>${x.id?`<div class="field"><label>Situação</label><select name="active"><option value="1" ${x.active?'selected':''}>Ativo</option><option value="0" ${!x.active?'selected':''}>Inativo</option></select></div>`:''}</div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">'+(x.id?'Salvar alterações':'Criar')+'</button>')}</form>`,'md');$('#uForm').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.target));if(x.id){body.active=body.active==='1';delete body.password;await api('/usuarios/'+x.id,{method:'PATCH',body:JSON.stringify(body)})}else await api('/usuarios',{method:'POST',body:JSON.stringify(body)});closeModal();await render()}catch(e){toast(e.message)}}}
async function commsPage(c){
  const tab=state.commsTab||'email';
  const tabs=`<div class="row-actions" style="margin-bottom:14px;flex-wrap:wrap"><button type="button" class="btn ${tab==='email'?'':'secondary'}" id="tabEmail">E-mail</button><button type="button" class="btn ${tab==='whatsapp'?'':'secondary'}" id="tabWa">WhatsApp</button></div>`;
  const bindTabs=()=>{$('#tabWa')&&($('#tabWa').onclick=()=>{state.commsTab='whatsapp';state.emailEditing=false;commsPage(c)});$('#tabEmail')&&($('#tabEmail').onclick=()=>{state.commsTab='email';commsPage(c)})};
  if(tab==='email')return emailSettingsPage(c,tabs,bindTabs);
  const cfg=await api('/comunicacoes/config');
  const jobs=await api('/comunicacoes/jobs?page=1&page_size=25');
  const statusLabel={DESATIVADO:'Desativado',CONFIGURANDO:'Configurando',ATIVO:'Ativo',ERRO_CONFIGURACAO:'Erro de configuração',INDISPONIVEL:'Indisponível'}[cfg.status]||cfg.status;
  const events=(cfg.events||[]).map(e=>`<label class="muted" style="display:block;margin:6px 0"><input type="checkbox" name="ev_${e.event_type}" ${e.whatsapp_enabled?'checked':''}> ${esc(e.label)}</label>`).join('');
  const recs=(cfg.recipients||[]).map(u=>`<div class="field"><label>${esc(u.name)} (${esc(u.role)})</label><input name="phone_${u.user_id}" value="${esc(u.phone||'')}" placeholder="(88) 99999-9999"></div>`).join('');
  c.innerHTML=head('Comunicações','WhatsApp é um canal opcional. As notificações internas continuam ativas.',cdsStackBackHtml(),'comunicacoes')+tabs+`<div class="panel" style="margin-bottom:14px"><p><b>WhatsApp</b> — ${esc(statusLabel)}</p><p class="muted">O token da API não é exibido e deve ser configurado no servidor.</p><form id="waForm"><label class="muted" style="display:block;margin:10px 0"><input type="checkbox" name="whatsapp_enabled" ${cfg.whatsapp_enabled?'checked':''}> Ativar WhatsApp</label><div class="form-grid"><div class="field"><label>Provedor</label><input value="${esc(originLabel(String(cfg.provider||'meta').toUpperCase()))}" disabled></div><div class="field"><label>Identificador do número</label><input name="whatsapp_phone_number_id" value="${esc(cfg.phone_number_id||'')}"></div><div class="field"><label>Número conectado</label><input name="display_number" value="${esc(cfg.display_number||'')}" placeholder="Exibido no painel"></div></div><h3 style="margin-top:16px">Eventos</h3>${events}<h3 style="margin-top:16px">Destinatários do escritório</h3><div class="form-grid">${recs||'<p class="muted">Nenhum usuário do escritório.</p>'}</div><button class="btn" type="submit" style="margin-top:12px">Salvar configuração</button></form></div><div class="panel table-wrap"><h3>Envios recentes</h3><table class="table"><tr><th>Quando</th><th>Destinatário</th><th>Evento</th><th>Situação</th><th>Tentativas</th></tr>${(jobs.items||[]).map(j=>`<tr><td>${esc(j.created_at)}</td><td>${esc(j.recipient_name||'-')}</td><td>${esc(j.template_key)}</td><td>${esc(j.status)}</td><td>${j.attempts||0}</td></tr>`).join('')||''}</table>${!(jobs.items||[]).length?'<div class="empty">Nenhum envio.</div>':''}</div>`;
  bindTabs();
  cdsBindBack('cdsBack',{fallbackPage:'configuracoes'});
  $('#waForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const events=(cfg.events||[]).map(ev=>({event_type:ev.event_type,whatsapp_enabled:fd.get('ev_'+ev.event_type)==='on'}));
    const recipient_phones=(cfg.recipients||[]).map(u=>({user_id:u.user_id,phone:fd.get('phone_'+u.user_id)||''}));
    try{
      await api('/comunicacoes/config',{method:'PATCH',body:JSON.stringify({whatsapp_enabled:fd.get('whatsapp_enabled')==='on',whatsapp_phone_number_id:fd.get('whatsapp_phone_number_id'),display_number:fd.get('display_number'),events,recipient_phones})});
      toast('Configuração salva.');commsPage(c);
    }catch(err){toast(err.message)}
  };
}
async function emailSettingsPage(c,tabs,bindTabs){
  let mail;
  try{
    mail=await api('/configuracoes/comunicacoes/email');
  }catch(err){
    if(err&&(err.status===401||err.status===403))throw err;
    if(err&&err.status===404){
      mail={configured:false,status:'not_configured',status_label:'Não configurado',hasCredential:false,from:'',fromName:'CDS Contábil',host:'',port:587,user:'',provider:'cds'};
    }else throw err;
  }
  if(mail&&mail.configured===false)mail.status=mail.status||'not_configured';
  const canEdit=['OWNER','ACCOUNTANT'].includes(state.user.role);
  const editing=!!state.emailEditing;
  const smtpMode=mail.provider==='smtp'&&(mail.configured||mail.source==='tenant'||mail.source==='env');
  const statusText=mail.status_label||(mail.configured?'Configurado':'Não configurado');
  const liveDot=mail.status==='configured_ok'||mail.configured?'●':(mail.status==='connection_error'?'⚠':'○');
  const headline=mail.status==='connection_error'?'Erro de conexão':(smtpMode&&mail.configured?'Ativo — SMTP personalizado':(mail.configured?'Ativo':'Aguardando configuração'));
  let jobs={items:[]};try{jobs=await api('/comunicacoes/jobs?page=1&page_size=15')}catch(e){if(e&&(e.status===401||e.status===403))throw e;jobs={items:[]}}
  const emailJobs=(jobs.items||[]).filter(j=>j.channel==='EMAIL');
  const empty=`<div class="panel" style="margin-bottom:14px"><h3>E-mail do sistema</h3><p>O CDS Contábil ainda não possui um servidor de e-mail configurado.</p><p class="muted">Configure um remetente para enviar convites e notificações.</p><p>Situação ${liveDot} Não configurado</p>${canEdit?'<div class="row-actions" style="margin-top:12px"><button type="button" class="btn" id="emailConfigure">Configurar e-mail</button></div>':''}</div>`;
  const summary=`<div class="panel" style="margin-bottom:14px"><h3>E-mail do sistema</h3><p><b>${esc(mail.from||mail.user||'')}</b><br>${esc(mail.fromName||'CDS Contábil')}</p><p>Situação ${liveDot} ${esc(statusText)}</p><p>Servidor<br>${esc(mail.host||'-')}:${esc(mail.port||'')}</p><p>Usuário<br>${esc(mail.user||'-')}</p><p>Credencial<br>${mail.hasCredential?'Configurada':'Não configurada'}</p>${canEdit?`<div class="row-actions"><button type="button" class="btn secondary" id="emailVerify">Testar conexão</button><button type="button" class="btn secondary" id="emailTest">Enviar e-mail de teste</button><button type="button" class="btn" id="emailConfigure">Configurar e-mail</button></div>`:''}</div>`;
  const form=canEdit?`<div class="panel"><h3>Configurar remetente/SMTP</h3><p class="muted">Configure o endereço usado pelo CDS Contábil para enviar convites e notificações. No Gmail, use uma senha de app (16 letras), não a senha de login da conta.</p><form id="emailForm"><input type="hidden" name="provider" value="smtp"><div class="form-grid"><div class="field"><label>E-mail remetente</label><input name="from" type="email" required value="${esc(mail.from||'')}" placeholder="cdscontabil@gmail.com"></div><div class="field"><label>Nome do remetente</label><input name="fromName" value="${esc(mail.fromName||'CDS Contábil')}"></div><div class="field"><label>Servidor SMTP</label><input name="host" required value="${esc(mail.host||'')}" placeholder="smtp.gmail.com"></div><div class="field"><label>Porta</label><input name="port" required value="${esc(mail.port||587)}"></div><div class="field"><label>Usuário SMTP</label><input name="user" required value="${esc(mail.user||'')}"></div><div class="field"><label>Senha / credencial</label><input name="password" type="password" autocomplete="new-password" placeholder="${mail.hasCredential?'Credencial configurada':'Senha de app do Gmail'}"></div><div class="field"><label>SSL/TLS</label><select name="secure"><option value="0">STARTTLS (587)</option><option value="1" ${mail.secure?'selected':''}>SSL (465)</option></select></div></div><p class="muted">A credencial nunca é exibida. Deixe em branco para preservar a atual.</p><div class="row-actions" style="margin-top:12px"><button class="btn" type="submit">Salvar configuração</button><button type="button" class="btn secondary" id="emailVerifyForm">Testar conexão</button><button type="button" class="btn secondary" id="emailTestForm">Enviar e-mail de teste</button></div></form></div>`:'<div class="panel"><p class="muted">Somente o administrador ou o contador alteram o e-mail do sistema.</p></div>';
  const cdsBox=`<div class="panel" style="margin-bottom:14px"><h3>E-mail</h3><p><b>${liveDot} ${esc(headline)}</b></p><p>Forma de envio</p><label class="muted" style="display:block;margin:8px 0"><input type="radio" name="delivery" value="cds" ${smtpMode?'':'checked'} ${canEdit?'':'disabled'}> Envio pelo CDS</label><label class="muted" style="display:block;margin:8px 0"><input type="radio" name="delivery" value="smtp" ${smtpMode?'checked':''} ${canEdit?'':'disabled'}> Servidor próprio / SMTP</label><p class="muted">Os e-mails são enviados pela infraestrutura de comunicação do CDS. Não é necessário configurar SMTP.</p><p>${mail.cds_available?'● Disponível':'⚠ Aguardando configuração da infraestrutura de e-mail'}</p></div>`;
  const jobRows=emailJobs.map(j=>`<tr><td>${esc(j.created_at||'')}</td><td>E-mail</td><td>${esc(originLabel(j.event_type||j.template_key)||'-')}</td><td>${esc(j.destination||j.recipient_email||'-')}</td><td>${esc(originLabel((j.provider||'').toUpperCase())||'-')}</td><td>${esc(originLabel(j.status)||'-')}</td></tr>`).join('');
  const recent=`<div class="panel table-wrap"><h3>Últimos envios</h3><table class="table"><tr><th>Data</th><th>Canal</th><th>Evento</th><th>Destinatário</th><th>Provedor</th><th>Situação</th></tr>${jobRows}</table>${emailJobs.length?'':'<div class="empty">Nenhum envio.</div>'}</div>`;
  c.innerHTML=head('Comunicações','E-mail do escritório para convites e notificações.',cdsStackBackHtml(),'comunicacoes')+tabs+cdsBox+(editing?form:(smtpMode&&mail.configured?summary:empty))+recent;
  bindTabs();
  cdsBindBack('cdsBack',{fallbackPage:'configuracoes'});
  const payloadFromForm=()=>{
    const fd=new FormData($('#emailForm'));
    const body={provider:fd.get('provider')||'smtp',host:fd.get('host'),port:Number(fd.get('port')||587),user:fd.get('user'),from:fd.get('from'),fromName:fd.get('fromName'),secure:fd.get('secure')==='1'};
    const pw=String(fd.get('password')||'');
    if(pw)body.password=pw;
    return body;
  };
  const verify=async()=>{try{const r=await api('/configuracoes/comunicacoes/email/testar',{method:'POST',body:JSON.stringify($('#emailForm')?payloadFromForm():{})});toast(r.message||'Conexão com o servidor de e-mail realizada com sucesso.','success');emailSettingsPage(c,tabs,bindTabs)}catch(err){toast(err.message||'Não foi possível conectar ao servidor de e-mail. Verifique as configurações.')}};
  const sendTest=()=>{
    if(!mail.configured){toast('Salve a configuração de e-mail antes de enviar um teste.');return}
    modal(`${modalHead('Enviar e-mail de teste','Informe o destinatário. O envio usa o canal de e-mail do escritório.')}<form id="emailTestFormModal"><div class="modal-body"><div class="field"><label>Destinatário</label><input name="to" type="email" required value="${esc(state.user.email||'')}"></div></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Enviar teste</button>')}</form>`,'sm');
    $('#emailTestFormModal').onsubmit=async e=>{e.preventDefault();try{const to=String(new FormData(e.target).get('to')||'').trim();const r=await api('/configuracoes/comunicacoes/email/teste',{method:'POST',body:JSON.stringify({to})});closeModal();toast(r.message||'E-mail de teste enviado com sucesso.','success')}catch(err){toast(err.message||'Não foi possível enviar o e-mail de teste. Verifique a configuração de envio.','error')}};
  };
  $('#emailConfigure')&&($('#emailConfigure').onclick=()=>{state.emailEditing=true;emailSettingsPage(c,tabs,bindTabs)});
  $('#emailForm')&&($('#emailForm').onsubmit=async e=>{e.preventDefault();try{await api('/configuracoes/comunicacoes/email',{method:'PUT',body:JSON.stringify(payloadFromForm())});toast('Configuração salva.','success');state.emailEditing=false;emailSettingsPage(c,tabs,bindTabs)}catch(err){toast(err.message)}});
  $('#emailVerify')&&($('#emailVerify').onclick=verify);
  $('#emailVerifyForm')&&($('#emailVerifyForm').onclick=verify);
  $('#emailTest')&&($('#emailTest').onclick=sendTest);
  $('#emailTestForm')&&($('#emailTestForm').onclick=sendTest);
  document.querySelectorAll('input[name="delivery"]').forEach(r=>{r.onchange=async()=>{if(!canEdit)return;try{if(r.value==='cds'){await api('/configuracoes/comunicacoes/email',{method:'PUT',body:JSON.stringify({provider:'cds'})});state.emailEditing=false}else state.emailEditing=true;emailSettingsPage(c,tabs,bindTabs)}catch(err){toast(err.message)}}});
}
async function processesPage(c){
  if(state.processView)return processDetailPage(c,state.processView);
  const q=state.processSearch||'',page=state.listPage?.processos||1;
  const companyQ=state.selectedCompany?('&company_id='+encodeURIComponent(state.selectedCompany.id)):'';
  const filter=state.processOccurrenceFilter||{};
  const occurrenceQ=(filter.status?'&status='+encodeURIComponent(filter.status):'')+(filter.deadline?'&deadline_status='+encodeURIComponent(filter.deadline):'');
  const [data,occ,dash]=await Promise.all([
    api('/processos?page='+page+'&page_size=25'+(q?'&q='+encodeURIComponent(q):'')+companyQ),
    api('/processo-ocorrencias?page=1&page_size=25'+companyQ+occurrenceQ).catch(()=>({items:[]})),
    api('/processos/dashboard?x=1'+companyQ).catch(()=>({pendentes:0,em_andamento:0,vencendo:0,atrasadas:0,concluidas:0}))
  ]);
  const list=listItems(data),occList=listItems(occ);
  const cards=[
    ['PENDENTE','Pendentes',dash.pendentes||0,'status','PENDENTE'],
    ['EM_ANDAMENTO','Em andamento',dash.em_andamento||0,'status','EM_ANDAMENTO'],
    ['VENCENDO','Vencendo',dash.vencendo||0,'deadline','VENCENDO'],
    ['ATRASADA','Atrasadas',dash.atrasadas||0,'deadline','ATRASADA'],
    ['CONCLUIDA','Concluídas',dash.concluidas||0,'status','CONCLUIDA']
  ];
  c.innerHTML=head('Processos','Execute ocorrências, acompanhe prazos e veja a próxima ação.','<button class="btn secondary" id="newOcc">+ Nova ocorrência</button><button class="btn" id="new">+ Novo processo</button>')+
  `<div class="grid cards" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">${cards.map(([key,label,value,type,val])=>`<button type="button" class="card kpi-card" data-process-filter="${key}" data-filter-type="${type}" data-filter-value="${val}" style="text-align:left;cursor:pointer;border:${(filter.status===val||filter.deadline===val)?'2px solid var(--primary)':'1px solid var(--line)'}"><div class="label">${label}</div><div class="value">${value}</div></button>`).join('')}</div>`+
  `<div class="panel" style="margin-bottom:14px"><input id="processSearch" placeholder="Buscar processo, setor ou empresa..." value="${esc(q)}" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px"></div>
  <div class="panel table-wrap"><table class="table"><thead><tr><th>Processo</th><th>Situação</th><th>Recorrência</th><th>Próxima</th><th>Empresa</th><th>Etapas</th><th></th></tr></thead><tbody>${list.map(x=>`<tr><td><b>${esc(x.name)}</b><div class="muted">${esc(x.responsible_name||'-')}</div></td><td>${processStatusBadge(x.status)}</td><td>${x.recurrence?`Mensal · ${x.recurrence.active?'Ativa':'Inativa'}`:'Não'}</td><td>${x.recurrence?processCompetenceLabel(x.recurrence.next_competence):'—'}</td><td>${esc(x.company_trade_name||x.company_name||'-')}</td><td>${x.step_count||0} etapas</td><td><button class="btn secondary" data-open="${esc(x.id)}">Abrir</button></td></tr>`).join('')||`<tr><td colspan="7">${emptyState('Nenhum processo','Cadastre o primeiro processo do escritório.')}</td></tr>`}</tbody></table></div>${pagerHtml(data,'processos')}
  <div class="panel table-wrap" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 0"><h3 style="margin:0">Ocorrências ${filter.status||filter.deadline?'filtradas':''}</h3>${filter.status||filter.deadline?'<button class="btn secondary" id="clearProcessFilter">Limpar filtro</button>':''}</div><table class="table"><thead><tr><th>Ocorrência</th><th>Competência</th><th>Situação</th><th>Progresso</th><th></th></tr></thead><tbody>${occList.map(x=>`<tr><td><b>${esc(x.title)}</b><div class="muted">${esc(x.company_trade_name||x.company_name||'')}</div></td><td>${esc(x.competence)}</td><td>${occurrenceStatusBadge(x.status)}${x.has_overdue?' <span class="badge rejected">ATRASADA</span>':(!x.has_overdue&&x.has_due_soon?' <span class="badge pending">VENCENDO</span>':'')}</td><td>${x.completed_required_steps||0}/${x.required_steps||0} · ${x.progress_percent||0}%</td><td><button class="btn" data-occ="${esc(x.id)}">Executar</button></td></tr>`).join('')||`<tr><td colspan="5">${emptyState('Nenhuma ocorrência','Não há ocorrências para este filtro.')}</td></tr>`}</tbody></table></div>`;
  bindPager('processos',dir=>{state.listPage={...(state.listPage||{}),processos:Math.max(1,page+dir)};processesPage(c)});
  $('#processSearch').oninput=debounce(()=>{state.processSearch=$('#processSearch').value.trim();processesPage(c)},350);
  $('#new').onclick=()=>processFormModal();
  $('#newOcc').onclick=()=>occurrenceFormModal(list);
  $('#clearProcessFilter')&&($('#clearProcessFilter').onclick=()=>{state.processOccurrenceFilter={};processesPage(c)});
  c.querySelectorAll('[data-process-filter]').forEach(b=>b.onclick=()=>{const type=b.dataset.filterType,value=b.dataset.filterValue;state.processOccurrenceFilter=type==='status'?{status:value}:{deadline:value};processesPage(c)});
  c.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{cdsRemember({fallbackPage:'processos',label:'Processos',kind:'processView'});state.processView=b.dataset.open;processesPage(c)});
  c.querySelectorAll('[data-occ]').forEach(b=>b.onclick=()=>occurrenceViewModal(b.dataset.occ));
}
function processCompetenceLabel(value){const p=String(value||'').split('-');return p.length===2?p[1]+'/'+p[0]:'—'}
async function processDetailPage(c,processId){
  const p=await api('/processos/'+processId);
  const team=await api('/usuarios?page=1&page_size=100').catch(()=>({items:[]}));
  const users=(team.items||[]).filter(u=>['OWNER','ACCOUNTANT','STAFF'].includes(u.role)&&u.active!==0);
  const steps=p.steps||[],rec=p.recurrence;
  const now=new Date(),defaultCompetence=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  c.innerHTML=head(esc(p.name),'Empresa: '+esc(p.company_trade_name||p.company_name||'-')+' · Responsável: '+esc(p.responsible_name||'-'),cdsBackBtn('cdsBack')+'<button class="btn secondary" id="toggleStatus">'+(p.status==='ATIVO'?'Desativar':'Ativar')+'</button><button class="btn" id="saveMeta">Salvar processo</button>')+
  `<div class="panel" style="margin-bottom:14px"><div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:12px"><div class="field"><label>Nome</label><input id="procName" value="${esc(p.name)}"></div><div class="field"><label>Setor</label><input id="procSector" value="${esc(p.sector||'')}"></div><div class="field"><label>Situação</label><div>${processStatusBadge(p.status)}</div></div></div><div class="field"><label>Descrição</label><textarea id="procDesc" rows="2">${esc(p.description||'')}</textarea></div><div class="field"><label>Responsável principal</label><select id="procResp"><option value="">—</option>${users.map(u=>`<option value="${esc(u.id)}" ${u.id===p.responsible_user_id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></div></div>
  <div class="panel" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">Recorrência</h3><p class="muted" style="margin:4px 0">Geração mensal de ocorrências independentes.</p></div>${rec?`<span class="badge ${rec.active?'approved':'pending'}">${rec.active?'ATIVA':'INATIVA'}</span>`:'<span class="badge pending">NÃO RECORRENTE</span>'}</div><div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:12px"><div class="field"><label>Periodicidade</label><select id="recFrequency"><option value="MENSAL">Mensal</option></select></div><div class="field"><label>Competência inicial</label><input id="recStart" type="month" value="${rec?rec.start_year+'-'+String(rec.start_month).padStart(2,'0'):defaultCompetence}"></div><div class="field"><label>Dia de geração</label><input id="recDay" type="number" min="1" max="31" value="${rec?.generation_day||1}"></div></div><label class="field" style="display:flex;align-items:center;gap:8px"><input id="recActive" type="checkbox" ${!rec||rec.active?'checked':''}> Recorrência ativa</label><div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin:10px 0"><div><small class="muted">Última geração</small><b style="display:block">${rec&&rec.last_competence?processCompetenceLabel(rec.last_competence):'—'}</b></div><div><small class="muted">Próxima competência</small><b style="display:block">${rec&&rec.next_competence?processCompetenceLabel(rec.next_competence):'—'}</b></div></div><div class="row-actions"><button class="btn" id="saveRecurrence">${rec?'Salvar recorrência':'Configurar recorrência'}</button>${rec?`<button class="btn secondary" id="toggleRecurrence">${rec.active?'Desativar':'Ativar'}</button><button class="btn secondary" id="generateNow">Gerar agora</button>`:''}</div></div>
  <div class="panel table-wrap"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 0"><h3 style="margin:0">Etapas</h3><button class="btn" id="addStep">+ Adicionar etapa</button></div><table class="table"><thead><tr><th>#</th><th>Etapa</th><th>Responsável</th><th>Prazo</th><th></th></tr></thead><tbody>${steps.map(s=>`<tr><td>${s.step_order}</td><td><b>${esc(s.name)}</b>${Number(s.required)?'':' <span class="muted">(opcional)</span>'}</td><td>${esc(s.responsible_name||'-')}</td><td>${dueLabel(s.due_offset_days)}</td><td><div class="row-actions"><button class="btn secondary" data-edit-step="${esc(s.id)}">Editar</button><button class="btn secondary" data-del-step="${esc(s.id)}">Remover</button></div></td></tr>`).join('')||`<tr><td colspan="5">${emptyState('Sem etapas','Adicione a primeira etapa deste processo.')}</td></tr>`}</tbody></table></div>`;
  $('#cdsBack').onclick=()=>cdsGoBack({fallbackPage:'processos',clear(){state.processView=null},after(){processesPage(c)}});
  $('#saveMeta').onclick=async()=>{try{await api('/processos/'+processId,{method:'PATCH',body:JSON.stringify({name:$('#procName').value,sector:$('#procSector').value,description:$('#procDesc').value,responsible_user_id:$('#procResp').value||null})});toast('Processo salvo.','success');processDetailPage(c,processId)}catch(err){toast(err.message)}};
  $('#toggleStatus').onclick=async()=>{try{await api('/processos/'+processId+(p.status==='ATIVO'?'/desativar':'/ativar'),{method:'POST',body:'{}'});toast(p.status==='ATIVO'?'Processo desativado.':'Processo ativado.','success');processDetailPage(c,processId)}catch(err){toast(err.message)}};
  $('#saveRecurrence').onclick=async()=>{try{await api('/processos/'+processId+'/recorrencia',{method:'PUT',body:JSON.stringify({frequency:'MENSAL',start_competence:$('#recStart').value,generation_day:Number($('#recDay').value),active:$('#recActive').checked})});toast('Recorrência salva.','success');processDetailPage(c,processId)}catch(err){toast(err.message)}};
  $('#toggleRecurrence')&&($('#toggleRecurrence').onclick=async()=>{try{await api('/processos/'+processId+'/recorrencia/'+(rec.active?'desativar':'ativar'),{method:'POST',body:'{}'});toast(rec.active?'Recorrência desativada.':'Recorrência ativada.','success');processDetailPage(c,processId)}catch(err){toast(err.message)}});
  $('#generateNow')&&($('#generateNow').onclick=async()=>{try{const result=await api('/processos/'+processId+'/recorrencia/gerar-agora',{method:'POST',body:JSON.stringify({competence:rec.next_competence})});toast(result.message,result.created?'success':'warning');processDetailPage(c,processId)}catch(err){toast(err.message)}});
  $('#addStep').onclick=()=>stepFormModal(processId,null,users,()=>processDetailPage(c,processId));
  c.querySelectorAll('[data-edit-step]').forEach(b=>b.onclick=()=>stepFormModal(processId,steps.find(x=>x.id===b.dataset.editStep),users,()=>processDetailPage(c,processId)));
  c.querySelectorAll('[data-del-step]').forEach(b=>b.onclick=async()=>{if(!confirm('Remover esta etapa do modelo? Ocorrências já criadas não serão alteradas.'))return;try{await api('/processos/'+processId+'/etapas/'+b.dataset.delStep,{method:'DELETE'});toast('Etapa removida.');processDetailPage(c,processId)}catch(err){toast(err.message)}});
}
function processExecutionDate(v){if(!v)return '-';const s=String(v).slice(0,10),p=s.split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:s}
function processDeadlineBadge(s){return({ATRASADA:'<span class="badge rejected">ATRASADA</span>',VENCENDO:'<span class="badge pending">VENCENDO</span>',CONCLUIDA:'<span class="badge approved">CONCLUÍDA</span>',CANCELADA:'<span class="badge rejected">CANCELADA</span>',NO_PRAZO:'<span class="badge approved">NO PRAZO</span>'}[s]||'')}
async function occurrenceViewModal(id){
  try{
    const o=await api('/processo-ocorrencias/'+id),steps=o.steps||[],next=o.next_step;
    const action=o.status==='PENDENTE'?'<button type="button" class="btn" id="startOccurrence">Iniciar ocorrência</button>':o.status==='CONCLUIDA'?'<button type="button" class="btn" id="reopenOccurrence">Reabrir ocorrência</button>':'';
    const progress=Math.max(0,Math.min(100,Number(o.progress_percent||0)));
    modal(`${modalHead(esc(o.title),'Empresa: '+esc(o.company_trade_name||o.company_name||'')+' · Responsável: '+esc(o.responsible_name||'-'))}
      <div class="modal-body">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div>${occurrenceStatusBadge(o.status)}<div class="muted" style="margin-top:5px">Última atividade: ${esc(timeAgo(o.last_activity_at))}</div></div>${action}</div>
        <div class="panel" style="margin:14px 0"><b>PROGRESSO — ${o.completed_required_steps||0} de ${o.required_steps||0} etapas obrigatórias</b><div style="height:12px;background:var(--line);border-radius:8px;overflow:hidden;margin-top:8px"><div style="height:100%;width:${progress}%;background:var(--primary)"></div></div><div class="muted" style="margin-top:5px">${progress}% concluído</div></div>
        ${next?`<div class="panel" style="border-left:4px solid var(--primary);margin-bottom:14px"><small class="muted">PRÓXIMA AÇÃO</small><h3 style="margin:5px 0">→ ${esc(next.name)}</h3><span>${esc(next.responsible_name||'Sem responsável')} · Prazo ${processExecutionDate(next.due_date)}</span></div>`:''}
        <div class="panel" style="padding:0"><div style="padding:14px 16px"><h3 style="margin:0">Checklist da ocorrência</h3></div>${steps.map(s=>{const mark=s.status==='CONCLUIDA'?'✓':s.status==='EM_ANDAMENTO'?'→':s.status==='BLOQUEADA'?'🔒':'☐';const buttons=s.status==='PENDENTE'?`<button class="btn" data-step-start="${s.id}">Iniciar</button>`:s.status==='EM_ANDAMENTO'?`<button class="btn" data-step-complete="${s.id}">Concluir</button>`:s.status==='CONCLUIDA'&&o.status==='EM_ANDAMENTO'?`<button class="btn secondary" data-step-reopen="${s.id}">Reabrir</button>`:'';return `<div style="padding:14px 16px;border-top:1px solid var(--line)"><div style="display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:start"><b style="font-size:20px">${mark}</b><div><b>${s.step_order}. ${esc(s.name)}</b>${Number(s.required)?'':' <span class="muted">(opcional)</span>'}<div class="muted">Responsável: ${esc(s.responsible_name||'-')} · Prazo: ${processExecutionDate(s.due_date)} · ${processDeadlineBadge(s.deadline_status)}</div>${s.started_at?`<small>Iniciada em ${formatDate(s.started_at)} por ${esc(s.started_by_name||'-')}</small>`:''}${s.completed_at?`<small style="display:block">Concluída em ${formatDate(s.completed_at)} por ${esc(s.completed_by_name||'-')}</small>`:''}<div class="field" style="margin:8px 0 0"><input data-step-observation="${s.id}" value="${esc(s.observation||'')}" placeholder="Observação da etapa"><button type="button" class="btn secondary" data-save-observation="${s.id}" style="margin-top:5px">Salvar observação</button></div></div><div class="row-actions">${buttons}</div></div></div>`}).join('')||'<div style="padding:16px">Sem etapas.</div>'}</div>
      </div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Fechar</button>')}`,'lg');
    const reload=()=>{closeModal();occurrenceViewModal(id)};
    $('#startOccurrence')&&($('#startOccurrence').onclick=async()=>{try{await api('/processo-ocorrencias/'+id+'/start',{method:'POST',body:'{}'});toast('Ocorrência iniciada.','success');reload()}catch(e){toast(e.message)}});
    $('#reopenOccurrence')&&($('#reopenOccurrence').onclick=async()=>{if(!confirm('Reabrir esta ocorrência? A ação ficará registrada na auditoria.'))return;try{await api('/processo-ocorrencias/'+id+'/reopen',{method:'POST',body:'{}'});toast('Ocorrência reaberta.','success');reload()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-step-start]').forEach(b=>b.onclick=async()=>{try{await api('/processo-ocorrencias/'+id+'/steps/'+b.dataset.stepStart+'/start',{method:'POST',body:'{}'});toast('Etapa iniciada.','success');reload()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-step-complete]').forEach(b=>b.onclick=async()=>{try{await api('/processo-ocorrencias/'+id+'/steps/'+b.dataset.stepComplete+'/complete',{method:'POST',body:'{}'});toast('Etapa concluída.','success');reload()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-step-reopen]').forEach(b=>b.onclick=async()=>{if(!confirm('Reabrir esta etapa?'))return;try{await api('/processo-ocorrencias/'+id+'/steps/'+b.dataset.stepReopen+'/reopen',{method:'POST',body:JSON.stringify({status:'PENDENTE'})});toast('Etapa reaberta.','success');reload()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-save-observation]').forEach(b=>b.onclick=async()=>{const input=document.querySelector('[data-step-observation="'+b.dataset.saveObservation+'"]');try{await api('/processo-ocorrencias/'+id+'/steps/'+b.dataset.saveObservation,{method:'PATCH',body:JSON.stringify({observation:input.value})});toast('Observação salva.','success')}catch(e){toast(e.message)}});
  }catch(err){toast(err.message)}
}
async function aiSettingsPage(c){
  const canAdmin=['OWNER','ACCOUNTANT'].includes(state.user.role);
  let summary,cred;
  try{
    summary=await api('/ai/usage/summary');
    cred=await api('/ai/credentials').catch(()=>({}));
  }catch(err){c.innerHTML=head('Inteligência Artificial','Controle de uso da IA por escritório.','','ia')+`<div class="panel">${emptyState('Não foi possível carregar',esc(err.message))}</div>`;return}
  const s=summary.settings||{};
  const u=summary.usage||{};
  const clients=summary.by_client||[];
  const ops=summary.by_operation||[];
  const moneyUsd=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'USD'});
  const statusDot=s.enabled?'● Ativa':'○ Desativada';
  const credOk=!!(cred.credential_configured||s.credential_configured);
  const credSrc=cred.credential_source_label||s.credential_source_label||(credOk?'Credencial configurada':'A Inteligência Artificial ainda não está configurada.');
  const lastTest=cred.last_tested_at||s.last_tested_at;
  const lastTestStatus=cred.last_test_status||s.last_test_status;
  const lastTestLabel=lastTest
    ? `${lastTestStatus==='success'?'Conectado':'Falha'} · ${formatDate(lastTest)}`
    : 'Ainda não testada';
  const openCredModal=(mode)=>{
    modal(`<form id="aiCredForm">${modalHead(mode==='rotate'?'Alterar chave da OpenAI':'Configurar chave da OpenAI','A chave nunca é exibida novamente após o cadastro.')}<div class="modal-body"><div class="field"><label>API Key</label><input name="api_key" type="password" autocomplete="new-password" required placeholder="Cole a chave da OpenAI"></div><p class="muted">A conexão será testada antes de salvar. Se o teste falhar, a chave atual permanece inalterada.</p></div>${modalFoot('<button type="button" class="btn secondary" onclick="closeModal()">Cancelar</button><button class="btn" type="submit">Testar e salvar</button>')}</form>`,'md');
    $('#aiCredForm').onsubmit=async e=>{
      e.preventDefault();
      const api_key=String(new FormData(e.target).get('api_key')||'').trim();
      if(!api_key){toast('Informe a chave da API.');return}
      try{
        await api('/ai/credentials',{method:'PUT',body:JSON.stringify({api_key})});
        closeModal();
        toast('Credencial configurada com sucesso.','success');
        aiSettingsPage(c);
      }catch(err){toast(err.message||'Não foi possível validar a credencial. Verifique a chave e tente novamente.','error')}
    };
  };
  c.innerHTML=head('Inteligência Artificial','A IA é opcional. O CDS continua funcionando com os motores internos.',cdsStackBackHtml(),'ia')+
    (s.warning_message?`<div class="panel" style="border-left:4px solid var(--color-warning);margin-bottom:14px"><b>Aviso</b><p>${esc(s.warning_message)}</p></div>`:'')+
    `<div class="panel" style="margin-bottom:14px">
      <h3>Provedor e credencial</h3>
      <div class="form-grid">
        <div class="field"><label>Provedor</label><input value="OpenAI" disabled></div>
        <div class="field"><label>Modelo</label><input value="${esc(s.model_display||'GPT-5.6 Terra')}" disabled></div>
      </div>
      <p><b>Status</b><br>${credOk?'● Configurada':'○ Não configurada'}</p>
      <p><b>Credencial</b><br>${credOk?'••••••••••••':'—'} <span class="muted">${esc(credSrc)}</span></p>
      <p class="muted">Último teste: ${esc(lastTestLabel)}</p>
      ${canAdmin?`<div class="row-actions" style="margin-top:12px">
        <button type="button" class="btn secondary" id="aiCredTest">Testar conexão</button>
        <button type="button" class="btn" id="aiCredSet">${credOk?'Alterar chave':'Configurar chave'}</button>
        ${cred&&cred.credential_source==='vault'?`<button type="button" class="btn secondary" id="aiCredRemove">Remover credencial</button>`:''}
      </div>`:'<p class="muted">Somente administrador ou contador gerenciam a credencial do provedor.</p>'}
      <p class="muted" style="margin-top:10px">Sem credencial, a Nova Despesa e a Inteligência Documental seguem em modo manual.</p>
    </div>
    <div class="grid" style="grid-template-columns:1.1fr 1fr;gap:14px">
      <div class="panel">
        <h3>Configurações Avançadas</h3>
        <p><b>Status</b><br>${esc(statusDot)}</p>
        <p><b>Modelo</b><br>${esc(s.model_display||'GPT-5.6 Terra')}</p>
        <form id="aiSettingsForm">
          <label class="muted" style="display:flex;gap:8px;align-items:center;margin:14px 0">
            <input type="checkbox" name="enabled" ${s.enabled?'checked':''} ${canAdmin?'':'disabled'}>
            Utilizar Inteligência Artificial
          </label>
          <div class="field"><label>Limite mensal (US$)</label>
            <input name="monthly_limit_usd" type="number" min="0" step="0.01" placeholder="Ex.: 50,00"
              value="${s.monthly_limit_usd==null?'':esc(s.monthly_limit_usd)}" ${canAdmin?'':'disabled'}>
            <small class="muted">Deixe em branco para não limitar. Ao atingir 100%, a IA é bloqueada e o CDS segue com os motores internos.</small>
          </div>
          <div class="field"><label>Autonomia operacional</label>
            <select name="autonomy_mode" ${canAdmin?'':'disabled'}>
              <option value="ASSISTED_50" ${(s.autonomy_mode||'ASSISTED_50')==='ASSISTED_50'?'selected':''}>50% — Assistida</option>
              <option value="AUTONOMOUS_98" ${s.autonomy_mode==='AUTONOMOUS_98'?'selected':''}>98% — Autônoma</option>
            </select>
            <small class="muted">50%: prepara o lançamento e entrega para aprovação. 98%: tenta resolver exceções antes de entregar. Em ambos, só o contador aprova.</small>
          </div>
          ${canAdmin?'<button class="btn" type="submit">Salvar configuração</button>':'<p class="muted">Somente administrador ou contador alteram esta configuração.</p>'}
        </form>
      </div>
      <div class="panel">
        <h3>Consumo do mês</h3>
        <div class="grid cards" style="grid-template-columns:1fr 1fr">
          <div class="card kpi-card"><div class="label">Custo estimado</div><div class="value" style="font-size:1.3rem">${moneyUsd(u.cost_usd)}</div></div>
          <div class="card kpi-card"><div class="label">Chamadas à IA</div><div class="value" style="font-size:1.3rem">${u.calls||0}</div></div>
          <div class="card kpi-card"><div class="label">Documentos analisados</div><div class="value" style="font-size:1.3rem">${u.documents||0}</div></div>
          <div class="card kpi-card"><div class="label">Tokens utilizados</div><div class="value" style="font-size:1.3rem">${Number(u.tokens||0).toLocaleString('pt-BR')}</div></div>
        </div>
        ${s.monthly_limit_cents?`<p class="muted" style="margin-top:12px">${s.usage&&s.usage.percent_used||0}% do limite mensal (${moneyUsd(s.monthly_limit_usd)}).</p>`:''}
      </div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
      <div class="panel table-wrap"><h3>Consumo por cliente</h3>
        <table class="table"><thead><tr><th>Cliente</th><th>Documentos</th><th>Chamadas</th><th>Custo estimado</th></tr></thead>
        <tbody>${clients.map(x=>`<tr><td>${esc(x.company_name)}</td><td>${x.documents}</td><td>${x.calls}</td><td>${moneyUsd(x.cost_usd)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Nenhum consumo no período.</td></tr>'}</tbody></table>
      </div>
      <div class="panel table-wrap"><h3>Consumo por operação</h3>
        <table class="table"><thead><tr><th>Operação</th><th>Chamadas</th><th>Tokens</th><th>Custo estimado</th></tr></thead>
        <tbody>${ops.map(x=>`<tr><td>${esc(x.label||x.operation_type)}</td><td>${x.calls}</td><td>${Number(x.tokens||0).toLocaleString('pt-BR')}</td><td>${moneyUsd(x.cost_usd)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Nenhuma chamada no período.</td></tr>'}</tbody></table>
      </div>
    </div>`;
  $('#aiCredTest')&&($('#aiCredTest').onclick=async()=>{
    try{
      const r=await api('/ai/credentials/test',{method:'POST',body:'{}'});
      toast(r.message||'Conexão com a OpenAI estabelecida.','success');
      aiSettingsPage(c);
    }catch(err){toast(err.message||'Não foi possível validar a credencial. Verifique a chave e tente novamente.','error')}
  });
  $('#aiCredSet')&&($('#aiCredSet').onclick=()=>openCredModal(credOk?'rotate':'create'));
  $('#aiCredRemove')&&($('#aiCredRemove').onclick=async()=>{
    if(!confirm('Remover a credencial do cofre? O sistema voltará a usar a chave do ambiente, se existir.'))return;
    try{
      await api('/ai/credentials',{method:'DELETE'});
      toast('Credencial removida do cofre.','success');
      aiSettingsPage(c);
    }catch(err){toast(err.message,'error')}
  });
  $('#aiSettingsForm')&&($('#aiSettingsForm').onsubmit=async e=>{
    e.preventDefault();
    if(!canAdmin)return;
    const fd=new FormData(e.target);
    const raw=String(fd.get('monthly_limit_usd')||'').trim();
    const body={enabled:!!e.target.enabled.checked};
    body.monthly_limit_usd=raw===''?null:raw;
    body.autonomy_mode=String(fd.get('autonomy_mode')||'ASSISTED_50');
    try{
      await api('/ai/settings',{method:'PATCH',body:JSON.stringify(body)});
      toast('Configuração de IA atualizada.','success');
      aiSettingsPage(c);
    }catch(err){toast(err.message,'error')}
  });
  cdsBindBack('cdsBack',{fallbackPage:'configuracoes'});
}
async function auditPage(c){const list=await api('/auditoria');c.innerHTML=head('Auditoria','Registro de operações sensíveis da plataforma.',cdsStackBackHtml(),'auditoria')+`<div class="panel table-wrap"><table class="table"><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>ID</th></tr>${list.map(x=>`<tr><td>${x.created_at}</td><td>${esc(x.user_name||'-')}</td><td>${x.action}</td><td>${x.entity_type}</td><td>${esc(x.entity_id||'-')}</td></tr>`).join('')}</table></div>`;cdsBindBack('cdsBack',{fallbackPage:'configuracoes'})}
function modal(html,size='md'){document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="modal" role="dialog" aria-modal="true"><div class="modal modal-${size}">${html}</div></div>`)}function modalHead(t,d='',helpKey){return `<div class="modal-head"><div><h2>${t}${helpKey?helpCircle(helpKey):''}</h2>${d?`<p class="modal-desc">${d}</p>`:''}</div><button type="button" class="btn secondary" onclick="closeModal()" aria-label="Fechar">Fechar ×</button></div>`}function modalFoot(inner){return `<div class="modal-foot">${inner}</div>`}function bindMoreMenus(scope){
  if(window.CdsOverlayMenu)window.CdsOverlayMenu.bindKebabs(scope||document);
  else{
    const hideAll=()=>document.querySelectorAll('.more-menu').forEach(m=>{m.hidden=true;m.classList.remove('overlay-menu-open');m.style.top='';m.style.left='';m.style.right=''});
    (scope||document).querySelectorAll('.more-btn').forEach(btn=>{btn.onclick=e=>{e.stopPropagation();const menu=btn.parentElement.querySelector('.more-menu');const willOpen=menu.hidden;hideAll();if(!willOpen)return;menu.hidden=false;menu.classList.add('overlay-menu-open');const r=btn.getBoundingClientRect();const mw=Math.max(180,menu.offsetWidth||180);const mh=menu.offsetHeight||160;let left=r.right-mw;if(left<8)left=8;if(left+mw>window.innerWidth-8)left=Math.max(8,window.innerWidth-mw-8);let top=r.bottom+6;if(top+mh>window.innerHeight-8)top=Math.max(8,r.top-mh-6);menu.style.top=top+'px';menu.style.left=left+'px';menu.style.right='auto'}});
    if(!window.__cdsMoreBound){window.__cdsMoreBound=true;document.addEventListener('click',hideAll);window.addEventListener('scroll',hideAll,true);window.addEventListener('resize',hideAll)}
  }
}window.closeModal=()=>{revokeEntryDocPreview();$('#modal')?.remove()};if(!window.__cdsEscModal){window.__cdsEscModal=true;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#modal'))closeModal()})}window.addEventListener('popstate',()=>{if(state.token)render()});
if(!window.__cdsPushMsgBound){
  window.__cdsPushMsgBound=true;
  if(navigator.serviceWorker){
    navigator.serviceWorker.addEventListener('message',ev=>{
      const d=ev&&ev.data;
      if(!d||d.type!=='CDS_PUSH_OPEN')return;
      if(d.company_id&&d.request_id)openRequestConversation(d.company_id,d.request_id);
      else if(d.company_id&&d.page)enterCompany(d.company_id,d.page);
      else if(d.company_id)enterCompany(d.company_id,d.page||'dashboard');
      else if(d.url)location.href=d.url;
    });
  }
  window.__cdsLastNotifIds=window.__cdsLastNotifIds||new Set();
  let officeNotifBootstrapped=false;
  async function bootstrapOfficeNotifSeen(){
    if(officeNotifBootstrapped||!state.token)return;
    officeNotifBootstrapped=true;
    try{
      const data=await api('/notificacoes?page=1&page_size=25');
      for(const n of (data.items||[])){if(n&&n.id)window.__cdsLastNotifIds.add(n.id)}
    }catch{}
  }
  function handleOfficeNotification(n){
    if(!n||!n.id||window.__cdsLastNotifIds.has(n.id))return;
    window.__cdsLastNotifIds.add(n.id);
    if(n.type==='REQUEST_MESSAGE_CREATED'||n.type==='REQUEST_UPDATED'||n.type==='REQUEST_CREATED'||n.type==='REQUEST_MESSAGE'){
      if(state.requestView&&n.entity_id===state.requestView){
        if(n.company_id)openRequestConversation(n.company_id,n.entity_id);
        return;
      }
      showRequestAlert({
        company_id:n.company_id,
        request_id:n.entity_id,
        company_name:n.company_name||'',
        title:n.context||n.title,
        preview:n.message
      });
      refreshNotifBadge();
      loadSidebarCounters().catch(()=>{});
      scheduleDashRefresh();
      return;
    }
    const page=notifActionPage(n);
    showCenterAlert({
      type:n.type,
      entity_id:n.entity_id,
      headline:n.title||'Atualização',
      company_name:n.company_name||'',
      description:n.message||'',
      preview:n.context||n.preview||'',
      actionLabel:'Abrir',
      onOpen:()=>{
        if(n.occurrence_id){openNotification(n.id);return}
        if(n.company_id)enterCompany(n.company_id,page);
        else{state.page=page;render()}
      }
    });
    refreshNotifBadge();
    const t=n.type||n.event_type||'';
    if(/DOCUMENT|EXPENSE|REVENUE|CLASSIFICATION|IMPORT|REQUEST|PENDENCY|PROCESS|ENTRY/.test(t))scheduleDashRefresh();
  }
  function startOfficeRealtime(){
    if(window.__cdsOfficeEs||window.__cdsOfficeEsStarting)return;
    if(!state.token||!window.CdsRealtime||!state.user||state.user.role==='CLIENT')return;
    window.__cdsOfficeEsStarting=true;
    bootstrapOfficeNotifSeen().then(()=>{
      window.__cdsOfficeEs=CdsRealtime.connect(state.token,{
        onNotification:n=>handleOfficeNotification(n),
        onConnected:()=>scheduleDashRefresh()
      });
    }).finally(()=>{window.__cdsOfficeEsStarting=false});
  }
  window.__cdsStartOfficeRealtime=startOfficeRealtime;
  // Fallback poll (SSE cobre o tempo real)
  setInterval(async()=>{
    if(!state.token||!state.user||state.user.role==='CLIENT')return;
    try{
      const data=await api('/notificacoes?page=1&page_size=10');
      const items=data.items||[];
      for(const n of items){
        if(!n||n.read_at)continue;
        handleOfficeNotification(n);
      }
    }catch{}
  },15000);
}
if(window.CdsPush){CdsPush.ensureServiceWorker().catch(()=>{})}
render();
function settingsNavHtml(){
  const items=[['geral','Geral'],['identidade','Identidade'],['equipe','Equipe e acesso'],['notificacoes','Notificações'],['comunicacoes','Comunicações'],['ia','Inteligência Artificial'],['sistema','Sistema']];
  const cur=state.settingsSection||'geral';
  return `<nav class="settings-nav" aria-label="Seções de configurações"><label class="sr-only" for="settingsSectionSelect">Seção</label><select id="settingsSectionSelect" class="settings-nav-select">${items.map(([id,label])=>`<option value="${id}" ${cur===id?'selected':''}>${label}</option>`).join('')}</select><div class="settings-nav-list">${items.map(([id,label])=>`<button type="button" class="settings-nav-item ${cur===id?'active':''}" data-settings-section="${id}">${label}</button>`).join('')}</div></nav>`;
}
function goSettingsSection(id){state.settingsSection=id||'geral';settingsPage($('#content'))}
function openExistingPage(page,extra){cdsRemember({fallbackPage:'configuracoes',label:'Configurações',kind:'settings_hub'});if(page==='comunicacoes')state.commsTab=extra||'email';if(page==='comunicacoes'&&extra==='whatsapp')state.commsTab='whatsapp';state.emailEditing=false;state.selectedCompany=null;history.pushState({},'','/');state.page=page;render()}
async function settingsPage(c){
  const t=state.tenant||{};
  const b=state.branding||{};
  const canBrand=['OWNER','ACCOUNTANT'].includes(state.user.role);
  const logoOk=!!(b.configured||b.has_logo)&&!!state.brandingLogoSrc;
  const section=state.settingsSection||'geral';
  const sections={
    geral:`<div class="settings-block"><h3>Conta</h3><dl class="settings-dl"><div><dt>Nome</dt><dd>${esc(state.user.name)}</dd></div><div><dt>E-mail</dt><dd>${esc(state.user.email||'—')}</dd></div><div><dt>Perfil</dt><dd>${esc(roleLabel(state.user.role))}</dd></div><div><dt>Escritório</dt><dd>${esc(t.name||state.user.tenant_name||'—')}</dd></div></dl></div><div class="settings-block" id="officePinSettings"><h3>PIN de acesso</h3><p class="muted">Código de 4 dígitos para acesso rápido.</p><div id="officePinFormMount"></div><p style="margin-top:10px"><button type="button" class="btn secondary" id="officePinForgot">Esqueci meu PIN</button></p></div><div class="settings-block"><h3>Escritório</h3><form id="officeForm"><div class="field"><label for="officeName">Nome do escritório</label><input id="officeName" name="name" value="${esc(t.name||'')}" ${state.user.role==='OWNER'?'':'disabled'}></div><div class="field"><label for="officeCnpj">CNPJ</label><input id="officeCnpj" name="cnpj" value="${esc(t.cnpj||'')}" ${state.user.role==='OWNER'?'':'disabled'}></div><div class="field"><label class="check-row"><input type="checkbox" name="assign_staff_companies" ${Number(t.assign_staff_companies)?'checked':''} ${state.user.role==='OWNER'?'':'disabled'}><span>Contabilidade designa cliente para a equipe</span></label><p class="field-help">Desligado: toda a equipe vê todas as empresas. Ligado: empresa sem responsável continua visível a todos; empresa com responsável só aparece para esses funcionários, além do administrador e do contador.</p></div>${state.user.role==='OWNER'?'<button class="btn" type="submit">Salvar</button>':''}</form></div>`,
    identidade:`<div class="settings-block"><h3>Identidade do Escritório</h3><p class="muted">Configure como seu escritório será apresentado aos clientes.</p><div class="identity-preview identity-preview-card">${state.brandingLogoSrc?`<img src="${state.brandingLogoSrc}" alt="Logo do escritório">`:`<div class="office-mark">${esc((b.office_name||t.name||'E').slice(0,1).toUpperCase())}</div>`}<div><b>${esc(b.office_name||t.name||'Escritório')}</b><small>Identidade apresentada ao cliente</small><p class="muted">${logoOk?'✓ Logo configurada':'Nenhuma logo configurada'}</p><p class="login-cds-soft muted">CDS Contábil Connect</p></div></div><form id="brandForm"><div class="field"><label for="officeBrandName">Nome do escritório</label><input id="officeBrandName" name="office_name" value="${esc(b.office_name||t.name||'')}" ${canBrand?'':'disabled'}></div><div class="field"><label for="officeSlogan">Slogan</label><input id="officeSlogan" name="slogan" value="${esc(b.slogan||'')}" ${canBrand?'':'disabled'}></div>${canBrand?'<button class="btn" type="submit">Salvar</button>':''}</form><div class="logo-drop" id="logoDrop">${state.brandingLogoSrc?`<img src="${state.brandingLogoSrc}" alt="Pré-visualização da logo">`:'Logo do escritório'}<div class="muted">PNG, JPG ou WEBP · máx. 5 MB</div><input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="row-actions">${canBrand?`<button type="button" class="btn" id="pickLogo">${logoOk?'Alterar logo':'Enviar logo'}</button><button type="button" class="btn secondary" id="clearLogo" ${logoOk?'':'disabled'}>Remover logo</button>`:'<p class="muted">Somente o administrador ou o contador alteram a identidade.</p>'}</div></div>`,
    equipe:`<div class="settings-block"><h3>Equipe e acesso</h3><p class="muted">Gerencie usuários, perfis e permissões do escritório.</p><button type="button" class="btn" id="openTeam">Gerenciar equipe</button></div>`,
    notificacoes:`<div class="settings-block" id="notifSettingsBlock"><h3>Notificações</h3><p class="muted">Canal único do CDS Contábil Connect. Cada navegador precisa autorizar o Web Push separadamente.</p><p class="muted">Carregando preferências…</p></div>`,
    comunicacoes:`<div class="settings-block"><h3>Comunicações</h3><p class="muted">Configure os canais de comunicação utilizados pelo escritório.</p><div class="settings-cards"><article class="settings-link-card"><h4>E-mail</h4><p>Configuração de e-mail</p><button type="button" class="btn" id="openEmail">Configurar</button></article><article class="settings-link-card"><h4>WhatsApp</h4><p>Configuração de WhatsApp</p><button type="button" class="btn secondary" id="openWhatsapp">Configurar</button></article></div></div>`,
    ia:`<div class="settings-block" id="aiSettingsSummary"><h3>Inteligência Artificial</h3><p class="muted">Carregando resumo…</p></div>`,
    sistema:`<div class="settings-block"><h3>Sistema</h3><p class="muted">Acesso às funções administrativas já existentes.</p><div class="settings-cards"><article class="settings-link-card"><h4>Auditoria</h4><p>Registros de ações do escritório</p><button type="button" class="btn" id="openAudit">Abrir</button></article><article class="settings-link-card"><h4>Informações do sistema</h4><p id="sysHealthLine">Produto, versão e status</p><button type="button" class="btn secondary" id="openHealth">Abrir</button></article></div></div>`
  };
  c.innerHTML=head('Configurações','Administre as configurações do escritório e do sistema.','','configuracoes')+`<div class="settings-hub">${settingsNavHtml()}<div class="settings-main" id="settingsMain">${sections[section]||sections.geral}</div></div>`;
  const jump=id=>goSettingsSection(id);
  document.querySelectorAll('[data-settings-section]').forEach(btn=>btn.onclick=()=>jump(btn.dataset.settingsSection));
  const sel=$('#settingsSectionSelect');if(sel)sel.onchange=()=>jump(sel.value);
  if(section==='geral'&&window.CdsAccessPin){
    const mount=$('#officePinFormMount');
    if(mount){
      mount.innerHTML=CdsAccessPin.formHtml({mode:'change',title:'Alterar PIN',submitLabel:'Salvar novo PIN'});
      const step=mount.querySelector('.cds-pin-step');
      if(step){const h=step.querySelector('h1');if(h)h.remove();const p=step.querySelector('p');if(p)p.remove()}
      CdsAccessPin.bindForm(mount,{api,submitLabel:'Salvar novo PIN',onSuccess:()=>toast('PIN atualizado com sucesso.','success')});
    }
    $('#officePinForgot')&&($('#officePinForgot').onclick=async()=>{try{const r=await api('/auth/pin/reset-request',{method:'POST',body:'{}'});toast(r.message||'Use a recuperação de conta.','info')}catch(err){toast(err.message,'error')}});
  }
  $('#officeForm')&&($('#officeForm').onsubmit=async e=>{e.preventDefault();try{const fd=new FormData(e.target);const body={name:fd.get('name'),cnpj:fd.get('cnpj'),assign_staff_companies:!!e.target.assign_staff_companies.checked};state.tenant=await api('/tenant',{method:'PATCH',body:JSON.stringify(body)});toast('Escritório atualizado.','success');settingsPage(c)}catch(err){toast(err.message,'error')}});
  $('#brandForm')&&($('#brandForm').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.target));await applyBranding(await api('/tenant/branding',{method:'PATCH',body:JSON.stringify(body)}));toast('Identidade atualizada.','success');settingsPage(c)}catch(err){toast(err.message,'error')}});
  $('#pickLogo')&&($('#pickLogo').onclick=()=>$('#logoFile').click());
  $('#logoFile')&&($('#logoFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024){toast('Arquivo muito grande. O tamanho máximo permitido é 5 MB.','error');e.target.value='';return}const fd=new FormData();fd.append('file',file);try{const r=await fetch('/api/tenant/branding/logo',{method:'POST',headers:authHeaders('/tenant/branding/logo'),body:fd});const data=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(humanApiError(r.status,data),r.status,data.error);await applyBranding(data);toast('Logo atualizada.','success');settingsPage(c)}catch(err){if(err&&err.status===401)return;toast(err.message||'Não foi possível enviar a logo.','error')}});
  $('#clearLogo')&&($('#clearLogo').onclick=async()=>{if(!confirm('Remover a logo do escritório?'))return;try{await applyBranding(await api('/tenant/branding/logo',{method:'DELETE'}));toast('Logo removida.','success');settingsPage(c)}catch(err){toast(err.message,'error')}});
  $('#openTeam')&&($('#openTeam').onclick=()=>openExistingPage('usuarios'));
  $('#openEmail')&&($('#openEmail').onclick=()=>openExistingPage('comunicacoes','email'));
  $('#openWhatsapp')&&($('#openWhatsapp').onclick=()=>openExistingPage('comunicacoes','whatsapp'));
  $('#openAiAdvanced')&&($('#openAiAdvanced').onclick=()=>openExistingPage('ia'));
  $('#openAudit')&&($('#openAudit').onclick=()=>openExistingPage('auditoria'));
  $('#openHealth')&&($('#openHealth').onclick=async()=>{try{const h=await api('/health');toast((h.product||'CDS Contábil Connect')+' · v'+(h.version||'1.0.0')+(h.ok?' · operacional':''),'info')}catch(err){toast(err.message)}});
  if(section==='sistema'){
    api('/health').then(h=>{const line=$('#sysHealthLine');if(line)line.textContent=(h.product||'CDS Contábil Connect')+' · v'+(h.version||'')}).catch(()=>{});
  }
  if(section==='ia'){
    (async()=>{
      const box=$('#aiSettingsSummary');if(!box)return;
      try{
        const summary=await api('/ai/usage/summary');
        const s=summary.settings||{};
        const u=s.usage||summary.usage||{};
        const moneyUsd=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'USD'});
        const status=s.enabled?'Ativa':'Inativa';
        const model=s.model_display||'GPT-5.6 Terra';
        const limit=s.monthly_limit_usd==null?'Sem limite':moneyUsd(s.monthly_limit_usd);
        const consumed=moneyUsd(u.cost_usd||0);
        const autonomy=s.autonomy_label||(s.autonomy_mode==='AUTONOMOUS_98'?'98% — Autônoma':'50% — Assistida');
        box.innerHTML=`<h3>Inteligência Artificial</h3><dl class="settings-dl"><div><dt>Status</dt><dd>${esc(status)}</dd></div><div><dt>Modelo</dt><dd>${esc(model)}</dd></div><div><dt>Autonomia</dt><dd>${esc(autonomy)}</dd></div><div><dt>Consumo</dt><dd>${esc(consumed)}${s.monthly_limit_usd!=null?' / '+esc(limit):''}</dd></div><div><dt>Limite mensal</dt><dd>${esc(limit)}</dd></div></dl><button type="button" class="btn" id="openAiAdvanced">Configurar Inteligência Artificial</button>`;
        $('#openAiAdvanced')&&($('#openAiAdvanced').onclick=()=>openExistingPage('ia'));
      }catch(err){box.innerHTML=`<h3>Inteligência Artificial</h3><p class="muted">${esc(err.message||'Não foi possível carregar o resumo.')}</p><button type="button" class="btn" id="openAiAdvanced">Configurar Inteligência Artificial</button>`;$('#openAiAdvanced')&&($('#openAiAdvanced').onclick=()=>openExistingPage('ia'))}
    })().catch(()=>{});
  }
  if(section==='notificacoes'){
    (async()=>{
      const box=$('#notifSettingsBlock');if(!box)return;
      let prefs={requests_enabled:true,documents_enabled:true,expenses_enabled:true,classification_enabled:true,approval_enabled:true,processes_enabled:true,integrations_enabled:true,push_enabled:true,visual_enabled:true,sound_enabled:false};
      let pushInfo={configured:false};
      try{prefs=await api('/push/prefs')}catch{}
      try{pushInfo=await api('/push/public-key')}catch{}
      const chk=(name,label)=>`<label class="check-row"><input type="checkbox" name="${name}" ${prefs[name]!==false?'checked':''}> ${label}</label>`;
      box.innerHTML='<h3>Notificações</h3><p class="muted">Canal único do CDS Contábil Connect (portal aberto e Web Push com portal fechado).</p><form id="notifPrefsForm"><h4>Canais</h4>'+
        chk('visual_enabled','Notificações no sistema')+
        chk('push_enabled','Web Push')+
        chk('sound_enabled','Som')+
        '<h4>Preferências</h4>'+
        chk('requests_enabled','Solicitações')+
        chk('documents_enabled','Documentos')+
        chk('expenses_enabled','Despesas')+
        chk('classification_enabled','Classificação')+
        chk('approval_enabled','Aprovação')+
        chk('processes_enabled','Processos')+
        chk('integrations_enabled','Integrações')+
        '<div class="row-actions"><button class="btn" type="submit">Salvar</button><button type="button" class="btn secondary" id="enablePush">Permitir neste navegador</button><button type="button" class="btn secondary" id="testPush">Testar notificação</button></div><p class="field-help">'+(pushInfo.configured?'VAPID configurado. Clique em Permitir neste navegador e aceite o pedido do Chrome/Edge/Firefox.':'Web Push aguardando chaves VAPID no ambiente.')+'</p></form>';
      $('#notifPrefsForm').onsubmit=async e=>{
        e.preventDefault();
        const fd=new FormData(e.target);
        const body={};
        for(const k of ['requests_enabled','documents_enabled','expenses_enabled','classification_enabled','approval_enabled','processes_enabled','integrations_enabled','push_enabled','visual_enabled','sound_enabled']){
          body[k]=fd.get(k)==='on';
        }
        try{await api('/push/prefs',{method:'PUT',body:JSON.stringify(body)});toast('Preferências salvas.','success')}catch(err){toast(err.message)}
      };
      $('#enablePush')&&($('#enablePush').onclick=async()=>{
        try{if(!window.CdsPush)throw new Error('Cliente Push indisponível.');await CdsPush.subscribePush(api);toast('Notificações ativadas neste navegador.','success')}catch(err){toast(err.message)}
      });
      $('#testPush')&&($('#testPush').onclick=async()=>{
        try{const r=await api('/push/test',{method:'POST',body:'{}'});toast(r.sent?('Teste enviado ('+r.sent+').'):'Nenhuma assinatura ativa neste dispositivo. Ative o push primeiro.','success')}catch(err){toast(err.message)}
      });
    })().catch(()=>{});
  }
}

