# SPRINT 07 — MOTOR CONTÁBIL

## 1. Arquitetura

Movimentação (despesa/receita) → `classify(tenant, company, tx)` → decisão `CLASSIFIED` | `NEEDS_CLASSIFICATION` → `createEntry` (atômico) → linhas em `entry_lines` **somente** se classificação segura → aprovação → posting automático (`POSTED`) → exportação canônica.

Não há IA. Motor determinístico de regras + fallback categoria/banco.

## 2. Fluxo e estados

Estados de **lançamento** (tabela `entries`, sem duplicar vocabulário):

| Status | Significado |
|---|---|
| `NEEDS_CLASSIFICATION` | Rascunho sem linhas (ou insuficientes); pendência OPEN |
| `PENDING` | Partida balanceada aguardando aprovação (`PENDING_APPROVAL`) |
| `POSTED` | Efetivado após aprovação; não editável |
| `REJECTED` | Intermediário da rejeição; a entry volta a `NEEDS_CLASSIFICATION` |

`classification_runs.status`: `CLASSIFIED` | `NEEDS_CLASSIFICATION` (origem `MANUAL` na decisão do contador).

## 3. Algoritmo

1. Carregar regras **do tenant** ativas, globais ou da empresa (`company_id IS NULL OR company_id=?`).
2. Empresa específica é avaliada antes da global na ordenação; recebe bônus de score.
3. Todas as regras que batem viram candidatos (não a primeira só).
4. Fallback: categoria **e** banco com contas analíticas → candidato `CATEGORY` score 70.
5. Agrupar por par (débito, crédito).
6. **Seguro** se: um único grupo com score ≥ 70, **ou** o melhor tem score ≥ 80 **e** vantagem ≥ 10 sobre o segundo grupo distinto.
7. Caso contrário: `NEEDS_CLASSIFICATION`, sem linhas definitivas.

## 4. Score (0–100, sem aleatoriedade)

Base 80  
+10 regra da empresa  
+5 descrição  
+2 forma / categoria / banco  
− min(25, priority/4)  (priority menor = precedência maior, como no cadastro atual)

Categoria+banco: 70. Categoria só / banco só: 55/50 incompletos (não geram partida).

## 5. Ambiguidade e conflito

Duas regras “ENERGIA” com contas diferentes e mesma prioridade → mesmo score → revisão.  
Prioridade claramente melhor (ex.: 5 vs 90) pode vencer se o gap de score ≥ 10.

## 6. Candidatos e evidências

Cada candidato: contas, score, origem `RULE|CATEGORY|BANK|MANUAL`, razões em português (nome da regra, trecho da descrição, global vs empresa, prioridade). Persistidos em `classification_runs`.

## 7. N linhas

2–100 linhas. 1D+NC, ND+1C, ND+NC. Mesma conta em várias linhas permitida. Centavos inteiros. `SUM(D)=SUM(C)>0`.

## 8. Contas

Somente `tenant_id` do JWT, `active=1`, `account_type='A'` e `is_postable=1`. Sintética (`S` ou não lançável) → `SYNTHETIC_ACCOUNT`. Outro tenant → 403.

## 9. Idempotência e reprocessamento

Índice único `(tenant_id, source_type, source_id)` quando `source_id` existe. `createEntry` reutiliza o lançamento não aprovado. `POST /api/lancamentos` com o mesmo `source_id` → 409. Reclassificar antes de aprovar substitui linhas; não cria segundo entry.

## 10. Aprovação e auditoria

Aprovar revalida balanceamento e contas lançáveis e efetiva `POSTED`. Lançamento `POSTED` não aceita `reclassificar` (409). A auditoria registra `ENTRY_APPROVED` (ação) e `ENTRY_POSTED` (estado). Decisão manual grava `classification_runs` (usuário, timestamp, contas, nota) e `audit_logs` `RECLASSIFY` (sem token/senha).

## 11. Segurança

CLIENT não classifica nem cria lançamento. Contexto `X-Company-Id` prevalece. Regras de outro tenant nunca entram na query.

## 12. Compatibilidade

Lançamentos antigos de 2 linhas continuam listáveis/aprováveis. Exportação canônica já concatena N débitos/créditos com `|`. Portal do cliente inalterado (sem D/C).

## 13. Queries principais

Uma query de regras do tenant; lookup de contas com cache por `classify`. Classificação de despesa no teste < 2s.

## 14. Limitações

Geração automática ainda produz 2 linhas (par de contas). Rateio N linhas é decisão manual. Sem cursor/Redis/adapters externos.
