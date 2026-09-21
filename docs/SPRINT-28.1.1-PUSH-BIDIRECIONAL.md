# Sprint 28.1.1 — Push bidirecional (office ↔ client)

## Problema
CLIENT → escritório recebia Web Push; escritório → CLIENT não.

## Causa raiz (auditada)
Não era falha de destinatários, VAPID nem isolamento tenant/company.

Fluxo office→client:
1. `messageRecipients` selecionava corretamente o(s) CLIENT da empresa
2. `notifyRequestMessage` tentava `sendToUser`
3. Cliente tinha **zero** `push_subscriptions` ativas → `skipped: no_subscriptions`

O Portal carregava `push-client.js` mas **não chamava** `subscribePush` (o escritório sim). Sem subscription, o navegador do cliente nunca era alvo do web-push.

## Correção
- Portal: UI “Ativar push no navegador” + `CdsPush.subscribePush(api)` (mesmo fluxo do escritório)
- Deep-link office→client: `/portal/?solicitacao=:id`
- Deep-link client→office: `/empresas/:companyId/solicitacoes?open=:id`
- Payload visual: título `CDS Contábil Connect`, preview truncado, ícone `cds-push-icon.png`, action `Abrir conversa`
- Diagnóstico explícito `skipped: no_subscriptions` quando não há sub ativa

## Isolamento
Mantido: destinatários filtrados por `tenant_id` + `company_id`; mensagem da Empresa A não notifica CLIENT da Empresa B.

## Testes
`tests/sprint-28.1.1-push-bidirectional.test.js`
- Portal registra subscription
- CLIENT→office com sub do contador tenta envio
- office→CLIENT sem sub → `no_subscriptions` (prova da assimetria)
- Após CLIENT assinar, office→CLIENT deixa de ser `no_subscriptions`
- Isolamento entre empresas
- Payload/deep-links e service worker

## Tempo real (app aberto)
- Canal SSE `GET /api/realtime/stream?token=...`
- Ao gravar notificação in-app, o hub publica imediatamente no destinatário
- Portal e escritório abrem EventSource no boot; poll fica só como fallback (~12–15s)
- Com conversa aberta, a thread atualiza na hora

## Assets
- `app.js` / `portal.js` / `push-client.js` / `request-chat.css` → `?v=s28-1-3`

## Como ativar no Portal (obrigatório em cada navegador)
1. Abra o Portal no navegador desejado (Chrome, Edge, Firefox…) e faça `Ctrl+F5`
2. Aparece o modal **Ativar notificações** → clique em **Permitir neste navegador**
3. Aceite o pedido nativo do navegador (“Permitir”)
4. Repita se usar outro navegador — a autorização do Edge **não** vale para o Chrome

Sem permissão neste navegador específico, o Web Push nativo não chega (mesmo que o SSE em tempo real funcione com o Portal aberto).

## Evidência do incidente (2026-09-20)
- Só existia subscription do `admin@demo.local` (OWNER)
- Cliente Diego (`conectoofertasbrasil@gmail.com`) tinha prefs ok e notificações in-app, mas `active_subs=0`
- Mensagens do escritório geravam evento/notificação interna; Web Push era skipado
- Atraso percebido vinha do **poll** (8–20s), não do envio da mensagem
