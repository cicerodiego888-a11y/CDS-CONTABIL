# Sprint 28.2 — Motor Central de Notificações

## Objetivo

Unificar in-app + Web Push sob um único `NotificationService`, sem alterar a arquitetura de empresas nem o fluxo funcional da 28.1.1.

## Arquitetura

```
EVENTO DE DOMÍNIO / Solicitações
        ↓
NotificationService.notify / notifyRequestMessage / deliverPushForDomainEvent
        ↓
RecipientResolver (tenant + company + role + prefs)
        ↓
notifications (in-app) + PushService (canal)
        ↓
Service Worker / toast / badge
```

## Módulos

- `backend/src/notifications/types.js` — catálogo
- `backend/src/notifications/templates.js` — conteúdo, preview, deep-link, actions
- `backend/src/notifications/resolver.js` — destinatários
- `backend/src/notifications/service.js` — motor
- `backend/src/notifications/routes.js` — aliases unread/read

## Integrações

| Origem | Tipo canônico | Canal |
|--------|---------------|-------|
| Solicitações (mensagem) | REQUEST_MESSAGE | NotificationService → Push |
| DOCUMENT_UPLOADED | DOCUMENT_RECEIVED | domain-events in-app + push |
| EXPENSE_CREATED | EXPENSE_RECEIVED | domain-events in-app + push |
| CLASSIFICATION_REQUIRED | CLASSIFICATION_PENDING | domain-events in-app + push |
| ENTRY_APPROVED | APPROVAL_COMPLETED | domain-events in-app + push |
| IMPORT_* | INTEGRATION_* | domain-events in-app + push |
| PROCESS_STEP_OVERDUE | PROCESS_STEP_OVERDUE | domain-events + push |

Tipos preparados sem disparo artificial: `DOCUMENT_ANALYSIS_*`, `APPROVAL_PENDING`, `PROCESS_STEP_DUE`, etc.

## Preferências

`user_notification_prefs` evoluiu com colunas por categoria (default ligado).

## PWA

Manifests da 28.1.2 mantidos. Identidade: **CDS Contábil Connect**.
