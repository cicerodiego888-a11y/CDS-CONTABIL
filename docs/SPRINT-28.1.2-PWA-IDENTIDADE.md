# Sprint 28.1.2 — Identidade PWA + notificação

## Diagnóstico
Não existia PWA/manifest. Notificações no navegador comum apareciam atribuídas a `localhost` / Edge — moldura nativa do SO/navegador, não conteúdo do payload CDS.

## Solução
Instalar a PWA (standalone). Com PWA instalada, Edge/Windows podem atribuir nome e ícone da aplicação **CDS Contábil Connect**.

## Manifests
- Contador: `/manifest.webmanifest` — `name: CDS Contábil Connect`, `start_url: /`, `scope: /`
- Cliente: `/portal/manifest.webmanifest` — `name: CDS Contábil Connect — Cliente`, `start_url: /portal/`, `scope: /portal/`
- `display: standalone`, `theme_color` / `background_color`: `#0f5f59`
- Ícones: `/assets/cds-pwa-192.png`, `/assets/cds-pwa-512.png` (marca oficial CDS preto/vermelho/branco).

## Limitação
Não é possível (nem desejável) falsificar a moldura nativa do Windows via JS. Em aba comum, o SO pode continuar mostrando localhost/navegador. A identidade correta exige PWA instalada.
