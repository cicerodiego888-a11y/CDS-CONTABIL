# Sprint 27.6 — Auditoria e correção do link PASSWORD_RESET

## Causa real

Auditoria do HTML/template e dos jobs de comunicação mostrou:

1. O template `password-reset` **gera** `<a href="...">Criar nova senha</a>` corretamente quando a `url` é informada.
2. Em `deliverInvite`, o payload gravado em `communication_jobs` para **PASSWORD_RESET** **não incluía `url`**.
3. Jobs históricos de `user-invite` / ACTIVATION **tinham `url`** no payload.
4. O worker (`processEmailJob`, a cada 2s) re-renderiza o template a partir do payload. Sem `url`, o HTML sai com `href=""`.
5. Há janela de corrida: job entra como `PENDING` antes do SMTP terminar → worker pode enviar o e-mail **sem link** enquanto o envio síncrono ainda está em andamento.

Resultado observado pelo cliente: e-mail com visual de botão “Criar nova senha”, porém **não clicável / sem fluxo** (`href` vazio).

Além disso, a URL base padrão usava a porta do **escritório** (`PORT`, tipicamente 3333). Com dual-front, o convite deve preferir o **Portal do Cliente** (`CLIENT_PORT`, tipicamente 3334), ou `CDS_EMAIL_APP_URL` público.

## HTML/href (sem token)

Formato esperado (redigido):

```html
<a href="http://<base>/convite/[REDACTED]" ...>Criar nova senha</a>
```

Com `url` vazia (bug do worker):

```html
<a href="" ...>Criar nova senha</a>
```

## URL base / rota

- Rota oficial (inalterada): `/convite/:token` → `frontend/public/convite.html`
- API: `GET/POST /api/invitations/:token`
- Base: `CDS_EMAIL_APP_URL` / `PUBLIC_URL`, senão `http://localhost:<CLIENT_PORT>` quando dual-port, senão `PORT`

## Correção

1. `deliverInvite` grava `url` no payload do job (PASSWORD_RESET e ACTIVATION).
2. `processEmailJob` passa `url: payload.url` ao re-renderizar.
3. `appPublicUrl()` prioriza o front do cliente no dual-port.
4. Template PASSWORD_RESET: `target="_blank"` + link textual de fallback.

## Arquivos

- `backend/src/communications/communication-service.js`
- `backend/src/communications/email/templates/index.js`
- `backend/src/server.js` (`appPublicUrl`)
- `.env.example`
- `tests/sprint-27.6-password-reset-link.test.js`
- `docs/SPRINT-27.6-LINK-RESET-ACESSO.md`

## Migration

Nenhuma.

## Segurança

- Token continua só como hash no banco (`token_hash`).
- Token bruto segue apenas no link do e-mail (necessário).
- Sem senha/`password_hash`/`token_hash` em logs, auditoria ou respostas de teste.
- Relatório e asserts não imprimem o token.

## Teste manual (realizado)

1. Contador: Redefinir acesso (API demo) → HTML do template gerado.
2. Abrir o HTML do e-mail no Portal do Cliente (porta 3334).
3. Clicar efetivamente no botão **Criar nova senha** (`<a href>`).
4. Abriu nova aba em `/convite/[token]` com título **Crie sua nova senha** e campos Nova senha / Confirmar.
5. Host do href: Portal do Cliente (`:3334`), rota `/convite/`.
6. Token não documentado neste relatório.

## Testes automatizados

Arquivo: `tests/sprint-27.6-password-reset-link.test.js` (11 casos).

Suite completa: `npm test` → 784 pass / 0 fail.

`node scripts/db-integrity.js` → integrity_check ok; foreign_key_check vazio.
