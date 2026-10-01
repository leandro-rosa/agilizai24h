# Inteligência Comercial v2 — relatório da Fase 1

Gerado em 01/10/2026 a partir de uma atualização real do `intelligence-service`
(motor 1.0.0, parâmetros versão 1, dados até **agosto/2026**, 21 lojas, 3.626
Produto × Loja). Todos os valores de parâmetro são **provisórios**, exceto a
tolerância que você definiu (o maior entre 10% do saldo e 3 unidades) e os dias
de visita. Este relatório **descreve, não decide**: não há nota de corte, e
"coerente" significa só que os dados posteriores são compatíveis com a
recomendação segundo o critério mostrado, nunca que ela estava correta.

Fonte: `GET /backtests/a83ff460-aba0-4d17-9acf-ffac0becfb70/summary` (texto completo
no próprio serviço) e `GET /runs/d6d506a7-…`.

## 1. Cobertura: quantos Produto × Loja podem ser analisados

Atualização atual (um instante, 3.626 pares):

| Categoria (exclusivas, somam o total) | Pares | % |
|---|---:|---:|
| Histórico insuficiente | 2.039 | 56% |
| Analisável, saldo **confiável** | 1.203 | 33% |
| Dados conflitantes | 212 | 6% |
| Analisável, **sem contagem suficiente** | 164 | 5% |
| Analisável, saldo **não confiável** | 8 | 0,2% |

Em todo o backtest (5 origens, abril a agosto, 13.124 pares-origem): histórico
insuficiente 8.339, saldo confiável 4.018, dados conflitantes 567, sem contagem
suficiente 134, não confiável 66. Só os analisáveis (4.218) recebem desfecho.

Leitura: a maior parte dos pares fora da análise é por **histórico curto** (SKUs
reabastecidos poucas vezes, ou sem estoque), não por dado ruim. Dos pares
analisáveis, a esmagadora maioria tem saldo confiável pela sua regra; só 8 estão
fora da tolerância.

## 2. Regras de contagem: o impacto antes de fixá-las

(Pares-origem; 13.124 no total. Tolerância 10% ou 3 un. salvo indicação.)

| Contagens consideradas / mínimo / idade máx. | Dentro | Fora | Não verificável | Libera o saldo |
|---|---:|---:|---:|---:|
| 1 / 1 / 30 d | 9.553 | 113 | 3.458 | 7.640 |
| 1 / 1 / 45 d | 10.919 | 114 | 2.091 | 8.510 |
| 1 / 1 / 90 d | 11.328 | 134 | 1.662 | 8.871 |
| **3 / 1 / 45 d (configurado)** | **10.746** | **287** | **2.091** | **8.347** |
| 3 / 2 / 45 d | 8.704 | 208 | 4.212 | 6.888 |
| 3 / 3 / 45 d | 7.389 | 134 | 5.601 | 5.901 |
| 5 / 1 / 45 d | 10.629 | 404 | 2.091 | 8.255 |

O que a tabela mostra (a escolha é sua):
- **A idade máxima e o mínimo de contagens são as alavancas.** Passar de 30 para
  45 dias tira ~1.370 pares de "não verificável"; de 45 para 90, mais ~430.
  Exigir 2 ou 3 contagens no mínimo joga 4.000 a 5.600 pares em "não
  verificável".
- **A tolerância quase não muda a cobertura.** De 5%/2 un. a 15%/5 un., o "fora
  da tolerância" vai de 375 a 117, enquanto o "não verificável" não se mexe: o
  limite que decide é ter contagem recente, não o tamanho da diferença.
- **Considerar mais contagens recentes (1, 3, 5) só aumenta o "fora"** (114, 287,
  404, com mínimo 1 e 45 dias): quanto mais contagens, maior a chance de uma delas divergir.
- Os valores atuais (3 / 1 / 45) liberam o saldo em 64% dos pares-origem. Eles
  continuam **provisórios**; nenhuma combinação foi escolhida.

## 3. O backtest de decisão (estimativas)

**Previsão de demanda.** Erro absoluto ponderado de **43,9%** (previsto 26.113
unidades contra 29.577 observadas, o motor subestima ~12%); 38,8% a 47,4% por
origem. 1.494 intervalos com ruptura ficaram de fora (piso de 6.852 unidades).

