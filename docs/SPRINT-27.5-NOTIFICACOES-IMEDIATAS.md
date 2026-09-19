# Sprint 27.5 — Auditoria e entrega imediata de notificações

## Causa real encontrada

Auditoria reproduziu `POST /api/auth/forgot-password` no ambiente de demonstração.

### O que funcionava (backend)

1. Request chega e responde `200` com mensagem genérica.
2. Usuário CLIENT é resolvido por `tenant slug + e-mail` (sem confiar em IDs do frontend).
3. Evento `CLIENT_PASSWORD_RESET_REQUESTED` é criado em `domain_events`.
4. Fan-out cria `notifications` para OWNER/ACCOUNTANT com `read_at = NULL`.
5. `GET /api/notificacoes` (sem escopo de empresa) retorna a notification **imediatamente**.

Conclusão: **o fluxo não quebrava na criação do evento/notification**.

### Onde quebrava a experiência no Portal do Contador

Duas causas combinadas na etapa **atualização da tela**:

| # | Causa | Evidência |
|---|--------|-----------|
| 1 | Polling de **45s** (`setInterval(..., 45000)`) | Contador com a tela aberta só descobria a notificação após F5 ou após ~45s. Badge e painel não atualizavam “em seguida”. |
| 2 | Inbox filtrado por `X-Company-Id` | Com empresa ativa, `api()` enviava `X-Company-Id`. `notificationWhere` filtrava `n.company_id = companyScope`. Em outra empresa da carteira, `unread` ia a `0` e a solicitação **desaparecia** da lista — mesmo existindo no banco. |

Reprodução da causa 2 (auditoria):

- sem scope → `unread: 1`, hit = true
- mesma empresa da solicitação → hit = true
- outra empresa (`X-Company-Id`) → `unread: 0`, hit = false

## Mecanismo atual de notifications

- Persistência: tabelas `domain_events` + `notifications` (sem migration nova).
- Criação: `emitEvent` → `fanOut` → `INSERT` por destinatário.
- Listagem: `GET /api/notificacoes` (ordenado por `created_at DESC`).
- Leitura: `POST /api/notificacoes/:id/lida` e marcar todas.

## Mecanismo de atualização imediata (Sprint 27.5)

Reutiliza o polling existente (sem WebSocket/SSE):

- intervalo **5s** com aba visível;
- intervalo **30s** com aba oculta (`visibilitychange`);
- um único timer (`__cdsNotifTimer`), limpo/rearmado em `startNotifPoll`;
- ao atualizar, se o painel estiver aberto, a lista é repintada;
- `dedupeNotifications` por `notification.id` evita duplicar itens na UI;
- `/notificacoes` entrou em `isTenantScopedPath` (não envia `X-Company-Id`);
- backend: inbox do escritório **ignora** `companyScope` (continua aplicando visibilidade STAFF/assignees).

Deep-link do Sprint 27.4 preservado.

## Arquivos alterados

- `backend/src/server.js` — `notificationWhere` sem filtro por `X-Company-Id` no inbox office
- `frontend/public/assets/app.js` — polling 5s/30s, dedupe, refresh do painel, path tenant-scoped
- `frontend/public/index.html` / `portal/index.html` — cache `s27-5`
- `tests/sprint-27.5-immediate-notifications.test.js` — novo
- `tests/events-notifications.test.js` — expectativa de polling + contexto company
- pins `s27-5` em testes de HTML/assets
- `docs/SPRINT-27.5-NOTIFICACOES-IMEDIATAS.md`

## Migration

Nenhuma.

## Performance

- 5s visível / 30s oculta; sem milissegundos agressivos.
- Sem múltiplos timers: `clearInterval` antes de rearmar.
- Listener `visibilitychange` único (`__cdsNotifVisBound`).
- Erro no poll é engolido (`catch`) para não derrubar o portal.

## Segurança

- Resposta pública permanece genérica (anti-enumeração).
- Sem senha/token/`*_hash`/Authorization em notifications ou respostas auditadas.
- Tenant isolation mantido; company isolation no deep-link via `company_id` da notification.

## Teste manual (sem F5)

1. Abrir Portal do Contador e deixar aberto (idealmente em outra empresa da carteira).
2. No Portal do Cliente, solicitar “Esqueci minha senha”.
3. Em até ~5s, badge sobe e a notification aparece sem reload.
4. Clique → Usuários + painel de redefinição (27.4).
5. Redefinir acesso → fluxo 27.3.
