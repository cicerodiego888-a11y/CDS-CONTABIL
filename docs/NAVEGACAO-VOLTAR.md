# Sprint 32 — Navegação global e Voltar

Camada central de retorno no CDS Contábil Connect, sem alterar rotas, APIs ou fluxos de negócio.

## Componente

`frontend/public/assets/back-navigation.js` → `CdsBackNav`

Prioridade de retorno:

1. stack (contexto anterior, com filtros)
2. fallback explícito do módulo
3. rota pai / raiz segura

Não usa `history.back()` cego. Deep link / refresh sem stack → fallback do módulo.

## Integração

| Superfície | Helpers |
|---|---|
| Escritório (`app.js`) | `cdsRemember` / `cdsGoBack` / `cdsBackBtn` / `cdsBindBack` |
| Portal (`portal.js`) | `portalRemember` / `portalGoBack` / `portalBackBtn` |

Botão padrão: **← Voltar** (classe `.cds-back-btn`). Aparece só em telas secundárias ou quando há stack.

Sidebar / `leaveCompany` / menu raiz do portal limpam a stack para evitar loops.

## Escopo

Incluído: detalhe de empresa, usuários da empresa, solicitação, processo, fechamento, hub de configurações (IA, equipe, comunicações, auditoria), detalhe de movimentação no portal.

Fora: dashboard e menus raiz; redesign de sidebar; Pipeline Audácia / Motor Contábil / IA.
