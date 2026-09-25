'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('tokens de modal e espaçamento existem', () => {
  const tokens = read('frontend/public/assets/tokens.css');
  const theme = read('frontend/public/assets/theme.css');
  assert.match(tokens, /--modal-sm:\s*520px/);
  assert.match(tokens, /--modal-md:\s*820px/);
  assert.match(tokens, /--modal-lg:\s*1100px/);
  assert.match(tokens, /--space-1:\s*4px/);
  assert.match(tokens, /--space-8:\s*32px/);
  assert.match(theme, /\.modal-sm\{width:min\(var\(--modal-sm\),calc\(100vw - 48px\)\)\}/);
  assert.match(theme, /\.modal-md\{width:min\(var\(--modal-md\),calc\(100vw - 48px\)\)\}/);
  assert.match(theme, /\.modal-lg\{width:min\(var\(--modal-lg\),calc\(100vw - 48px\)\)/);
  assert.match(theme, /\.modal-back\{[^}]*overflow-y:\s*auto/);
  assert.match(theme, /\.modal-lg\{[^}]*height:\s*auto/);
});

test('formulário Nova empresa agrupa campos e usa modal grande', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /Identificação da empresa/);
  assert.match(js, /Informações complementares/);
  assert.match(js, /Cadastre uma nova empresa na carteira do escritório/);
  assert.match(js, /companyFormFields/);
  assert.match(js, /modal\(`<form id="companyForm"/);
  assert.match(js, /,'lg'\)/);
  assert.match(js, /Razão Social \*/);
  assert.match(js, /CNPJ \*/);
  assert.doesNotMatch(js, /type="tab"/);
});

test('consulta CNPJ e dados automáticos permanecem editáveis', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /Consultar CNPJ/);
  assert.match(js, /\/api\/empresas\/consulta-cnpj/);
  assert.match(js, /Consultando\.\.\./);
  assert.match(js, /Empresa encontrada/);
  assert.match(js, /Dados preenchidos automaticamente/);
  assert.match(js, /field-auto/);
  assert.match(js, /Preenchido automaticamente/);
  assert.match(js, /Os dados preenchidos serão substituídos/);
  assert.doesNotMatch(js, /readonly.*cnpjLookup/);
});

test('cabeçalho e rodapé sticky do modal de empresa', () => {
  const js = read('frontend/public/assets/app.js');
  const theme = read('frontend/public/assets/theme.css');
  assert.match(js, /function modalHead/);
  assert.match(js, /function modalFoot/);
  assert.match(js, /Fechar ×/);
  assert.match(js, /Cancelar/);
  assert.match(js, /Cadastrar empresa/);
  assert.match(js, /id="companySubmit"/);
  assert.match(theme, /\.modal-head\{[^}]*flex-shrink:0/);
  assert.match(theme, /\.modal-body\{[^}]*overflow:\s*visible/);
  assert.match(theme, /\.modal-lg\{[^}]*height:\s*auto/);
  assert.match(theme, /\.modal-foot\{[^}]*flex-shrink:0/);
});

test('Nova despesa do escritório segue ordem operacional', () => {
  const js = read('frontend/public/assets/app.js');
  const se = read('frontend/public/assets/smart-expense.js');
  const slice = js.slice(js.indexOf('function txModal'), js.indexOf('async function entries'));
  assert.match(slice, /CdsSmartExpense\.open/);
  assert.match(slice, /mode:'office'/);
  assert.match(se, /Nova despesa/);
  assert.match(se, /Fornecedor/);
  assert.match(se, /Data da competência/);
  assert.match(se, /Descrição \*/);
  assert.match(se, /Valor \*/);
  assert.match(se, /Categoria/);
  assert.match(se, /Forma de pagamento/);
  assert.match(se, /Ler novamente/);
  assert.match(se, /Salvar despesa/);
  assert.match(se, /Salvando\.\.\./);
  assert.match(se, /Despesa registrada com sucesso\. Ela foi enviada para análise da contabilidade/);
  assert.ok(se.indexOf('Fornecedor') < se.indexOf('Data da competência'));
  assert.ok(se.indexOf('Data da competência') < se.indexOf('Descrição'));
  assert.ok(se.indexOf('Descrição') < se.indexOf('Valor'));
});

test('Portal Nova despesa e ausência de Nova receita', () => {
  const js = read('frontend/public/portal/portal.js');
  const se = read('frontend/public/assets/smart-expense.js');
  const css = read('frontend/public/portal/portal.css');
  assert.match(js, /Nova despesa/);
  assert.match(js, /CdsSmartExpense\.open/);
  assert.match(js, /mode:'client'/);
  assert.match(se, /Forma de pagamento/);
  assert.match(se, /Salvar despesa/);
  assert.match(se, /Salvando\.\.\./);
  assert.match(se, /Despesa registrada com sucesso\. Ela foi enviada para análise da contabilidade/);
  assert.doesNotMatch(js, /Nova receita/);
  assert.match(css, /max-width:960px/);
  const form = js.slice(js.indexOf('async function transactionForm'), js.indexOf('async function detail'));
  assert.match(form, /CdsSmartExpense\.open/);
  assert.match(form, /\/api\/client\/despesas/);
  assert.match(js, /Notificações/);
  assert.match(js, /Alterar senha/);
});

test('upload com dropzone, feedback e loading', () => {
  const app = read('frontend/public/assets/app.js');
  const portal = read('frontend/public/portal/portal.js');
  assert.match(app, /function docModal/);
  assert.match(app, /Arraste o arquivo aqui/);
  assert.match(app, /Enviando\.\.\./);
  assert.match(app, /Documento anexado com sucesso/);
  assert.match(portal, /Documento anexado com sucesso/);
  assert.match(portal, /Documento enviado com sucesso/);
  assert.match(portal, /Enviando\.\.\./);
  assert.match(portal, /id="docDrop"/);
});

test('validação de campo e estados de loading', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /Informe um endereço de e-mail válido/);
  assert.match(js, /Informe um valor válido/);
  assert.match(js, /id="emailFieldError"/);
  assert.match(js, /classList\.add\('busy'\)/);
  assert.match(js, /Consultando\.\.\./);
  assert.match(js, /Importando\.\.\./);
  assert.match(js, /Salvando\.\.\./);
  assert.match(js, /Cadastrando\.\.\./);
});

test('responsividade tablet e mobile dos modais', () => {
  const theme = read('frontend/public/assets/theme.css');
  const portal = read('frontend/public/portal/portal.css');
  assert.match(theme, /@media\(max-width:768px\)/);
  assert.match(theme, /width:calc\(100vw - 24px\)/);
  assert.match(theme, /grid-template-columns:1fr/);
  assert.match(theme, /@media\(max-width:650px\)/);
  assert.match(portal, /@media\(max-width:768px\)/);
  assert.match(portal, /calc\(100vw - 24px\)/);
});

test('rotas, convite e Motor Contábil preservados', () => {
  const js = read('frontend/public/assets/app.js');
  for (const x of ['empresas', 'despesas', 'documentos', 'importacoes', 'classificacao', 'lancamentos', 'pendencias', 'solicitacoes', 'configuracoes']) {
    assert.match(js, new RegExp(`state\\.page==='${x}'`));
  }
  assert.match(js, /Etapa 2 de 2\. O acesso é ativado por convite/);
  assert.doesNotMatch(js.slice(js.indexOf('Primeiro usuário'), js.indexOf('async function companyViewPage')), /name="password"/);
  assert.match(js, /Lançamento N linhas/);
  assert.match(js, /\/lancamentos\/'\+prefill\.id\+'\/reclassificar/);
});

test('modal não fecha ao clicar fora', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /function modal\(/);
  assert.doesNotMatch(js, /e\.target\.id==='modal'\)closeModal/);
  assert.match(js, /aria-label="Fechar"/);
  assert.match(js, /onclick="closeModal\(\)"/);
});

test('contexto da empresa tem Usuários e não tem Receitas', () => {
  const js = read('frontend/public/assets/app.js');
  const groups = js.slice(js.indexOf('const contextMenuGroups='), js.indexOf('const companyContextNav='));
  assert.match(groups, /\['usuarios','Usuários'/);
  assert.match(groups, /Visão geral/);
  assert.match(groups, /Despesas/);
  assert.match(groups, /Documentos/);
  assert.doesNotMatch(groups, /Receitas/);
  assert.doesNotMatch(groups, /Nova receita/);
  assert.match(js, /Controle de acesso desta empresa/);
  assert.match(js, /Reenviar convite/);
  assert.match(js, /state\.selectedCompany\?companyUsersPage/);
});

test('modal de usuário tem header body footer e campos acessíveis', () => {
  const js = read('frontend/public/assets/app.js');
  const theme = read('frontend/public/assets/theme.css');
  assert.match(theme, /\.modal-head\{[^}]*flex-shrink:0/);
  assert.match(theme, /\.modal-body\{[^}]*overflow:\s*visible/);
  assert.match(theme, /\.modal-body\{[^}]*flex:1 1 auto/);
  assert.match(theme, /\.modal-back\{[^}]*overflow-y:\s*auto/);
  assert.match(theme, /\.modal-foot\{[^}]*flex-shrink:0/);
  assert.match(js, /id="clientUserForm"/);
  assert.match(js, /id="uForm"/);
  assert.match(js, /Nome \*/);
  assert.match(js, /E-mail \*/);
  assert.match(js, /Perfil \*/);
  assert.match(js, /Salvar alterações/);
  assert.match(js, /onclick="closeModal\(\)">Cancelar/);
  const clientModal = js.slice(js.indexOf('function clientUserModal'), js.indexOf('async function transactions'));
  assert.doesNotMatch(clientModal, /name="password"/);
  assert.doesNotMatch(clientModal, /option value="CLIENT"/);
});

test('menu global usa Equipe e acessos, empresa mantém Usuários', () => {
  const js = read('frontend/public/assets/app.js');
  const menu = js.slice(js.indexOf('const menuGroups='), js.indexOf('const contextMenuGroups='));
  assert.match(menu, /\['usuarios','Equipe e acessos'/);
  assert.doesNotMatch(menu, /\['usuarios','Usuários'\]/);
  assert.match(js, /head\('Equipe e acessos','Gerencie os usuários que fazem parte do seu escritório\.'/);
  assert.match(js, /option value="\$\{r\}"[^>]*>\$\{roleLabel\(r\)\}/);
  assert.match(js, /function users\(/);
  assert.match(js, /api\('\/usuarios\?page='/);
});

test('HTML aponta assets versionados no escritório e no Portal', () => {
  const admin = read('frontend/public/index.html');
  const portal = read('frontend/public/portal/index.html');
  assert.match(admin, /app\.js\?v=s40-supplier/);
  assert.match(admin, /smart-expense\.js\?v=s36-draft/);
  assert.match(admin, /theme\.css\?v=s40-zoom/);
  assert.match(admin, /tokens\.css\?v=s40-modal/);
  assert.match(admin, /document-viewer\.js\?v=s40-zoom/);
  assert.match(portal, /portal\.js\?v=s40-login/);
  assert.match(portal, /smart-expense\.js\?v=s36-draft/);
  assert.match(portal, /portal\.css\?v=s40-login/);
  assert.match(portal, /document-viewer\.js\?v=s40-zoom/);
});

test('importação não pede JSON na conferência', () => {
  const js = read('frontend/public/assets/app.js');
  assert.doesNotMatch(js, /Movimentações \(JSON\)/);
  assert.doesNotMatch(js, /movements_json/);
  assert.doesNotMatch(js, /JSON inválido/);
  assert.match(js, /id="importRows"/);
  assert.match(js, /Revise as movimentações antes de importar/);
  assert.match(js, /Adicionar movimentação/);
});

test('rótulos de origem, tipo e pagamento aparecem em português', () => {
  const js = read('frontend/public/assets/app.js');
  const portal = read('frontend/public/portal/portal.js');
  assert.match(js, /EXPENSE:'Despesa'/);
  assert.match(js, /originLabel\(e\.origin\|\|e\.source_type\)/);
  assert.match(js, /option value="EXPENSE">Despesa<\/option>/);
  assert.match(portal, /payLabel/);
  assert.match(portal, /CONCLUDED:'Concluída'/);
});

test('classificação explica revisão em linguagem do escritório', () => {
  const js = read('frontend/public/assets/app.js');
  assert.match(js, /function classificationReasonLabel/);
  assert.match(js, /Nenhuma regra ou fallback suficiente/);
  assert.match(js, /Informe débito e crédito/);
  assert.match(js, /function classificationCandidatesHtml/);
  assert.doesNotMatch(js, /confiança \$\{c\.score/);
});

test('configurações contábeis têm ajuda contextual no círculo de interrogação', () => {
  const js = read('frontend/public/assets/app.js');
  const theme = read('frontend/public/assets/theme.css');
  assert.match(js, /data-screen-help/);
  assert.match(js, /function helpCircle/);
  for (const title of [
    'Como funciona: Bancos',
    'Como funciona: Categorias',
    'Como funciona: Regras Contábeis',
    'Como funciona: Plano de Contas',
    'Como funciona: Exportações',
    'Como funciona: Fechamento Contábil',
    'Como funciona: Empresas',
    'Como funciona: Classificação',
    'Como funciona: Aprovação',
    'Como funciona: Documentos',
    'Como funciona: Importações',
    'Como funciona: Comunicações',
    'Como funciona: Inteligência Artificial',
    'Como funciona: Configurações'
  ]) {
    assert.match(js, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(js, /head\('Exportações'[^)]*'exportacoes'\)/);
  assert.match(js, /head\('Fechamento Contábil'[^)]*'fechamento'\)/);
  assert.match(js, /head\('Classificação'[^)]*'','classificacao'\)/);
  assert.match(js, /modalHead\(editing\?\(cat\?'Editar categoria':'Editar banco'\):\(cat\?'Nova categoria':'Banco'\),cat\?'Vincule a categoria a uma conta analítica.':'Vincule o banco a uma conta analítica do plano.',endpoint\)/);
  assert.match(js, /modalHead\('Nova regra contábil','Condições e contas da partida automática\.','regras'\)/);
  assert.match(js, /modalHead\('Importar plano de contas','PDF, CSV ou TXT\. Confira a prévia antes de gravar\.','plano'\)/);
  assert.match(theme, /\.screen-help-btn/);
  assert.match(theme, /\.help-back/);
  assert.doesNotMatch(js, /How this screen works/i);
});

test('fila de aprovação permite revisar o lançamento no modal', () => {
  const js = read('frontend/public/assets/app.js');
  const theme = read('frontend/public/assets/theme.css');
  assert.match(js, /async function approval/);
  assert.match(js, /async function reviewApproval/);
  assert.match(js, /Revisar →/);
  assert.match(js, /async function viewEntry/);
  assert.match(js, /Detalhes do lançamento/);
  assert.match(js, /function nLinesHtml/);
  assert.match(js, /entry-doc-preview/);
  assert.match(js, /function bindEntryDoc/);
  assert.match(js, /Carregando pré-visualização/);
  assert.match(theme, /\.entry-doc-preview\{/);
});
