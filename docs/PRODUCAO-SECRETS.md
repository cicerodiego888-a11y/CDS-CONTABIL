# Segredos e variáveis de produção

Nunca coloque valores reais neste repositório, em `.env.example`, em `.env.production.example`, em `dist-production/` ou em commits.

Use o arquivo `.env` **somente no servidor** (fora do Git).

## Obrigatórias

| Variável | Regra |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Porta HTTP (ex.: `3333`) |
| `CLIENT_PORT` | `0` (portal no mesmo servidor) |
| `CDS_DB_PATH` | Caminho do SQLite de **produção** (não o piloto) |
| `UPLOAD_DIR` | Diretório de uploads |
| `EXPORT_DIR` | Diretório de exportações |
| `CDS_OFFICE_PUBLIC_URL` | URL pública HTTPS (sem localhost) |
| `CDS_CORS_ORIGIN` | Origem(ns) CORS HTTPS (sem `*`, sem localhost) |
| `CDS_AUTH_COOKIE` | `true` |
| `JWT_SECRET` | Segredo forte, ≥ 16 caracteres, único |
| `DOCUMENT_ENCRYPTION_KEY` | Chave forte, ≥ 32 caracteres |
| `DEMO_MODE` | `false` |

## E-mail (recomendado para onboarding)

| Variável | Uso |
|---|---|
| `CDS_EMAIL_PROVIDER` | `smtp` |
| `CDS_EMAIL_HOST` | Host SMTP |
| `CDS_EMAIL_PORT` | Ex.: `587` |
| `CDS_EMAIL_USER` | Usuário |
| `CDS_EMAIL_PASSWORD` | Senha / app password |
| `CDS_EMAIL_FROM` | Remetente |
| `CDS_EMAIL_FROM_NAME` | Nome de exibição |

Sem SMTP funcional, o fluxo “Criar minha conta” não consegue enviar o e-mail de ativação.

## Opcionais

| Variável | Uso |
|---|---|
| `AI_PROVIDER` / `OPENAI_API_KEY` / `AI_CREDENTIAL_ENCRYPTION_KEY` | Interpretação visual / IA |
| `WEB_PUSH_VAPID_PUBLIC_KEY` / `WEB_PUSH_VAPID_PRIVATE_KEY` / `WEB_PUSH_VAPID_SUBJECT` | Web Push |
| `CDS_EMAIL_APP_URL` | Base de links do portal do cliente (se diferente da URL do escritório) |

## Como gerar segredos

### JWT_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### DOCUMENT_ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### VAPID (opcional)

```bash
npx web-push generate-vapid-keys
```

Guarde a chave **privada** só no servidor. A pública pode ser exposta via API de push.

## Armazenamento

1. Crie `.env` no servidor a partir de `.env.production.example`.
2. Preencha segredos gerados localmente (não no chat / não no Git).
3. Restrinja permissões do arquivo (ex.: somente o usuário do serviço).
4. Faça backup cifrado dos segredos fora do servidor de aplicação.
5. Rotacione `JWT_SECRET` com planejamento (invalida sessões).

## Layout no servidor

Segredos ficam em arquivo fora do código, por exemplo:

`/opt/cds-contabil/.env`

referenciado por `EnvironmentFile=` no systemd (`deploy/systemd/cds-contabil.service.example`).

Não coloque o `.env` dentro de `dist-production/` nem no Git.

## Cookie

Com `CDS_AUTH_COOKIE=true` e `NODE_ENV=production`, o cookie de sessão usa `HttpOnly` + `Secure` (HTTPS).

## O que nunca fazer

- Commitar `.env` ou `.env.production`
- Colocar senha SMTP / VAPID private / API keys na documentação
- Reutilizar o `JWT_SECRET` / `DOCUMENT_ENCRYPTION_KEY` de desenvolvimento
- Usar localhost como `CDS_OFFICE_PUBLIC_URL` ou `CDS_CORS_ORIGIN` em produção
- Logar valores de segredos no relatório de deploy
