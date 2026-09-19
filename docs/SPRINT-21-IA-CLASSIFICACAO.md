# Sprint 21 — IA + Classificação Contábil

## Princípio

A IA atua somente como assistente. O CDS valida toda referência retornada e o contador
decide. Nenhum endpoint desta sprint cria lançamento `POSTED`, aprova lançamento ou cria
conta contábil.

Fluxo implementado:

`documento → extração revisada → provider → sugestão → validação CDS → decisão humana → preparação`

O lançamento preparado ainda passa pela tela contábil, pelas validações existentes e pela
aprovação normal.

## Arquitetura

O módulo independente `backend/src/accounting-ai/` contém:

- `AccountingAIProvider`: contrato do provider;
- `OpenAIAccountingProvider`: integração externa concentrada em um único adaptador;
- `DisabledAccountingAIProvider`: fallback quando a IA está desligada;
- `AccountingAIService`: contexto, idempotência, validações e decisões;
- `routes.js`: API, autenticação, autorização e escopo.

Não existem chamadas OpenAI nas rotas nem no Motor Contábil.

## Configuração

```env
AI_PROVIDER=off
AI_ENABLED=false
OPENAI_API_KEY=
AI_MODEL=gpt-5.6-terra
OPENAI_BASE_URL=https://api.openai.com/v1
AI_TIMEOUT_MS=30000
```

Modelo padrão: **GPT-5.6 Terra** (`gpt-5.6-terra`), provider OpenAI.
A IA é opcional e a ativação é por escritório/tenant (`tenant_ai_settings.enabled`).
`AI_ENABLED` / `AI_PROVIDER` descrevem a capacidade técnica da instalação; a chave fica
somente no backend/ambiente e nunca é exposta pela API.

`AI_PROVIDER=off` é o padrão. Se o provider estiver desligado, sem chave, indisponível ou
exceder o timeout, a sugestão recebe `FAILED` e a interface mantém a classificação manual.
A chave nunca é persistida, retornada pela API ou incluída em auditoria.

## Contexto enviado

Somente são enviados:

- fornecedor, CPF/CNPJ, data, valor, descrição, tipo e forma de pagamento;
- trecho relevante do texto extraído, limitado a 1.500 caracteres;
- no máximo 200 contas analíticas, ativas e postáveis do tenant;
- categorias e bancos ativos globais ou da empresa do documento.

O documento binário, textos integrais, contas de outro tenant e configurações de outra
empresa não são enviados.

O plano de contas atual é estruturalmente do tenant. Portanto, a disponibilidade da conta
é validada no tenant; o contexto específico da empresa é aplicado às categorias, bancos,
documento e decisão.

## Validação da sugestão

O provider pode devolver até três candidatos com confiança e motivo. Antes de persistir:

- o ID deve existir na lista autorizada enviada;
- a conta deve pertencer ao tenant;
- a conta deve estar ativa;
- a conta deve ser analítica e postável;
- categoria e banco devem ser globais ou pertencer à empresa;
- confiança é limitada ao intervalo de 0 a 1.

Referências inventadas, inativas, sintéticas ou fora do escopo são descartadas. Se nenhum
candidato válido restar, a sugestão falha com fallback manual. O provider não substitui
`assertPostableAccount()`, `validateAccountingSemantics()` ou as regras de aprovação.

## Decisão humana

O contador pode:

- **Aceitar**: registra a conta sugerida;
- **Alterar**: registra conta, categoria, banco e histórico escolhidos;
- **Rejeitar**: registra a recusa sem criar lançamento;
- **Revisar depois**: fecha a tela sem tomar decisão.

Aceitar ou alterar retorna uma preparação de lançamento. Quando existe banco contábil
válido, débito e crédito são pré-preenchidos; caso contrário, a tela permanece manual.
Salvar essa preparação cria um lançamento normal para conferência e aprovação, nunca
`POSTED`.

As decisões preservam conta sugerida, conta escolhida, usuário e data para evolução futura.
Não há treinamento, fine-tuning ou alteração automática do modelo.

## Persistência

A migration `025_accounting_ai.sql` cria:

- `ai_classification_suggestions`;
- `ai_classification_candidates`;
- `ai_classification_decisions`;
- `ai_chart_previews`.

Uma extração possui uma sugestão corrente. Requisições repetidas retornam o resultado
existente; reprocessamento exige ação explícita.

## API

- `GET /api/ia/status`
- `POST /api/documentos/:id/sugestao-contabil`
- `POST /api/documentos/:id/sugestao-contabil/reprocessar`
- `GET /api/documentos/:id/sugestao-contabil`
- `POST /api/documentos/:id/sugestao-contabil/decisao`
- `POST /api/plano-contas/preview-ia`
- `GET /api/plano-contas/preview-ia/:previewId`
- `POST /api/plano-contas/preview-ia/:previewId/importar`

Todas as rotas exigem autenticação de escritório e respeitam tenant, empresa e acesso ao
documento.

## Importação inteligente do plano

O parser tradicional continua sendo a primeira opção. Se um PDF não produzir nenhuma conta,
o texto extraído pode ser enviado ao provider e persistido como prévia.

A prévia verifica:

- código, descrição e tipo `S`/`A`;
- códigos e classificações duplicados;
- hierarquia e conta pai;
- tenant e empresa da solicitação;
- conta sintética não postável e conta analítica postável.

Zero contas, duplicidade, tipo inválido ou pai ausente deixam a prévia `INVALID`. A IA não
grava contas. Somente o endpoint de confirmação importa uma prévia `READY`, dentro de uma
transação.

## Auditoria

São registrados, sem texto documental ou segredo:

- `AI_CLASSIFICATION_REQUESTED`
- `AI_CLASSIFICATION_COMPLETED`
- `AI_CLASSIFICATION_FAILED`
- `AI_SUGGESTION_ACCEPTED`
- `AI_SUGGESTION_REJECTED`
- `AI_SUGGESTION_OVERRIDDEN`
- `AI_CHART_IMPORT_REQUESTED`
- `AI_CHART_IMPORT_COMPLETED`
- `AI_CHART_IMPORT_FAILED`

## Testes

`tests/sprint-21-accounting-ai.test.js` cobre provider ativo e desligado, resposta válida e
inválida, erro, timeout, fallback, candidatos, confiança, conta inexistente/inativa/sintética,
aceite, rejeição, substituição, preparação sem postagem, isolamento, prévia, hierarquia,
duplicidade, bloqueio de zero contas, confirmação e auditoria.

Critérios finais:

- `npm test`: zero falhas;
- `PRAGMA integrity_check`: `ok`;
- `PRAGMA foreign_key_check`: zero linhas;
- linter: zero erros;
- `git diff --check`: sem erros.
