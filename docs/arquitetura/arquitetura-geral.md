# Arquitetura Geral — V1.0

Modular monolith Node.js + Express + SQLite, com frontend web e isolamento por tenant.

Fluxo canônico: dados da empresa → normalização → classificação → aprovação → lançamento contábil (`POSTED`) → exportação → adaptador do sistema destino.

O núcleo nunca depende diretamente de um software contábil externo.
