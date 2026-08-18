# backend/apps/supply-service

Abastecimento e remoções por loja e período — e a **regra que define o
produto**: nem toda remoção é perda. Ver [../../CLAUDE.md](../../CLAUDE.md)
para as convenções do workspace backend.

**Escrito por**: `ingestion-worker-service` (fila BullMQ).
**Lido por**: `finance-service` (quantidades para valorar) e
`inventory-service` (derivação de estoque).
**Publica**: `period.data-updated` (`@app/period-events-contracts`).

## Rotas e filas

| Superfície | Uso |
|---|---|
| `GET /reasons` | Os seis motivos e sua classificação — a regra como dado |
| `GET /supply/:storeId?period=` | Abastecimentos e remoções por motivo |
| `GET /supply/:storeId/loss?period=` | Perda real: total, por motivo, por SKU |
| fila `ingestion.supply-rows` | Consome lote de um período |
| fila `period.data-updated` | Publica quando o período muda |

## A regra

| Motivo | Rótulo | Conta como perda |
|---|---|---|
| `expired` | Validade vencida | **sim** |
| `damaged_product` | Produto danificado | **sim** |
| `other_reason` | Outro motivo | **sim** |
| `return` | Devolução | não |
| `transfer` | Transferência | não |
| `internal_use` | Uso e consumo | não |

Uma linha pode **misturar motivos**: `-6 Devolução, -3 Outro motivo` são 9
unidades removidas e **3 de perda**, não 9. Classificar a linha inteira — em
qualquer direção — é a falha que este serviço existe para impedir.

## Decisões que não são óbvias no código

- **Motivos são uma tabela com flag `counts_as_loss`**, não enum em código nem
  lista fixa num `WHERE`. Uma regra escrita como
  `WHERE reason IN ('expired',...)` é invisível para o operador, duplicada em
  cada call site, e silenciosamente errada no instante em que um sétimo motivo
  aparece num relatório. Como dado, a regra tem um lugar só e pode ser mostrada
  ao lado do número que produziu.
- **Motivo desconhecido é rejeitado, nunca bucketizado.** Os dois defaults
  escondem-se: cair para perda infla o número que o negócio quer reduzir; cair
  para não-perda apaga perda real dos livros. O erro nomeia o motivo, e nada é
  escrito no lote inteiro.
- **Só o split é guardado.** O 9 combinado não existe em lugar nenhum como
  quantidade: se estivesse guardado ao lado do split, os dois poderiam
  divergir e todo consumidor teria que saber em qual confiar. O texto original
  da linha fica em `source_text` — **auditoria apenas**, explicitamente não uma
  quantidade de que algo calcula.
- **Perda é derivada na leitura, nunca armazenada.** Uma coluna de perda é
  desnormalização que pode divergir das linhas que resume, e a divergência é
  invisível. Derivar mantém as linhas como fonte única, e permite corrigir a
  classificação sem backfill.
- **Substituição do período inteiro numa transação**, igual ao `sales-service`.
  Três serviços resolvendo isso do mesmo jeito vale mais que três otimizações
  locais.
- **O evento sai só depois do commit e só se algo mudou.** Reenviar arquivo
  idêntico é ação normal do operador; publicar incondicionalmente causaria
  tempestade de recomputação a jusante por nada.
- **O evento leva identificadores, nunca cifras** — é o que impede este serviço
  de saber como a reconciliação funciona.

## Risco registrado: editar `counts_as_loss` reescreve o passado

Porque perda é derivada, virar a flag **restata silenciosamente todo período
já fechado**. Trate como configuração sensível a segurança: mudança exige a
mesma revisão que código. Se restatement retroativo virar problema real, a
flag precisa de vigência datada, espelhando as versões de custo em
`products-service`.

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway.
- `other_reason` conta como perda e é o rótulo menos informativo; dividi-lo em
  categorias mais finas é refinamento de relatório, precisa de volume real
  primeiro.
- Sem suíte automatizada do worker contra Redis (mesmo débito de `sales` e
  `gateway`); a decisão de publicar/suprimir tem 7 testes unitários.
