# Sprint 28.4.2 — Calibração visual final

## Escopo

Ajuste exclusivamente visual para aproximar o Portal Contábil da referência aprovada:

**preto + vinho + vermelho CDS + branco + cinzas**, com aparência profissional e discreta.

Não houve alteração de APIs, banco, permissões, Tenant Branding, NotificationCenter, IA ou motores.

## O que mudou

- Tokens em `frontend/public/assets/tokens.css` passaram a descrever a sidebar em camadas (`--color-sidebar-gradient-*`, `--color-sidebar-wine`, `--color-avatar-*`).
- Sidebar deixa de ser um bloco `#111111` chapado: gradiente 160deg de preto para vinho, com brilho radial discreto na base.
- Card do administrador: fundo translúcido com nuance vinho; avatar circular vermelho/rosado e letra branca.
- Item ativo: gradiente vermelho CDS integrado, texto/ícone brancos, badge sobre vermelho mais escuro.
- Área principal permanece clara (não é dark mode). Botões primários continuam `#C8102E`.
- Login e Portal Cliente usam a mesma linguagem.
- Cache: `?v=s28-4-2`.
- Ícones PWA/favicon atualizados para a marca oficial CDS (preto/vermelho/branco).

## Ícones PWA

Os PNGs oficiais (`cds-pwa-192.png`, `cds-pwa-512.png`, favicon e ícones de push) passaram a usar a marca CDS preto/vermelho/branco.

## Teal

Overlay `rgba(13,59,56,.42)` do visualizador/portal (herança teal) foi substituído por overlay preto. Verde/amarelo permanecem só como cores semânticas de status.
