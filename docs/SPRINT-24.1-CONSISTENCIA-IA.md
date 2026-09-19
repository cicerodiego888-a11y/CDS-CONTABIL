# Sprint 24.1 — Consistência da configuração IA / GPT-5.6 Terra

## Objetivo

Unificar modelo, display, preços e defaults da IA **antes** de configurar a API OpenAI.
Sem interpretação visual, sem mudança no fluxo da Nova Despesa e sem ativar IA nos tenants.

## Fonte única de verdade

| Campo | Valor |
|-------|--------|
| Model ID | `gpt-5.6-terra` |
| Display | `GPT-5.6 Terra` |
| Provider | OpenAI |
| Env | `AI_MODEL=gpt-5.6-terra` |
| Timeout | `AI_TIMEOUT_MS=30000` |

Defaults em `backend/src/config.js`, `.env.example` e fallback do
`OpenAIAccountingProvider` apontam para o mesmo ID. A UI usa `display_model` /
`model_display` = `GPT-5.6 Terra`.

## Capacidade vs decisão do escritório

- `AI_PROVIDER` / `AI_ENABLED` / `OPENAI_API_KEY` → capacidade técnica da instalação
- `tenant_ai_settings.enabled` → decisão do escritório

Novos tenants nascem com IA **desativada**. Configurar a API Key **não** ativa tenants
existentes. Ativação continua em Configurações → Inteligência Artificial
(`OWNER` / `ACCOUNTANT`).

## Preço vigente

Migration `028_ai_model_pricing_gpt56_terra.sql` atualiza somente a linha
`openai` / `gpt-5.6-terra`:

- input: 2.00 USD / 1M
- cached input: 0.20 USD / 1M
- output: 12.00 USD / 1M

Registros históricos de consumo e preços de `gpt-4.1-mini` / `gpt-4o-mini` permanecem.

## Defaults seguros

```env
AI_PROVIDER=off
AI_ENABLED=false
OPENAI_API_KEY=
AI_MODEL=gpt-5.6-terra
OPENAI_BASE_URL=https://api.openai.com/v1
AI_TIMEOUT_MS=30000
```

Nenhuma chave real no repositório. IA desligada por padrão.

## Fora de escopo

OCR próprio, interpretação visual, envio de imagens, Responses API obrigatória,
alteração do núcleo contábil ou do Motor de Classificação CDS.
