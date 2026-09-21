# Sprint 28.4.8 — Importação robusta do Plano de Contas

## Causa do 422

`POST /api/plano-contas/preview` usava um parser legado que só aceitava linhas no formato:

`código  classificação(≥4 dígitos)  S|A  descrição`

A Relação de Contas real (Código / Classificação / Descrição, sem coluna de tipo) gerava **0 contas**. O preview então chamava a IA (`requestChartPreview`). Sem provedor configurado, a falha virava 422/`PREVIEW_FAILED` com a mensagem **"Sugestão inteligente indisponível."** — erro de parser mascarado como erro de IA.

## Formato suportado

- PDF, CSV e TXT (formatos já existentes).
- Relatório **Código / Classificação / Descrição** (classificação de qualquer comprimento).
- Formato legado `código classificação tipo(S|A) descrição`.
- CSV/TXT delimitado (`;` ou `,`).

**Classificação não é chave única.** Contas com o mesmo código de classificação e códigos/descrições diferentes são contas distintas.

## Parser

Pipeline: arquivo → extração (`pdf-parse` + fallback textual já usado em documentos) → normalização (espaços, NBSP, quebras) → detecção → parsing → hierarquia S/A inferida por prefixo de classificação → validação → prévia. A IA **não** valida a estrutura e **não** é fallback do preview determinístico.

Cabeçalhos, rodapés, `Página:`, `Emissão:`, `Hora:`, `RELAÇÃO DE CONTAS`, `Empresa:`, `C.N.P.J.` e paginação `n/m` são ignorados. Empresa e CNPJ do relatório entram na prévia.

## Identidade e duplicidades

Identidade lógica: `código + classificação + descrição`. Duplicidade exata só quando os três coincidem. Mesma classificação gera **alerta**, não rejeição. Código repetido é issue; na importação o segundo código é ignorado (sem duplicar silenciosamente no mesmo plano).

Não há UNIQUE em `classificacao` no schema; nenhuma migration foi necessária.

## 422

```json
{
  "error": "PLAN_ACCOUNTS_PREVIEW_INVALID",
  "message": "...",
  "details": { "stage": "...", "code": "...", "reason": "...", "fileType": "pdf" }
}
```

Códigos: `PDF_INVALID`, `EXTRACTION_UNAVAILABLE`, `STRUCTURE_UNRECOGNIZED`, `NO_ACCOUNTS`. Stack só no log (dev/homolog). Erro inesperado: 500 controlado, sem stack no cliente.

## Preview e importação

Preview **não grava** contas. Importação definitiva (`POST /api/plano-contas/import`) exige confirmação humana e cria um **novo** plano (sem replace-all). Auditoria `ACCOUNT_PLAN_IMPORTED` com arquivo, usuário, tenant, quantidades e resultado.

## Limitações

- Sem OCR nesta sprint (PDF sem texto → `EXTRACTION_UNAVAILABLE`).
- Plano continua no tenant (não há `company_id` no schema de `account_plans`).
- IA de `preview-ia` permanece opcional e separada.
