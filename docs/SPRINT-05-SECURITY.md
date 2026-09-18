# Sprint 05 — Segurança e autenticação multi-tenant

Documento honesto do estado real após a Sprint 05. Não descreve o sistema como “100% seguro”.

## 1. Problemas encontrados

- Login buscava usuário só por e-mail (`SELECT ... WHERE lower(email)=?`), colidindo se dois tenants tivessem o mesmo endereço.
- `JWT_SECRET` tinha fallback fixo `cds-contabil-connect-change-this-secret`.
- Token de convite era impresso em `console.log` com a URL completa.
- `POST /api/auth/register` criava escritório/tenant sem restrição de ambiente.
- `POST/PATCH /api/usuarios` aceitava `role` (incluindo OWNER) para ACCOUNTANT.
- `companyOk` retornava `true` para escritório sem contexto, sem checar se a empresa pertencia ao tenant.
- CORS era `cors()` (origem refletida de forma irrestrita / `*`).
- JWT do escritório e do portal permanece em `localStorage`.

## 2. Solução implementada

Identificador estável de escritório: `tenants.slug`. O login exige `tenant` (slug ou id) + e-mail + senha + usuário ativo. Mensagens de falha genéricas: “Credenciais inválidas.”

## 3. Autenticação (antes / depois)

**Antes:** e-mail global + senha.  
**Depois:** contexto de tenant obrigatório no login; JWT HS256 12h com `sub`, `tenant_id`, `role`, `company_id`, `profile`; `iat` padrão do jsonwebtoken.

## 4. Autorização

- Papel do JWT, nunca do body.
- `tenant_id` do body é descartado.
- OWNER atribui OWNER/ACCOUNTANT/STAFF.
- ACCOUNTANT atribui ACCOUNTANT/STAFF; não altera OWNER nem cria OWNER.
- STAFF não cria/altera usuários de escritório.
- CLIENT só `/api/client/*` (APIs administrativas 403).
- CLIENT_VIEWER continua sem escrita (despesa/receita/documento) via `effectiveClientPermission`.

## 5. Multi-tenant

`UNIQUE(tenant_id, email)` no schema original foi preservado. O mesmo e-mail pode existir em tenants diferentes. Slug único por escritório.

## 6. JWT

- Production: servidor **não inicia** sem `JWT_SECRET` forte (≥16 caracteres; fallbacks conhecidos rejeitados).
- Desenvolvimento/teste: se ausente, usa `cds-dev-only-not-for-production` (explícito, não produtivo).
- Verify com `algorithms: ['HS256']`.

## 7. Convites

Log: `Convite criado para usuario {id} no tenant {id}.`  
Token continua só no hash (banco) e, fora de production, em `activation_url` da resposta HTTP para testes/demo — **não** no stdout.

## 8. Documentos

Download: `tenant_id` do JWT + `companyOk` (contexto, se houver). Documento de outro tenant → 404.

## 9. Exportações

`company_id` validado contra o tenant; com `X-Company-Id` o contexto prevalece. Empresa de outro tenant → 400/404, sem listar exportações alheias.

## 10. CORS / headers

- Production: origens de `CDS_CORS_ORIGIN` (lista). Sem variável, CORS não reflete qualquer origem (`origin: false`).
- Demais ambientes: `origin: true` (reflete a Origin da requisição; necessário para o frontend local).
- Headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Powered-By` desligado.

## 11. Rate limit

Implementado em memória no `POST /api/auth/login`: 8 tentativas / 15 min em production; 200 fora; `CDS_LOGIN_MAX` sobrescreve. Sem Redis. Reinício do processo zera o contador.

## 12. Registro público

`POST /api/auth/register` **desabilitado** quando `NODE_ENV=production`. Em development/test permanece para bootstrap e suíte.

## 13. Pontos pendentes

- JWT em `localStorage` (XSS pode roubar sessão).
- Sem denylist/revogação de JWT (logout é client-side + endpoint no-op).
- Rate limit in-memory, não distribuído.
- Sem ACL por empresa (STAFF/ACCOUNTANT veem o tenant inteiro).
- Login por e-mail ainda é único **dentro** do tenant (não global).
- Helmet não foi instalado (headers manuais).
- Cookies HttpOnly não foram adotados nesta Sprint.

## 14. Riscos conhecidos

- XSS no frontend vanilla continua crítico por causa do `localStorage`.
- Convite em claro na resposta HTTP em não-produção.
- Seed/demo com senha conhecida.

## 15. Testes

Ver `tests/security-auth.test.js` e regressão `npm test -- --test-concurrency=1`.

## 16. Resultado

Sprint 05 corrige as falhas de auth/isolamento listadas acima. Não homologa adapters, motor N linhas nem “segurança total”.
