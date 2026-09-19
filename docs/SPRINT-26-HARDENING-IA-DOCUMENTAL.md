# Sprint 26 — Hardening IA documental / Smart Expense

## Objetivo

Auditar e endurecer o fluxo das Sprints 20–25 **sem** novas features de IA.
Core V1.0 permanece congelado.

## Problemas encontrados e correções

| Problema | Correção |
|----------|----------|
| `OpenAIAccountingProvider` sem `interpretDocumentImage` (regressão) | Método multimodal restaurado |
| Valor IA objeto → `[object Object]` | `coerceAiRaw` rejeita object/array/boolean |
| Confidence `2` virava `1` (alta) | Fora de `[0,1]` → `0` |
| Valor negativo / absurdo da IA visual | Rejeitado na normalização visual (sem mudar `normalizeMoney` global) |
| Imagem enorme enviada ao provider | Limite `MAX_VISUAL_BYTES` (12MB) antes do base64 |
| `fieldState` aceitava confidence inválida | Clamp/rejeição determinística em smart-expense |

## Já estava correto (sem mudança estrutural)

- Datas impossíveis (`31/02/2026`) → `null`
- CPF/CNPJ só com 11/14 dígitos
- Isolation tenant/company via DocumentAccess + `createTx` valida `document_id`
- IA não marca POSTED; despesa nasce PENDING / NEEDS_CLASSIFICATION
- Ordem: CDS classificação → IA classificatória só se necessário
- Upload MIME rejeita exe/zip etc.
- Análise ignora `origin`/`confidence` do body (só `force`)

## Fluxo preservado

```
DOCUMENTO → EXTRAÇÃO → IA visual (se necessário) → validação CDS
  → classificação CDS → IA classificatória (se necessário)
  → usuário → SALVAR
```

Falha → fallback manual.

## Testes

`tests/sprint-26-hardening.test.js`

## Limitações / riscos restantes

- Reprocessamento (`/reler`) gera nova chamada e novo usage (deliberado)
- PDF multipágina sem rasterização avançada (igual Sprint 25)
- CNPJ/CPF sem dígito verificador completo (apenas comprimento) — comportamento pré-existente
