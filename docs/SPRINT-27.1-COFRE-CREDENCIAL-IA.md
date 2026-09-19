# Sprint 27.1 — Cofre de Credencial da IA

## Arquitetura

Separação clara:

| Camada | Responsabilidade |
|--------|------------------|
| **Cofre (`ai_provider_credentials`)** | Credencial OpenAI da instalação (ciphertext) |
| **`tenant_ai_settings`** | Liga/desliga IA + limite mensal por escritório |
| **AI Control / usage** | Consumo e disponibilidade do tenant |

Fluxo de resolução da chave:

```
Cofre (prioridade)
  ↓ se vazio
OPENAI_API_KEY + AI_PROVIDER=openai (fallback)
  ↓ se vazio
IA indisponível → CDS + manual
```

## Criptografia

- Algoritmo: **AES-256-GCM**
- Derivação: `scrypt(AI_CREDENTIAL_ENCRYPTION_KEY, salt)`
- Armazenado: `encrypted_api_key`, `key_iv`, `key_tag`, `key_salt`, `key_version`, `last4`
- Master key **nunca** no banco, Git ou frontend

Variável:

```
AI_CREDENTIAL_ENCRYPTION_KEY=
```

Em produção: mínimo 32 caracteres; chave fraca rejeitada no boot.
Se houver credencial no cofre e a master key estiver ausente → falha explícita na resolução.

`DOCUMENT_ENCRYPTION_KEY` **não** é reutilizada (propósitos distintos).

## Endpoints

| Método | Rota | Quem |
|--------|------|------|
| GET | `/api/ai/credentials` | OWNER/ACCOUNTANT/STAFF |
| POST | `/api/ai/credentials/test` | OWNER/ACCOUNTANT |
| PUT | `/api/ai/credentials` | OWNER/ACCOUNTANT |
| DELETE | `/api/ai/credentials` | OWNER/ACCOUNTANT |

Nenhum endpoint devolve a API Key.
PUT testa antes de persistir; falha **não** substitui a chave atual.
Teste de conexão usa `GET /v1/models` (não gera usage de negócio).

## UI

Configurações → Avançadas → Inteligência Artificial  
(também no menu CONFIGURAÇÕES → Inteligência Artificial)

- Provider: OpenAI (fixo nesta sprint)
- Modelo: GPT-5.6 Terra
- Máscara `••••••••••••`
- Botões: Testar / Configurar ou Alterar / Remover
- Sem “Ver chave”

## Auditoria

Eventos: `AI_CREDENTIAL_CREATED`, `AI_CREDENTIAL_ROTATED`,
`AI_CREDENTIAL_REMOVED`, `AI_CREDENTIAL_TESTED`

Payload: provider, modelo, sucesso/falha, last4 opcional.
Nunca: API Key, Authorization, ciphertext completo desnecessário.

## Permissões

- Gerenciar credencial: OWNER / ACCOUNTANT
- CLIENT / CLIENT_ADMIN: bloqueados
- STAFF: consulta status apenas

## Limitações

- Um provider (`openai`); sem multi-chave
- Sem rotação automática da master key
- Sem AWS/Azure/HashiCorp Vault
- Fallback `.env` permanece para transição

## Recuperação

1. Manter `AI_CREDENTIAL_ENCRYPTION_KEY` estável entre reinícios
2. Backup do SQLite inclui ciphertext (inútil sem master key)
3. Remover credencial na UI volta ao fallback ENV, se existir
