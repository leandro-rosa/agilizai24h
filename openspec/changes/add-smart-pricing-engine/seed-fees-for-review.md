# Taxas iniciais para confirmação do dono

Nada aqui é cadastrado automaticamente. Só entra em `AcquirerFee` o que for confirmado, com data de vigência.
Valores em % (o cadastro guarda em basis points: 1,39% = 139).

## O que as vendas reais mostram (dev, só leitura, recibos `OK`)

| Método | Adquirente | Bandeira | Recibos | R$ | Ticket médio |
|---|---|---|---|---|---|
| Voucher | PagSeguro | SODEXO | 2.624 | 26.426 | 10,07 |
| Voucher | PagSeguro | TICKET | 1.804 | 15.686 | 8,70 |
| Voucher | PagSeguro | ALELO | 710 | 7.510 | 10,58 |
| Voucher | PagSeguro | VR | 70 | 530 | 7,57 |
| PIX | PagSeguro | — | 4.919 | 44.297 | 9,01 |
| Débito | PagSeguro | MAESTRO / VISA_ELECTRON / MASTERCARD / ELO | — | — | ~9 |
| Crédito | PagSeguro | MASTERCARD / VISA / ELO / AMEX | — | — | ~9–10 |

- O adquirente nas vendas é **PagSeguro** (não "PagBank"): as taxas de PIX/débito/crédito precisam usar esse nome.
- **SODEXO** é a maior bandeira de voucher (~53% do voucher) e não está na sua lista: Sodexo = Pluxee (mesma empresa, nome novo). Precisa de um alias.
- Voucher ≈ 25% da receita nesses dados (sua referência: ~22%).
- Ticket médio de ~R$ 9–10: uma taxa fixa por transação pesa muito (R$ 0,89 sobre R$ 8,70 ≈ 10%).

## Informado pelo dono

### PIX / débito / crédito (PagSeguro)

| Método | Taxa | Confirmado |
|---|---|---|
| pix | 0,69% | [ ] |
| debit | 1,39% (condição 2: 1,89%) | [ ] |
| credit | 2,97% (condição 2: 3,50%) | [ ] |

### VR/VA (valores recebidos; vigência ainda não informada)

| Bandeira | Linha | Taxa | Prazo | Situação |
|---|---|---|---|---|
| Pluxee (= Sodexo) | Administração | 6,90% | 28 dias | ativa |
| Pluxee | Reembolso expresso | 9,6% | — | **cancelado** (não entra) |
| Ticket | PAT | 3,6% | 28 dias | ativa |
| Ticket | TR/TA até R$ 1.000 | 4,99% | 28 dias | ativa |
| Ticket | TR/TA acima de R$ 1.000 | 5,99% | 28 dias | ativa |
| Ticket | Taxa por transação | R$ 0,89 / R$ 1,15 | — | ativa (a confirmar o que cada valor significa) |
| Ticket | Antecipação | 6,40% em 7 dias | — | **cancelada** (não entra) |
| VR Benefícios | Auxílio | 6,85% | 28 dias | ativa |
| VR Benefícios | PAT | 3,6% | 28 dias | ativa |
| VR Benefícios | Transferência | R$ 10,90 | — | ativa (custo por transferência, não por venda) |
| VR Benefícios | Antecipação | 0,2745% ao dia | — | **cancelada** (não entra) |
| Alelo | Auxílio/Refeição | 6,9% | 30 dias | ativa |
| Alelo | Cartão Natal | 6% | 30 dias | ativa |
| Alelo | PAT | 3,6% | 15 dias | ativa |
| Alelo | Multi | 6% | 2 dias | ativa |

## Problemas de modelagem (o cadastro atual guarda um percentual por adquirente, método e data)

1. **Várias taxas por bandeira.** As vendas só dizem a bandeira, não se foi PAT, Auxílio ou Multi. Sem decisão, a taxa de cada bandeira é ambígua.
2. **Taxa fixa por transação** (Ticket R$ 0,89 / R$ 1,15; VR transferência R$ 10,90) não é percentual. O cadastro atual não guarda valor fixo.
3. **Faixa por valor** (Ticket TR/TA 4,99% / 5,99%): precisa saber se a faixa é por venda ou por volume mensal.
4. **Prazo de 15 a 30 dias** é custo de capital de giro, não taxa de venda. Fora do preço nesta fase; pertence ao fluxo de caixa.
5. Linhas **canceladas** não entram.

## Outras perguntas

- A partir de que data cada taxa vale? (o cadastro é datado; data errada muda a margem de meses fechados)
- Alíquota de imposto (referência histórica ~7,07%): confirmar o valor e desde quando.

## Decisões do dono (2026-10-06)

- **Taxa por bandeira = a maior taxa ativa** (as vendas só informam a bandeira, não PAT/Auxílio). Média entre bandeiras feita pelo motor.
- **Ticket: R$ 0,89 por venda** (o R$ 1,15 não vale).
- **Sodexo = Pluxee.**
- **Alíquota: 7,07%.**

## Proposta de cadastro (ainda NÃO registrada: falta a data de vigência e a autorização para gravar no banco)

| Adquirente | Método | Taxa | Fixo por venda |
|---|---|---|---|
| PagSeguro | pix | 0,69% | — |
| PagSeguro | debit | 1,39% | — |
| PagSeguro | credit | 2,97% | — |
| Pluxee | voucher | 6,90% | — |
| Ticket | voucher | 5,99% | R$ 0,89 |
| VR Benefícios | voucher | 6,85% | — |
| Alelo | voucher | 6,9% | — |

Pendente: vigência de cada uma, e o tratamento das condições 1,89% (débito) e 3,50% (crédito).

## Respostas de 2026-10-06 (segunda rodada)

- **Vigência: o dono não sabe.** Nada foi gravado. Como o motor só usa a taxa vigente no fim da janela analisada, uma data de início antiga (ex.: 2026-01-01) não muda a análise atual; só mudaria meses fechados. Fica como pendência para quando ele souber.
- **PagBank = PagSeguro.** As vendas dizem PagSeguro; o parâmetro `payment.brandAliases` mapeia `pagseguro → pagbank` por padrão.
- **1,89% (débito) e 3,50% (crédito) são um segundo plano**, a cadastrar como outro adquirente (ex.: "PagBank plano 2").
- **Autorização para gravar no banco: não.** Cadastrar pela tela (ou `POST /treasury/fees`) quando ela existir.

### Efeito no motor (decidido pelo dono: média simples dos planos)

As vendas só trazem "PagSeguro" e não distinguem o plano 1 do plano 2. Quando as vendas de um método vêm de um único adquirente, o motor usa a **média simples** das taxas cadastradas desse método (débito: (1,39% + 1,89%) / 2 = 1,64%; crédito: (2,97% + 3,50%) / 2 = 3,235%) e avisa no relatório. Quando as vendas distinguem vários adquirentes, cada um usa a própria taxa.
