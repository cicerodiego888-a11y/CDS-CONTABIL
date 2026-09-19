# Sprint 25 — Interpretação visual por IA

## Objetivo

Permitir que PNG/JPG e PDFs com extração determinística insuficiente sejam
interpretados pela IA visual, retornando campos estruturados. A IA **não** lança
despesa, **não** inventa informação e **não** substitui os motores CDS.

## Arquitetura

```
DOCUMENTO
  → Extração CDS
  → Suficiente? ──SIM──→ Classificação CDS
       │
      NÃO
       ↓
    IA Visual (fallback)
       ↓
    Normalização + validação CDS
       ↓
    Classificação CDS
       ↓
    IA classificatória (somente se necessário)
       ↓
    Usuário confirma → Salva
```

Complexidade no motor; simplicidade na tela (Nova Despesa).

## Quando a IA visual é acionada

| Caso | Comportamento |
|------|----------------|
| PNG / JPEG | IA visual se tenant/provider disponíveis |
| PDF com campos suficientes | **Não** chama IA visual |
| PDF com texto insuficiente / vazio | Tenta IA visual (texto auxiliar ou falha controlada) |
| IA desligada / limite / sem chave | Fluxo manual; não bloqueia |

## Contrato JSON

Campos: `document_type`, `document_number`, `issue_date`, `supplier_name`,
`supplier_document`, `description`, `total_amount`, `payment_method`, cada um com
`value` + `confidence` em `fields`.

Regras do prompt: não inventar CNPJ, data, valor, fornecedor; `null` quando
ilegível; confiança baixa permanece baixa.

## Validação CDS

A resposta passa por `normalizeAiVisualResult` (`document-intelligence/visual.js`)
usando `normalizeMoney` / `normalizeDate` / `normalizeTaxDocument`. Valores
inválidos são descartados antes de persistir.

## Origem

Campos interpretados visualmente: `origin = AI_VISUAL`  
`extraction_method = AI_VISUAL`  
Operação de consumo: `DOCUMENT_INTERPRETATION`

## Segurança

- Bytes lidos via `DocumentStorage` no backend (mesmo caminho da extração)
- Sem API Key no frontend
- Sem base64 no `localStorage`
- Auditoria sem imagem e sem chave: `DOCUMENT_AI_VISUAL_*`

## Consumo

Usa `ai-control` existente (limite mensal, pricing, summary por operação
“Interpretação visual”).

## Fallback

Timeout, provider off, limite, resposta inválida ou imagem ilegível → mensagem
amigável e preenchimento manual. Core V1.0 intacto.

## Limitações

- Sem motor OCR dedicado
- PDF multipágina: estratégia simples (texto extraído / sem rasterização complexa)
- Sem lançamento ou aprovação automática

## Testes

`tests/sprint-25-visual-ai.test.js`
