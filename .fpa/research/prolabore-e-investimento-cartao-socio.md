---
name: prolabore-e-investimento-cartao-socio
description: Pró-labore corrigido jan-ago/2026 e um gap real de CAPEX (R$67 mil, "Investimento cartão sócio") ainda sem dono nem itemização.
metadata:
  type: research
  period: 2026-01 a 2026-08
---

# Pró-labore (Josias/Barbara) e o gap de "Investimento (cartão sócio)"

Investigação em 2026-09-18, a partir do operador achando os valores de
pró-labore de jan-jul estranhos no DRE (só agosto parecia certo).

## O que a investigação descobriu

No extrato (`treasury-service`), pagamentos recorrentes para Josias e
Barbara aparecem em **três categorias diferentes**, e só uma é pró-labore:

- **`Pró-labore`** — a conta certa. Só passou a ser usada a partir de
  maio/2026; antes disso a categoria nem existia no extrato.
- **`Sócios`** — confirmado pelo operador: **não é pró-labore**, é outra
  coisa (retirada/adiantamento). Fica de fora do DRE de pró-labore.
- **`Investimento (cartão sócio)`** — confirmado pelo operador: fatura de
  cartão pessoal do Josias/Barbara sendo reembolsada pela empresa, **não é
  pró-labore**. Ver gap abaixo.

O valor certo de pró-labore por mês (jan-ago/2026) já está lançado em
`accounting-service`, conta `4.3.03`, `origin: manual` — **a conta é a
fonte de verdade, não duplicar o número aqui** (consultar
`GET /accounting/entries?from=2026-01&to=2026-08` filtrando o código da
conta, ou a tela DRE).

## Gap aberto: "Investimento (cartão sócio)" não está em lugar nenhum

R$ 67.019,73 (mar-ago/2026, extrato completo) classificados como
`nature: investment` no `treasury-service`, mas:

- Não entram no DRE (`accounting-service`) — correto, não é despesa
  operacional.
- **Também não entram no CAPEX (`capex-service`)** — `investment_item` e
  `store_investment` estão **zerados** (nenhum registro no serviço
  inteiro). `nature: investment` já sinaliza a intenção de que isso é
  CAPEX, mas ninguém nunca criou os registros correspondentes.

Por mês: mar R$1.069,99 · abr R$8.823,90 · mai R$3.942,77 · jun
R$15.757,34 · jul R$12.559,10 · ago R$24.866,63.

**Por que não foi resolvido ainda**: `investment_item` exige
descrição/categoria/loja/à-vista-ou-financiado por item, e o extrato só
tem "reembolso de cartão" sem itemização — só o operador sabe o que foi
comprado em cada lançamento e pra qual loja. Perguntado em 2026-09-18;
operador respondeu que não tem essa informação disponível no momento.

**Como aplicar**: não assumir que esse dinheiro já está contado em algum
lugar (CMV, despesas, CAPEX) — ele não está, em nenhum dos dois serviços,
até esse follow-up ser fechado. Ao construir qualquer análise de
resultado/CAPEX que dependa de "quanto a empresa investiu" no período,
sinalizar que esse valor real existe e está fora da conta. Não recriar
essa investigação do zero numa sessão futura — só perguntar ao operador se
a itemização já está disponível.
