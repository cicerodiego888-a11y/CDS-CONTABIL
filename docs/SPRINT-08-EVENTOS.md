# Sprint 08 — Motor de eventos

## 1. Arquitetura
Ação de domínio (POST/PATCH/aprovação) → `emitEvent()` em `backend/src/domain-events.js` → `domain_events` → handler in-app → `notifications` por destinatário. Sem Redis, fila, WhatsApp, e-mail ou WebSocket. Processamento síncrono no SQLite, preferencialmente na mesma `db.transaction(()=>{})()`.

## 2. Catálogo
| EVENT_TYPE | Origem | Destinatários in-app | Canal atual | Futuro |
|---|---|---|---|---|
| EXPENSE_CREATED | Portal/escritório cria despesa | Escritório ativo + confirmação ao CLIENT ator | In-app | WhatsApp/e-mail |
| REVENUE_CREATED | Portal/escritório cria receita | Idem | In-app | WhatsApp |
| DOCUMENT_UPLOADED | Upload individual | Escritório ativo | In-app | WhatsApp |
| CLASSIFICATION_REQUIRED | Motor deixa NEEDS_CLASSIFICATION | Escritório | In-app | Desktop |
| CLASSIFICATION_COMPLETED | Reclassificação manual | Somente evento (sem avalanche in-app) | — | Canais futuros |
| ENTRY_CREATED | Partida gerada (auto ou manual) | Somente evento | — | |
| ENTRY_APPROVED | Aprovação | Escritório | In-app | |
| ENTRY_REJECTED | Rejeição | Escritório | In-app | |
| REQUEST_CREATED | POST /api/solicitacoes | CLIENT da empresa | In-app | |
| REQUEST_UPDATED | Cliente responde solicitação | Escritório | In-app | |
| PENDENCY_RESPONSE | Cliente responde pendência | Escritório | In-app | |

Não existe `DOCUMENTS_RECEIVED`: o upload atual é um arquivo por request.

## 3–8. Entidade, tenant, company, actor, entity, payload
`domain_events`: `tenant_id` obrigatório (contexto autenticado, nunca `req.body.tenant_id`), `company_id` da operação/`req.companyScope`, `actor_user_id`, `entity_type`/`entity_id`, `payload_json` com chaves permitidas (`amount_cents`, `description`, métodos, `original_name`, `title`, `note`, `status`). Sem senha, JWT, token ou binário. Nome da empresa é resolvido no handler (JOIN), não duplicado no payload.

## 9. Idempotência
Índice único parcial em `(tenant_id, event_type, entity_type, entity_id)` para eventos semanticamente únicos. Reclassificação (`CLASSIFICATION_COMPLETED`) e respostas são repetíveis. `notifications` únicos em `(event_id, recipient_user_id)`.

## 10–11. Handlers e notificações
`fanOut` busca destinatários em **uma** query por audiência e insere em lote transacional. Título/mensagem são da notificação, não do evento.

## 12–13. Destinatários e preferências
Escritório: `OWNER|ACCOUNTANT|STAFF` e `active=1`. CLIENT não recebe eventos administrativos. Preferência `notification_preferences.in_app_enabled` (default true). Estrutura pronta para canais futuros; nesta sprint só in-app. Sem UI grande — `PUT /api/notificacoes/preferencias`.

## 14. Polling
Frontend 45s, só autenticado. `GET /api/notificacoes` paginado (`page`, `page_size`≤100) + `unread` via `COUNT(*)`. `?since=` incremental.

## 15. Segurança
Lista filtrada por `tenant_id` + `recipient_user_id`. CLIENT só `/api/client/notificacoes` da empresa do JWT. `X-Company-Id` inválido → 404. Sem PATCH de eventos.

## 16. Transações
Despesa/receita/documento/solicitação: entidade + evento + notificações no mesmo `db.transaction(...)()`. Falha de fan-out é logada sem segredo; a operação de domínio permanece se o emit já comitou — o caminho feliz é atômico. Rollback forçado no teste não deixa evento órfão.

## 17. Índices
`domain_events`: tenant+created_at, tenant+company+created_at, tenant+type+created_at, unique once. `notifications`: recipient+read_at, recipient+created_at, event+recipient.

## 18. Agrupamento
Eventos granulares. Sem lote de documentos. Agregação de apresentação fica para sprint futura.

## 19. Limitações
Sem WhatsApp/desktop/push; retenção automática não implementada; CLASSIFICATION_COMPLETED/ENTRY_CREATED não geram in-app para não duplicar EXPENSE_CREATED.

## 20. Próximos canais
O handler in-app é o único consumidor. Rotas de despesa **não** chamam WhatsApp. Sprint 09+ pode ler `domain_events` / `status`.
