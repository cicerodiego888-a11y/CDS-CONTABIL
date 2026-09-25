# Código interno do cliente (`codigo_cliente`)

## Finalidade

Identificador amigável e interno das **empresas clientes** de cada escritório (tenant), no padrão `CLI-000001`.

Não é credencial de login. Não substitui CNPJ nem `company_id`.

## Formato

```
CLI- + 6 dígitos
CLI-000001
CLI-000002
…
CLI-999999
```

Regex: `^CLI-\d{6}$`

## Relação com outros identificadores

| Campo | Papel |
|-------|--------|
| `tenant_id` | Escritório contábil (isolamento multi-tenant) |
| `company_id` (`companies.id`) | Identificador interno técnico da empresa |
| `codigo_cliente` | Código amigável operacional por tenant |
| CNPJ | Identificação fiscal oficial |

É permitido o mesmo `CLI-000001` em tenants diferentes.  
Dentro do mesmo tenant, `UNIQUE(tenant_id, codigo_cliente)`.

## Geração automática

Ao `POST /api/empresas`:

1. Valida CNPJ e regras existentes
2. Ignora `codigo_cliente` / `client_code` / `company_id` / `tenant_id` do body
3. Em transação **IMMEDIATE**, aloca o próximo número via `tenant_client_code_seq`
4. Persiste `codigo_cliente` na mesma transação do insert
5. Audita `CLIENT_CODE_GENERATED` e `COMPANY_CREATED`

O usuário não digita e não edita o código (`PATCH` também descarta o campo).

## Sequência por tenant

Contador em `tenant_client_code_seq(tenant_id, next_num)`.

Cada tenant começa em `CLI-000001` independentemente.

## Concorrência

Alocação sob `BEGIN IMMEDIATE` (better-sqlite3 `transaction().immediate()`), com incremento atômico do contador e verificação de unicidade. Conflito raro → tenta o próximo número.

Não usar `MAX()+1` fora de transação.

## Backfill

Na abertura do banco, `backfillClientCodes`:

- Seleciona empresas com `codigo_cliente` nulo/vazio
- **Ordem determinística:** `datetime(created_at) ASC, id ASC` por tenant
- Idempotente: quem já tem código não muda
- Não altera CNPJ, razão social, usuários, documentos nem lançamentos

## Matriz e filial

Sem mudança na arquitetura fiscal. Matriz e filial com CNPJs distintos recebem códigos distintos (`CLI-…` separados). O CNPJ continua sendo a chave fiscal.

## Isolamento

Listagens e detalhe de empresas usam o `tenant_id` autenticado. Não há endpoint público de `codigo_cliente`. Tenant A não vê empresas/códigos do Tenant B.

## Auditoria

Evento: `CLIENT_CODE_GENERATED`  
Payload típico: `tenant_id`, `company_id`, `codigo_cliente`, `context` (`create` | `backfill`).

Sem senhas ou credenciais.

## Schema

- Coluna `companies.codigo_cliente`
- Índice único parcial `(tenant_id, codigo_cliente)`
- Tabela `tenant_client_code_seq`

Arquivo: `database/schema/039_client_code.sql` (+ `ensureColumn` em `database.js`).

## Fora de escopo (Etapa 2)

Novo login, remoção do código do escritório na tela, branding, SMTP, portal.
