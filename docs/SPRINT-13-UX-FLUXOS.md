# Sprint 13 — UX operacional: formulários, modais e fluxos

## Diagnóstico

O cadastro de empresa e os demais formulários cabiam em um modal médio (~640–720px) com campos densos, pouco agrupamento e rodapé que saía da vista ao rolar. O Portal já tinha o fluxo de Nova despesa, mas a ordem visual e o upload ainda pareciam um formulário comprimido.

Nenhuma regra de negócio foi alterada. Motor Contábil, classificação, N-lines, WhatsApp, auth, multi-tenant, eventos e auditoria permaneceram no backend.

## Decisões

- Sistema de tamanho de modal no Design System (`--modal-sm/md/lg`).
- Cabeçalho e rodapé do modal fixos; só o corpo rola.
- Campos da Nova empresa agrupados em duas seções, sem abas nem wizard extra.
- Consulta CNPJ inalterada; feedback visual de preenchimento automático.
- Etapa 2 continua por convite, sem senha no frontend.
- Ações secundárias em tabelas densas vão para o menu ⋮; a ação principal permanece visível.
- Portal sem Nova receita.

## Padrões de modal

| Tamanho | Token | Uso |
| --- | --- | --- |
| Pequeno | `--modal-sm` 480px | Ajuda e confirmações curtas |
| Médio | `--modal-md` 720px | Usuário, documento, solicitação, exportação |
| Grande | `--modal-lg` 960px | Nova empresa, despesa, importação, lançamento N-lines, regra |

Largura efetiva: `min(token, calc(100vw - 48px))`. Em ≤768px: `calc(100vw - 24px)` e grade de uma coluna.

## Formulários

Labels permanentes, altura mínima ~44px, erros ao lado do campo, `field-auto` para dado consultado, botão principal teal e secundário outline. Loading troca o texto do botão (`Consultando...`, `Salvando...`, `Importando...`) e impede clique duplo.

## Nova empresa

Modal grande (~960px, até 90vh). Seções Identificação e Informações complementares. CNPJ + Consultar. Após sucesso: “Empresa encontrada” / “Dados preenchidos automaticamente.” Campos continuam editáveis. Rodapé sticky: Cancelar / Continuar / Cadastrar empresa.

## Nova despesa

Escritório e Portal: Descrição → Valor → Data → Pagamento → Banco → Comprovante. Mensagem de sucesso: despesa enviada para análise da contabilidade.

## Portal

Formulário largo (até 960px). Upload com dropzone. Menu oficial sem Nova receita. Empresa continua implícita (campo somente leitura).

## Upload

Dropzone alta, drag and drop, formatos, arquivo selecionado, `Enviando...`, erro via toast + restauração do botão.

## Responsividade

Desktop usa o token do modal. Tablet (~768px) e mobile (~390px) empilham colunas e mantêm rodapé acessível.

## Testes

- Baseline da Sprint: 197 PASS / 0 FAIL / 0 SKIP.
- Novos: `tests/ux-flows-13.test.js`.
- Pins de asset: `?v=s13-2`.
- Modal grande (`Nova empresa`) tem altura definida (~90vh) para o corpo (`modal-body`) rolar com cabeçalho e rodapé visíveis.

## Sprint 13.4 — empresa como contexto contábil

A navegação do escritório separa gestão da carteira do trabalho por empresa. Receitas e lançamentos deixam de ser módulos globais de movimentação. Detalhes em `docs/SPRINT-13.4-CONTEXTO-CONTABIL.md`.

## Limitações

- Importação contábil continua via JSON no modal (sem novo endpoint de arquivo).
- Teste visual em sessão incógnita e troca real de dois tenants no navegador dependem do ambiente do operador.
- Confirmações nativas (`confirm`/`prompt`) não passaram pelo sistema de modal.
