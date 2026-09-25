# Backup de produção

## Objetivo

Proteger o SQLite de produção e os uploads **sem apagar** o banco ativo.

Separação obrigatória:

| Área | Exemplo |
|---|---|
| Aplicação | `/opt/cds-contabil/app` |
| Dados (banco) | `CDS_DB_PATH` → `/opt/cds-contabil/database/...` |
| Uploads | `UPLOAD_DIR` |
| Backups | `BACKUP_DIR` → `/opt/cds-contabil/backups` |
| Logs | `/opt/cds-contabil/logs` |

Backups **não** ficam dentro de `dist-production/`.

## Configuração

```env
CDS_DB_PATH=/opt/cds-contabil/database/cds-contabil-connect.db
BACKUP_DIR=/opt/cds-contabil/backups
UPLOAD_DIR=/opt/cds-contabil/uploads
```

A aplicação usa sempre `CDS_DB_PATH` (nunca `DB_FILE`).

Se `BACKUP_DIR` não estiver definido, o padrão é `<ROOT>/backups`.

## O que copiar

| Item | Origem | Observação |
|---|---|---|
| Banco | `$CDS_DB_PATH` | Incluir `-wal` / `-shm` se existirem |
| Uploads | `$UPLOAD_DIR` | Comprovantes / branding |
| Manifest | JSON com data e paths | Sem segredos |

Não incluir:

- `.env` (cofre separado)
- `node_modules`
- logs verbosos
- banco piloto

## Frequência sugerida

- Diário: SQLite (+ WAL/SHM)
- Semanal: SQLite + uploads
- Antes de atualização de versão: backup completo

## Retenção sugerida

- 7 diários / 4 semanais / 3 mensais

## Onde armazenar

**Backup local no mesmo disco do banco não é proteção suficiente.**

Produção deve ter cópia **externa/offsite** (outro volume, object storage, mídia externa).

Não inventar provedor nesta documentação — escolha conforme a política do escritório.

Se armazenamento externo ainda não existir:

**PENDÊNCIA DE INFRAESTRUTURA**

## Como gerar (no servidor)

```bash
cd /opt/cds-contabil/app
# EnvironmentFile/.env com CDS_DB_PATH e BACKUP_DIR
npm run backup
```

Saída: `$BACKUP_DIR/backup-<timestamp>/` com `.db`, WAL/SHM opcionais, `uploads/` e `MANIFEST.json`.

O comando **copia** o banco; não o apaga nem o substitui.

## Restauração

1. Pare o serviço.
2. Restaure o SQLite (e WAL/SHM) em `CDS_DB_PATH`.
3. Restaure uploads se necessário.
4. Use o **mesmo** `DOCUMENT_ENCRYPTION_KEY` (e kid) da época do backup — documentos cifrados dependem dessas chaves.
5. Confira permissões do usuário do serviço.
6. `npm run validate:production-db`
7. Suba o serviço e valide `/api/health` + login.

Nunca restaure o **banco piloto** em produção.  
Piloto ≠ produção.

## Validação do backup

- `PRAGMA integrity_check;` → `ok`
- `PRAGMA foreign_key_check;` → vazio
- Tamanho coerente com o banco ativo

## Segurança

- Backups = dados pessoais/financeiros
- Controle de acesso equivalente ao `.env`
- Não servir `/backups` pelo reverse proxy
- **Não versionar backups no Git**
