# Sprint 28.3 — Cabeçalho do Cliente, sessões e Push por portal

## Problema encontrado

Após a Sprint 28.2 (Motor Central de Notificações), o Portal do Cliente ainda:

- usava cabeçalho diferente do Portal do Contador;
- compartilhava `localStorage["ccc_token"]` com o Contador (sobrescrita de sessão no mesmo navegador);
- registrava o mesmo Service Worker (`/service-worker.js`, escopo `/`);
- exibia popup HTML próprio (`showClientRequestAlert` / `showClientDocumentAlert`) além do Push nativo e do sino.

## O que a Sprint 28.3 corrigiu

Sem alterar `NotificationService`, `RecipientResolver`, domain-events, tenant/company ou regras dos módulos:

1. **Cabeçalho unificado** (`CdsAppHeader`) no Portal do Cliente, no mesmo padrão visual do Contador: empresa ativa (somente leitura), pesquisa no escopo permitido, sino, ajuda, avatar/perfil.
2. **Sino** alimentado por `GET /api/notificacoes/nao-lidas`; dropdown com marcar individual / marcar todas via `PATCH .../read` e `PATCH .../read-all`.
3. **Sessões separadas**: `ccc_office_token` (Contador) e `ccc_client_token` (Cliente); logout de um não apaga o outro; migração segura a partir de `ccc_token` legado após `/auth/me`.
4. **Service Workers separados**:
   - Contador: `/service-worker.js` (escopo `/`)
   - Cliente: `/portal/service-worker.js` (escopo `/portal/`)
5. **Push client** (`push-client.js`) registra o SW conforme o path (`resolveSwConfig`).
6. **Remoção do popup HTML** de notificação; canais restantes: sino + página Notificações + notificação nativa do navegador/Windows.
7. **PWA Cliente** mantém identidade CDS Contábil Connect (`/portal/manifest.webmanifest`, scope `/portal/`).

## Arquitetura (depois)

```
                 CDS CONTÁBIL CONNECT
                         │
             ┌───────────┴───────────┐
             │                       │
       PORTAL CONTADOR          PORTAL CLIENTE
             │                       │
    ccc_office_token         ccc_client_token
             │                       │
    SW /service-worker.js    SW /portal/service-worker.js
             │                       │
          Push OFFICE             Push CLIENT
             │                       │
             └───────────┬───────────┘
                         │
                  NotificationService
                         │
                  RecipientResolver
                         │
                  Notification Center + 🔔
                         +
                 Notificação nativa
```

## Segurança

- `tenant_id` + `company_id` + role preservados nas rotas de unread/read/read-all e na subscription Push (IDs derivados da sessão, não do body).
- `UNIQUE(endpoint)` / `ENDPOINT_CONFLICT` mantidos.
- CLIENT não acessa listagem office de `/api/notificacoes`; apenas aliases liberados (`nao-lidas`, `:id/read`, `read-all`, `prefs-canais`) + rotas `/api/client/*`.

## Limitações do navegador

Em alguns ambientes o Push endpoint pode ser reutilizado entre registrations; o backend continua recusando associação silenciosa a outro usuário.

## Testes

- `tests/sprint-28.3-client-header-push.test.js`
- Regressão: `npm test`
- `PRAGMA integrity_check` → `ok`
- `PRAGMA foreign_key_check` → 0 registros

## Resultado final

Cada portal tem sessão, escopo, Service Worker, Push e cabeçalho próprios, sem segundo motor de notificações e sem moldura HTML duplicada.
