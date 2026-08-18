# backend/apps/products-service

Catálogo de SKUs e a **referência de custo datada** de que toda cifra em
dinheiro da plataforma deriva. Ver [../../CLAUDE.md](../../CLAUDE.md) para as
convenções do workspace backend.

**Consumidores**: `finance-service` e `supply-service` (custo as-of para valorar
um período), `ingestion-worker-service` (resolve nomes e grava custos da
planilha de preços), `gateway-service` (leituras do painel).

## Rotas

| Rota | Uso |
|---|---|
| `GET/POST /products`, `GET/PATCH /products/:id` | Catálogo |
| `POST /products/:sku/costs` | Registra custo com data de vigência |
| `GET /products/:id/costs` | Histórico de custo |
| `GET /costs?sku=&as_of=` | Custo de um SKU **numa data** |
| `POST /costs/bulk` | Custos de um conjunto de SKUs numa data — resultado particionado |
| `POST /names/resolve` | Resolve nomes do PDV para produtos |
| `GET/POST/DELETE /names/overrides` | Tabela curada de overrides |
| `GET /health`, `GET /docs` | Health e OpenAPI |

## As duas regras que produzem dinheiro errado se implementadas "quase certo"

**1. Custo é série datada, e não existe "custo atual".**
Não há coluna `current_cost` em `Product`, nem operação que devolva custo sem
data. Isso é deliberado: um campo mutável é a coisa fácil de ler por acidente,
e lê-lo para um mês histórico reprecifica aquele mês silenciosamente — os
números simplesmente mudam, sem nada indicando. Modelando custo **só** como
série, não existe esse campo para ler errado.
Regra: a versão mais recente com `effective_from <= as_of`. Antes de todas →
reporta ausência, **nunca** cai para a mais antiga.

**2. Busca em lote devolve resultado particionado, não um mapa.**
`{ resolved, unresolved (com motivo), complete }`. Um mapa convidaria
`costs[sku] ?? 0`, e essa única expressão é como um SKU sem preço vira zero
silencioso — o que subestima CMV **e** perda, deixando os números *melhores*,
então ninguém questiona. A forma particionada não tem jeito natural de
expressar "trate ausente como zero" sem escrever algo que parece errado.

O shape do lote vive em `@app/products-contracts` (não é restated aqui), com
`assertCompleteCosts()` — a forma correta de consumir: quem precisa de um total
tem que primeiro estabelecer que nada ficou sem resolver.

## Matching de nomes

Normalização (caixa, acentos, espaços) → override curado, que **vence**. Um
override existe porque um humano olhou um mismatch real e decidiu; então ele
precisa poder **corrigir** um match normalizado errado, não só preencher lacuna.

**Não há matching fuzzy, e não deve haver.** Casar "Guaraná 350ml" com
"Guaraná 600ml" gera um custo plausível, errado e que ninguém percebe — pior
que um SKU não-casado, que é barulhento e é corrigido. Ambiguidade (mais de um
candidato) vira `ambiguous_name`, nunca escolha arbitrária.

## Dinheiro é inteiro em centavos

`cost_cents: Int`. Nunca float: esses valores são somados por milhares de linhas
e multiplicados por quantidades — exatamente o padrão que acumula erro de ponto
flutuante binário. A diferença resultante contra a planilha do operador seria
pequena, real e caríssima de diagnosticar.

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway, que ainda não existe.
- Sem custo por loja: custo é de rede. Mudar isso é mudança de spec.
- Sem preço de venda: a reconciliação usa **custo**; receita vem dos relatórios
  de venda, que já a declaram.
- Correção retroativa de custo é feita gravando uma versão corretiva para a
  mesma data de vigência; não há trilha de auditoria de correções.
