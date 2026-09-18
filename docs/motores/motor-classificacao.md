# Motor de Classificação

Regras ordenadas por prioridade. Condições podem usar descrição, forma de pagamento e categoria. O motor retorna conta de débito, conta de crédito e confiança.

Classificação automática segura grava a entry em `PENDING` (aguardando aprovação). Sem regra explícita, a movimentação fica em `NEEDS_CLASSIFICATION` para o contador. Após classificação manual, o status passa a `PENDING`. A aprovação (etapa seguinte) efetiva o lançamento (`POSTED`).
