# Arquitetura implementada — CDS Contábil Connect

## Núcleo
`cliente -> transação normalizada -> Motor de Classificação -> aprovação -> lançamento contábil (POSTED) -> Motor de Exportação`

## Multi-tenant
Todas as entidades operacionais possuem `tenant_id`. Usuários do perfil CLIENT também carregam `company_id`, e as rotas operacionais restringem leitura/escrita à própria empresa.

## Plano de contas
O plano é importado por tenant. Cada conta preserva:
- código da conta;
- classificação;
- tipo S/A;
- descrição;
- pai/nível;
- indicador de conta analítica/postável;
- dados brutos da origem.

Classificação duplicada é registrada como inconsistência sem destruir a informação; código duplicado é tratado como conflito de importação.

## Motor de Classificação
Regras são ordenadas por prioridade. Podem considerar descrição, forma de pagamento/recebimento, categoria e banco. Sem regra segura, a transação permanece pendente para classificação manual.

## Lançamentos
A aprovação exige pelo menos duas linhas e soma de débitos igual à soma de créditos; em seguida o posting gera `POSTED` automaticamente.

## Exportação
O núcleo cria um formato canônico e os destinos são isolados por `systemKey`. O projeto não finge homologação de layout proprietário: a configuração final do arquivo de cada software deve ser alimentada com o layout oficial/versionado do cliente.
