# Aprovação e efetivação

A aprovação é a etapa 2 da esteira contábil: uma **ação** que autoriza o lançamento. Não existe estado operacional `APPROVED`. O posting é automático e atômico.

## Estados persistidos

| Valor no banco | Significado |
|---|---|
| `NEEDS_CLASSIFICATION` | Sem classificação válida. Só na fila de Classificação. |
| `PENDING` | Semântico **PENDING_APPROVAL**. Só na fila de Aprovação. |
| `POSTED` | Lançamento efetivado. Tela de Lançamentos e exportação. |
| `REJECTED` | Intermediário da rejeição; o registro volta a `NEEDS_CLASSIFICATION`. |

## Fluxo

```
CLASSIFICAÇÃO
↓
APROVAÇÃO (ação / evento ENTRY_APPROVED)
↓
LANÇAMENTO AUTOMÁTICO
↓
POSTED
↓
EXPORTAÇÃO
```

`POST /api/aprovacao/:id/aprovar` recebe `PENDING`, valida tenant, empresa, contas postáveis/ativas, N linhas e balanceamento, registra a aprovação e efetiva `POSTED` na mesma transação. Não existe botão “Gerar lançamento”. Não há `PENDING → APPROVED` nem `APPROVED → POSTED`.

Idempotência: `UPDATE ... WHERE status='PENDING'` + chave `(tenant_id, source_type, source_id)` quando houver origem.

Rejeição exige motivo: `PENDING` → `REJECTED` (auditoria `ENTRY_REJECTED`) → `NEEDS_CLASSIFICATION`.

A auditoria registra `ENTRY_APPROVED` e em seguida `ENTRY_POSTED`. O banco fica em `POSTED`.
