# SPRINT 07 — CLASSIFICAÇÃO (EXEMPLOS)

Contas usadas nos testes (plano real gravado no SQLite de teste):

- `3210100012` ENERGIA ELETRICA (analítica)
- `3210100013` OUTRAS DESPESAS (analítica)
- `1110200001` BANCO DO BRASIL (analítica)
- `1110100001` CAIXA GERAL (analítica)
- `3` DESPESAS (sintética — rejeitada em lançamento)

## Exemplo 1 — inequívoco

Movimentação: `"Conta de energia elétrica"`  
Regra: nome `ENERGIA`, condição descrição contém `"energia"`, D=`3210100012`, C=`1110200001`, prioridade 10.

Resultado: `CLASSIFIED` / lançamento `PENDING`  
Evidências: regra correspondeu; descrição contém "energia"; regra global do escritório; prioridade 10.

## Exemplo 2 — conflito

Regras ativas, ambas descrição `"conflito-xyz"`, prioridade 20, contas diferentes.

Resultado: `NEEDS_CLASSIFICATION`  
Sem linhas automáticas. Pendência aberta no rascunho. Contador monta N linhas e grava via `POST /api/lancamentos/:id/reclassificar`.

## Exemplo 3 — prioridade

`"energia premium"` casa com regra prioridade 5 (energia/banco) e prioridade 90 (outras/caixa).

Gap de score ≥ 10 e melhor ≥ 80 → vence a de prioridade 5.

## Exemplo 4 — empresa vs global

Mesma descrição e prioridade 10: regra `company_id` da empresa ativa tem +10 no score e vence a global.

## Exemplo 5 — fallback

Sem regra. Categoria e banco da **mesma empresa/tenant** com contas analíticas.

Score 70, único par → `CLASSIFIED` origem `CATEGORY`.

Somente categoria ou somente banco: evidência incompleta → revisão.

## Exemplo 6 — N linhas manuais

Valor R$ 1.000,00:

| Lado | Conta | Centavos |
|---|---|---|
| D | ENERGIA ELETRICA | 100000 |
| C | BANCO DO BRASIL | 60000 |
| C | CAIXA GERAL | 40000 |

Backend recusa se a diferença ≠ 0, se alguma conta for sintética ou de outro tenant.

## Exemplo 7 — cliente

Portal envia data, descrição, valor, forma, banco, categoria, documento.  
`classification` **não** volta no JSON do CLIENT.
