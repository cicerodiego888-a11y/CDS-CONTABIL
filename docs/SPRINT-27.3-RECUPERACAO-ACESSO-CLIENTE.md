# Sprint 27.3 — Recuperação segura de acesso do cliente

## Objetivo

Permitir que o escritório (OWNER/ACCOUNTANT) redefina o acesso do Portal do Cliente sem jamais expor, recuperar ou enviar a senha antiga. A recuperação é controlada pelo escritório; o cliente não possui self-service por e-mail.

## Fluxo

1. Contador abre **Usuários** da empresa → **Redefinir acesso** → confirma.
2. Backend registra `CLIENT_CREDENTIAL_RESET_REQUESTED`.
3. Convites `PENDING` anteriores são revogados.
4. Novo convite `PASSWORD_RESET` é criado (token aleatório 32 bytes hex, **somente hash** no banco, validade **24h**, uso único).
5. E-mail é enviado pelo provider existente (`CDS_EMAIL_*`).
6. Se o envio falhar: convite novo é revogado, senha/sessões **não** são alteradas, resposta 502 com mensagem de falha e auditoria `CLIENT_INVITATION_SEND_FAILED`.
7. Se o envio OK: sessões revogadas (`token_version`), hash da senha substituído por valor aleatório inutilizável, auditorias `CLIENT_SESSION_REVOKED`, `CLIENT_INVITATION_CREATED`, `CLIENT_INVITATION_SENT`.
8. Cliente abre `/convite/:token` → **Crie sua nova senha** → aceita.
9. Token consumido (`ACCEPTED` + `accepted_at`); nova senha só como bcrypt hash; auditoria `CLIENT_PASSWORD_DEFINED`.
10. Credencial volta a **CONFIGURADA**; cliente acessa o Portal.

No login do portal, **Esqueci minha senha** apenas orienta a contatar o escritório (sem endpoint público de reset).

## Permissões

| Papel | Pode redefinir? |
|-------|-----------------|
| OWNER | Sim |
| ACCOUNTANT | Sim |
| STAFF | Não |
| CLIENT / CLIENT_* | Não |

Escopo: `tenant_id` e `company_id` do backend (JWT + `companyVisibleToUser` + `X-Company-Id` / `scope`). Nunca confiar em IDs enviados no body.

Perfis elegíveis: usuários `role=CLIENT` com perfil CLIENT_ADMIN / CLIENT_FINANCE / CLIENT_VIEWER (sem mudança de permissões).

## Segurança do token

- Geração: `crypto.randomBytes(32).toString('hex')`
- Persistência: `SHA-256(token)` em `client_invitations.token_hash`
- Token puro só no link do e-mail / `activation_url` (não-prod)
- Finalidade: coluna `purpose` (`ACTIVATION` | `PASSWORD_RESET`)
- Uso único + expiração; finalidade desconhecida rejeitada

## Validade

- Ativação padrão: 72h (infra existente)
- Redefinição (`PASSWORD_RESET`): **24h**

## Revogação de sessão

Reutiliza `sessions.revoke` (`users.token_version`). Não há segundo mecanismo.

## E-mail

Provider existente. Assunto: `Redefinição de acesso — CDS Contábil Connect`. CTA: Criar nova senha. Sem senha/token no texto visível além do link do botão.

Link: `CDS_EMAIL_APP_URL` + `/convite/{token}`.

## Auditoria

Eventos: `CLIENT_CREDENTIAL_RESET_REQUESTED`, `CLIENT_SESSION_REVOKED`, `CLIENT_INVITATION_CREATED`, `CLIENT_INVITATION_SENT`, `CLIENT_PASSWORD_DEFINED`, `CLIENT_INVITATION_SEND_FAILED`.

Nunca: senha, hash de senha, token, API key, Authorization.

## Credencial (UI)

| Estado | Quando |
|--------|--------|
| CONFIGURADA | Convite ACCEPTED ou ativo com último acesso |
| AGUARDANDO DEFINIÇÃO | Convite PENDING com `purpose=PASSWORD_RESET` |
| NÃO CONFIGURADA | Demais pendências de ativação |

## Migration

- `database/schema/030_client_invitation_purpose.sql` (documentação)
- `ensureColumn(client_invitations.purpose, DEFAULT 'ACTIVATION')` em `backend/src/database.js`

## Arquivos alterados

- `backend/src/server.js` — endpoint `POST /api/client-users/:id/redefinir-acesso`, invitation purpose, accept/GET
- `backend/src/database.js` — coluna purpose
- `backend/src/communications/communication-service.js` — template password-reset
- `backend/src/communications/email/templates/index.js` — conteúdo do e-mail
- `frontend/public/assets/app.js` — ação Redefinir acesso
- `frontend/public/portal/portal.js` — Esqueci minha senha
- `frontend/public/convite.html` — tela de nova senha
- `frontend/public/index.html` / `portal/index.html` — cache bust
- `tests/sprint-27.3-access-recovery.test.js`
- `docs/SPRINT-27.3-RECUPERACAO-ACESSO-CLIENTE.md`

## Testes

Arquivo `tests/sprint-27.3-access-recovery.test.js` cobre permissões, isolamento tenant/company, revogação, token hash/uso único/expiração/finalidade, hash de senha, e-mail, falha de envio, auditoria e ausência de segredos.

## Fora de escopo

- Self-service de reset por e-mail pelo cliente
- Novo motor paralelo de recuperação
- Alteração de perfis CLIENT_* / Core V1.0
