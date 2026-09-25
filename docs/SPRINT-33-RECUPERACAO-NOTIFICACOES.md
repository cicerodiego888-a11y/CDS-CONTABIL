# Sprint 33 — Fechamento da recuperação + notificações unread

## Objetivo

Corrigir o ciclo de vida da recuperação automática de senha e fazer o dropdown
principal mostrar somente notificações **não lidas**.

## Recuperação

1. Cliente clica em **Esqueci minha senha** → e-mail automático + convite `PASSWORD_RESET` (`PENDENTE`).
2. Escritório recebe `CLIENT_PASSWORD_RESET_REQUESTED` (OWNER/ACCOUNTANT).
3. Cliente redefine a senha pelo link → convite `ACCEPTED` (= **CONCLUÍDA**).
4. `PASSWORD_RESET_COMPLETED` para o escritório (informativo).
5. Notificações `CLIENT_PASSWORD_RESET_REQUESTED` do mesmo usuário são marcadas como lidas automaticamente.
6. Falha no envio → convite `REVOKED` (= **FALHA**) + `PASSWORD_RESET_FAILED`.

Campos expostos em `/api/empresas/:id/users`:

- `password_reset_status`: `PENDENTE` | `CONCLUIDA` | `FALHA`
- `password_reset_method`: `EMAIL`
- `password_reset_requested_at` / `password_reset_completed_at`

O mecanismo antigo **Redefinir acesso** (27.3) permanece intacto.

## Notificações

- Dropdown do sino: somente `unread` (`GET /api/notificacoes?unread=1`).
- Contador do sino: quantidade de não lidas.
- Ao visualizar: `UNREAD → READ` e some do dropdown.
- **Marcar todas**: marca todas como lidas; dropdown esvazia; itens ficam no histórico.
- **Histórico de notificações**: botão no painel + página do portal; preserva título, mensagem, data/hora, tipo, origem, entidade e status de leitura.

## Arquivos

- `backend/src/server.js` — forgot/accept lifecycle + status no users API
- `frontend/public/assets/app.js` — unread dropdown, histórico, painel CONCLUÍDA
- `frontend/public/portal/portal.js` — unread dropdown + histórico
- `frontend/public/assets/cds-app-header.js` — botão Histórico
- `tests/sprint-33-reset-lifecycle-unread.test.js`
- `docs/SPRINT-33-RECUPERACAO-NOTIFICACOES.md`

## Migration

Nenhuma. Reutiliza `client_invitations`, `domain_events`, `notifications`.
