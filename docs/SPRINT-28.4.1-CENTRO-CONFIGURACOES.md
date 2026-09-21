# Sprint 28.4.1 — Centro de Configurações + identidade visual CDS

## Escopo

Refatoração de **UX/UI** da tela de Configurações e migração da identidade visual de teal para **preto + vermelho + branco + cinzas**.

Não houve alteração de:

- APIs, permissões, tenant/company isolation
- Tenant Branding (Sprint 28.4)
- NotificationService / NotificationCenter / RecipientResolver / Web Push
- AccountingAIProvider, vault, limites
- autenticação, motores contábeis

## Centro de Configurações

A página única gigante foi substituída por um hub com navegação interna (`state.settingsSection`):

| Seção | Conteúdo | Destino |
|-------|----------|---------|
| Geral | Conta + dados do escritório (`PATCH /api/tenant`) | nesta tela |
| Identidade | Tenant Branding existente | `GET/PATCH/POST/DELETE /api/tenant/branding*` |
| Equipe e acesso | resumo + botão | página `usuarios` |
| Notificações | canais e preferências | `GET/PUT /api/push/prefs` (mesmo motor) |
| Comunicações | cards E-mail / WhatsApp | página `comunicacoes` |
| Inteligência Artificial | resumo status/modelo/consumo | `GET /api/ai/usage/summary` + página `ia` |
| Sistema | Auditoria + health | página `auditoria` e `GET /api/health` |

Desktop: nav lateral. Mobile: `<select>` (`settings-nav-select`).

Receitas **não** aparece nas preferências: o campo não existe em `user_notification_prefs`.

## Identidade visual

Tokens em `frontend/public/assets/tokens.css`:

- primário / ações / item ativo: `#C8102E`
- sidebar: `#111111`
- fundo: `#F5F5F5` / superfície branca
- textos e bordas em cinza

O vermelho é usado em ativo, indicadores e botão primário — não na interface inteira.

Teal (`#0f5f59` e correlatos) foi removido do **runtime** (CSS, HTML, JS de UI, manifests). Documentação histórica das sprints 12/28.1.2 permanece.

Ícones PNG oficiais do PWA não foram redesenhados nesta sprint (arquivo binário).

## Testes

`tests/sprint-28.4.1-settings-identity.test.js`
