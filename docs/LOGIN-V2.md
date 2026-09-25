# Login V2 — CDS Contábil Connect

## Objetivo

O login definitivo solicita apenas **e-mail** e **senha**. O escritório (tenant) é identificado automaticamente após autenticação válida. O usuário não informa código do escritório, `tenant_id`, `company_id` nem `codigo_cliente`.

## Fluxo

```
E-mail + senha
    → autenticação (bcrypt)
    → usuários elegíveis com a mesma credencial
    → 1 ambiente  → JWT / sessão
    → N ambientes → escolha de ambiente (somente após senha válida)
    → tenant_id + company_id (quando CLIENT)
    → ambiente autenticado
```

## Autenticação

- Endpoint principal: `POST /api/auth/login` com `{ email, password }`.
- Compatibilidade: clientes legados ainda podem enviar `tenant` / `tenant_slug` para resolver um único ambiente. O Portal do Cliente usa Login V2 (e-mail + senha; escolha de ambiente quando necessário).
- JWT, cookies de sessão (quando habilitados), roles e autorização permanecem os mesmos.
- Usuário inativo ou CLIENT com empresa não ativa são rejeitados.

## Identificação automática do tenant

Após validar a senha, o backend associa o usuário ao `tenant_id` persistido na conta. O frontend nunca envia `tenant_id` livremente como autorização; o middleware de auth continua sendo a autoridade.

## Múltiplos tenants por e-mail

A unicidade de e-mail continua sendo por tenant (`UNIQUE(tenant_id, email)`). O mesmo e-mail pode existir em escritórios diferentes.

Quando a senha é válida em mais de um usuário:

1. a API responde `needs_environment_choice: true`;
2. envia `choice_token` de curta duração;
3. envia `environments[]` com dados visuais: `key`, `name`, `cnpj`, `logo_url`.

**Nunca** se lista escritórios associados a um e-mail antes da senha correta.

## Seleção de ambiente

- Tela “Escolha seu ambiente” só aparece depois da autenticação válida.
- Exibe nome da contabilidade, CNPJ e logo (quando houver).
- Não exibe `tenant_id`, slug, `company_id`, `codigo_cliente` nem código interno do escritório.
- Conclusão: `POST /api/auth/login/choose` com `{ choice_token, key }`.

## Nome, CNPJ e branding

- Nome e CNPJ vêm do tenant / identidade (`tenant_branding.office_name` com fallback para `tenants.name`).
- Logo vem da identidade configurada em **Configurações → Identidade** (OWNER/ACCOUNTANT).
- Resposta de login bem-sucedido inclui `office: { name, cnpj, logo_url }` para a UI.
- Antes da autenticação, o card não inventa nome/CNPJ de um escritório específico.
- Não há endpoint público novo de descoberta de tenant por e-mail.

## Layout

Tela dividida:

| Lado esquerdo | Lado direito |
|---|---|
| Logo da contabilidade (superior) | Card de login |
| Headline e benefícios | E-mail, senha, Lembrar-me, Esqueci, Entrar, Criar conta |
| Logo CDS Contábil Connect (inferior, próxima ao livro) | Após escolha: nome/CNPJ/logo do ambiente |

Mobile prioriza o formulário; a marca CDS permanece discreta na base. Sem overflow horizontal.

## Segurança

- Sem enumeração de tenants antes da senha.
- Preferência local (“Lembrar-me” / último ambiente) é apenas conveniência visual — nunca autorização.
- Senha nunca é armazenada em texto no navegador.
- Isolamento multi-tenant e por company preservados.

## Compatibilidade

Preservados: Portal do Cliente (Login V2), recuperação de senha, onboarding (Sprint 34/35), SMTP, `codigo_cliente` (Sprint 36.1), JWT, roles, notificações e branding existente.

## Recuperação de senha

O link “Esqueci minha senha” permanece. Portal e app do escritório pedem só o e-mail (quando o CLIENT for único). Com `tenant` explícito (API legada), o fluxo anterior segue igual. Token, expiração, e-mail e notificações não mudam.

## Onboarding

“Criar minha conta” continua no fluxo signup → e-mail → ativação → tenant + OWNER → login.
