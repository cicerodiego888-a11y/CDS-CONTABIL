# Lançamentos

A tela de lançamentos lista somente partidas **efetivadas** (`POSTED`), resultado da esteira:

normalização → classificação → aprovação → lançamento → exportação

Um lançamento pode possuir N linhas (não apenas 1D+1C). Débitos e créditos devem totalizar exatamente o mesmo valor.

Após a aprovação, o Motor Contábil efetiva o lançamento automaticamente (`AccountingPostingService`). Não há etapa manual “Gerar lançamento”.

Lançamento **manual** (`source_type=MANUAL`) é exceção, identificado como tal, e segue as mesmas regras de contas analíticas, ativas e balanceamento. Continua sujeito à aprovação quando criado em `PENDING`.

`PENDING` no banco significa aguardando aprovação (`PENDING_APPROVAL`).
