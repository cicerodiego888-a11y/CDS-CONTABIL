# Sprint 28.1 — Solicitações como conversa + Web Push

## Objetivo
Transformar Solicitações em conversa contextual única (escritório ↔ cliente), com histórico em `request_messages`, controle de não lidas, alerta interno e Web Push (VAPID) sem Firebase/OneSignal.

## Escopo preservado
- Arquitetura tenant_id + company_id inalterada
- Sem banco por empresa
- Despesas, Documentos, Classificação, Aprovação, Lançamentos e Integrações não alterados
- Tabela `client_request_responses` mantida (legado somente leitura / sem novos inserts)

## Migration
`database/schema/032_request_messages_push.sql`
- `request_messages`
- `request_message_reads`
- `push_subscriptions`
- `user_notification_prefs`
- Migração idempotente de `client_request_responses` → `request_messages`

## Status
- Novos: `AGUARDANDO_CLIENTE`, `AGUARDANDO_ESCRITORIO`
- Fechados: `CONCLUDED`, `CANCELLED` (aceita também CONCLUIDA/CANCELADA na API)
- Legados: `OPEN` → aguardando cliente; `RESPONDED` → aguardando escritório

## Endpoints
### Escritório
- `GET /api/solicitacoes` — lista + last_message + unread
- `GET /api/solicitacoes/nao-lidas`
- `GET /api/solicitacoes/:id`
- `GET /api/solicitacoes/:id/mensagens` (marca lidas)
- `POST /api/solicitacoes/:id/mensagens`
- `PATCH /api/solicitacoes/:id` — **corrigido** com companyScope/companyOk

### Cliente
- `GET /api/client/solicitacoes`
- `GET /api/client/solicitacoes/:id`
- `GET /api/client/solicitacoes/:id/mensagens`
- `POST /api/client/solicitacoes/:id/mensagens`
- `POST /api/client/solicitacoes/:id/resposta` — compatível, grava em `request_messages`

### Push
- `GET /api/push/public-key` (só pública)
- `GET|PUT /api/push/prefs`
- `POST /api/push/subscribe`
- `DELETE /api/push/subscribe`
- `POST /api/push/test` — OWNER/ACCOUNTANT/STAFF

## Fluxo de conversa
1. Escritório cria solicitação → status `AGUARDANDO_CLIENTE` + 1ª mensagem
2. Cliente responde → `AGUARDANDO_ESCRITORIO` + evento `REQUEST_MESSAGE_CREATED` (+ `REQUEST_UPDATED` compat)
3. Escritório responde → `AGUARDANDO_CLIENTE`
4. Abrir conversa marca mensagens do outro lado como lidas
5. Cliente e escritório compartilham o **mesmo** `request_messages`

## Destinatários Push
- Cliente → usuários do escritório (assigned_to, created_by, assignees da empresa; fallback equipe ativa)
- Escritório → clientes ativos da empresa (`role=CLIENT`, mesmo company_id)
- Push é assíncrono; falha **não** bloqueia mensagem

## Web Push
- Service Worker: `frontend/public/service-worker.js`
- Cliente: `frontend/public/assets/push-client.js`
- Env: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`
- Deep-link: `/empresas/{company_id}/solicitacoes/{request_id}`

## UI
- Lista: “Abrir conversa” (sem “Abrir empresa” no contexto da empresa)
- Chat profissional (escritório/cliente diferenciados)
- Badge de não lidas no menu + destaque discreto (pisca finito)
- Configurações → Notificações (prefs + ativar push + testar)

## Testes
`tests/sprint-28.1-request-conversation-push.test.js`
