# Sprint 12 — Redesign visual profissional

## Diagnóstico do frontend anterior

O painel era um SPA vanilla (`index.html` + `app.js` + `app.css` + `admin.css`) e o Portal outro SPA (`portal/`). A paleta era azul-navy (`#2457d6` / `#0b1426`), com o Portal em Georgia + teal depois sobrescrito para o mesmo azul. Havia tokens parciais (`--bg`, `--primary`) espalhados, cards de empresas em grade irregular, Dashboard como lista de KPIs sem hierarquia, login em gradiente azul forte e pouca padronização de empty/loading/toast.

Arquivos frontend existentes antes da sprint: `frontend/public/index.html`, `assets/app.js`, `assets/app.css`, `assets/admin.css`, `portal/index.html`, `portal/portal.js`, `portal/portal.css`, `convite.html`.

## Estratégia visual

Não houve reescrita do backend. A lógica de `api()`, contexto `X-Company-Id`, paginação, debounce, notificações, importações e menus funcionais foi preservada. O redesign consolidou tokens, um tema carregado por último, HTML de Dashboard/Empresas/Topbar/Portal e classes de Design System.

Direção: SaaS contábil, sidebar teal petróleo, conteúdo off-white, cards com sombra suave, tipografia system/Inter, verde/teal de identidade e azul só em informação.

## Design System e tokens

Arquivo `frontend/public/assets/tokens.css` define `--color-primary`, hover, soft, background, surface, border, textos e estados. `theme.css` padroniza botão, input, badge, card, KPI, tabela, modal, toast, empty, skeleton, topbar, identidade do escritório e media queries.

Componentes não são um framework: são classes CSS + HTML gerado pelo JS existente.

## Dashboard

Saudação por horário, panorama da carteira, quatro KPIs com dados de `GET /api/dashboard`, atividade a partir de notificações reais, barras de origem (CDS Sistemas com 0 se ausente), donut só com contagens reais, tabela das últimas empresas e próximas ações derivadas de totais reais. Evolução de 6 meses permanece empty state — não há série histórica na API.

## Portal

Mesma família visual, menu mais simples, home com quatro cards e CTA de Nova despesa. Sem Nova receita. Formulário centralizado com upload e Cancelar/Salvar.

## Logo do escritório

`GET /api/tenant` não possui campo de logo. Nesta sprint a identidade usa o nome do tenant e, opcionalmente, data URL em `localStorage` chaveada por `ccc_tenant_logo_{tenantId}`. Sem logo: placeholder “Configure a identidade do seu escritório”. Sem imagem decorativa. Sem API nova.

## Responsividade e acessibilidade

Sidebar colapsável e drawer no mobile (já existentes) com cores novas. Tabelas viram blocos abaixo de 650px. Foco visível, labels, `aria-label` em sino/ajuda/menu, diálogo de modal, toasts com `role="status"`. Estados não dependem só de cor (texto no badge).

## Testes

Baseline da suíte anterior: 169 PASS / 0 FAIL / 0 SKIP.

Novos testes em `tests/ui-redesign.test.js`. Cache de assets (na época) `?v=s12-1`; a Sprint 12.1 avançou o pin para `?v=s12-2`.

## Limitações

- Logo não persiste no banco (só no navegador do usuário).
- Sem série histórica de carteira no backend.
- Prioridade URGENTE/ATENÇÃO/NORMAL em pendências é derivada do texto/status, pois a tabela `pendencies` não tem coluna de prioridade.
- Ícones continuam SVG inline únicos (não Font Awesome).
