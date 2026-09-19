# Sprint 27.4 — Solicitação de recuperação de senha via notificação

## Objetivo

O botão **Esqueci minha senha** do Portal do Cliente cria uma **solicitação** (notificação interna) para o escritório. A redefinição efetiva continua sendo executada pelo contador via Sprint 27.3 (**Redefinir acesso**).

## Fluxo

1. Cliente informa código do escritório + e-mail (já presentes no login) e solicita redefinição.
2. Endpoint público `POST /api/auth/forgot-password` responde sempre com mensagem genérica (anti-enumeração).
3. Se o usuário CLIENT existir no tenant/empresa ativa:
   - dedupe: se já houver notificação **não lida** para o mesmo `tenant + company + client_user`, não cria outra;
   - emite `CLIENT_PASSWORD_RESET_REQUESTED` via `domain_events` → fan-out de `notifications`.
4. OWNER e ACCOUNTANT do tenant recebem a notificação (STAFF e CLIENT não).
5. Clique na notificação no Portal do Contador:
   - marca como lida;
   - abre a empresa → Usuários → painel **Solicitação de redefinição de acesso** com o usuário focado e botão **Redefinir acesso**.
6. Contador executa o fluxo 27.3 (e-mail + token `PASSWORD_RESET` + nova senha).

## Segurança

- Sem revelar existência de e-mail/usuário.
- Sem envio de e-mail no forgot (e-mail só no Redefinir acesso).
- Sem senha/token/`password_hash`/`token_hash` em payload, notificação ou auditoria.
- Contexto autorizado no backend (tenant por slug, usuário por e-mail CLIENT); IDs do body não são confiados.

## Destinatários

| Papel | Recebe? |
|-------|---------|
| OWNER | Sim |
| ACCOUNTANT | Sim |
| STAFF | Não |
| CLIENT / CLIENT_* | Não |

## Idempotência

Notificação não lida existente para o mesmo `client_user` → nova solicitação é ignorada (`result: deduped` na auditoria). Após marcar como lida, nova solicitação pode gerar nova notificação.

## Auditoria

- `CLIENT_PASSWORD_RESET_REQUESTED` (solicitação / dedupe)
- Eventos do Sprint 27.3 permanecem intactos na redefinição

## Migration

Nenhuma. Estrutura de `domain_events` / `notifications` reutilizada.

## Arquivos

- `backend/src/domain-events.js` — evento, copy, destinatários OWNER/ACCOUNTANT
- `backend/src/server.js` — endpoint público + `mapNotification` com referência
- `frontend/public/portal/portal.js` — solicitação no login
- `frontend/public/assets/app.js` — deep-link da notificação + painel
- `tests/sprint-27.4-reset-request-notification.test.js`
- `docs/SPRINT-27.4-SOLICITACAO-RESET-NOTIFICACAO.md`

## Fora de escopo

Self-service de reset; alteração do motor 27.3; e-mail automático no forgot; Core V1.0 / AI / processos.
