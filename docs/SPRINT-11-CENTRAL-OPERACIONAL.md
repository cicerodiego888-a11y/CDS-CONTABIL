# Sprint 11 — Central Operacional da Carteira + origens de dados

## Objetivo

O escritório acompanha a carteira de empresas em dois níveis:

1. **Visão geral** — lista paginada com indicadores operacionais por empresa.
2. **Contexto da empresa** — `/empresas/:id` com `X-Company-Id`; as telas usam a empresa ativa sem nova seleção.

O CDS Contábil Connect **não depende** do CDS Sistemas.

## Arquitetura

Origem → normalização → movimentação → classificação → revisão → lançamento → exportação.

O núcleo contábil não chama API externa. A origem é um campo de domínio.

## Origem dos dados

Valores oficiais: `PORTAL_CLIENTE`, `CDS_SISTEMAS`, `IMPORTACAO_CONTABIL`, `IMPORTACAO_FISCAL`, `OUTRA_ORIGEM_FUTURA`.

A interface mostra rótulos amigáveis (Portal do Cliente, CDS Sistemas, Importação Contábil, Importação Fiscal). Não expõe token, adapter ou `provider_id`.

## CDS Sistemas (opcional)

Não há integração real nesta sprint: nenhum webhook, token, endpoint externo ou sincronização.

`POST /api/importacoes` com `origin=CDS_SISTEMAS` apenas **grava a origem** nas movimentações, para o pipeline e a Central. Empresa com `cds_systems_enabled=0` (padrão) opera normalmente. Não há bloqueio “precisa usar CDS Sistemas”.

## Portal do Cliente

Menu: Início, Despesas, Nova despesa, Documentos, Pendências, Solicitações, Meu perfil.

Não há Nova receita, conta contábil, débito/crédito ou classificação. `POST /api/client/receitas` responde 403. Receitas continuam no domínio via importação. Evento `REVENUE_CREATED` nasce da importação, não do Portal.

A empresa do cliente vem do JWT (`tenant_id`, `company_id`, `user_id`). O cliente não escolhe empresa.

## Importação

`GET/POST /api/importacoes` — escritório apenas.

Status: `PENDENTE`, `PROCESSANDO`, `CONCLUIDA`, `CONCLUIDA_COM_ERROS`, `ERRO`.

Layouts proprietários (Domínio, Alterdata, Fortes, Questor, SCI) **não** foram inventados. A importação aceita movimentações já normalizadas (JSON) e reutiliza o mesmo `createTx` do núcleo.

Eventos reais: `IMPORT_CREATED`, `IMPORT_COMPLETED`, `IMPORT_FAILED`. Auditoria em `audit_logs` coexiste com `domain_events`.

## Eventos e notificações

Sprint 08 e 10 preservadas. Despesa do Portal gera `EXPENSE_CREATED` → IN_APP (e WhatsApp se o canal estiver ativo). WhatsApp permanece opcional. Documentos não são enviados por WhatsApp. Sem chat.

## Segurança

`tenant_id` só do JWT. Empresa de outro tenant: 404. Empresa bloqueada: leitura permitida, escrita 409. CLIENT não acessa Central, usuários do escritório, comunicações, regras, plano, lançamentos internos, classificação, aprovação ou importações.

## Performance

`GET /api/empresas` pagina (`page` / `page_size` / `q`) e agrega por subconsultas SQL na mesma query (sem loop N+1 de empresas). Dropdown de empresas continua com busca server-side. Indicadores do dashboard são agregações por `tenant_id`.

## Testes

`tests/central-operacional.test.js` cobre isolamento, paginação, contexto, origens, Portal sem receita, importação, eventos, notificações, usuário inativo e escala com 1.000 empresas.

## Limitações reais

- Não existe conector ao CDS Sistemas.
- Não há parser de layout de software contábil de terceiros.
- Importação fiscal/contábil entra como JSON normalizado pelo escritório.
- O Portal não lista receitas no menu (o GET `/api/client/receitas` permanece para receitas já existentes).
