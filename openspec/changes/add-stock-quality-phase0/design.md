## Context

O pipeline de abastecimento hoje: o `ingestion-worker-service` lê o workbook (uma aba por operação, duas tabelas empilhadas), valida a identidade `Qtd. final = Qtd. Anterior + Qtd. abastecida + Remoções + Diferença` linha a linha (vale em 100% das 89.252 linhas reais) e entrega ao `supply-service`, por loja e período, apenas quantidades mensais (`SupplyRowsJob`: restocks, removals, adjustments, recordedClosingBalances). Horário da operação, tipo, `Qtd. confirmada` e `A abastecer` são lidos ou ignorados mas **não chegam** ao supply-service. O `inventory-service` já lê `sales-service` e `supply-service` por um cliente de movimentos.

Evidência da auditoria de 30/09/2026 que molda o desenho (ver memória `commercial-intel-v2-phase0-findings`):

- `Qtd. confirmada` é a contagem feita antes do abastecimento (`Diferença == confirmada − anterior` em 4.313 de 4.313 linhas de Combinado com abastecimento). Só cerca de 29% das linhas são contadas, e apenas a partir de março.
- `Capacidade` está vazia em 100% das linhas. Não há teto de mola.
- Operações sem `Cliente` são o inventário do centro de distribuição (152 operações, 28.610 linhas).
- Há loja-meses com consumo nas contagens e venda zero (importação de venda faltante).
- Uma comparação anterior entre saldo derivado e saldo registrado foi revertida (design D5 de `align-ingestion-with-real-reports`) porque `Qtd. final` mensal e saldo derivado não são comparáveis. A auditoria nova usa visitas, não o saldo mensal.

Restrição de negócio do Leandro: **nenhuma tolerância é definida agora** (memória `no-tolerance-before-data`); regras que moldam recomendação vivem no backend.

## Goals / Non-Goals

**Goals:**
- Guardar cada visita e suas linhas de forma aditiva, sem mudar nenhum registro mensal.
- Calcular a auditoria de forma determinística, pura e testável, no backend.
- Mostrar distribuições, contagens e lacunas no painel, com a cobertura de cada número.

**Non-Goals:**
- Saldo estimado como produto, motor de quantidade/mix/próximo abastecimento, telas Por Loja/Por Produto/Matriz.
- Tolerância, semáforo, aprovado/reprovado, ou qualquer comportamento que dependa do resultado da auditoria.
- Guardar os inventários do CD (só contá-los).
- Contagem física cega (o Leandro não pode fazê-la agora).

## Decisions

### D1. Visitas em tabelas novas do `supply-service`, aditivas

Duas tabelas: visita (loja, tipo, início, fim, fim da operação anterior quando informado, referência de origem, `ingestion_id`) e linha (visita, SKU, saldo anterior, contagem confirmada nula quando ausente, a abastecer nula quando ausente, abastecido, removido total, ajuste assinado, saldo final). Índices por loja+fim e por visita+SKU. As quatro tabelas mensais ficam como estão.

Alternativas: (a) guardar no banco do ingestion-worker — rejeitada, `staged_row` é transitória e o dado pertence ao domínio de abastecimento; (b) serviço novo — rejeitada, a Fase 0 é leitura e não justifica um serviço; (c) enriquecer `RecordedClosingBalance` — rejeitada, seu grão é mensal e misturaria dois significados.

### D2. Transporte: campo opcional `visits` em `SupplyRowsJob`, sem subir `schemaVersion`

O job por loja e período passa a carregar também `visits`. O campo é opcional e o worker antigo continua válido. Substituição por (loja, período) na mesma transação que já substitui os registros mensais, atribuindo a visita ao período do seu `fim`. Volume estimado: cerca de 700 linhas por loja-mês, dentro do que a fila já carrega.

Alternativa: fila nova — rejeitada, duas filas para o mesmo lote quebram a atomicidade que garante convergência na reimportação.

### D3. `Qtd. confirmada` e `A abastecer` passam a ser mapeadas como colunas nomeadas

Entram no mapeamento de colunas existente com nulo quando a célula está vazia. Nunca é assumido `0`. A linha com identidade quebrada continua rejeitada e **não** gera linha de visita.

### D4. A auditoria roda no `inventory-service`, calculada na leitura

Módulo novo que lê visitas (novo read do supply-service) e vendas agregadas (cliente de movimentos existente) e calcula tudo com funções puras. Sem tabela de resultado: os números mudam quando chega dado novo (setembro chega amanhã) e guardá-los criaria outro saldo divergente. Rota de rede inteira `GET /inventory/audit/balance?from=&to=`, exposta pelo gateway com a permissão de leitura de estoque.

Alternativas: no `finance-service` — rejeitada, aqui a resposta é em unidades; no navegador — rejeitada, a estratificação por giro é regra analítica e deve viver no backend.

