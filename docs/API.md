# API principal

Todas as rotas abaixo usam `/api` e, exceto autenticação/health, exigem `Authorization: Bearer <token>`.

## Autenticação

- `POST /auth/login`
- `POST /auth/register`
- `GET /auth/me`

## Escritório e empresas

- `GET /tenant`
- `PATCH /tenant` — OWNER
- `GET /empresas`
- `POST /empresas`
- `PATCH /empresas/:id`
- `DELETE /empresas/:id`
- `GET /usuarios`
- `POST /usuarios`
- `PATCH /usuarios/:id`

## Plano de contas

- `GET /plano-contas`
- `GET /plano-contas/:id/accounts?search=`
- `POST /plano-contas/preview` — multipart `file`
- `POST /plano-contas/import` — multipart `file` + `name`
- `POST /plano-contas/accounts`

Formatos aceitos: PDF, CSV e TXT. O importador reconhece equivalentes de `Código`, `Classificação`, `Tipo` e `Descrição`.

## Cadastros

- `GET/POST/PATCH /categorias`
- `GET/POST/PATCH /bancos`
- `GET/POST/PATCH /regras-contabeis`
- `POST /regras-contabeis/simulate`

## Financeiro

- `GET/POST/PATCH /despesas`
- `GET/POST/PATCH /receitas`
- filtros de listagem: `status`, `from`, `to`

## Contábil

- `GET /lancamentos`
- `GET /lancamentos/:id`
- `POST /lancamentos` — lançamento manual balanceado
- `POST /lancamentos/:id/reclassificar`
- `GET /aprovacao/pendentes`
- `POST /aprovacao/:id/aprovar`
- `POST /aprovacao/:id/rejeitar`
- `GET /pendencias`

## Documentos

- `GET /documentos`
- `POST /documentos/upload` — multipart `file` + `company_id`
- `GET /documentos/:id/download`

## Solicitações

- `GET /solicitacoes`
- `POST /solicitacoes`
- `PATCH /solicitacoes/:id`

## Exportação

- `GET /exportacoes`
- `POST /exportacoes/gerar`
- `GET /exportacoes/:id/download`

O gerador só seleciona `entries.status='POSTED'`.

## Auditoria e notificações

- `GET /auditoria`
- `GET /notificacoes`
- `POST /notificacoes/:id/lida`

## Dashboard

- `GET /dashboard`

## Portal do cliente

Usuários `CLIENT` devem usar exclusivamente o namespace abaixo. A empresa é derivada do vínculo do usuário autenticado; `company_id` enviado pelo cliente é ignorado.

- `GET /client/dashboard`
- `GET /client/categorias`
- `GET /client/bancos`
- `GET/POST /client/despesas`
- `GET/POST /client/receitas`
- `GET /client/transacoes/:id`
- `GET/POST /client/documentos`
- `GET /client/pendencias`
- `POST /client/pendencias/:id/resposta`
- `GET /client/solicitacoes`
- `POST /client/solicitacoes/:id/resposta`
- `GET /client/notificacoes`
- `PATCH /client/notificacoes/:id/lida`

As respostas de pendências ficam disponíveis ao escritório em `GET /pendencias/:id/respostas`. O Portal não expõe plano de contas, regras, lançamentos, exportações ou auditoria administrativa.

## Estados contábeis

`NEEDS_CLASSIFICATION` → `PENDING` → `POSTED`. Rejeição: `PENDING` → `REJECTED` → `NEEDS_CLASSIFICATION`.

A aprovação é uma ação (`ENTRY_APPROVED`); o estado persistido após aprovar é `POSTED`. Uma aprovação só é aceita se a soma dos débitos for igual à soma dos créditos e maior que zero.
