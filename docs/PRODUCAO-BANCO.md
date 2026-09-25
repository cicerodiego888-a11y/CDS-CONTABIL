# Banco piloto × banco de produção

## Regra

**BANCO PILOTO ≠ BANCO PRODUÇÃO**

| | Piloto / desenvolvimento | Produção |
|---|---|---|
| Papel | Histórico do ambiente atual (dados de teste/piloto) | Instalação limpa para o primeiro escritório real |
| Caminho típico | `./database/cds-contabil-connect.db` | `./database/production/cds-contabil-connect.db` (ou volume no servidor) |
| Variável | `CDS_DB_PATH` no `.env` local | `CDS_DB_PATH` no `.env` do servidor |
| Dados | Podem existir tenants, empresas, documentos | Deve iniciar zerado (sem dados de negócio) |

`DB_FILE` **não** é usado. O caminho oficial é sempre `CDS_DB_PATH`.

## Preservação do piloto

Antes de preparar produção, faça backup:

```bash
npm run backup
```

O backup vai para `backups/backup-<timestamp>/` e inclui SQLite (+ WAL/SHM se existirem) e uploads.

O arquivo piloto em `database/cds-contabil-connect.db` **não** deve ser apagado nem zerpado pelos scripts de produção.

## Criar banco de produção limpo

Nunca aponte `CDS_DB_PATH` para o arquivo piloto ao preparar produção.

```bash
# Windows PowerShell
$env:CDS_DB_PATH="./database/production/cds-contabil-connect.db"
npm run prepare:production-db
npm run validate:production-db
```

Ou:

```bash
node scripts/prepare-production-database.js --path ./database/production/cds-contabil-connect.db
node scripts/validate-production-database.js --path ./database/production/cds-contabil-connect.db
```

Se o arquivo alvo **já existir**, o prepare **recusa** sobrescrever (proteção contra acidente).

## Fluxo

```
BANCO INEXISTENTE
      ↓
CRIAR SQLITE
      ↓
APLICAR TODAS AS MIGRATIONS (001…040)
      ↓
FOREIGN KEYS ON
      ↓
integrity_check
      ↓
foreign_key_check
      ↓
VALIDAÇÃO DAS TABELAS
      ↓
READY_FOR_FIRST_ONBOARDING
```

## O que NÃO vai para produção

- Dados do banco piloto
- Contas do plano importadas no piloto (ex.: 683 contas)
- Documentos / uploads do piloto
- Seeds de desenvolvimento

O plano de contas é importado depois pelo fluxo oficial da aplicação, se necessário.

## Exceção de dados de sistema

A migration `028_ai_model_pricing_gpt56_terra.sql` pode inserir preços de modelo de IA. Isso é **dado-base do sistema**, não dado de escritório/cliente.

## Onboarding

Com banco limpo (`tenants=0`, `users=0`, `companies=0`), o primeiro escritório nasce pelo fluxo oficial:

Login → Criar minha conta → confirmação de e-mail → ativação → TENANT + OWNER → dashboard.

Não criar OWNER/TENANT/COMPANY via SQL.
