# Sprint 09 — Cadastro inteligente de nova empresa por CNPJ

## Objetivo

Permitir que o escritório consulte o cadastro público de um CNPJ **antes** de incluir a empresa na carteira de clientes. A consulta preenche o formulário; o cadastro só ocorre quando o usuário confirma em `POST /api/empresas`.

Fluxo: Carteira de Clientes → Nova empresa → informar CNPJ → Consultar CNPJ → revisar → Cadastrar empresa.

## O que não é

Não é consulta genérica pública no navegador. Não cria empresa automaticamente. Não cria outra tabela de “empresa cliente”. A tabela oficial continua sendo `companies`.

## Provider

Camada isolada em `backend/src/empresas/cnpj/`.

- Interface: `consultarCnpj(cnpj)` → `{ status, code, data }`
- Implementação de produção: **BrasilAPI** (`https://brasilapi.com.br/api/cnpj/v1/{cnpj}`), sem chave obrigatória.
- `CDS_CNPJ_API_KEY` é opcional (enviada como `Authorization: Bearer` se definida).
- `CDS_CNPJ_PROVIDER=off` ou `none` desliga a fonte externa.
- Testes injetam provider mock via `setCnpjProvider()`; a suíte **não** chama a rede.

O frontend **nunca** acessa a URL do provider. Só chama `POST /api/empresas/consulta-cnpj`.

O `fetch` nativo do Node envia `User-Agent: node`. A BrasilAPI (Cloudflare) responde **403 Forbidden** a esse cliente e o CDS mapeava isso para 502. O provider envia `User-Agent: CDS-Contabil-Connect/1.0`. Timeout, 403, 429 e 5xx da fonte viram **502** `PROVIDER_INDISPONIVEL`. Erro interno do CDS vira **500**. Sem dados fictícios.

**Estado deste ambiente:** o núcleo está implementado e testado com provider injetável. A consulta ao vivo depende da BrasilAPI estar alcançável (não exige API key). Se a fonte estiver indisponível, a API responde `PROVIDER_INDISPONIVEL` sem cadastrar nada.

## Normalização

`backend/src/empresas/cnpj/normalize.js`

- CNPJ: string, 14 caracteres `[A-Z0-9]` após remover máscara; não usa `Number`; preserva zeros à esquerda; aceita letras (CNPJ alfanumérico).
- CEP: 8 dígitos, exibição `00000-000`.
- UF: 2 letras.
- Telefone: dígitos.
- Situação cadastral: maiúsculas, sem inventar valor.
- Datas: ISO `AAAA-MM-DD` quando reconhecível.
- Campos ausentes: `null`. A razão social recebida não é reescrita semanticamente.

## Duplicidade

Unicidade: `tenant_id + cnpj_normalized` (índice parcial `idx_companies_tenant_cnpj_norm`).

O mesmo CNPJ **pode** existir em outro escritório. No mesmo tenant: HTTP 409 `EMPRESA_JA_CADASTRADA` — *Esta empresa já está cadastrada na carteira deste escritório.*

A consulta, se o CNPJ já está na carteira do tenant JWT, **não** chama o provider. Retorna referência segura `{ id, name, trade_name, cnpj, status }` — sem usuários, lançamentos ou configurações internas.

## Multi-tenant e company context

- `tenant_id` vem do JWT. Body/query/hidden field são descartados (`delete req.body.tenant_id`).
- Consulta e cadastro: `OWNER | ACCOUNTANT | STAFF`. `CLIENT` não acessa a carteira administrativa.
- **Não** exige `X-Company-Id` para criar empresa (contexto do escritório, não da empresa em uso).
- Depois de criada, a empresa aparece em `GET /api/empresas` e pode ser acessada com “Acessar empresa” (Sprint 04).

## Cache

Não implementado nesta sprint. Consulta CNPJ ≠ empresa na carteira. Cache persistente (`cnpj_consultas` + TTL) fica como evolução, para não duplicar cadastro nem aumentar complexidade sem ganho imediato.

## Segurança e rate limit

- Rate limit próprio da consulta (`CDS_CNPJ_LOOKUP_MAX`, janela 15 min, chave IP+usuário). Não altera o rate limit de login do Sprint 05.
- Respostas sem stack, sem API key.
- Dados internos de outro tenant não vazam pela consulta pública.

## Situação cadastral

Exibida no formulário. `BAIXADA` / `INAPTA` / `SUSPENSA` / `NULA` geram alerta contextual e **não** bloqueiam o cadastro.

## Dados oficiais x internos

Consultados: CNPJ, razão, fantasia, situação RF, abertura, natureza, CNAE, endereço, contato, porte, Simples, MEI.

Internos CDS: `tenant_id`, id, status operacional da carteira, usuários, plano de contas, permissões, parâmetros contábeis.

## API

| Método | Rota | Efeito |
|---|---|---|
| POST | `/api/empresas/consulta-cnpj` | Consulta; não persiste empresa |
| POST | `/api/empresas` | Cadastro na carteira (já existente) |
| GET | `/api/empresas` | Listagem paginada da carteira |

Códigos da consulta: `EMPRESA_ENCONTRADA`, `EMPRESA_JA_CADASTRADA`, `CNPJ_INVALIDO`, `CNPJ_NAO_ENCONTRADO`, `PROVIDER_INDISPONIVEL`, `ERRO_PROVIDER`, `FORBIDDEN` / `CLIENT_PORTAL_ONLY`.

## Frontend

Modal **Nova empresa** existente: campo CNPJ + Consultar CNPJ (IDLE / Consultando... / sucesso / erro). Alterar o CNPJ após consulta limpa os dados cadastrais e exige nova consulta. Confirma substituição se já houver dados preenchidos.

## Auditoria e eventos

- `audit_logs`: ação `COMPANY_CREATED` no cadastro confirmado (sem senha/token/API key).
- Sprint 08: evento de domínio `COMPANY_CREATED` no POST de empresa. Consulta **não** emite evento.
- Notificação in-app para usuários ativos do escritório: “Nova empresa na carteira”.

## Variáveis de ambiente

```
CDS_CNPJ_PROVIDER=brasilapi   # ou off | none
CDS_CNPJ_API_URL=https://brasilapi.com.br/api/cnpj/v1
CDS_CNPJ_API_KEY=             # opcional
CDS_CNPJ_TIMEOUT_MS=8000
CDS_CNPJ_LOOKUP_MAX=20        # produção; dev padrão 400
```

## Limitações

- BrasilAPI não cobre todos os CNPJs e pode ter indisponibilidade; o CDS trata timeout/5xx/429 sem cadastrar.
- Não há cache cadastral.
- CNPJ alfanumérico é aceito estruturalmente; a fonte atual (BrasilAPI) ainda é voltada a CNPJ numérico.
- Cadastro ainda permite empresa sem CNPJ (fluxo legado), se a razão social for informada.

## Próximos passos

1. Cache `cnpj_consultas` com TTL.
2. Provider adicional homologado (Receita/Serpro) quando houver credencial.
3. Opcional: tornar CNPJ obrigatório no POST.
4. Enriquecer a ficha da empresa com CNAEs secundários.

## Testes

`tests/company-cnpj.test.js` — normalização, provider mock, duplicidade por tenant, isolamento, consulta sem persistir, POST+GET, auditoria, evento, CLIENT bloqueado, paginação e edição de usuário.
