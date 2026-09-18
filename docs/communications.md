# Motor de Comunicações CDS

O escritório pede `communicationService.send` / `deliverInvite`. Não fala com SMTP, Meta ou chaves de API.

```
Aplicação
  → CommunicationService
      → Email (CdsEmailProvider | SmtpEmailProvider)
      → WhatsApp (engine Sprint 10, inalterado)
      → fila communication_jobs
```

## Providers de e-mail

| Provider | Quando entra | Envio real |
|---|---|---|
| `cds` | Padrão conceitual de tenant novo / sem SMTP explícito | Somente se `CDS_EMAIL_API_URL` e `CDS_EMAIL_API_KEY` existirem |
| `smtp` | Tenant escolheu servidor próprio e gravou credencial, ou fallback `.env` SMTP do operador | `sendSmtp` (Sprints 13.5 / 13.5.2) |
| `off` | Escolha explícita | Nenhum envio |

Não há fake-send. Sem infraestrutura CDS, o status é `NOT_CONFIGURED` / `email_sent: false`.

Resolver (`emailProviderForTenant`):

1. SMTP persistido do tenant (não troca silenciosamente quem já usa SMTP)
2. `off` se gravado
3. CDS se o tenant escolheu CDS e a API estiver disponível
4. Override de teste
5. CDS se a API SaaS estiver disponível
6. SMTP do `.env` (operador)
7. Nenhum

## Fila e estados

Reusa `communication_jobs` (Sprint 10). Canal `EMAIL` usa `PENDING`, `PROCESSING`, `ACCEPTED`, `FAILED`, `CANCELLED`. WhatsApp continua com `SENT` / `DELIVERED`.

Retry: até 3 tentativas, backoff 15s / 60s / 180s. Erros permanentes (`EMAIL_NOT_CONFIGURED`, `EMAIL_AUTH_FAILED`) vão para `FAILED`.

`last_error` guarda código, nunca senha, token ou API key.

## Eventos

Catálogo em `backend/src/communications/communication-events.js` (`USER_INVITE`, `USER_INVITE_RESEND`, `EMAIL_TEST`, eventos do Sprint 08). Convite sempre gera job. Eventos operacionais (despesa, documento, etc.) só geram e-mail se o provider estiver disponível e `email_enabled` da preferência não for `0`.

## Convite

Cadastro do usuário → convite 72h (hash) → `communication_job` → provider. Sem SMTP/CDS o usuário e o convite existem; a mensagem admite que o envio não ocorreu.

## Templates

`backend/src/communications/email/templates/` reutiliza o HTML de convite e aplica nome do escritório (branding). Sem logo o envio não quebra.

## Segurança

- `tenant_id` só da sessão
- GET de e-mail sem senha / API key
- OWNER / ACCOUNTANT gravam; STAFF lê; `CLIENT_*` 403
- WhatsApp, preferências in-app e SMTP AES-256-GCM permanecem

## Configuração futura CDS

```
CDS_EMAIL_API_URL=
CDS_EMAIL_API_KEY=
```

Enquanto vazias, a UI mostra *Aguardando configuração da infraestrutura de e-mail*. Não documente essa API como se já enviasse para a internet.
