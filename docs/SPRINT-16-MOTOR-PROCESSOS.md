# Sprint 16 — Motor de Processos (fundação)

Módulo novo, independente do núcleo V1.0 certificado. Sem recorrência automática, sem IA e sem redesign.

## Conceitos

| Entidade | Papel |
|---|---|
| **Processo** | Modelo/base (ex.: Apuração Mensal) |
| **Etapa** | Passo do modelo, com ordem, responsável e prazo relativo (D+N) |
| **Ocorrência** | Execução em uma competência (ex.: 2026-09) |
| **Etapas da ocorrência** | Cópia imutável do modelo no momento da criação |

## Status

- Processo: `ATIVO` | `INATIVO`
- Ocorrência: `PENDENTE` | `EM_ANDAMENTO` | `CONCLUIDA` | `CANCELADA`
- Etapa da ocorrência: `PENDENTE` | `EM_ANDAMENTO` | `CONCLUIDA` | `BLOQUEADA` | `CANCELADA`

Processo inativo **não** gera nova ocorrência.

## Banco

Migration: `database/schema/020_process_engine.sql`

- `processes`
- `process_steps`
- `process_occurrences` (competência estruturada: `competence`, `competence_year`, `competence_month`)
- `process_occurrence_steps`

Isolamento por `tenant_id` + `company_id`.

## API (escritório)

- `GET/POST /api/processos`
- `GET/PATCH /api/processos/:id`
- `POST /api/processos/:id/ativar|desativar`
- `POST/PATCH/DELETE /api/processos/:id/etapas[/:stepId]`
- `PUT /api/processos/:id/etapas/ordem`
- `GET/POST /api/processo-ocorrencias`
- `GET/PATCH /api/processo-ocorrencias/:id`

Código em `backend/src/processes/` (`service.js`, `routes.js`, `competence.js`), montado em `server.js` sem alterar regras contábeis.

## Interface

Menu **Processos** no escritório: lista, detalhe com etapas, nova ocorrência manual.

## Auditoria

`PROCESS_CREATED`, `PROCESS_UPDATED`, `PROCESS_ACTIVATED`, `PROCESS_DEACTIVATED`, `PROCESS_STEP_*`, `PROCESS_OCCURRENCE_*`.

## Fora desta sprint

Recorrência mensal, checklist de execução, notificações automáticas, IA/OCR/Open Finance.

Próximo: **Sprint 17 — Execução + Checklist**.
