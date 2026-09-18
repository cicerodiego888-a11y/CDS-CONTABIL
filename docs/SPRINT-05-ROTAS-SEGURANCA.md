# Matriz real de rotas — Sprint 05

Inventário extraído de `backend/src/server.js`. Rotas estáticas (`/`, `/portal/`, `/convite/:token`, assets) omitidas na tabela de API.

Legenda: Auth = JWT Bearer. Tenant = `req.user.tenant_id`. Company = `X-Company-Id` validado (`scope`) e/ou `company_id` validado no tenant. R = leitura, W = escrita.

| Método | Caminho | Pública | Auth | Tenant JWT | Company | Roles | R/W |
|---|---|---|---|---|---|---|---|
| GET | /api/health | sim | não | — | — | — | R |
| POST | /api/auth/register | sim* | não | cria tenant | — | — | W |
| POST | /api/auth/login | sim | não | via slug | — | — | R |
| POST | /api/auth/logout | sim | opcional | — | — | — | W |
| POST | /api/auth/password | não | sim | sim | — | autenticado | W |
| GET | /api/auth/me | não | sim | sim | — | autenticado | R |
| GET | /api/tenant | não | sim | sim | — | autenticado | R |
| PATCH | /api/tenant | não | sim | sim | — | OWNER | W |
| GET | /api/empresas | não | sim | sim | não filtra lista office | office; CLIENT bloqueado | R |
| GET | /api/empresas/:id | não | sim | sim | path id no tenant | OWNER, ACCOUNTANT, STAFF | R |
| POST | /api/empresas | não | sim | sim | nova no tenant | OWNER, ACCOUNTANT, STAFF | W |
| PATCH | /api/empresas/:id | não | sim | sim | path | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/empresas/:id/bloquear | não | sim | sim | path | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/empresas/:id/desbloquear | não | sim | sim | path | OWNER, ACCOUNTANT, STAFF | W |
| DELETE | /api/empresas/:id | não | sim | sim | path | OWNER, ACCOUNTANT | W |
| GET | /api/usuarios | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | R |
| POST | /api/usuarios | não | sim | sim | — | OWNER, ACCOUNTANT (roles limitadas) | W |
| PATCH | /api/usuarios/:id | não | sim | sim | — | OWNER, ACCOUNTANT (sem elevação) | W |
| GET | /api/empresas/:id/users | não | sim | sim | path | OWNER, ACCOUNTANT, STAFF | R |
| GET | /api/empresas/:id/users/:userId | não | sim | sim | path | OWNER, ACCOUNTANT, STAFF | R |
| POST | /api/empresas/:id/users | não | sim | sim | path ACTIVE | OWNER, ACCOUNTANT, STAFF | W |
| PATCH | /api/client-users/:id | não | sim | sim | user.company | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/client-users/:id/resend-invitation | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/client-users/:id/revoke-invitation | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/client-users/:id/block | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/client-users/:id/unblock | não | sim | sim | empresa ACTIVE | OWNER, ACCOUNTANT, STAFF | W |
| GET | /api/plano-contas | não | sim | sim | — (por tenant) | OWNER, ACCOUNTANT, STAFF | R |
| GET | /api/plano-contas/:id/accounts | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | R |
| POST | /api/plano-contas/preview | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/plano-contas/import | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/plano-contas/accounts | não | sim | sim | — | OWNER, ACCOUNTANT | W |
| GET | /api/categorias | não | sim | sim | scope opcional | auth + CLIENT bloqueado no prefixo | R |
| POST/PATCH | /api/categorias | não | sim | sim | body validável | OWNER, ACCOUNTANT, STAFF | W |
| GET | /api/bancos | não | sim | sim | scope opcional | idem | R |
| POST/PATCH | /api/bancos | não | sim | sim | body | OWNER, ACCOUNTANT, STAFF | W |
| GET | /api/regras-contabeis | não | sim | sim | scope (global+empresa) | OWNER, ACCOUNTANT, STAFF | R |
| POST/PATCH | /api/regras-contabeis | não | sim | sim | body | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/regras-contabeis/simulate | não | sim | sim | body | OWNER, ACCOUNTANT, STAFF | R |
| GET | /api/documentos | não | sim | sim | scope | autenticado office | R |
| POST | /api/documentos/upload | não | sim | sim | contexto ou body no tenant; ACTIVE | autenticado office | W |
| GET | /api/documentos/:id/download | não | sim | sim | companyOk | autenticado | R |
| GET/POST | /api/despesas | não | sim | sim | scope / createTx | office | R/W |
| PATCH | /api/despesas/:id | não | sim | sim | companyOk | office | W |
| GET/POST | /api/receitas | não | sim | sim | idem | office | R/W |
| PATCH | /api/receitas/:id | não | sim | sim | companyOk | office | W |
| GET | /api/lancamentos | não | sim | sim | scope | autenticado office | R |
| GET | /api/lancamentos/:id | não | sim | sim | companyOk | autenticado | R |
| POST | /api/lancamentos | não | sim | sim | contexto/body + ACTIVE | OWNER, ACCOUNTANT, STAFF | W |
| POST | /api/lancamentos/:id/reclassificar | não | sim | sim | companyOk | OWNER, ACCOUNTANT, STAFF | W |
| GET | /api/aprovacao/pendentes | não | sim | sim | scope | office | R |
| POST | /api/aprovacao/:id/aprovar | não | sim | sim | companyOk | OWNER, ACCOUNTANT | W |
| POST | /api/aprovacao/:id/rejeitar | não | sim | sim | companyOk | OWNER, ACCOUNTANT | W |
| GET | /api/pendencias | não | sim | sim | scope | autenticado office | R |
| GET | /api/solicitacoes | não | sim | sim | scope | autenticado office | R |
| POST | /api/solicitacoes | não | sim | sim | contexto/body | autenticado office | W |
| GET | /api/auditoria | não | sim | sim | — | OWNER, ACCOUNTANT, STAFF | R |
| GET | /api/dashboard | não | sim | sim | scope | autenticado office | R |
| GET | /api/exportacoes | não | sim | sim | scope | OWNER, ACCOUNTANT, STAFF | R |
| POST | /api/exportacoes/gerar | não | sim | sim | contexto/body + ACTIVE | OWNER, ACCOUNTANT, STAFF | W |
| GET | /api/exportacoes/:id/download | não | sim | sim | companyOk | autenticado | R |
| GET | /api/invitations/:token | sim | hash | — | — | — | R |
| POST | /api/invitations/:token/accept | sim | hash | do convite | empresa ACTIVE | — | W |
| GET/POST/PATCH | /api/client/* | não | sim | sim | sessão CLIENT | CLIENT + perfil | misto |

\* `POST /api/auth/register` é pública apenas fora de `NODE_ENV=production`.

Portal do cliente: empresa vem da sessão JWT (`company_id`), não de escolha na UI.
