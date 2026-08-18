# backend/apps/ingestion-worker-service

Transforma as três planilhas operacionais em registros normalizados — a
mudança que substitui o processo manual mensal. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Chamado por**: `gateway-service` (HTTP interno, ao aceitar um upload).
**Lê**: `stores-service` e `products-service`.
**Escreve**: filas de `sales`, `supply` e `products`.
Sem superfície pública — não publica porta.

## O fluxo

```
gateway: recebe arquivo → S3 → POST /ingestions aqui
  ↓ fila ingestion.parse-file
ParseFileWorker: baixa do S3 → valida cabeçalhos → sheeter.smartChunk
  ↓ fila ingestion.staged-rows (N jobs, 1200 linhas cada)
StagedRowsWorker: resolve nomes → parseia motivos → grava em staged_row
  ↓ (só o último chunk)
finalize(): UM batch por período para cada sink
```

## Por que existe staging (o risco mais sutil do desenho)

`smartChunk` quebra um arquivo em N jobs de fila, e os sinks **substituem o
período inteiro**. Se cada chunk entregasse suas linhas direto ao sink, cada
lote apagaria o anterior e só as linhas do último chunk sobreviveriam — um
período silenciosamente sem a maior parte dos dados, com status "completed".

Staging existe só para isso: as linhas se acumulam em `staged_row`, e apenas o
chunk que fecha o arquivo entrega tudo de uma vez. O contador
`expected_chunks`/`processed_chunks` é incrementado e lido numa única
instrução, então dois chunks terminando juntos não podem ambos se ver como
"último" (entregaria duas vezes) nem ambos como "não último" (deixaria o
arquivo eternamente inacabado). Há teste para os dois casos.

## Parsing de motivos — a peça com consequência de negócio

`-6 Devolução, -3 Outro motivo` vira duas quantidades: 6 de `return` e 3 de
`other_reason`. O 9 nunca é produzido. Motivo desconhecido, segmento ilegível,
ou split que não bate com o total reportado **rejeitam a linha**, nunca
adivinham — e o total reportado só pode ser conferido aqui, porque
`supply-service` nunca recebe um total.

Interpretação de texto mora aqui, e não no `supply`, de propósito: o formato é
do PDV e pode mudar; a classificação de perda é do negócio e é estável.

## Decisões que não são óbvias no código

- **Loja e período vêm do request**, nunca inferidos do arquivo: a planilha de
  abastecimento não tem período legível por máquina, e adivinhar atribui
  silenciosamente dados de março a abril.
- **Cabeçalhos são validados antes do chunking**, então um arquivo do tipo
  errado falha uma vez, e não gera milhares de jobs falhando.
- **Colunas são lidas por nome** (com aliases e folding), não por posição: os
  exports não garantem ordem, e leitura posicional pegaria a coluna errada em
  silêncio em vez de falhar.
- **Linha que não dá para processar é rejeitada e registrada**, nunca pulada —
  uma linha pulada produz um total quieto demais, sem nada indicando.
- **`toCents`/`toQuantity` devolvem `null` para valor ilegível, nunca 0.**
  Descascar não-dígitos de "abc" deixa string vazia, e `Number('')` é 0 — um
  valor que o arquivo não soube expressar viraria zero silencioso. Há teste de
  regressão para isso; foi bug real durante a implementação.
- **Custos são gravados com vigência no período do upload**, o que é o que faz
  valer "valorar um mês com o custo daquele mês".

## Testes

- Unitários (`pnpm test`): parser de motivos (23) e mapeamento de linhas (18).
- Integração (`pnpm test:integration`): precisa do Postgres deste serviço.
  Cobre a acumulação de chunks — N chunks produzem **um** handover com todas as
  linhas —, a corrida do último chunk, o split de supply na entrega, e
  parcial vs completo.

## Gaps conhecidos

- Sem teste e2e do arquivo real (upload → S3 → parse → sinks); o caminho da
  fila de cada sink é coberto nos próprios serviços.
- Sem cancelamento de ingestão em andamento; corrige-se reenviando o arquivo.
- Sem política de retenção dos arquivos crus no object storage.
- O `StagedRowsWorker` resolve nomes por chunk; um arquivo com muitos chunks
  faz várias chamadas ao `products`. Aceitável no volume atual (uma loja-mês
  cabe num chunk), revisitar se deixar de ser verdade.
