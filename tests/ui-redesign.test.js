const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('tokens CSS da identidade visual existem',()=>{
  const css=read('frontend/public/assets/tokens.css')+read('frontend/public/assets/app.css');
  for(const t of['--color-primary','--color-primary-hover','--color-primary-soft','--color-background','--color-surface','--color-surface-hover','--color-border','--color-text','--color-text-secondary','--color-success','--color-warning','--color-danger','--color-info'])assert.match(css,new RegExp(t));
});

test('layout escritório tem sidebar, topbar e conteúdo',()=>{
  const js=read('frontend/public/assets/app.js');
  const html=read('frontend/public/index.html');
  assert.match(html,/tokens\.css\?v=s28-4-2/);
  assert.match(html,/theme\.css\?v=s28-4-2/);
  assert.match(js,/app-shell/);
  assert.match(js,/id="sidebar"/);
  assert.match(js,/class="top"/);
  assert.match(js,/id="globalSearch"/);
  assert.match(js,/Pesquisar empresas, documentos, pendências/);
  assert.match(js,/Ctrl K/);
  assert.match(js,/id="content"/);
});

test('sidebar redesenhada preserva grupos e rotas',()=>{
  const js=read('frontend/public/assets/app.js');
  for(const x of['GESTÃO','FILAS DE TRABALHO','CONFIGURAÇÕES CONTÁBEIS','RELATÓRIOS','SISTEMA','Início','Empresas','Importações','Classificação','Lançamentos','Documentos','Pendências','Solicitações','Comunicações','Usuários','Configurações','menuSearch','menu-badge'])assert.match(js,new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('dashboard possui saudação, KPIs reais e área da logo',()=>{
  const js=read('frontend/public/assets/app.js');
  assert.match(js,/officeIdentityHtml/);
  assert.match(js,/Configure a identidade do seu escritório/);
  assert.match(js,/Veja o resumo da operação do seu escritório/);
  assert.match(js,/Lançamentos efetivados/);
  assert.match(js,/Movimentações por origem/);
  assert.match(js,/\/tenant\/branding/);
  assert.doesNotMatch(js,/ccc_tenant_logo_/);
  assert.doesNotMatch(js,/planta|unsplash|hero-photo|imagem decorativa/i);
});

test('empresas e contexto preservam acesso e X-Company-Id',()=>{
  const js=read('frontend/public/assets/app.js');
  assert.match(js,/Gerencie a carteira de empresas do escritório/);
  assert.match(js,/Pesquisar empresa ou CNPJ/);
  assert.match(js,/Acessar empresa/);
  assert.match(js,/leaveCompany/);
  assert.match(js,/X-Company-Id/);
  assert.match(js,/context-nav/);
  assert.match(js,/Visão geral/);
});

test('portal do cliente não tem Nova receita e mantém menu oficial',()=>{
  const js=read('frontend/public/portal/portal.js');
  assert.match(js,/Início/);
  assert.match(js,/Nova despesa/);
  assert.match(js,/Documentos/);
  assert.match(js,/Pendências/);
  assert.match(js,/Solicitações/);
  assert.match(js,/Meu perfil/);
  assert.doesNotMatch(js,/Nova receita/);
  assert.match(js,/Veja o que precisa da sua atenção/);
});

test('estados, toasts, skeleton e responsividade básica',()=>{
  const js=read('frontend/public/assets/app.js');
  const theme=read('frontend/public/assets/theme.css');
  assert.match(js,/empty-state/);
  assert.match(js,/skeleton-page/);
  assert.match(js,/toast-success/);
  assert.match(js,/Está tudo em dia por aqui/);
  assert.match(theme,/max-width:650px/);
  assert.match(theme,/@media/);
  assert.match(theme,/focus-visible/);
});

test('notificações, importações e rotas preservadas',()=>{
  const js=read('frontend/public/assets/app.js');
  assert.match(js,/notif-bell/);
  assert.match(js,/não lida/);
  assert.match(js,/\/importacoes/);
  assert.match(js,/CDS Sistemas/);
  assert.match(js,/sem integração ativa/);
  assert.match(js,/\/comunicacoes\/config/);
  assert.doesNotMatch(js,/CDS_WHATSAPP_API_TOKEN/);
});
