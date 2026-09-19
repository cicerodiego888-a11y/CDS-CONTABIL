# Sprint 14 — Núcleo V1.0 estabilizado

Correção, hardening e testes do núcleo. Sem Open Finance, IA ou motor de processos.

## O que mudou

- Documentos passam a gravar `storage_path` relativo (`documents/{id}/arquivo`).
- `DocumentStorageService` monta o caminho físico a partir de `UPLOAD_DIR`.
- Arquivos novos são criptografados com AES-256-GCM. A chave vem de `DOCUMENT_ENCRYPTION_KEY`.
- Visualização/download descriptografa em memória. Não grava cópia aberta permanente.
- Acesso continua filtrado por tenant, empresa, usuário e permissão.
- Credencial do cliente: hash bcrypt, status CONFIGURADA / NÃO CONFIGURADA. Senha não é recuperável.
- `CDS_DB_PATH` é o caminho oficial do banco. `DB_FILE` não é usado.
- `DEMO_MODE=true` habilita seed e dicas de login. Produção recusa demo.
- Validação semântica `validateAccountingSemantics()` além de D = C.
- Sessão: JWT 12h, rate limit, revogação opcional (`logout` com `{revoke:true}`), cookie HttpOnly preparado.
- Estrutura: `config.js`, `database.js`, `app.js`, `server.js`.

## Variáveis

Ver `.env.example`. Produção exige `JWT_SECRET` forte e `DOCUMENT_ENCRYPTION_KEY` (mín. 32).

## Migração de documentos

```bash
npm run migrate:documents
```

Relatório de arquivos ausentes: `logs/ORPHAN_DOCUMENTS.json`. Órfãos não são apagados automaticamente.
