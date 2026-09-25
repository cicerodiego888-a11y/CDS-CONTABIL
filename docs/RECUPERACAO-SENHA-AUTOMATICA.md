# Recuperação automática de senha (Portal)

Fluxo self-service do **Esqueci minha senha** no Portal do Cliente.

## Fluxo

1. Cliente preenche código do escritório + e-mail no login.
2. Clica em **Esqueci minha senha** (sem tela intermediária / sem segunda confirmação).
3. `POST /api/auth/forgot-password` identifica o usuário (se existir), gera token `PASSWORD_RESET` (24h, uso único) e envia o e-mail automaticamente.
4. Cria/atualiza a solicitação (`PENDENTE`) e notifica o escritório com `CLIENT_PASSWORD_RESET_REQUESTED`.
5. Resposta sempre neutra (anti-enumeração):

> Enviamos as instruções para o seu e-mail cadastrado.  
> Verifique sua caixa de entrada para criar uma nova senha.

6. Cliente abre o link `/convite/:token`, define a nova senha.
7. Solicitação passa automaticamente para **CONCLUÍDA** (`client_invitations.status=ACCEPTED`).
8. Escritório recebe notificação `PASSWORD_RESET_COMPLETED` (informativa).

## Falhas

Se o envio do e-mail falhar de forma relevante:

- solicitação → **FALHA** (`REVOKED`)
- `PASSWORD_RESET_FAILED` → Notification Center (OWNER / ACCOUNTANT)
- A resposta ao cliente permanece neutra.

## Compatibilidade

- O contador continua podendo usar **Redefinir acesso** (Sprint 27.3).
- Rotas, permissões, tenant/company isolation e convites `ACTIVATION` permanecem intactos.
