# Validação da entrega

Esta entrega contém implementação funcional de backend, banco, regras, classificação, lançamentos, aprovação, documentos, exportação e frontend.

A validação estrutural realizada antes da distribuição inclui:
- checagem de sintaxe dos arquivos JavaScript com `node --check`;
- conferência das migrations SQL;
- conferência dos scripts de setup/seed/importação/backup;
- conferência de caminhos relativos do projeto;
- conferência de que o frontend usa apenas as APIs do próprio projeto.

A execução de `npm install` no ambiente de construção não foi concluída por limite de tempo/rede; portanto a entrega não deve ser descrita como homologada em runtime neste ambiente. Em Windows, após `npm install`, `npm run setup`, `npm run seed` e `npm test`, o projeto pode ser validado localmente.
