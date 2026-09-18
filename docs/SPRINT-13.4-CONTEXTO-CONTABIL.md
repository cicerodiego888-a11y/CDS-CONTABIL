# Sprint 13.4 — Empresa como contexto principal de trabalho

## Regra oficial

A **empresa** é o contexto principal de trabalho contábil. O menu global do escritório serve à **gestão da carteira** e às **filas transversais**. O trabalho de classificação, lançamentos, aprovação e importação de uma empresa acontece em `/empresas/:id`.

Receitas **continuam no domínio** (tabela, APIs, importação `type=REVENUE`, evento `REVENUE_CREATED`, vínculo com movimentação/lançamento/auditoria). Não são módulo operacional global e o cliente não as cadastra.

## Menu global do escritório

- GESTÃO: Empresas, Equipe e acessos, Documentos, Pendências, Solicitações, Importações, Despesas
- FILAS DE TRABALHO: Classificação, Aprovação
- CONFIGURAÇÕES CONTÁBEIS, RELATÓRIOS, SISTEMA

Não há mais o grupo MOVIMENTAÇÕES com Receitas / Classificação / Lançamentos / Aprovação.

Classificação e Aprovação globais são filas da carteira: cada registro identifica a empresa (`company_id` / `company_name`).

## Contexto da empresa (`/empresas/:id`)

- OPERAÇÃO: Visão geral, Despesas, Documentos, Pendências, Solicitações
- CONTÁBIL: Classificação, Lançamentos, Aprovação
- IMPORTAÇÃO: Importações
- ACESSO: Usuários

Lançamentos são acessados aqui, não como módulo global.

Não há Receitas, Nova receita nem grupo MOVIMENTAÇÕES neste contexto.

## Fluxo de receita importada

IMPORTAÇÃO → registro REVENUE → movimentação → classificação → aprovação → lançamento (`POSTED`) → exportação

Não é necessário um menu global “Receitas” para rastrear o fluxo.

## Portal do Cliente

Inalterado nesta sprint: Início, Despesas, Nova despesa, Documentos, Pendências, Solicitações, Meu perfil. Sem Receitas / Nova receita.

## Permissões legado

`client.revenues.view`, `client.revenues.create` e `client.revenues.edit` permanecem no catálogo e nos perfis (ADMIN/FINANCE). `POST /api/client/receitas` continua bloqueado com `REVENUE_NOT_AVAILABLE_FOR_CLIENT`. `GET`/`PATCH` de receitas no portal permanecem para receitas já existentes (importação). Não apagar as permissões: a importação e o escritório usam o domínio `revenues`.

## Rotas de domínio preservadas

`GET`/`POST` `/api/receitas` e a página interna `state.page==='receitas'` existem tecnicamente, sem exposição no menu. `GET /api/lancamentos` permanece; o acesso operacional é pelo contexto da empresa.

## Card Despesas

No dashboard da empresa, o card **Despesas** conta somente `expenses` (`operacional.expenses` / `dashboard.expense_count`). Receitas não entram nessa métrica. O campo `movements` do dashboard (despesas + receitas) permanece para compatibilidade, mas não alimenta o card.
