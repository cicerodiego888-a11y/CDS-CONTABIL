# Sprint 22 — Nova Despesa Inteligente

## Princípio

A tela de Nova Despesa é simples. A complexidade fica no motor:

`documento → extração → classificação CDS → IA (se necessária e habilitada) → validação CDS → usuário confirma → salvar`

A IA é opcional e nunca bloqueia o lançamento. Nenhum fluxo desta sprint cria
`POSTED` automaticamente, altera o Core V1.0, o Motor Fiscal, o Motor Não Fiscal,
nem substitui os Sprints 20 e 21.

## Experiência

A mesma UI (`frontend/public/assets/smart-expense.js` + `smart-expense.css`) serve:

- Portal do Contador (`mode: office`)
- Portal do Cliente (`mode: client`)

Layout: documento à esquerda, formulário à direita, identidade CDS Contábil Connect.

Campos iniciais:

- Fornecedor
- Data da competência
- Descrição
- Valor
- Categoria
- Forma de pagamento (obrigatória pelas regras atuais de despesa)

Ações: **Ler novamente**, **Cancelar**, **Salvar despesa**.

## Orquestração

Módulo `backend/src/smart-expense/`:

- `service.js`: pipeline, origem por campo, banners, `tenant_ai_settings`
- `routes.js`: endpoints do escritório e do cliente

Origens internas por campo:

- `EXTRACTION_ENGINE`
- `CLASSIFICATION_ENGINE`
- `AI`
- `MANUAL`

Banners:

- motor CDS / extração: `Preenchido automaticamente`
- IA usada: `Analisado pela IA`
- falha amigável: `Não foi possível concluir a análise inteligente...`

## Fluxo de classificação

1. Document Intelligence (Sprint 20) extrai campos.
2. Motor de Classificação Inteligente tenta classificar.
3. Se `CLASSIFIED` → **não chama IA**.
4. Se não classificar e `tenant_ai_settings.enabled` (ou `AI_ENABLED` + OpenAI) →
   `AccountingAIProvider` (Sprint 21) com `allowUnreviewed`.
5. Validação e persistência da despesa continuam em `/api/despesas` e
   `/api/client/despesas`.

## Persistência

Migration `database/schema/026_smart_expense.sql`:

- `tenant_ai_settings`
- `expense_document_analyses`
- `ai_usage_records` (preparação de custo; sem cobrança nesta sprint)

Coluna `expenses.supplier_name` garantida em `database.js`.

## API

Escritório:

- `POST /api/documentos/:id/analise-despesa`
- `POST /api/documentos/:id/analise-despesa/reler`
- `GET /api/documentos/:id/analise-despesa`
- `GET /api/ia/enabled`

Cliente:

- `POST /api/client/documentos/:id/analise-despesa`
- `POST /api/client/documentos/:id/analise-despesa/reler`
- `GET /api/client/documentos/:id/analise-despesa`

Ao salvar a despesa com `document_id`, a análise passa a `SAVED`.

## Auditoria

Eventos registrados quando aplicável:

- `DOCUMENT_ANALYSIS_STARTED`
- `DOCUMENT_ANALYSIS_COMPLETED`
- `DOCUMENT_ANALYSIS_FAILED`
- `CLASSIFICATION_ENGINE_USED`
- `AI_CLASSIFICATION_USED`
- `AI_CLASSIFICATION_FAILED`
- `DOCUMENT_REANALYZED`
- `EXPENSE_CREATED`

Sem API keys em logs ou payloads.

## Configuração

```env
AI_PROVIDER=off
AI_ENABLED=false
OPENAI_API_KEY=
```

Com IA desligada, o fluxo permanece: extração → classificação CDS → revisão manual.

## Testes

`tests/sprint-22-smart-expense.test.js` cobre PDF estruturado, imagens sem OCR,
documento ilegível, CDS sem IA, fallback IA, IA desligada, falha de IA,
isolamento tenant/empresa, portal cliente, releitura e presença da UI.
