# Backup e restauração

O sistema é portátil quando o banco guarda apenas `storage_path` relativo e o diretório de uploads acompanha o backup.

## Backup

```bash
npm run backup
```

Gera `backups/backup-<timestamp>/` com:

- `cds-contabil-connect.db` (e WAL/SHM se existirem)
- `uploads/`
- `MANIFEST.json`

Não inclui `.env` com segredos. Em outro servidor, configure `JWT_SECRET` e `DOCUMENT_ENCRYPTION_KEY` iguais aos originais para descriptografar documentos.

## Restore

```bash
node scripts/restore.js backups/backup-XXXX/cds-contabil-connect.db C:\cds-restore
```

O script copia o banco informado e, se existir, a pasta `uploads/` ao lado do arquivo `.db` do backup. Se essa pasta não existir, usa `uploads/` do repositório atual.

Depois:

```bash
set CDS_DB_PATH=C:\cds-restore\cds-contabil-connect.db
set UPLOAD_DIR=C:\cds-restore\uploads
set DOCUMENT_ENCRYPTION_KEY=<mesma chave>
set JWT_SECRET=<mesmo segredo>
node backend/src/server.js
```

## Validação

1. Integridade: `npm run db:integrity`
2. Login
3. Abrir documentos autorizados
4. Consultar empresas e lançamentos POSTED
5. Confirmar que não há dependência de `C:\projetos\...` da máquina original
