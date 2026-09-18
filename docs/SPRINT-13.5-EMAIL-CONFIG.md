# Sprint 13.5 — Central de configuração de e-mail

A configuração SMTP do escritório passa a ser administrativa, persistida por tenant, reutilizando `backend/src/email/provider.js` e `smtp.js`.

## Onde configurar

Configurações → Comunicações → E-mail (aba na tela Comunicações). Também pelo menu SISTEMA → Comunicações → E-mail.

OWNER e ACCOUNTANT gravam, testam e enviam teste. STAFF pode visualizar. CLIENT_* não acessa.

## Persistência

Tabela `tenant_email_settings` (`database/schema/014_tenant_email.sql`), uma linha por `tenant_id`.

Credencial: AES-256-GCM com chave derivada por scrypt de `CDS_EMAIL_SECRET` ou, se ausente, `JWT_SECRET`. Salt/IV/tag por registro. Nunca texto puro.

## Precedência

1. Configuração persistida válida do tenant.
2. Variáveis `CDS_EMAIL_*` do ambiente (e `setEmailProvider` nos testes).
3. Provider `off`.

`CDS_EMAIL_APP_URL` permanece só no ambiente (links de convite).

## API

- `GET /api/configuracoes/comunicacoes/email`
- `PUT /api/configuracoes/comunicacoes/email`
- `POST /api/configuracoes/comunicacoes/email/testar`
- `POST /api/configuracoes/comunicacoes/email/teste`

GET nunca devolve senha. `hasCredential` indica se há credencial.

## Convites

`invitationRecord` usa `emailProviderForTenant`. Mensagens 13.3D preservadas.
