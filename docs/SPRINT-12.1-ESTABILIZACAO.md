# Sprint 12.1 — Estabilização visual + identidade do escritório

## Problema

A Sprint 12 deixou a logo do escritório apenas em `localStorage` por `tenantId`. Isso não sobrevive a outro navegador, vazava facilmente entre sessões se a chave não fosse limpa, e não é fonte de verdade para um SaaS multi-tenant.

O segundo problema era o tratamento genérico de erros no SPA: falhas de tela ou de API secundária podiam ser tratadas como perda de autenticação.

## Solução

- Identidade do **tenant** persistida em `tenant_branding` + arquivo em `uploads/branding/{tenantId}/{uuid}.ext`.
- Backend é a autoridade (`tenant_id` do JWT).
- Frontend busca `GET /api/tenant/branding` uma vez em `loadBase` e, se houver logo, um `GET` autenticado que vira Object URL.
- `api()` só limpa sessão em **401** (exceto login/senha). 403/404/409/422/429/5xx/rede mostram mensagem e mantêm o usuário autenticado.

## Branding

Campos: `office_name`, `slogan`, `logo_path`, `logo_mime`, timestamps.

Sem tema por tenant. Sem SVG (não sanitizado). MIME conferido por magic bytes + extensão.

A logo **não** entra na tabela `documents`.

## Persistência

Migração: `database/schema/013_tenant_branding.sql`.

Tenants antigos sem linha em `tenant_branding` continuam válidos: o GET devolve o nome do tenant e `has_logo: false`.

## Endpoints

| Método | Caminho | Quem |
|--------|---------|------|
| GET | `/api/tenant/branding` | OWNER, ACCOUNTANT, STAFF |
| PATCH | `/api/tenant/branding` | OWNER, ACCOUNTANT |
| POST | `/api/tenant/branding/logo` | OWNER, ACCOUNTANT |
| DELETE | `/api/tenant/branding/logo` | OWNER, ACCOUNTANT |
| GET | `/api/tenant/branding/logo` | OWNER, ACCOUNTANT, STAFF |

CLIENT recebe 403 em `/api/tenant/*` (prefixo já bloqueado). STAFF lê, não escreve.

OWNER, ao salvar `office_name`, atualiza também `tenants.name`.

## Segurança

- Sem `tenant_id` do body como autoridade (`delete req.body.tenant_id` + JWT).
- Path da logo: exatamente `{tenantId}/{arquivo}`; recusa `..` e path absoluto.
- Nome interno UUID. Não expõe `logo_path` no JSON.
- Upload ≤ 2 MB; PNG / JPEG / WEBP.
- Cache da logo: `private, max-age=60` + query `v=updated_at`. Não há cache compartilhado entre tenants (arquivo por pasta de tenant + JWT).

## Tratamento de erros

| Status | Sessão | UI |
|--------|--------|----|
| 401 | limpa e vai ao login | “Sua sessão expirou…” quando o token expirou |
| 403 | permanece | “Você não tem permissão…” |
| 404 / 409 / 422 / 429 / 5xx | permanece | mensagem contextual + retry na tela quando cabe |
| rede | permanece | “Não foi possível conectar ao servidor.” |

Dashboard: KPIs de `/dashboard`; atividade de notificações em `Promise` isolada com “Não foi possível carregar agora.” + Tentar novamente.

Polling de notificações: erro silencioso (exceto 401).

Portal: mesma regra; menu sem Nova receita.

## Configuração

Configurações → Identidade do escritório: nome, slogan, enviar logo, remover logo (confirmação), pré-visualização.

## Testes

- Baseline da suíte anterior: 177 PASS / 0 FAIL / 0 SKIP.
- Novos: `tests/stabilization-12-1.test.js`.
- Assets versionados `?v=s12-2`.

## Teste visual

Exercitar no navegador: login escritório, Dashboard (placeholder ou logo real), Configurações (upload/remoção), segundo tenant, Portal (Nova despesa Frete 120,00 PIX Nubank 15/09/2026 + comprovante), Documentos, erro 403 sem logout, viewports desktop/tablet/mobile.

## Limitações

- Logo do Dashboard usa Object URL (a tag `<img>` não envia JWT sozinha).
- ACCOUNTANT altera `office_name` no branding sem necessariamente alterar `tenants.name` (apenas OWNER sincroniza o cadastro do escritório).
- Sem paleta/tema completo por tenant.
- Teste de outro navegador/incógnito depende do ambiente local com servidor no ar.
