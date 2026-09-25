# Sprint 28.4 — Identidade do Escritório

## Regra de propriedade

- A **logo pertence ao TENANT** (escritório de contabilidade).
- Não pertence a `company_id`, `user_id` nem a perfis CLIENT.
- Um escritório possui **uma** identidade principal (`UNIQUE(tenant_id)`).
- CDS Contábil Connect permanece como plataforma tecnológica (secundária/discreta).

```
TENANT / ESCRITÓRIO
├── identidade (logo)
├── usuários do escritório
└── empresas clientes (apenas consomem a identidade)
```

## Persistência

Reutiliza a tabela existente `tenant_branding` (migration `013_tenant_branding.sql`).

Campos auxiliares (boot `ensureColumn` + stub `034_tenant_branding_meta.sql`):

- `logo_size`
- `logo_updated_at`

Armazenamento controlado:

```
uploads/branding/{tenant_id}/logo.{png|jpg|webp}
```

O banco guarda apenas referência relativa, ex.: `{tenant_id}/logo.webp`.  
Nunca se expõe caminho físico absoluto na API.

## Permissões

| Perfil | GET (office) | POST/PATCH/DELETE logo |
|--------|--------------|-------------------------|
| OWNER | sim | sim |
| ACCOUNTANT | sim | sim |
| STAFF | sim (leitura) | **403** |
| CLIENT_* | **403** em `/api/tenant/branding*` | **403** |

CLIENT consome via:

- `GET /api/client/branding`
- `GET /api/client/branding/logo`

Mutação CLIENT (`POST`/`DELETE`/`PATCH` em branding) → **403**.

Autoridade no **backend**; frontend apenas oculta ações.

## API

### Escritório (autenticado)

- `GET /api/tenant/branding` → `{ configured, has_logo, logo_url, office_name, slogan, updated_at, ... }`
- `PATCH /api/tenant/branding` → nome/slogan (OWNER/ACCOUNTANT)
- `POST /api/tenant/branding/logo` → upload (OWNER/ACCOUNTANT)
- `DELETE /api/tenant/branding/logo` → remove (OWNER/ACCOUNTANT)
- `GET /api/tenant/branding/logo` → bytes da imagem

### Público (login pré-auth)

Resolve contexto pelo **código/slug** do escritório (mesmo mecanismo do login), sem aceitar `tenant_id` arbitrário:

- `GET /api/public/branding?tenant={slug}`
- `GET /api/public/branding/logo?tenant={slug}&v={updated_at}`

Alias seguro: `demo` → `escritorio-demonstracao`.

Slug inexistente ou inativo → `{ configured: false, logo_url: null }` (fallback CDS).

### Cliente

- `GET /api/client/branding` / `GET /api/client/branding/logo` — somente o tenant da sessão.

## Upload e validação

Formatos: PNG, JPG/JPEG, WEBP (magic bytes + extensão).

Rejeita: SVG, HTML, JS, MIME/extensão incompatíveis, conteúdo inválido.

Limite: **5 MB** — mensagem: `Arquivo muito grande. O tamanho máximo permitido é 5 MB.`

## Cache

`logo_url` inclui `?v={logo_updated_at|updated_at}` para invalidar logo antiga após substituição.

## Login

1. Portal do Cliente: e-mail + senha (Login V2); sem código do escritório.
2. Branding no card: logo do escritório quando conhecida (último ambiente lembrado via `ccc_last_tenant`, ou após login / escolha de ambiente).
3. Sem logo conhecida → slot vazio (não usa CDS como marca principal do portal).
4. API legada: `/api/public/branding?tenant=...` continua disponível para carregar a identidade por slug.

## Portais

- **Portal do Contador** → Configurações → Identidade do Escritório (preview, alterar, remover).
- **Portal do Cliente** → apenas consome (login + nav); **sem** tela de configuração de logo.

## Auditoria

Eventos em `audit_logs`:

- `TENANT_BRANDING_CREATED`
- `TENANT_BRANDING_UPDATED`
- `TENANT_BRANDING_DELETED`

Registra `tenant_id`, `user_id`, ação e metadados (mime/size).  
Não registra binário da imagem, senhas ou tokens.

## Isolamento multi-tenant

Toda operação usa `tenant_id` da sessão (ou slug público validado).  
Tenant A nunca recebe logo de B/C.

## Testes

`tests/sprint-28.4-tenant-branding.test.js` cobre create/update/delete, ACL, isolamento A/B/C, formatos, rejeições, auditoria, versionamento, login público e consumo CLIENT.

## Fora de escopo

Logo por empresa, temas por cliente, múltiplas logos, editor de cores, alteração de autenticação ou NotificationService.
