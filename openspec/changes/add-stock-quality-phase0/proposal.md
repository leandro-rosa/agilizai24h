## Why

A Inteligência Comercial v2 (Mix × Quantidade × Saldo × Próximo abastecimento, por Produto × Loja) só pode recomendar "quanto levar" se soubermos quão confiável é o saldo de cada produto em cada loja. Hoje essa confiabilidade é desconhecida: o saldo derivado do `inventory-service` é mensal, dá negativo em 3.787 de 18.152 linhas e difere do saldo registrado em cerca de metade delas, e uma tentativa anterior de comparar os dois foi revertida por isso.

A auditoria de 30/09/2026 mostrou que as planilhas brutas de abastecimento já trazem o que falta, **por visita**: `Qtd. Anterior`, `Qtd. confirmada` (contagem), `Qtd. abastecida`, `Remoções`, `Diferença`, `Qtd. final`, data/hora e tipo de operação (Abastecimento, Inventário, Combinado). O pipeline guarda só o total mensal e descarta o resto. Com as visitas, dá para comparar contagem × sistema e consumo entre visitas × vendas.

Esta mudança é a **Fase 0** do plano: medir a qualidade do saldo e mostrar isso no painel, **sem definir tolerância**. A tolerância aceitável só será decidida com o Leandro depois de ver as distribuições reais, porque 5 unidades em 100 e 2 em 10 não significam o mesmo.

## What Changes

- **Persistir as visitas de abastecimento** no `supply-service`, em tabelas novas e aditivas (visita e linha da visita), a partir do parser que o `ingestion-worker-service` já executa. Os registros mensais existentes (`RestockRecord`, `RemovalRecord`, `AdjustmentRecord`, `RecordedClosingBalance`) não mudam de comportamento.
- **Levar a `Qtd. confirmada`, o horário de início/fim da visita e a `A abastecer` até o `supply-service`.** Hoje o contrato de fila só carrega quantidades mensais.
- **Endpoint de auditoria de saldo** no `inventory-service` (que já lê `supply-service` e `sales-service`), exposto pelo `gateway-service`, devolvendo:
  - contagem × sistema: nº de linhas contadas, % iguais, distribuição da diferença absoluta e relativa, por faixa de giro e por faixa de saldo;
  - consumo entre visitas × vendas registradas, por loja × SKU × mês, rateado por dia, com a razão por loja-mês;
  - lacunas: loja-mês sem venda importada, inventários sem `Cliente` (centro de distribuição), `Capacidade` vazia, pares de visita em que o saldo sobe sem evento, cobertura de contagem por loja.
- **Nova aba "Qualidade do saldo (Fase 0)"** em Inteligência Comercial no painel admin, somente leitura, mostrando essas distribuições. Nenhum limiar de aprovação/reprovação é exibido.
- **Backfill** dos meses já importados (jan a ago/2026) a partir das planilhas originais, pelo mesmo caminho de reimportação de período do Drive, sem escrever dado sintético em banco real.
- Fora de escopo: motor de recomendação, saldo estimado como produto, tela Por Loja/Por Produto/Matriz, tolerância, contagem cega, importação do inventário do CD.

## Capabilities

### New Capabilities
- `stock-balance-audit`: a auditoria de qualidade do saldo — como a contagem é comparada com o sistema, como o consumo entre visitas é comparado com as vendas, quais lacunas são reportadas, a garantia de não haver tolerância embutida, e a aba do painel que a apresenta.

### Modified Capabilities
- `supply`: passa a registrar cada visita de abastecimento e suas linhas (saldo anterior, contagem confirmada, abastecido, remoções, diferença, saldo final, horários, tipo), além dos totais mensais.
- `ingestion`: o parser do relatório de abastecimento passa a encaminhar os dados por visita, inclusive `Qtd. confirmada`, horários e `A abastecer`, e a contar (sem descartar silenciosamente) as operações sem `Cliente`.

## Impact

- `backend/apps/supply-service`: migração Prisma aditiva, `SupplyService.ingestPeriod` grava visitas na mesma transação, novo read de visitas.
- `backend/apps/ingestion-worker-service`: mapeamento de colunas (`Qtd. confirmada`, `A abastecer`, `Iniciado em`, `Finalizado em`), montagem das visitas em `finalize()`.
- `backend/common/nest-libs` (contrato `@app/ingestion-contracts`): campo opcional `visits` em `SupplyRowsJob`, sem subir `schemaVersion`.
- `backend/apps/inventory-service`: módulo de auditoria de saldo (cálculo determinístico e puro, testável).
- `backend/apps/gateway-service`: rota de leitura da auditoria.
- `frontend/apps/admin`: aba nova, cliente RTK Query, componentes de distribuição.
- Dados: backfill de aproximadamente 117 mil linhas de visita (jan a ago/2026); custo de armazenamento pequeno.
- Sem mudança em `finance-service`, `accounting-service` e demais serviços financeiros. `finance-service` segue sendo a fonte de CMV, sobra e perda; a auditoria não recalcula nada disso.
- Relação com outras mudanças: substitui, na prática, o escopo não iniciado de `add-commercial-intelligence-governance` para o saldo; não altera `add-commercial-intelligence-page`.
