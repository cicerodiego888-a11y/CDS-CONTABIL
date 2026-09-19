# Sprint 28 — Adapter de exportação Domínio (Thomson Reuters)

## Declaração de homologação

**Arquivo gerado conforme o layout fornecido do Domínio, pendente de validação no ambiente real do cliente.**

Somente após importar o arquivo no Domínio real e validar o resultado, registrar a integração como homologada.

## Auditoria prévia

Arquitetura anterior:

- `POST /api/exportacoes/gerar` gerava sempre o **CSV canônico** CDS, inclusive para `system_key=dominio`.
- Contas unidas com `|` em uma célula.
- Sem mapeamento de código reduzido Domínio.
- Nome de arquivo: `{companyId}-{timestamp}.csv`.

Limitações encontradas:

- Não havia adapter por destino.
- “Domínio” era apenas um rótulo no seletor.
- Planilha modelo XLSX/CSV de exemplo **não estava no repositório**; a implementação seguiu o XML do layout **11758** descrito na sprint.

## Arquitetura nova

```
backend/src/export/
  adapter.js              # registry ExportAdapter
  canonical-adapter.js    # CSV canônico (contaazul, alterdata, …)
  dominio-adapter.js      # Layout 11758
  mappings.js             # account_external_mappings
  service.js              # prévia + geração + persistência
  routes.js               # HTTP
```

`system_key=dominio` → `DominioAdapter`.  
Demais `system_key` → CSV canônico (inalterado).

## Layout Domínio

| Item | Valor |
|------|--------|
| Nome | Excel (3.1) |
| Descrição | Lançamentos Contábeis em Lote com Filial e Centro de Custos |
| Código | **11758** |
| Separador | `;` |
| Decimal | `,` |
| Encoding | `latin1` (ISO-8859-1 / ANSI compatível) |
| Campos | 10 por registro |
| Cabeçalho | **não** enviado |

Campos:

1. Data `DD/MM/AAAA`
2. Cód. Conta Débito
3. Cód. Conta Crédito
4. Valor (`10000,00` — sem milhar)
5. Cód. Histórico (vazio nesta versão)
6. Comp. Histórico (`entries.description`)
7. Indicador de Início de Lote (`1` no primeiro registro do lançamento)
8. Matriz/Filial (vazio)
9. CC Débito (vazio)
10. CC Crédito (vazio)

### Nota sobre “Inicia Lote”

O exemplo XLSX/CSV do Domínio pode mostrar valores como `99` ou `854` na coluna de início de lote.  
**O XML do layout define o indicador como `1`.** Esta entrega segue o XML, não os valores ilustrativos da planilha.

## Mapeamento

Tabela: `account_external_mappings` (migration `031_account_external_mappings.sql`).

O código enviado ao Domínio é `external_code`.  
**Não** se usa `accounts.account_code` automaticamente.

UI: Empresa → Integrações → Domínio.

## Geração

- **1 D + 1 C** → 1 linha com ambos os códigos e `Inicia Lote=1`.
- **N×N** → uma linha por conta (débito ou crédito); primeiro registro do lançamento com `Inicia Lote=1`.
- Conta sem mapeamento → **bloqueia** (prévia + geração).
- Lançamento não balanceado → **bloqueia**.
- Somente `POSTED`.

Arquivo exemplo:

`dominio-empresa-2026-01-01-2026-01-31.txt`

## Endpoints

- `POST /api/exportacoes/previa`
- `POST /api/exportacoes/gerar` (delega ao adapter)
- `GET /api/exportacoes/:id/download`
- `GET/PUT /api/empresas/:id/integracoes/dominio/mapeamentos`
- `DELETE .../mapeamentos/:accountId`

## Limitações desta entrega

- Sem importação em massa de mapeamento.
- Sem histórico externo (`history_external_mappings` — só preparado conceitualmente).
- Sem matriz/filial e centro de custo (campos vazios).
- Sem API remota Domínio.

## Testes

`tests/sprint-28-dominio-export.test.js`

Casos cobrem adapter, POSTED-only, 1×1, N×N, bloqueios, isolamento, formatação, checksum, download, auditoria e CSV canônico paralelo.

## Data da validação técnica (código)

2026-09-19 — geração conforme layout 11758 em ambiente de teste automatizado.  
Homologação no Domínio do cliente: **pendente**.
