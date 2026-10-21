# Relatórios de divergências para clientes — desenho

Pedido: relatório por cliente/unidade/período das perdas "Outros (roubo)", a preço de venda, com a conferência anterior de cada produto; tela, PDF e Excel.

## O que o dado já tinha e o que faltava

| Peça | Estado | Decisão |
|---|---|---|
| Motivo "Outros (roubo)" | Não existe como motivo; o export só tem "Outro motivo" (`other_reason`), e o fechamento de fornecedor já o trata como roubo | Incluir só `other_reason`. Evidência em `constants/client-report.ts` |
| Motivo por visita | **Perdido**: só `removed_total` (todos os motivos) por linha de visita; a divisão existia no parser e era descartada no `finalize()` | Guardar a divisão por visita (`removals_by_reason`). Linhas antigas = desconhecido, nunca zero |
| Meses já importados | Sem a divisão | Reimportar o mês (`/ingestion`) — ação do operador, não feita aqui |
| Conferência | `confirmed_count` nulo = não contado (só ~27% das linhas) | Conferência = linha com contagem. Anterior = a mais recente estritamente antes, mesma loja+SKU, qualquer período |
| Cliente → unidades | `Store.client_code` vazio em todas as lojas; `ClientSite.store_id` e `ContractStore` coerentes entre si (nenhuma loja em dois clientes) | `ClientSite.store_id` (billing). Nunca por nome |
| Preço de venda | `PriceVersion` datado, global, só acrescenta; 24 de 256 produtos têm preço | Preço em vigor no dia da identificação; ausente = "Preço não disponível" + total parcial |
| Data da falta | Visita (`ended_at`), não a hora da ocorrência | A data é a da visita que registrou; o intervalo é conferência anterior → visita |
| Excel com painel congelado | `xlsx@0.18.5` não grava | `exceljs@4.4.0` (já no lockfile do monorepo) só para este export |

## Fluxo

`ingestion-worker` (divisão por linha de visita) → `supply-service` (`GET /reports/divergences`, regra pura `deriveDivergences`) → `gateway` (`/client-reports/divergences`: cliente→unidades, nomes, preço por dia, isolamento) → admin (tela; PDF e Excel do mesmo payload).

## Fora do escopo / limites reais

- Sem envio automático ao cliente.
- A data da falta é um intervalo; o relatório não afirma o momento da ocorrência nem o motivo real.
- Fonte Helvetica nos PDFs (como os demais); logo e padrão são os arquivos oficiais do projeto.
- O cadastro de preços cobre poucos produtos: a maior parte das linhas reais sairá com "Preço não disponível" até haver preço de venda datado.
