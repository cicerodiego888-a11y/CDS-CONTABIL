# Deploy de produção — VPS Linux genérico

Arquitetura alvo:

```
INTERNET
   ↓
HTTPS :443
   ↓
REVERSE PROXY (ex.: Nginx)
   ↓
Node.js Express :3333 (localhost)
   ↓
SQLite PRODUÇÃO
```

O usuário **não** deve acessar `http://IP:3333` publicamente.

## Pré-requisitos

| Item | Valor |
|---|---|
| SO | Linux (VPS) |
| Node.js | **20+** (README do projeto) |
| npm | compatível com Node 20+ |
| Portas | 80, 443 (públicas); 3333 só localhost |
| Pacote | `dist-production/` (Sprint 40.2) |
| Banco | limpo / preparado (Sprint 40.2) — **não** o piloto |

`[CONFIGURAÇÃO DEPENDENTE DO PROVEDOR]`: criação da VPS, IP público, DNS, painel de certificado.

## Layout sugerido no servidor

```
/opt/cds-contabil/
  app/                 # conteúdo de dist-production + node_modules
  database/            # SQLite de produção
  uploads/
  exports/
  backups/
  logs/
  .env                 # somente no servidor
```

Código ≠ dados ≠ backups ≠ logs ≠ segredos.

## Passo a passo

### 1. Provisionar VPS

`[CONFIGURAÇÃO DEPENDENTE DO PROVEDOR]`

- SSH
- Firewall: 22 (restrito), 80, 443
- Usuário de serviço `cds` (sem root para a app)

### 2. Instalar Node.js 20+

Verifique no servidor:

```bash
node --version   # >= 20
npm --version
```

Não altere `package.json` só para acomodar Node antigo.

### 3. Enviar o pacote

No ambiente de build (dev):

```bash
npm test
node scripts/db-integrity.js
npm run build:production
node scripts/check-production-package.js
```

Copie **apenas** `dist-production/` para `/opt/cds-contabil/app/`  
(rsync/scp — `[CONFIGURAÇÃO DEPENDENTE DO PROVEDOR]`).

**Não** copie: `node_modules` local, `.env`, banco piloto, uploads, exports, backups, logs.

### 4. Dependências no servidor

```bash
cd /opt/cds-contabil/app
npm ci --omit=dev
```

### 5. `.env` de produção

Copie `.env.production.example` → `/opt/cds-contabil/.env` e preencha **no servidor**.

Obrigatório:

```env
NODE_ENV=production
PORT=3333
CLIENT_PORT=0
CDS_AUTH_COOKIE=true
CDS_OFFICE_PUBLIC_URL=https://DOMINIO_REAL
CDS_CORS_ORIGIN=https://DOMINIO_REAL
JWT_SECRET=<gerado no servidor>
DOCUMENT_ENCRYPTION_KEY=<gerado no servidor>
CDS_DB_PATH=/opt/cds-contabil/database/cds-contabil-connect.db
UPLOAD_DIR=/opt/cds-contabil/uploads
EXPORT_DIR=/opt/cds-contabil/exports
BACKUP_DIR=/opt/cds-contabil/backups
DEMO_MODE=false
```

Links de e-mail (convite/reset) usam a mesma origem pública (`CDS_OFFICE_PUBLIC_URL`); o Portal fica em `https://DOMINIO/portal/`. Não configure localhost.

Geração de secrets: ver `docs/PRODUCAO-SECRETS.md`.  
SMTP: necessário para onboarding por e-mail.

Permissão: somente o usuário do serviço deve ler `.env`.

### 6. Banco

```bash
export $(grep -v '^#' /opt/cds-contabil/.env | xargs)   # ou EnvironmentFile no systemd
# Se o arquivo ainda não existir:
npm run prepare:production-db
npm run validate:production-db
```

Antes do primeiro onboarding: `tenants=0`, `users=0`, `companies=0`.  
Nunca use o banco piloto.

### 7. Reverse proxy + HTTPS

Modelo: `deploy/nginx/cds-contabil.conf.example`

- HTTP :80 → redirect HTTPS
- HTTPS :443 → `127.0.0.1:3333`
- Headers: `Host`, `X-Forwarded-*`
- Negar `/.env`, `/database`, `/backups`, `/logs`

Certificado: `[CONFIGURAÇÃO DEPENDENTE DO PROVEDOR]` (Let's Encrypt, painel, etc.).

### 8. Processo (systemd)

Modelo: `deploy/systemd/cds-contabil.service.example`

```bash
# [CONFIGURAÇÃO DEPENDENTE DO PROVEDOR] — paths do systemctl
sudo systemctl enable --now cds-contabil
sudo systemctl status cds-contabil
```

A app não depende de SSH aberto. Não rode como root.

### 9. Preflight no servidor

```bash
cd /opt/cds-contabil/app
npm run preflight:production
```

Esperado: **PASS** (WARNs só para opcionais: IA/VAPID).

### 10. Smoke

```bash
PRODUCTION_BASE_URL=https://DOMINIO_REAL npm run smoke:production
```

Manual (checklist Sprint 40.3): login, criar escritório, e-mail, ativação, dashboard, empresa, isolamento, HTTPS, `/api/health`.

## DNS

```
A   DOMINIO_REAL  →  IP_DO_SERVIDOR
```

`[CONFIGURAÇÃO DEPENDENTE DO PROVEDOR]` — não inventar IP/domínio.

## O que não fazer

- Expor porta 3333 na Internet
- `CLIENT_PORT=3334` em produção pública
- `CDS_CORS_ORIGIN=*`
- URL pública com localhost
- Copiar `.env` / banco / uploads do Windows
- Servir backups/logs pelo Nginx

## Referências

- `docs/PRODUCAO-BANCO.md`
- `docs/PRODUCAO-SECRETS.md`
- `docs/BACKUP-PRODUCAO.md`
- `deploy/nginx/cds-contabil.conf.example`
- `deploy/systemd/cds-contabil.service.example`
- `scripts/smoke-production.js`
- `scripts/check-production-package.js`