**Reduzir (2.380 pares avaliados):** 258 compatíveis, 190 contrárias, **1.932
inconclusivas** (1.104 delas por poucos ciclos depois). Evidências separadas:
perdas posteriores 934 un. (validade 153, avaria 17, outro motivo 764); vendas
posteriores 10.181 un.; **369 de 3.370 ciclos seguintes (11%) em que a demanda
passou da quantidade sugerida**; perda potencialmente evitável **até 754 un.**;
venda potencialmente em risco **até 861 un.**

Leitura: com os parâmetros atuais, reduzir teria evitado **no máximo** 754
unidades de perda ao risco de **até** 861 de venda. Os dois números são do mesmo
tamanho, então a redução, como está calibrada, **não mostra vantagem clara**.
Isso é coerente com a suspeita de que o intervalo H por SKU distorce a banda
(seção 4).

**Aumentar (152):** 89 compatíveis, 9 contrárias, 54 inconclusivas — o sinal mais
limpo, quando há ruptura recente.
**Manter (1.994):** 727 compatíveis, 46 contrárias, 1.221 inconclusivas.
**Avaliar retirada (116):** 13 compatíveis, 4 contrárias, 99 inconclusivas
(84 por poucos ciclos).
**Testar (12):** 9 compatíveis.

**Economia dos períodos seguintes:** vendidas 31.703 un. (receita R$ 264.737,83;
margem R$ 131.889,49), perdidas 2.473 un. (custo R$ 11.642,32), resultado
R$ 120.247,17. Margem com o custo **de hoje** (uma só versão por SKU).

## 4. O que esses números dizem sobre os parâmetros provisórios

1. **Intervalo de reposição (H) por SKU.** 973 de 3.626 pares (27%) recebem
   "reduzir", e a redução não mostra vantagem líquida. É o sinal esperado do
   defeito já descrito: o H vem das reposições do próprio SKU, então um SKU com
   sobra é reposto raramente, o H cresce e a banda alarga até incluir o excesso.
   **Decisão pendente sua:** usar o H **da loja** (visitas segunda, terça, quinta
   e sexta) no lugar do H do SKU. O backtest agora existe para medir o antes e o
   depois dessa troca.
2. **Demanda subestimada em ~12%** (mediana em vez de média, descartando
   rupturas): coerente com 1.494 rupturas e 53 sugestões de aumento.
3. **Contagens:** a regra 3 / 1 / 45 é razoável como ponto de partida, mas o
   ganho mais barato de cobertura é a **idade máxima** (45 → 60 dias tira
   ~215 pares de "não verificável"), não afrouxar a tolerância.
4. **Poucos ciclos depois** deixam 40% a 60% das avaliações inconclusivas:
   conforme setembro e os meses seguintes entrarem, esse número cai sozinho.

## 5. Limitações (o relatório declara cada uma)

- A quantidade parametrizada **da época é desconhecida**: 4.785 de 4.785
  desfechos usam a quantidade atual como substituta, porque o histórico só começa
  quando você a importou (setembro/2026).
- Custo é uma versão por SKU (margens com o custo de hoje).
- Venda e remoção por motivo só existem por mês; a perda é distribuída pelos
  ciclos (estimativa).
- Cada Produto × Loja é julgado sozinho: a evidência de rede não é refeita no
  passado.
- "SKU rejeitado na importação" e "baseline em conflito" ainda não chegam como
  entrada, então esses dois conflitos não aparecem na cobertura.
- Consumo e venda vêm do mesmo PDV: concordância mostra alinhamento, não o que
  havia na prateleira.

## 6. Atualização mensal e frescor

`GET /refresh/status` responde: dados atualizados até **2026-08**, atualizado em
01/10/2026, sem defasagem; **2026-09 pendente de importação (0 de 21 lojas)**, a
análise não se apresenta como atualizada até setembro. Quando setembro for
importado (fornecimento e venda em pelo menos 90% das lojas), a atualização
recalcula tudo (motor, backtest, cobertura e sensibilidade) e **adiciona** o mês
ao histórico sem apagar o conjunto de agosto.
