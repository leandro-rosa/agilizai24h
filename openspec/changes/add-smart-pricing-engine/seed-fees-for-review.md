# Taxas iniciais para confirmação do dono

Nada aqui é cadastrado automaticamente. Só entra em `AcquirerFee` o que for confirmado.
Valores em % (o cadastro guarda em basis points: 1,39% = 139).

## Informado pelo dono (referência atual)

| Adquirente | Método | Taxa | Vigência | Confirmado |
|---|---|---|---|---|
| PagBank | pix | 0,69% | ? | [ ] |
| PagBank | debit | 1,39% | ? | [ ] |
| PagBank | credit | 2,97% | ? | [ ] |
| (rótulo a definir, ex.: "PagBank condição 2") | debit | 1,89% | ? | [ ] |
| (rótulo a definir, ex.: "PagBank condição 2") | credit | 3,50% | ? | [ ] |

## VR/VA — valores não informados

| Bandeira | Método | Taxa | Vigência | Confirmado |
|---|---|---|---|---|
| Pluxee | voucher | ? | ? | [ ] |
| Ticket | voucher | ? | ? | [ ] |
| VR Benefícios | voucher | ? | ? | [ ] |
| Alelo | voucher | ? | ? | [ ] |

## Perguntas

1. A partir de que data cada taxa vale? (o cadastro é datado; uma data errada muda a margem de meses fechados)
2. As taxas de 1,89% e 3,50% são de outro plano/máquina do PagBank ou de outro adquirente? Qual rótulo usar?
3. Os nomes das bandeiras precisam bater com o que as vendas registram em `acquirer`/`card_brand`; confirmar a grafia.
4. Alíquota de imposto (referência histórica ~7,07%): confirmar o valor e desde quando.
