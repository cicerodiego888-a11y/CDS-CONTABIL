# Sprint 17 — Execução + Checklist do Processo

## Resultado

O Motor de Processos agora controla a execução manual das ocorrências criadas na Sprint 16.
O núcleo contábil V1.0 não foi alterado.

Validação final:

- `npm test`: **566 testes, 566 aprovados, 0 falhas**
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: nenhum erro

## Arquitetura

As mudanças permanecem no módulo `backend/src/processes/`:

- `service.js`: transições, prazos, bloqueios, progresso e próxima ação
- `routes.js`: autorização, endpoints e auditoria
- `database/schema/021_process_execution.sql`: índices da execução
- `database.js`: aplicação idempotente das novas colunas em bancos existentes

Entidades estruturais da Sprint 16 foram preservadas. A execução usa
`process_occurrence_steps`; não existe cadastro paralelo de funcionários.

## Fluxo de execução

```text
Ocorrência PENDENTE
  → iniciar ocorrência ou primeira etapa
Ocorrência EM_ANDAMENTO
  → iniciar etapa PENDENTE
  → concluir etapa EM_ANDAMENTO
  → liberar próxima etapa
Todas as etapas obrigatórias CONCLUIDAS
  → ocorrência CONCLUIDA automaticamente
```

Iniciar diretamente a primeira etapa também inicia a ocorrência.

## Estados e transições

Ocorrência:

- `PENDENTE → EM_ANDAMENTO`
- `EM_ANDAMENTO → CONCLUIDA` automaticamente
- `CONCLUIDA → EM_ANDAMENTO` somente por reabertura explícita
- `CANCELADA` não permite execução

Etapa:

- `PENDENTE → EM_ANDAMENTO → CONCLUIDA`
- `BLOQUEADA → PENDENTE` quando a etapa obrigatória anterior é concluída
- `CONCLUIDA → PENDENTE|EM_ANDAMENTO` somente por reabertura explícita

Transições inválidas retornam `409`.

## Prazos

Na criação da ocorrência, cada etapa recebe `due_date` próprio:

```text
data-base = primeiro dia da competência
due_date = data-base + due_offset_days
```

Exemplo: competência `2026-09`, `D+3` → `2026-09-04`.

O prazo fica copiado na ocorrência e não volta a depender do modelo.

Classificação:

- `NO_PRAZO`: mais de dois dias até o vencimento
- `VENCENDO`: vence hoje ou nos próximos dois dias
- `ATRASADA`: prazo anterior à data atual
- `CONCLUIDA`: etapa concluída
- `CANCELADA`: etapa cancelada

## Bloqueio simples

A dependência é exclusivamente sequencial:

- uma etapa obrigatória incompleta bloqueia as etapas posteriores;
- ao concluí-la, a próxima etapa é liberada;
- não existe grafo de dependências nesta sprint.

## Conclusão e progresso

O progresso considera as etapas obrigatórias:

```text
percentual = obrigatórias concluídas / obrigatórias totais
```

Etapas opcionais não impedem a conclusão automática da ocorrência.
O payload da ocorrência contém:

- `required_steps`
- `completed_required_steps`
- `total_steps`
- `completed_steps`
- `progress_percent`
- `next_step`

`next_step` prioriza uma etapa em andamento e depois a primeira pendente.

## Reabertura

Uma ocorrência concluída deve ser reaberta antes de uma etapa concluída.
A reabertura:

- limpa `completed_at` da ocorrência;
- registra auditoria;
- permite reabrir uma etapa como `PENDENTE` ou `EM_ANDAMENTO`;
- limpa executor e conclusão anteriores da etapa conforme o destino.

Não existe reabertura silenciosa.

## Observação

Cada etapa da ocorrência possui `observation` simples, limitada a 4.000
caracteres. Não há chat, comentários encadeados ou anexos nesta sprint.

## Autorização e isolamento

Todas as rotas passam por:

1. autenticação existente;
2. perfil interno (`OWNER`, `ACCOUNTANT` ou `STAFF`);
3. `tenant_id`;
4. visibilidade de `company_id`;
5. vínculo da ocorrência e da etapa.

`tenant_id`, `company_id`, `started_by` e `completed_by` enviados pelo
frontend não são usados como autoridade. Executor vem do token autenticado.
Usuários `CLIENT` não acessam o módulo.

O dashboard também respeita as empresas visíveis para STAFF.

## API

Base existente: `/api/processo-ocorrencias`.

- `POST /:id/start`
- `POST /:id/reopen`
- `POST /:id/steps/:stepId/start`
- `POST /:id/steps/:stepId/complete`
- `POST /:id/steps/:stepId/reopen`
- `PATCH /:id/steps/:stepId` — observação
- `GET /api/processos/dashboard`

Listagem aceita:

- `status=PENDENTE|EM_ANDAMENTO|CONCLUIDA|CANCELADA`
- `deadline_status=VENCENDO|ATRASADA`

## Auditoria

- `PROCESS_OCCURRENCE_STARTED`
- `PROCESS_OCCURRENCE_COMPLETED`
- `PROCESS_OCCURRENCE_REOPENED`
- `PROCESS_STEP_STARTED`
- `PROCESS_STEP_COMPLETED`
- `PROCESS_STEP_REOPENED`
- `PROCESS_STEP_UPDATED`

## Interface

A tela Processos contém indicadores clicáveis:

- Pendentes
- Em andamento
- Vencendo
- Atrasadas
- Concluídas

A ocorrência mostra:

- status e responsável;
- barra de progresso;
- próxima ação;
- checklist com responsável, prazo e situação;
- executor e datas;
- iniciar, concluir e reabrir;
- observação operacional.

## Testes e critérios de aceite

Arquivo: `tests/sprint-17-process-execution.test.js`.

Cobertura:

- cálculo e classificação de prazo;
- início de ocorrência e etapa;
- executor e timestamps;
- transições inválidas;
- bloqueio/liberação sequencial;
- progresso e próxima ação;
- conclusão automática;
- etapa opcional;
- reabertura controlada;
- observação;
- dashboard e filtros;
- isolamento tenant/company/perfil;
- auditoria e elementos da interface.

## Fora do escopo

Não foram implementados: recorrência automática, geração mensal, notificações,
e-mail/WhatsApp automáticos, IA/OCR/OpenAI/Open Finance, integração Domínio,
calendário complexo, chat ou dependências avançadas.

Próxima etapa: **Sprint 18 — Recorrência + Automações**.
