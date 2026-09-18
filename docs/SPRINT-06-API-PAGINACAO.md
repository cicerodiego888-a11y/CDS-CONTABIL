# SPRINT 06 — API DE PAGINAÇÃO

Padrão real adotado no backend (`pageParams` / `paged` em `backend/src/server.js`).

## Query

| Parâmetro | Default | Regras |
|---|---|---|
| `page` | `1` | `>= 1`. Valores `0` ou inválidos viram `1`. |
| `page_size` | `25` | `1`–`100`. Alias `limit` aceito. `999999` vira `100`. Negativo vira `1`. |
| `q` / `search` | — | Busca textual no SQLite quando o endpoint suporta. |
| `sort` / `dir` | empresas: `name` / `asc` | **Whitelist** de colunas. `dir` só `asc` ou `desc`. |

Não existe Redis, cursor pagination nem cache distribuído.

## Envelope

Compatível com o contrato anterior de empresas (`items` + `total` + `page` + `page_size` + `pages` + `from` + `to`):

```json
{
  "items": [],
  "total": 1234,
  "page": 1,
  "page_size": 25,
  "pages": 50,
  "from": 1,
  "to": 25,
  "pagination": {
    "page": 1,
    "page_size": 25,
    "total": 1234,
    "total_pages": 50
  }
}
```

O frontend do escritório lê `items` (helper `listItems`). Consumidores que esperavam array foram atualizados.

## Endpoints paginados

Todos aplicam `tenant_id` do JWT. Com header `X-Company-Id` válido, filtram `company_id` do contexto. `COUNT` usa os mesmos filtros.

| Método | Caminho | Busca / filtros extras |
|---|---|---|
| GET | `/api/empresas` | `q` em razão social, fantasia e CNPJ; `status`; `sort` whitelist |
| GET | `/api/usuarios` | `q` em nome e e-mail |
| GET | `/api/despesas` | `status`, `category_id`, `payment_method`, `from`, `to`, `q` (descrição) |
| GET | `/api/receitas` | `status`, `category_id`, `receipt_method`, `from`, `to`, `q` |
| GET | `/api/documentos` | `status`, `from`, `to`, `type=pdf\|image`, `q` (nome do arquivo) |
| GET | `/api/lancamentos` | `status`, `q` (histórico) |
| GET | `/api/aprovacao/pendentes` | fila `PENDING` / `NEEDS_CLASSIFICATION` |
| GET | `/api/pendencias` | default `status=OPEN`; `status=ALL` lista todos; `type`, `from`, `to` |
| GET | `/api/solicitacoes` | `status`, `q` (título/descrição) |
| GET | `/api/exportacoes` | histórico, sem alterar CSV canônico |

## Não paginados (documentado)

- `GET /api/categorias`, `/api/bancos`, `/api/regras-contabeis` — configuração.
- `GET /api/client/despesas`, `/api/client/receitas`, demais listas do portal — empresa única.
- `GET /api/auditoria` — `LIMIT 500`.
- `GET /api/empresas/:id/users` — usuários CLIENT daquela empresa.

## Isolamento

`total` **não** é `SELECT COUNT(*)` global. Sempre `WHERE tenant_id=?` e, no contexto, `company_id=?`.
