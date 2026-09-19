# Sprint 19 — Eventos e notificações do Motor

## Objetivo

O Motor de Processos passa a publicar acontecimentos operacionais no `domain_events` e a direcionar notificações internas aos responsáveis. A Central de Notificações existente, suas preferências, contador de não lidas e APIs de leitura foram reutilizados.

O núcleo contábil V1.0, o Portal Cliente e os canais externos não foram alterados funcionalmente.

## Arquitetura

Fluxo implementado:

`ProcessService/RecurrenceService → ProcessEventService → domain_events → handler → notifications`

- `backend/src/processes/events.js` publica eventos, resolve destinatários, cria notificações e verifica atrasos.
- `backend/src/domain-events.js` continua sendo o event bus e sanitiza o payload permitido.
- O serviço de processos não grava diretamente em `notifications`.
- A tela apenas consome notificações e abre a referência; não contém regra de distribuição.

## Eventos

- `PROCESS_OCCURRENCE_AUTO_CREATED`
- `PROCESS_OCCURRENCE_MANUALLY_CREATED`
- `PROCESS_OCCURRENCE_STARTED`
- `PROCESS_STEP_STARTED`
- `PROCESS_STEP_COMPLETED`
- `PROCESS_OCCURRENCE_COMPLETED`
- `PROCESS_STEP_OVERDUE`

Início de ocorrência/etapa gera evento sem notificação adicional. Criação de ocorrência, liberação de próxima etapa, conclusão e atraso notificam quando há um destinatário válido.

## Destinatários

- ocorrência criada: responsável principal;
- etapa concluída: responsável da próxima etapa, se diferente do executor;
- ocorrência concluída: responsável principal;
- etapa atrasada: responsável da etapa.

Somente usuários ativos `OWNER`, `ACCOUNTANT` ou `STAFF` do mesmo `tenant_id` podem receber. Quando a atribuição de empresas para `STAFF` está ativa, o usuário também precisa ter visibilidade da empresa. Usuários do Portal Cliente não recebem notificações operacionais.

As preferências existentes em `notification_preferences` são respeitadas.

## Referências e ação contextual

Cada notificação mantém `event_id`, `company_id` e referência à ocorrência em `entity_type/entity_id`. O payload do evento registra, quando aplicável:

- `process_id`;
- `occurrence_id`;
- `step_id`.

`GET /api/notificacoes` expõe esses dados em `reference`. Ao clicar, a interface abre o módulo Processos e a ocorrência correspondente. Referências removidas mostram “Este processo não está mais disponível.”

## Idempotência

`database/schema/023_process_events.sql` cria unicidade para:

- criação automática da ocorrência;
- criação manual da ocorrência;
- atraso de uma etapa.

Além disso, o índice existente `notifications(event_id, recipient_user_id)` impede que o mesmo evento entregue duas notificações ao mesmo usuário. Assim, execuções repetidas do scheduler não repetem o alerta de atraso.

## Scheduler

O scheduler da Sprint 18 foi preservado e executa, no mesmo ciclo:

1. geração das recorrências vencidas;
2. busca de etapas com `due_date` anterior à data atual e ainda não concluídas/canceladas;
3. publicação idempotente de `PROCESS_STEP_OVERDUE`.

Não foi criado um segundo scheduler.

## API e interface

Foram reutilizados:

- `GET /api/notificacoes`;
- `POST /api/notificacoes/:id/lida`;
- `POST /api/notificacoes/lidas`;
- `GET/PUT /api/notificacoes/preferencias`.

A Central existente apresenta as notificações do Motor, o estado lida/não lida e “Abrir processo”. A ocorrência exibe sua última atividade sem introduzir uma timeline.

## Auditoria

- `PROCESS_NOTIFICATION_CREATED`: destinatário, processo, ocorrência, etapa e tipo do evento;
- `PROCESS_NOTIFICATION_READ`: usuário, notificação, ocorrência e evento.

Os demais eventos de execução continuam usando a auditoria existente.

## Testes

`tests/sprint-19-process-events-notifications.test.js` cobre:

- eventos manuais, automáticos, de início, conclusão e atraso;
- destinatário principal e próximo responsável;
- não lida/lida e referência contextual;
- idempotência de recorrência e atraso;
- isolamento por tenant/empresa e restrição de `STAFF`;
- auditoria e elementos da interface.

Validação final:

```text
npm test
PRAGMA integrity_check
PRAGMA foreign_key_check
```

## Fora do escopo

WhatsApp, e-mail, SMS, push, lembretes recorrentes, calendário avançado, IA, OCR, Open Finance e workflows complexos permanecem fora desta sprint.
