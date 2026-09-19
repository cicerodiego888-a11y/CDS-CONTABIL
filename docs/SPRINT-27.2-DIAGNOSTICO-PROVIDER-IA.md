# Sprint 27.2 — Diagnóstico do Provider de IA (Visual)

## Problema observado

Nova Despesa / Visual AI registrava:

- `DOCUMENT_AI_VISUAL_REQUESTED`
- operação `DOCUMENT_INTERPRETATION` FAILED
- `error_code = AI_PROVIDER_ERROR`
- tokens nulos
- formulário sem campos

O teste de credencial (`GET /v1/models`) havia passado.

## Evidência encontrada (chamada real controlada)

Script: `scripts/diag-openai-visual.js`  
Horário: `2026-09-19T16:57:37.713Z`  
Credencial: cofre (`credential_source: vault`)  
Imagem: PNG 1×1 (70 bytes) — enviada corretamente

| Campo | Valor |
|-------|-------|
| endpoint | `https://api.openai.com/v1/chat/completions` |
| model | `gpt-5.6-terra` |
| mime_type | `image/png` |
| image_size_bytes | 70 |
| HTTP status | **429** |
| provider_code | **credit_balance_exhausted** |
| provider_type | **insufficient_quota** |
| provider_param | `null` |
| provider_message | You have no credits remaining. Add credits… |
| request_id | `req_98f9523614c344f48081da41ad3b7844` |
| fase | resposta do provider |

Nenhuma API Key / Authorization / Base64 foi registrada.

## Request analisado (sem correção)

Confirmado no provider:

- Chat Completions: `POST {OPENAI_BASE_URL}/chat/completions`
- `model = AI_MODEL` (`gpt-5.6-terra`)
- `temperature = 0`
- `response_format = { type: 'json_object' }`
- mensagem multimodal com `image_url` data-URL (`image/png;base64,...`)
- MIME normalizado (`image/jpg` → `image/jpeg`)

## Causa comprovada

**Saldo/créditos da organização OpenAI esgotados.**

A OpenAI rejeitou a chamada de interpretação visual com HTTP **429**,
`type=insufficient_quota`, `code=credit_balance_exhausted`.

Isso é **independente** do teste `GET /v1/models`, que só valida a chave
e **não** prova que `interpretDocumentImage()` consegue consumir cota.

## O que este sprint NÃO alterou

- modelo / endpoint / prompt / Smart Expense / cofre / Core V1.0
- nenhuma “correção” de payload presumida

## Arquivos alterados

- `backend/src/accounting-ai/openai-provider.js` — captura corpo de erro + `AI_DEBUG`
- `backend/src/accounting-ai/service.js` — auditoria FAILED com metadados seguros
- `backend/src/config.js` / `.env.example` — `AI_DEBUG`
- `tests/sprint-27.2-provider-diagnosis.test.js`
- `scripts/diag-openai-visual.js`
- `docs/SPRINT-27.2-DIAGNOSTICO-PROVIDER-IA.md`

## Testes

Suite Sprint 27.2 + `npm test` completo (ver entrega).

## Próximo passo recomendado (fora deste sprint)

1. Recarregar créditos na conta OpenAI (billing).
2. Repetir Visual AI com a mesma imagem.
3. Só então, se ainda falhar com outro código (ex.: `model_not_found`),
   abrir sprint de correção de modelo/contrato — **não antes**.
