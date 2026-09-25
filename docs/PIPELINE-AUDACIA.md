# Pipeline Audácia — Documento → Lançamento PENDING

## Princípio

```
IA interpreta e sugere
→ Motor CDS valida
→ Contador aprova
```

A IA **nunca** aprova, posta ou fecha competência.

## Autonomia operacional (50% / 98%)

Configuração no Centro de IA (`tenant_ai_settings.autonomy_mode`).

- **ASSISTED_50** — prepara o lançamento completo e entrega em PENDING.
- **AUTONOMOUS_98** — prepara + tenta resolver exceções (regras, histórico, plano, IA ampliada) antes do PENDING.

Detalhes: [AUTONOMIA-IA.md](./AUTONOMIA-IA.md). Em ambos os modos a fronteira continua sendo **PENDING**.

## Fluxo

```
CLIENTE envia documento
→ armazenamento + hash
→ DocumentInterpretationService
→ XML estruturado > texto PDF > visão IA (PNG/JPG; sem OCR local) > IA
→ natureza (categorias oficiais)
→ regras / histórico / plano de contas
→ sugestão de lançamento
→ validação (débito = crédito, contas analíticas)
→ confiança explicável
→ PENDING + notificação
→ contador confere lado a lado e APROVA / EDITA / REJEITA
→ POSTED → competência → exportação Domínio
```

## Categorias oficiais

`COMPRA`, `VENDA`, `SERVIÇO TOMADO`, `SERVIÇO PRESTADO`, `DESPESA`, `RECEITA`,
`PAGAMENTO`, `RECEBIMENTO`, `FOLHA`, `PRÓ-LABORE`, `IMPOSTO`, `FINANCIAMENTO`,
`EMPRÉSTIMO`, `ATIVO IMOBILIZADO`, `TRANSFERÊNCIA BANCÁRIA`, `TARIFA BANCÁRIA`, `OUTROS`

Constantes: `backend/src/document-pipeline/operation-types.js`

## Prioridade de dados

1. XML fiscal estruturado  
2. Texto extraído (PDF)  
3. Visão IA (PNG/JPG e PDF sem texto suficiente; OpenAI Vision)  
4. IA interpretativa / classificação  


Campo normalizado: `{ value, confidence, source }` — XML não é sobrescrito por OCR.

## Confiança

| Faixa | Banda |
|-------|-------|
| 95–100% | ALTA |
| 80–94% | MÉDIA |
| < 80% | BAIXA |

## API

| Método | Rota |
|--------|------|
| GET | `/api/documentos/:id/pipeline` |
| POST | `/api/documentos/:id/pipeline/processar` |
| GET | `/api/contabilidade/naturezas` |

Upload (portal/escritório) enfileira o pipeline de forma **assíncrona**.

## Aprendizado

Tabela `document_learning_decisions`: decisões do contador (ACEITO/SOBRESCREVE/REJEITA) com contas sugeridas vs selecionadas — rastreável e auditável, sem auto-treino perigoso.
