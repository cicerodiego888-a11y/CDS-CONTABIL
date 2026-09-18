# Sprint 08 — Notificações in-app

## UX (escritório)
Sino no topo. Badge com não lidas (`Notificações (5)`). Painel: não lida (fundo destacado), lida, vazio, erro, carregando. Marcar uma ou todas. Relativo: “há 2 min” no frontend a partir de `created_at`.

## Mensagens
- Nova despesa recebida — `{empresa} enviou uma nova despesa` — `R$ 1.250,00 · PIX`
- Nova receita recebida — analogamente
- Novo documento recebido — nome do arquivo
- Classificação pendente — valor/descrição
- Confirmação do cliente: “Despesa registrada com sucesso.” (sem débito/crédito)

## API
- `GET /api/notificacoes?page=&page_size=&since=` → `{items, pagination, unread}`
- `POST /api/notificacoes/:id/lida`
- `POST /api/notificacoes/lidas`
- `GET/PUT /api/notificacoes/preferencias`
- `GET /api/client/notificacoes` permanece **array** (compatível com o Portal)

## Navegação segura
Mapa fixo: expense→despesas, revenue→receitas, document→documentos, entry→lançamentos, request→solicitações, pendency→pendências. Com `company_id`, abre `/empresas/:id` via API (404 se outra empresa/tenant). Sem URL livre no banco.

## Permissões
CLIENT não lê a API administrativa. Portal single-company. Usuário inativo/bloqueado não entra na query de destinatários.

## Polling
45 segundos. Sem WebSocket. Visão geral: clique leva ao contexto da empresa. Dentro de uma empresa, o GET usa `X-Company-Id` e lista só aquele contexto.
