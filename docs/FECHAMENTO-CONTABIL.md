# Fechamento Contábil — Competência Contábil

## Conceito

Uma **competência contábil** pertence a uma empresa e representa o período `YYYY-MM`.

Exemplo: empresa SCOSY · competência `2026-09`.

A competência **não** se confunde com:

| Conceito | Significado |
|----------|-------------|
| `POSTED` | Lançamento aprovado e efetivado |
| Lote Domínio | Indicador de início de lote no arquivo (campo 7) |
| Exportação | Geração do arquivo + registro em `exports` / `export_items` |
| `EXPORTED` | Competência exportada (arquivo gerado e vinculado) |
| `CLOSED` | Período definitivamente bloqueado |

**EXPORTADO ≠ FECHADO.** Gerar o arquivo Domínio não fecha a competência.

## Lifecycle

```
OPEN (Aberta)
  → IN_REVIEW (Em conferência)
  → READY_FOR_EXPORT (Pronta para exportação)
  → EXPORTED (Exportada)
  → CLOSED (Fechada)
```

Reabertura controlada:

```
CLOSED → IN_REVIEW
```

Depois da reabertura o ciclo pode avançar novamente. Nova exportação gera **novo** registro em `exports` (histórico preservado).

## Banco

Tabela `accounting_periods` (migration `035_accounting_periods.sql`):

- `tenant_id` + `company_id` + `competence` únicos
- `period_start` / `period_end` derivados da competência
- `status`, `closed_at` / `closed_by`, `reopened_at` / `reopened_by` / `reopen_reason`
- `export_id` aponta para a exportação mais recente vinculada

## Serviço

`AccountingPeriodService` (`backend/src/accounting/period-service.js`):

- criar / obter / listar
- alterar status (conferência, pronta para exportação)
- `validateForClosing()`
- fechar / reabrir
- `resolveAccountingPeriod(company_id, occurred_on)` via `occurred_on → YYYY-MM`
- `assertWritable` — bloqueio backend quando `CLOSED`

Constantes centralizadas em `period-statuses.js` (`OPEN`, `IN_REVIEW`, `READY_FOR_EXPORT`, `EXPORTED`, `CLOSED`).

## Bloqueio (CLOSED)

Quando a competência está `CLOSED`, o backend responde **HTTP 409** `ACCOUNTING_PERIOD_CLOSED`:

> A competência MM/AAAA está fechada. Reabra a competência para realizar alterações.

Bloqueia: criar/editar lançamento, reclassificar, aprovar, rejeitar, alterar movimentação que origine lançamento na competência, gerar exportação para o período fechado.

A validação é **sempre no backend**.

## Validações antes do fechamento

`validateForClosing()` verifica:

- documentos pendentes / em processamento / erro crítico
- lançamentos `NEEDS_CLASSIFICATION` ou `PENDING`
- pendências `OPEN` relacionadas
- lançamentos sem linhas, sem D/C ou desbalanceados (`UNBALANCED_ENTRY`)
- contas de lançamentos `POSTED` sem `external_code` Domínio (`UNMAPPED_ACCOUNTS`)
- exportação existente quando a regra exige

## Exportação Domínio

Mantém o fluxo e o adapter existentes:

- Layout **11758** Excel 3.1
- Separador `;` · decimal `,` · data `DD/MM/AAAA` · encoding latin1
- 10 campos; códigos via **`external_code`** (nunca `account.id`)

Integração mínima: após gerar com sucesso, vincula `accounting_periods.export_id` e avança status para `EXPORTED` (sem fechar).

Pré-validação: `DominioAdapter.validate()` + regras da competência. Bloqueio estruturado:

```json
{
  "error": "DOMINIO_EXPORT_BLOCKED",
  "message": "A exportação não pode ser gerada.",
  "details": []
}
```

Exportações anteriores à sprint **não** são migradas para `CLOSED`. Se existirem, a UI pode exibir: *Exportação anterior registrada.*

## Permissões

| Ação | OWNER | ACCOUNTANT | STAFF | CLIENT |
|------|-------|------------|-------|--------|
| Ver / listar / resumo | ✓ | ✓ | ✓ | ✗ |
| Criar competência | ✓ | ✓ | ✓ | ✗ |
| Iniciar conferência / pronta exportação | ✓ | ✓ | ✗ | ✗ |
| Exportar Domínio | ✓ | ✓ | ✓* | ✗ |
| Fechar | ✓ | ✓ | ✗ | ✗ |
| Reabrir (com motivo) | ✓ | ✓ | ✗ | ✗ |

\* STAFF já podia exportar no fluxo legado; fechamento/reabertura permanecem restritos a OWNER/ACCOUNTANT.

Isolamento: toda consulta respeita `tenant_id` e `company_id` (middleware / `companyOk`). Empresa A não acessa competência da empresa B.

## Auditoria

Eventos em `audit_logs`:

- `ACCOUNTING_PERIOD_CREATED`
- `ACCOUNTING_PERIOD_REVIEW_STARTED`
- `ACCOUNTING_PERIOD_READY_FOR_EXPORT`
- `ACCOUNTING_PERIOD_EXPORTED`
- `ACCOUNTING_PERIOD_CLOSED`
- `ACCOUNTING_PERIOD_REOPENED`

Incluem tenant, empresa, usuário, competência, antes/depois e motivo (reabertura).

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/contabilidade/competencias` | Listar |
| POST | `/api/contabilidade/competencias` | Criar (ou retornar existente) |
| GET | `/api/contabilidade/competencias/:id` | Detalhe |
| GET | `/api/contabilidade/competencias/:id/resumo` | Painel de conferência |
| GET | `/api/contabilidade/competencias/:id/historico` | Fechamentos / reaberturas / exportações |
| POST | `.../iniciar-conferencia` | → IN_REVIEW |
| POST | `.../pronta-exportacao` | → READY_FOR_EXPORT |
| POST | `.../fechar` | → CLOSED |
| POST | `.../reabrir` | body `{ reason }` → IN_REVIEW |

Rotas legadas de exportação **não** foram quebradas:

- `/api/exportacoes/previa`
- `/api/exportacoes/gerar`
- `/api/empresas/:id/integracoes/dominio/mapeamentos`

## Interface

Página **Fechamento Contábil** (menu Relatórios / Contábil na empresa):

- Empresa, competência, status
- Cards: documentos, lançamentos, pendências, débitos, créditos
- Balanceamento BALANCEADO / NÃO BALANCEADO
- Checklist com navegação para Aprovação, Integrações → Domínio, etc.
- Histórico de fechamentos, reaberturas e exportações

## Fluxo operacional completo

```
DOCUMENTO
→ INTERPRETAÇÃO
→ CLASSIFICAÇÃO
→ SUGESTÃO
→ VALIDAÇÃO
→ APROVAÇÃO
→ LANÇAMENTO POSTED
→ CONFERÊNCIA DA COMPETÊNCIA
→ EXPORTAÇÃO DOMÍNIO
→ CONFERÊNCIA NO DOMÍNIO
→ FECHAMENTO DA COMPETÊNCIA
→ BLOQUEIO DO PERÍODO
```
