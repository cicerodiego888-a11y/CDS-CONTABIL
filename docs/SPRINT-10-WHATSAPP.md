# Sprint 10 — Motor de comunicação + WhatsApp

## Arquitetura

Operação de domínio → `emitEvent` (Sprint 08) → notificação IN_APP → `communicationEngine.enqueueForEvent` → job persistente → worker → `WhatsAppProvider.sendMessage`.

O domínio **não** chama a API do WhatsApp. Falha no canal não faz rollback de despesa, evento ou IN_APP.

Canais atuais: `IN_APP` (padrão) e `WHATSAPP` (opcional). E-mail/push ficam fora desta sprint.

## Provider

**Meta WhatsApp Cloud API** (`https://graph.facebook.com/v21.0/{phone-number-id}/messages`).

Escolha: API oficial Business, sem WhatsApp Web, QR ou sessão pessoal.

Adapter: `backend/src/comunicacoes/providers/whatsapp.js` (`sendMessage`). Token só em variável de ambiente. Sem credencial, o adapter existe e os testes usam mock.

## Credenciais

```
CDS_WHATSAPP_PROVIDER=meta
CDS_WHATSAPP_API_URL=https://graph.facebook.com/v21.0
CDS_WHATSAPP_API_TOKEN=
CDS_WHATSAPP_PHONE_NUMBER_ID=          # fallback global; o escritório também informa o ID no painel
CDS_WHATSAPP_VERIFY_TOKEN=             # GET webhook (hub.verify_token)
CDS_WHATSAPP_APP_SECRET=               # HMAC X-Hub-Signature-256
CDS_WHATSAPP_TIMEOUT_MS=8000
CDS_COMMS_WORKER=off                   # desliga o intervalo interno (testes)
```

Núcleo e adapter implementados e testados; **ativação do envio real depende da configuração das credenciais do provider.**

## Tabelas (`011_communications.sql`)

- `communication_settings` — por tenant (`whatsapp_enabled`, `phone_number_id`, `display_number`)
- `communication_event_prefs` — eventos por tenant
- `communication_jobs` — fila persistente

Telefone do destinatário: `users.whatsapp_phone` (TEXT, E.164).

## Endpoints

| Método | Rota | Auth |
|---|---|---|
| GET/PATCH | `/api/comunicacoes/config` | escritório; PATCH OWNER/ACCOUNTANT |
| GET | `/api/comunicacoes/status` | escritório |
| GET | `/api/comunicacoes/jobs` | escritório, paginado |
| GET/POST | `/api/webhooks/whatsapp` | verificação Meta / HMAC |

Tokens nunca retornam na API. `api_token` no PATCH é rejeitado.

## Fila, worker, retry

Estados: `PENDING` → `PROCESSING` → `SENT` → `DELIVERED` ou `FAILED`.

Claim no SQLite (`UPDATE ... AND status='PENDING'`). PROCESSING travado >5 min volta para PENDING.

Até 3 tentativas. Backoff 15s / 60s / 180s. 429/5xx/timeout = transitório. 400/401/403/404/`NO_PHONE` = permanente.

Worker interno a cada 2s no processo principal.

Idempotência: `UNIQUE(event_id, recipient_user_id, channel)`.

## Webhook

POST valida `X-Hub-Signature-256` (`CDS_WHATSAPP_APP_SECRET`). Sem secret → 401. Duplicata não reprocessa `DELIVERED`.

## Templates

Interpolação `{{company_name}}`, `{{amount}}`, `{{payment_method}}`. Sem HTML, sem débito/crédito, sem arquivo, sem URL de upload.

## Destinatários

Usuários ativos `OWNER|ACCOUNTANT|STAFF` do tenant, com telefone válido e evento habilitado. CLIENT não recebe WhatsApp administrativo e não configura o canal.

## Preferências

IN_APP padrão ligado. WhatsApp desligado até o escritório ativar. Eventos padrão no WhatsApp: despesa, receita, documento, classificação pendente, resposta de solicitação. Aprovação/rejeição de lançamento começam desligados.

## Status

`DESATIVADO` | `CONFIGURANDO` | `ATIVO` | `ERRO_CONFIGURACAO` | `INDISPONIVEL`

`ATIVO` só com canal ligado, token/adapter configurado e phone number id.

## Segurança / LGPD

Isolamento por `tenant_id`. Jobs de outro tenant não listam. Webhook localiza por `provider_message_id`. Sem chat, sem histórico de conversa, payload mínimo.

## Como testar

1. `npm test -- --test-concurrency=1`
2. Sem token: ativar no painel, criar despesa → IN_APP ok, job `FAILED`/`ERRO_CONFIGURACAO` ou envio mock nos testes.
3. Com credencial Meta: preencher env, phone number id, um número de teste, UMA mensagem controlada.

## Limitações

- Sem envio de arquivo no WhatsApp.
- Sem conversa bidirecional.
- Token é global do processo (env), não por tenant em texto aberto no banco.
- Health check não consulta a Graph API a cada GET status.
