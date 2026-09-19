# Sprint 23 — Controle de IA e consumo por escritório

## Princípio

A IA é um recurso opcional controlado por `tenant_id`. O CDS não depende dela.

Fluxo:

`extração → classificação CDS → IA (se habilitada, dentro do limite e necessária) → validação CDS`

## Configuração

Menu **Configurações → Inteligência Artificial** (Portal do Contador).

- Ativar / desativar IA
- Modelo exibido: `GPT-5.6 Terra` (ID técnico: `gpt-5.6-terra`; fonte: `AI_MODEL`)
- Limite mensal em US$ (custo estimado)

Preço vigente (`ai_model_pricing`, model `gpt-5.6-terra`):

| Tipo | USD / 1M tokens |
|------|-----------------|
| input | 2.00 |
| cached input | 0.20 |
| output | 12.00 |

Somente `OWNER` e `ACCOUNTANT` alteram a configuração. `STAFF` pode consultar.
Clientes do portal não acessam `/api/ai/*`.

`AI_ENABLED` / `AI_PROVIDER` = capacidade da instalação. `tenant_ai_settings.enabled` =
decisão do escritório. Configurar API Key **não** ativa tenants existentes.

## Consumo

Cada chamada grava em `ai_usage_records`:

- tenant, empresa, usuário, documento
- operação, provider, modelo
- tokens, duração, status, erro
- custo estimado (centavos de USD)

Preços em `ai_model_pricing` (atualizáveis sem alterar o motor).

Operações:

- `ACCOUNT_CLASSIFICATION`
- `DOCUMENT_INTERPRETATION`
- `DOCUMENT_REANALYSIS`
- `PLAN_ACCOUNT_IMPORT`

## Limite

Percentual do limite mensal:

| Faixa | Comportamento |
|-------|----------------|
| 0–49% | normal |
| 50–79% | aviso |
| 80–99% | aviso de atenção |
| 100% | bloqueia novas chamadas de IA |

Com IA bloqueada ou desligada, motores CDS e classificação manual seguem ativos.
Nunca bloqueia lançamento de despesa.

## API

- `GET /api/ai/settings`
- `PATCH /api/ai/settings`
- `GET /api/ai/usage`
- `GET /api/ai/usage/summary`
- `GET /api/ai/usage/by-client`
- `GET /api/ai/usage/by-operation`

O frontend não envia tokens, custo, provider ou API key. O backend calcula e persiste.

## Migration

`database/schema/027_ai_usage_control.sql` — tabelas e preços iniciais.
`database/schema/028_ai_model_pricing_gpt56_terra.sql` — correção do preço vigente do
`gpt-5.6-terra` (2.00 / 0.20 / 12.00). Histórico de consumo e preços de modelos antigos
(`gpt-4.1-mini`, `gpt-4o-mini`) são preservados.

Colunas extras em `tenant_ai_settings` e `ai_usage_records` via `ensureColumn` em `database.js`.

## Integração

- `backend/src/ai-control/` — settings, pricing, limite, consultas
- Accounting AI e Smart Expense consultam `availability()` antes de chamar o provider
- Banners da Nova Despesa: IA / CDS / preenchido automaticamente

## Não implementado

Cobrança real, faturas, pagamento OpenAI, créditos, cartão/PIX.
