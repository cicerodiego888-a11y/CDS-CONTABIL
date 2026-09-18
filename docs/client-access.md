# Acesso de clientes

O acesso de clientes reutiliza o backend, o banco e o JWT existentes. Os identificadores técnicos abaixo descrevem o modelo; na interface eles aparecem em Português (Brasil).

## Empresa cliente

A empresa pertence a um `tenant_id` (escritório) e reúne os dados cadastrais:

- CNPJ
- Razão Social (`name`)
- Nome Fantasia (`trade_name`)
- Situação: `ACTIVE` (Ativa), `BLOCKED` (Bloqueada), `ARCHIVED` (Arquivada)
- Telefone, e-mail e endereço (logradouro, número, complemento, bairro, cidade, UF e CEP)

Uma empresa bloqueada não pode ser acessada por usuários `CLIENT`. Usuários e histórico permanecem no banco.

## Usuário cliente

Usuários do Portal do Cliente têm:

- `role = CLIENT` (único valor técnico permitido para este tipo de acesso)
- `tenant_id` e `company_id` da empresa em que foram criados
- perfil em `client_user_profiles`

Uma empresa pode ter vários usuários. Criar usuário **não** cria outra empresa.

## Role e perfil

Role técnico (não alterar o CHECK do banco):

- `OWNER`, `ACCOUNTANT`, `STAFF`, `CLIENT`

Perfis do portal (internos) e rótulos na interface:

- `CLIENT_ADMIN` → Administrador
- `CLIENT_FINANCE` → Financeiro
- `CLIENT_VIEWER` → Visualizador

O backend aceita o código técnico ou o rótulo em português e grava o perfil interno. O `role` gravado é sempre `CLIENT`.

## Permissões

A autorização é aplicada no backend em `/api/client/...`. Esconder um botão na tela não concede acesso.

- Administrador: dashboard, despesas e receitas (visualizar, criar e editar quando permitido), documentos, pendências, solicitações, notificações, relatórios e gerenciamento de usuários da própria empresa quando a permissão existir.
- Financeiro: as mesmas operações financeiras e de colaboração, sem gerenciamento de usuários.
- Visualizador: dashboard, visualização de despesas, receitas, documentos e relatórios, além de solicitações e notificações conforme as rotas já existentes. Não cria nem edita movimentações.

Tentativas incompatíveis retornam HTTP 403 com a mensagem: "Você não tem permissão para realizar esta operação."

## Convite e ativação

1. O escritório cria a empresa em `POST /api/empresas`.
2. Cria o usuário em `POST /api/empresas/:id/users` com o perfil desejado.
3. O backend gera um token aleatório, grava somente o hash SHA-256, define validade de 72 horas e status `PENDING` (Pendente).
4. O convidado abre `/convite/:token`, consulta `GET /api/invitations/:token` e define a senha em `POST /api/invitations/:token/accept`.
5. O convite passa a `ACCEPTED` (Aceito), a conta é ativada e o login redireciona para `/portal/`.

Reenvio invalida o convite anterior e gera um novo token. Revogação impede o aceite. Senha e token puro não entram na auditoria nem no e-mail.

Estados da tela de convite:

- Válido: "Ative seu acesso"
- Expirado: "Este convite expirou."
- Revogado: "Este convite não está mais disponível."
- Já utilizado: "Este convite já foi utilizado."
- Erro: "Não foi possível validar este convite."

## Bloqueio

- Usuário bloqueado (`active = 0`) não autentica.
- Empresa bloqueada impede login e uso do portal pelos `CLIENT` vinculados.
- Desbloqueio restaura o acesso quando a empresa está Ativa.

## Isolamento

Consultas administrativas filtram pelo `tenant_id` da sessão. Rotas do portal usam o `company_id` do usuário autenticado, nunca o informado pelo cliente. Usuário da Empresa A não consulta Empresa B, nem dados de outro tenant.

## Endpoints principais

- `GET /api/empresas` e `GET /api/empresas?q=`
- `POST /api/empresas`
- `GET /api/empresas/:id`
- `PATCH /api/empresas/:id`
- `POST /api/empresas/:id/bloquear`
- `POST /api/empresas/:id/desbloquear`
- `GET /api/empresas/:id/users`
- `POST /api/empresas/:id/users`
- `GET /api/empresas/:id/users/:userId`
- `PATCH /api/client-users/:id`
- `POST /api/client-users/:id/resend-invitation`
- `POST /api/client-users/:id/revoke-invitation`
- `POST /api/client-users/:id/block`
- `POST /api/client-users/:id/unblock`
- `GET /api/invitations/:token`
- `POST /api/invitations/:token/accept`
- `GET /api/client/relatorios`

A página de ativação fica em `/convite/:token`.

## Portal do Cliente — despesas, receitas e documentos

O Portal usa o mesmo backend, banco, JWT, `tenant_id` e `company_id`. Não há seletor de empresa: o `company_id` vem do usuário autenticado e o payload não é autoridade.

### Responsabilidades

Cliente: registra despesas, envia documentos e responde pendências e solicitações. O cliente **não cadastra receitas** (`POST /api/client/receitas` responde `403 REVENUE_NOT_AVAILABLE_FOR_CLIENT`).

Escritório: importa receitas, classifica, revisa, aprova, gera lançamentos e exporta. Lançamentos e o trabalho contábil ocorrem no contexto da empresa.

O cliente não informa débito, crédito, conta contábil, código ou lançamento. Esses dados pertencem ao Motor Contábil.

### Permissões no portal

- Administrador e Financeiro: criar e editar despesas/receitas (quando a movimentação não estiver aprovada) e enviar documentos.
- Visualizador: somente visualização. Tentativas de escrita retornam 403.

Movimentação aprovada não pode ser alterada pelo cliente; use solicitação ou pendência.

### Upload

Formatos: JPG, JPEG, PNG e PDF. Validação no backend (autenticação, autorização, tenant, empresa, extensão, MIME e tamanho). Hash SHA-256 é gravado. O caminho físico do servidor não é exposto. Documento da despesa/receita deve ser associado à movimentação; se o upload falhar, a movimentação pode ser salva e o arquivo anexado depois. Documentos independentes ficam pendentes de análise até a contabilidade associá-los.

### Isolamento e escala

Consultas do portal filtram `tenant_id` + `company_id` da sessão. Um escritório (tenant) não acessa empresas de outro. Um usuário da Cremolia não acessa a Empresa B.

`GET /api/empresas` é paginado (`items`, `total`, `page`, `page_size`) com busca por razão social, nome fantasia e CNPJ, sempre no tenant autenticado. Não há limite artificial de quantidade de empresas. Listagens administrativas não carregam milhares de registros no navegador de uma vez.

