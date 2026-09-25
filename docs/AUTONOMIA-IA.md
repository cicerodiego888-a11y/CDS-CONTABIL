# Autonomia operacional da IA — 50% / 98%

## Princípio

```
AUTONOMIA ≠ AUTORIDADE
```

| | 50% Assistida | 98% Autônoma |
|--|---------------|--------------|
| Interpreta / extrai / classifica / sugere | Sim | Sim |
| Valida no Motor CDS | Sim | Sim |
| Entrega em PENDING | Sim | Sim |
| Tentativas extras de resolução | Não | Sim |
| Aprova / posta / fecha | **Nunca** | **Nunca** |

## AutonomyPolicy

Arquivo: `backend/src/ai-control/autonomy-policy.js`

- `ASSISTED_50` — capacidades de preparação (BASE_CAPABILITIES)
- `AUTONOMOUS_98` — BASE + resolução avançada (MULTI_ATTEMPT, SUPPLIER_PATTERN, CHART_FUZZY, EXPANDED_AI…)
- Forbidden em ambos: `APPROVE_ENTRY`, `POST_ENTRY`, `CLOSE_PERIOD`, `AUTO_EXPORT`…

## DecisionEngine

Arquivo: `backend/src/document-pipeline/decision-engine.js`

Estende o pipeline Audácia. Tentativas (98%):

1. Regra conhecida  
2. Histórico do contador  
3. Padrão do fornecedor / plano de contas  
4. IA com contexto ampliado  

Limite de tentativas; sem loop infinito. Resultado máximo: **PENDING**.

## Configuração

Centro existente **Inteligência Artificial** → Autonomia operacional.

- Persistência: `tenant_ai_settings.autonomy_mode` (default `ASSISTED_50`)
- PATCH `/api/ai/settings` `{ autonomy_mode: "ASSISTED_50" | "AUTONOMOUS_98" }`
- Auditoria: `AI_AUTONOMY_CHANGED`

Não ativa 98% silenciosamente em tenants existentes.

## Fluxo (inalterado na UX)

```
Documento → interpretação → natureza → DecisionEngine(autonomia)
→ sugestão → Motor Contábil → confiança → PENDING → contador aprova → POSTED
```

A tela de aprovação, filas e exportação Domínio permanecem as mesmas.