Custo: cerca de 117 mil linhas em 8 meses. Cálculo em memória com os pares consecutivos por loja×SKU; aceitável na escala atual. Cache só se a medição mostrar necessidade.

### D5. Consumo entre visitas e rateio por dia

Para pares consecutivos de uma loja×SKU ordenados por fim: `consumo = saldo_final(k) − saldo_anterior(k+1)`. O consumo é rateado pelos dias em que o intervalo cai em cada mês (sobreposição em segundos). Só entram meses totalmente cobertos pela cadeia. Consumo negativo (saldo subiu sem evento: 0,14% dos pares) é contado à parte e nunca entra nas distribuições como consumo negativo.

### D6. Faixas de giro e de saldo são apresentação, não tolerância

Giro = média mensal de vendas da loja×SKU no intervalo auditado: alto (≥ 20), médio (5 a 20), baixo (< 5), sem venda. Saldo: 0, 1–5, 6–15, 16–40, 41+. Esses cortes são **parâmetros de apresentação do backend**, devolvidos na resposta para o painel rotular, nunca fixados no navegador, e registrados como provisórios. A resposta não contém nenhum campo de veredito; um teste afirma isso.

### D7. Lacunas

- Loja-mês sem venda e com consumo: listado e **excluído** das distribuições de consumo versus venda.
- Operações sem `Cliente`: o ingestion-worker registra, por operação, uma rejeição com motivo próprio e um resumo consultável (`GET /ingestions/gaps?from&to`, via gateway). O painel combina as duas consultas. As linhas do CD não são gravadas (Non-Goal).
- `Capacidade`: o parser já a lê; a auditoria informa a fração de linhas com capacidade, hoje zero, e o painel diz "não disponível".
- Cobertura de contagem por loja e mês, e período coberto pelas visitas.

### D8. Backfill pela reimportação de período, verificado por soma de controle

Reimportar jan–ago pelo caminho normal (upload/Drive) converge por construção (idempotência já especificada). Antes e depois, compara-se uma soma de controle dos quatro registros mensais por período. Se divergir, o backfill para e o motivo é investigado. Agosto vem do armazenamento local do ingestion; janeiro a julho, dos arquivos em `var/exemplos-de-planilhas`. Nenhum dado sintético é gravado em banco real; testes usam fixtures com dados reais anonimizados ao nível de SKU/loja já presentes no repo.

### D9. Painel

Aba "Qualidade do saldo" na página de Inteligência Comercial, ao lado de Abastecimento e Mix, com cliente RTK Query próprio e componentes somente leitura (tabelas com barras proporcionais, cards de cobertura). Usa os estados de requisição existentes (carregando, vazio, erro, proibido). Um aviso fixo explica que consumo e venda vêm do mesmo PDV: a concordância valida o alinhamento dos dados, não a verdade física.

## Risks / Trade-offs

- **Contagem pode ser confirmação sem contagem** (97% iguais ao sistema) → a aba mostra cobertura e gradiente por giro, e o texto fixo nomeia o limite. A medição real do erro exige contagem cega, adiada pelo Leandro.
- **Seleção das linhas contadas é desconhecida** (mediana de 31% por operação) → cobertura é reportada ao lado de qualquer percentual.
- **Rateio por dia aproxima o consumo mensal** → a distribuição de diferenças inclui ruído de datas; ele é simétrico (1.460 acima, 1.811 abaixo) e isso é exibido.
- **Reimportação de período substitui registros mensais** → soma de controle antes/depois (D8); parada se divergir.
- **Dado termina em agosto; setembro chega em 01/10** → as consultas aceitam intervalo e a auditoria é recalculada na leitura, sem reprocessar nada.
- **Giro vem de vendas agregadas do mesmo PDV** → registrado no aviso da aba.
- **Ponto único de falha no `inventory-service` ao ler todas as lojas** → leitura paginada por loja, falha de uma loja não derruba a rede, e o erro é exposto como lacuna, não como zero.

## Migration Plan

1. Migração Prisma aditiva no supply-service (tabelas novas, sem alterar as existentes).
2. Publicar parser e consumidor com o campo `visits` opcional. O consumidor aceita job sem `visits`.
3. Soma de controle dos registros mensais; reimportar jan–ago; soma de controle de novo.
4. Publicar o módulo de auditoria, a rota no gateway e a aba.
5. Rollback: remover a aba e a rota; parar de enviar `visits`; as tabelas novas podem permanecer vazias sem afetar nada. Nada nas tabelas mensais foi alterado.

## Open Questions

- Cortes finais das faixas de giro e de saldo (hoje provisórios; só afetam o rótulo da apresentação).
- Se e quando os inventários do CD serão gravados (estoque central e viabilidade de "levar X").
