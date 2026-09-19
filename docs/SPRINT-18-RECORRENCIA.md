# Sprint 18 — Recorrência + Geração Automática

## Resultado

O Motor de Processos suporta recorrência mensal, geração manual idempotente e
scheduler interno. O núcleo contábil V1.0 não foi alterado.

- `npm test`: **575 testes, 575 aprovados, 0 falhas**
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: nenhum erro
- linter: nenhum erro

## Conceito

O processo continua sendo o modelo. A recorrência determina quando uma
ocorrência deve nascer. A ocorrência mantém sua própria cópia das etapas,
responsáveis e prazos.

```text
Processo ATIVO
  + recorrência MENSAL ATIVA
  + competência alcançou o dia de geração
  = ocorrência PENDENTE
```

## Arquitetura

- `database/schema/022_process_recurrence.sql`
- `backend/src/processes/recurrence.js` — `ProcessRecurrenceService`
- `backend/src/processes/service.js` — criação de ocorrência já existente
- `backend/src/processes/routes.js` — API e autorização
- scheduler montado no boot de `server.js`

O serviço de recorrência é independente do timer. No futuro, um worker ou
scheduler externo pode chamar `processService.recurrence.runDue()` sem mover
regras de negócio.

## Modelo de dados

`process_recurrences` contém:

- `process_id`, `tenant_id`, `company_id`
- `frequency` (`MENSAL`)
- `generation_day` (1 a 31)
- `start_year`, `start_month`
- `active`
- `last_generated_year`, `last_generated_month`
- autoria e timestamps

Unicidade da ocorrência:

```text
process_id + company_id + competence_year + competence_month
```

O índice existente por processo/competência continua válido; o índice
composto reforça a regra de domínio.

## Competência mensal

A competência é `AAAA-MM`, além das colunas estruturadas de ano e mês.

Sequência:

```text
2026-12 → 2027-01
```

Histórico:

- `last_competence`: última competência processada pelo gerador
- `next_competence`: mês seguinte, ou competência inicial se nunca gerou

## Dia de geração

O dia aceito é de 1 a 31. Quando não existe no mês, usa-se o último dia válido:

- dia 31 em abril → 30/04
- dia 31 em fevereiro/2027 → 28/02
- dia 31 em fevereiro/2028 → 29/02

## Geração automática

O scheduler executa no processo principal:

- imediatamente após o boot;
- depois, em intervalo configurável;
- somente para processo ativo e recorrência ativa;
- com catch-up mensal desde a competência inicial;
- limite defensivo de 120 competências por execução.

Variáveis:

```text
CDS_PROCESS_SCHEDULER=on
CDS_PROCESS_SCHEDULER_MS=300000
```

`CDS_PROCESS_SCHEDULER=off` desliga somente o timer; não desliga o serviço nem
a geração manual.

## Geração manual

Na tela do processo, **Gerar agora** envia a próxima competência exibida.

API:

```text
POST /api/processos/:id/recorrencia/gerar-agora
{ "competence": "2026-10" }
```

Resultado:

- `201`: ocorrência criada;
- `200`: ocorrência já existente, sem duplicar;
- `409`: processo ou recorrência inativos.

Sem competência explícita, o backend usa a competência atual ou a inicial
(quando a inicial está no futuro), mantendo a operação repetida idempotente.

## Cópia e prazos

O gerador chama a mesma criação de ocorrência usada no fluxo manual:

1. valida processo, tenant e empresa;
2. cria ocorrência `PENDENTE`;
3. copia etapas ativas e responsáveis;
4. calcula `due_date` pelo primeiro dia da competência + D+N;
5. preserva o bloqueio sequencial da Sprint 17.

Alterações futuras no modelo não mudam ocorrências já geradas.

## Idempotência

Antes da criação, o serviço procura a ocorrência pela chave de domínio. A
constraint do SQLite protege também contra concorrência.

Repetir uma solicitação para a mesma competência retorna:

```text
Ocorrência da competência MM/AAAA já existe.
```

O scheduler pode rodar várias vezes no mesmo dia sem criar duplicatas.

## Recorrência ativa/inativa e processo pausado

- recorrência inativa: não gera;
- processo `INATIVO`: não gera mesmo com recorrência ativa;
- ocorrências antigas permanecem intactas;
- ativar novamente retoma a partir da próxima competência.

## API

- `GET /api/processos/:id/recorrencia`
- `PUT /api/processos/:id/recorrencia`
- `POST /api/processos/:id/recorrencia/ativar`
- `POST /api/processos/:id/recorrencia/desativar`
- `POST /api/processos/:id/recorrencia/gerar-agora`

Somente `OWNER`, `ACCOUNTANT` e `STAFF`, respeitando a visibilidade existente
de empresa.

## Isolamento

Cada operação valida:

1. token e perfil;
2. `tenant_id` do processo;
3. empresa visível;
4. compatibilidade entre processo, recorrência e empresa.

O scheduler usa os IDs persistidos na recorrência e a criação volta a validar
todos eles. Dados enviados pelo frontend não definem tenant ou empresa.

## Auditoria

- `PROCESS_RECURRENCE_CREATED`
- `PROCESS_RECURRENCE_UPDATED`
- `PROCESS_RECURRENCE_ACTIVATED`
- `PROCESS_RECURRENCE_DEACTIVATED`
- `PROCESS_OCCURRENCE_GENERATION_REQUESTED`
- `PROCESS_OCCURRENCE_AUTO_CREATED`

Gerações do scheduler também são auditadas, mesmo sem requisição HTTP.

## Interface

Lista de processos:

- recorrente mensal ou não;
- recorrência ativa/inativa;
- próxima competência.

Detalhe:

- competência inicial;
- dia de geração;
- status da recorrência;
- última e próxima competências;
- salvar, ativar/desativar e **Gerar agora**.

## Testes

Arquivo: `tests/sprint-18-process-recurrence.test.js`.

Cobertura:

- CRUD e ativação da recorrência;
- geração manual e automática;
- cópia de etapas/responsáveis;
- competência e prazos;
- idempotência;
- processo/recorrência inativos;
- último dia do mês e ano bissexto;
- histórico e próxima competência;
- snapshot independente do modelo;
- auditoria;
- isolamento tenant/company;
- elementos da interface.

## Fora do escopo

Não foram implementados notificações, e-mail/WhatsApp automáticos, IA/OCR,
OpenAI/Open Finance, integração Domínio, calendário avançado, frequências
diária/semanal/anual, workflow avançado ou filas distribuídas.

Próxima etapa: **Sprint 19 — Eventos + Notificações**.
