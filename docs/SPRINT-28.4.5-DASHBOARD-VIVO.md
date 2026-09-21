# Sprint 28.4.5 — Dashboard contábil vivo

A tela inicial do Portal do Contador passou a agregar operação, prazos e atividade em tempo quase real, sem novos motores.

- `GET /api/dashboard` ganhou `period`, `kpis`, `summary`, `activity_series`, `health` e `processing_rate` (campos antigos preservados).
- `GET /api/processos/dashboard/proximos-prazos` lista prazos do Motor de Processos.
- A busca global some só no Dashboard; o SSE existente atualiza os blocos sem recarregar o app.
