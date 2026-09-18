# SPRINT 06 — ESCALA OPERACIONAL

## 1. Baseline

Suíte anterior (Sprint 05): **80 PASS / 0 FAIL / 0 SKIP**.

Após Sprint 06: `npm test -- --test-concurrency=1` → **96 PASS / 0 FAIL / 0 SKIP**.

Massa de escala usa banco temporário (`CDS_DB_PATH` em `os.tmpdir()`), não a base de desenvolvimento.

## 2. Listas encontradas (inventário real)

| Recurso | Endpoint de escritório | Antes | Depois |
|---|---|---|---|
| Empresas | `GET /api/empresas` | já paginado (`items` + `total`) | default `page_size=25`, `pagination` aninhado, busca `q` no SQLite |
| Usuários (escritório) | `GET /api/usuarios` | array completo | paginado + busca nome/e-mail |
| Documentos | `GET /api/documentos` | `LIMIT 200` sem COUNT | paginado, COUNT com os mesmos filtros |
| Despesas | `GET /api/despesas` | array sem LIMIT | paginado (`pageTx`) |
| Receitas | `GET /api/receitas` | array sem LIMIT | paginado |
| Lançamentos | `GET /api/lancamentos` | array + N+1 por linha | paginado + subquery de débito |
| Aprovação | `GET /api/aprovacao/pendentes` | array + `entry()` N+1 | paginado + somas em subquery |
| Pendências | `GET /api/pendencias` | array OPEN | paginado (default `status=OPEN`) |
| Solicitações | `GET /api/solicitacoes` | array | paginado |
| Exportações | `GET /api/exportacoes` | array | paginado |
| Categorias | `GET /api/categorias` | array tenant/company | **sem paginação** (cadastro pequeno) |
| Bancos | `GET /api/bancos` | array | **sem paginação** |
| Regras | `GET /api/regras-contabeis` | array | **sem paginação** |
| Plano / contas | `GET /api/plano-contas`, `.../accounts` | LIMIT 10000 nas contas | inalterado (configuração) |
| Auditoria | `GET /api/auditoria` | `LIMIT 500` | inalterado nesta sprint |
| Notificações | `GET /api/notificacoes` | `LIMIT 100` | inalterado |
| Usuários da empresa | `GET /api/empresas/:id/users` | array da empresa | inalterado (escopo de uma empresa) |
| Portal cliente | `/api/client/*` listas | arrays da empresa única | **inalterado** (single-company) |

Endpoints **não inventados**. Dashboard já agregava em SQL (`SUM`/`COUNT`); aceita `from`/`to` se enviados, sem nova UX de período.

## 3. Endpoints paginados e parâmetros

Ver `docs/SPRINT-06-API-PAGINACAO.md`.

## 4. Índices adicionados (`database/schema/007_scale_indexes.sql`)

- `idx_entries_tenant_company` `(tenant_id, company_id, occurred_on)`
- `idx_entry_lines_entry_side` `(entry_id, side)`
- `idx_exports_tenant_company` `(tenant_id, company_id, created_at)`
- `idx_pendencies_company` `(tenant_id, company_id, status)`
- `idx_requests_company` `(tenant_id, company_id, created_at)`
- `idx_users_tenant_name` / `idx_users_tenant_email`
- `idx_expenses_description` / `idx_revenues_description` `(tenant_id, company_id, description)`

Índices já existentes de empresas (`tenant_id` + name/cnpj/status/created_at) foram reaproveitados. Não foram criados dezenas de índices.

### EXPLAIN QUERY PLAN (relevante)

Busca paginada de empresas (`tenant_id` + `LIKE` em nome/fantasia, `ORDER BY name LIMIT 25`): o plano percorre a tabela `companies` com os filtros de tenant. Índices `idx_companies_tenant_name` / `idx_companies_tenant_cnpj` existem para as consultas por nome/CNPJ. Com 1001 empresas no teste, `GET /api/empresas?page=1&page_size=25` retornou **25 itens** em menos de 2s.

## 5. N+1

Encontrados:

1. `GET /api/lancamentos`: `qRows(...).map` + `one(SUM entry_lines)` por lançamento.
2. `GET /api/aprovacao/pendentes`: `entry(req, e.id)` (linhas + contas) por item da fila.

Corrigidos:

1. Soma de débito via `COALESCE((SELECT SUM(...) FROM entry_lines WHERE entry_id=e.id AND side='D'),0)` na query da lista.
2. Débito/crédito na fila de aprovação via subqueries; `entry.balanced` sem carregar o lançamento completo.

Não refatorado: `GET /api/lancamentos/:id` (detalhe único, `entry()` é adequado); exportação canônica ainda lê linhas por lançamento **aprovado do período** (geração de arquivo, não listagem).

## 6. Frontend

- `loadBase` **não** baixa mais 30 empresas ativas.
- Seletor remoto (`#companyPickerSearch`) consulta `GET /api/empresas?q=&page_size=15` com debounce 350ms e sequência para ignorar respostas antigas.
- No contexto `/empresas/:id` o campo empresa é somente leitura (“Você está trabalhando em: …”).
- Listas do escritório: estados Carregando / vazio / erro / pager (Anterior / Próxima).
- Busca de empresas e usuários com debounce.
- Cache-bust `?v=s06-1`.
- Portal do cliente não paginado nesta sprint (empresa única).

## 7. Backend

- `pageParams` default 25, máximo 100; `page` mínimo 1; `page_size` inválido normalizado.
- `paged()` mantém `items`, `total`, `page`, `page_size`, `pages`, `from`, `to` e adiciona `pagination: { page, page_size, total, total_pages }`.
- `COUNT(*)` usa o mesmo `WHERE` da lista (tenant + company + filtros).
- Ordenação de empresas: whitelist `name|trade_name|cnpj|created_at|status`.
- `listTx` permanece array completo **somente** para o portal cliente.

## 8. Testes de escala

Arquivo `tests/scale-pagination.test.js`: tenant A com **1001 empresas**, tenant B com **501**. Listagens internas com 40–60 registros. Banco descartado no `after`.

## 9. Segurança

Isolamento tenant/company, anti-spoof `X-Company-Id` vs `company_id` no body, header de outro tenant → 404, CLIENT no portal: testes Sprint 04/05 preservados.

## 10. Pendências

- Portal cliente e auditoria ainda limitam/listam sem o envelope `{ items, pagination }` (volume por empresa única / LIMIT 500).
- Filtro de período no dashboard da UI não foi expandido (API já aceita `from`/`to`).
- Paginação offset (não cursor).
- Plano de contas ainda pode carregar até 10.000 contas no detalhe do plano (fora do escopo de listas operacionais).
- Motor N linhas (Sprint 07) não implementado.

## 11. Decisão categorias / bancos / regras

Listas de configuração por tenant, volume esperado baixo. Permanece sem paginação; consultas continuam filtradas por `tenant_id` e, no contexto, por empresa ou global (`company_id IS NULL OR company_id=?`).
