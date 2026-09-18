# Exportações

Somente lançamentos efetivados (`entries.status='POSTED'`) entram no arquivo.

Não são exportáveis: `NEEDS_CLASSIFICATION`, `PENDING`/`PENDING_APPROVAL`, `REJECTED`.

O sistema gera um formato canônico interno e usa adaptadores por destino. Os layouts específicos de Domínio, Conta Azul, Alterdata, Fortes, Questor e SCI não são presumidos: devem ser parametrizados conforme o layout/importador efetivamente suportado pela versão do software do cliente.
