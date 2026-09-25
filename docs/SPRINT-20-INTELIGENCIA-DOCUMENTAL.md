# Sprint 20 — Inteligência Documental: fundação

## Objetivo

Transformar documentos já armazenados em texto e campos estruturados para conferência humana. Esta camada não classifica contabilmente, não cria lançamento e não altera o documento original.

Fluxo:

`Documento → Extração → Normalização → Dados estruturados → Conferência → REVIEWED`

## Arquitetura

O módulo está isolado em `backend/src/document-intelligence/`:

- `extraction.js`: `DocumentExtractionService`, estados, processamento e idempotência;
- `normalization.js`: texto, moeda, datas, CPF/CNPJ e número documental;
- `interpreter.js`: contrato `DocumentInterpreter` e implementação determinística `LocalDocumentInterpreter`;
- `routes.js`: autorização e API.

O módulo consome `DocumentAccess` e `DocumentStorageService`. O arquivo é descriptografado somente em memória para processamento e permanece criptografado no armazenamento.

## Extração

### PDF

PDFs textuais usam `pdf-parse` e recebem `extraction_method=PDF_TEXT`. Há fallback determinístico para operadores textuais simples de PDFs não comprimidos quando o parser não consegue reconstruir o índice do arquivo.

O texto original retornado pela extração é preservado separadamente dos valores normalizados.

### PNG/JPG/JPEG

Os formatos são reconhecidos e aceitos pelo fluxo. Sem OCR dedicado:

- com IA visual habilitada (Sprint 25): interpretação estruturada via provider
  (`extraction_method=AI_VISUAL`);
- sem credencial / IA desligada / limite: status `FAILED`, método `AI_VISUAL`,
  códigos `AI_NOT_CONFIGURED` | `AI_DISABLED` | `AI_LIMIT_REACHED` e
  preenchimento manual (mensagens distintas; não confundir com OCR local).

Nenhum serviço externo é chamado quando a IA está desligada.

## Persistência

A migration `database/schema/024_document_intelligence.sql` cria:

- `document_extractions`: uma extração atual por documento;
- `document_extracted_fields`: valor bruto, valor normalizado, correção humana e confiança.

Campos iniciais:

- `document_type`;
- `document_number`;
- `issue_date`;
- `supplier_name`;
- `supplier_document`;
- `description`;
- `total_amount`;
- `payment_method`.

## Estados

- `PENDING`;
- `PROCESSING`;
- `EXTRACTED`;
- `FAILED`;
- `REVIEWED`.

A solicitação HTTP cria o registro e agenda o processamento com `setImmediate`, retornando `202`. A separação entre solicitação e processamento permite substituir o agendamento local por worker/fila futuramente.

## Normalização e confiança

- `R$ 1.250,50` → `1250.50`;
- `15/09/2026` → `2026-09-15`;
- CPF/CNPJ → somente dígitos;
- espaços, controles e quebras são normalizados na interpretação.

Cada campo mantém `raw_value`, `normalized_value`, `reviewed_value` e `confidence`. Confiança é apenas informativa e nunca aprova lançamento.

## Conferência

A tela de Documentos possui “Analisar documento”/“Ver análise”. O modal apresenta:

- status e método;
- campos editáveis;
- confiança por campo;
- texto original extraído;
- visualização do arquivo original;
- salvar correções;
- confirmar dados;
- reprocessar.

Confirmar muda o status para `REVIEWED`. Nenhuma linha é inserida em `entries`.

## Segurança

Todas as rotas exigem usuário interno autenticado e reutilizam:

- `DocumentAccess.load`;
- `DocumentAccess.authorize`;
- `tenant_id`;
- escopo e visibilidade de `company_id`;
- regras existentes de `STAFF`.

Usuários do Portal Cliente não acessam a análise. O texto extraído só é retornado pelas mesmas rotas autenticadas e contextualizadas do documento.

## Idempotência

Existe `UNIQUE(document_id)` em `document_extractions`.

- uma segunda solicitação comum retorna a extração existente;
- reprocessamento é explícito;
- o mesmo registro é reutilizado e `attempt_count` incrementado;
- uma execução em `PROCESSING` não pode ser iniciada novamente.

## Auditoria

- `DOCUMENT_EXTRACTION_REQUESTED`;
- `DOCUMENT_EXTRACTION_COMPLETED`;
- `DOCUMENT_EXTRACTION_FAILED`;
- `DOCUMENT_EXTRACTION_REVIEWED`.

Os logs armazenam identificadores, empresa, método, resultado e códigos de erro. Texto extraído e valores sensíveis não são copiados para a auditoria.

## API

- `POST /api/documentos/:id/extracao`;
- `GET /api/documentos/:id/extracao`;
- `PATCH /api/documentos/:id/extracao`;
- `POST /api/documentos/:id/extracao/reprocessar`.

## Preparação para IA

`DocumentInterpreter` define o contrato de interpretação. Nesta sprint somente `LocalDocumentInterpreter` existe. Uma implementação futura baseada em IA poderá cumprir o mesmo contrato sem alterar persistência, revisão, segurança ou domínio documental.

## Testes

`tests/sprint-20-document-intelligence.test.js` cobre:

- PDF textual;
- PNG e JPG sem OCR;
- MIME inválido;
- normalização;
- oito campos estruturados e confiança;
- transições de estado;
- correção e confirmação;
- preservação do original;
- idempotência e reprocessamento;
- isolamento tenant/empresa/perfil;
- auditoria;
- ausência de lançamento automático;
- elementos de interface.

## Fora do escopo

OpenAI, OCR externo, classificação contábil, lançamento automático, `POSTED` automático, aprendizado histórico, Open Finance, notificações externas e integrações contábeis.
