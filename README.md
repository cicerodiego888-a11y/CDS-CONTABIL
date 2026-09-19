# CDS Contábil Connect — V1.0 Implementado

Certificação e congelamento do núcleo: `docs/V1.0-CERTIFICATION.md`.

Motor de Processos (Sprint 16): `docs/SPRINT-16-MOTOR-PROCESSOS.md`.
Execução e checklist (Sprint 17): `docs/SPRINT-17-EXECUCAO-CHECKLIST.md`.
Recorrência mensal (Sprint 18): `docs/SPRINT-18-RECORRENCIA.md`.
Eventos e notificações do Motor (Sprint 19): `docs/SPRINT-19-EVENTOS-NOTIFICACOES.md`.
Inteligência Documental (Sprint 20): `docs/SPRINT-20-INTELIGENCIA-DOCUMENTAL.md`.
IA e Classificação Contábil (Sprint 21): `docs/SPRINT-21-IA-CLASSIFICACAO.md`.

SaaS multi-tenant para escritórios contábeis. O sistema recebe dados financeiros simples das empresas, normaliza os eventos, aplica regras contábeis configuradas pelo escritório, cria partidas de múltiplas linhas, envia para revisão/aprovação e gera exportações a partir apenas de lançamentos aprovados.

## O que está implementado

- Autenticação JWT e senha com bcrypt.
- Multi-tenant: cada escritório possui dados isolados por `tenant_id`.
- Perfis `OWNER`, `ACCOUNTANT`, `STAFF` e `CLIENT`.
- Usuário `CLIENT` fica restrito à empresa vinculada.
- Cadastro de empresas, usuários, categorias e bancos.
- Plano de contas por escritório.
- Importação de plano de contas em PDF, CSV e TXT, com prévia, validação e relatório de rejeições.
- Preservação de `Código`, `Classificação`, `Tipo (S/A)` e descrição.
- Detecção de código duplicado durante importação.
- Motor de classificação por regras com prioridade, condições e confiança.
- Fallback por categoria + conta financeira.
- Despesas e receitas.
- Partidas com N linhas de débito/crédito.
- Validação de partida balanceada.
- Lançamento manual e reclassificação.
- Fila de aprovação e rejeição com motivo.
- Pendências de classificação.
- Documentos anexados com SHA-256.
- Solicitações entre empresa e escritório.
- Auditoria das operações.
- Dashboard operacional.
- Exportação CSV canônica configurável, somente de lançamentos aprovados.
- Estrutura preparada para adapters por software contábil.
- SQLite com WAL e foreign keys.
- Scripts de setup, seed e backup.
- Frontend web responsivo sem etapa de build.

## Instalação Windows

Requer Node.js 20+.

```bash
npm install
copy .env.example .env
npm run setup
npm start
```

Acesse `http://localhost:3333`.

Em produção: `NODE_ENV=production`, `DEMO_MODE=false`, `JWT_SECRET` forte e `DOCUMENT_ENCRYPTION_KEY` definida. O sistema não inicia sem essas chaves.

Para ambiente de demonstração local:

```bash
set DEMO_MODE=true
npm run seed
```

As credenciais de demo só são criadas e exibidas na tela de login quando `DEMO_MODE=true`. Não use demo em produção.

Documentos ficam em `UPLOAD_DIR` com caminho relativo no banco (`documents/{id}/arquivo`). Backup: `npm run backup`. Restore: veja `docs/BACKUP-RESTORE.md`.

## Fluxo principal

`Empresa → Despesa/Receita → Motor de Classificação → Lançamento → Revisão → Aprovação → Exportação`

O usuário da empresa **não escolhe débito ou crédito**. Ele fornece os dados operacionais. A classificação é responsabilidade das regras do escritório.

## Plano de contas

O importador aceita arquivos com as colunas equivalentes a:

`Código | Classificação | Tipo | Descrição`

O projeto inclui como referência funcional o plano enviado no projeto original. O plano possui contas sintéticas e analíticas e deve ser tratado como plano do escritório/empresa importadora, não como plano global do SaaS.

## Exportação

A camada de exportação está isolada pelo campo `system_key` (`dominio`, `contaazul`, `alterdata`, `fortes`, `questor`, `sci`). O arquivo atualmente gerado é um **CSV canônico configurável**. Não é declarado como layout oficial homologado de nenhum desses produtos sem o respectivo layout oficial/versionado fornecido pelo escritório.

## Banco e segurança

- Banco: SQLite.
- Integridade referencial ativada.
- WAL ativado.
- Senhas nunca são armazenadas em texto puro.
- JWT com expiração de 12 horas.
- Todas as consultas de negócio usam `tenant_id`.
- Restrição adicional de `company_id` para clientes.
- Auditoria para operações críticas.

## Limite consciente da V1

Integrações proprietárias de importação/exportação precisam do layout oficial da versão do software de destino. O Connect não inventa esses layouts. A camada canônica e o ponto de adapter já estão definidos para que cada homologação seja adicionada sem alterar o núcleo contábil.
