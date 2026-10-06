# frontend/apps/admin

Painel de gestão interno do Agiliz.AI — vendas, financeiro, abastecimento,
estoque, produtos e lojas. Hoje essa gestão é feita no sistema terceiro
touchpay; este app é o novo front de gestão. Fala **só** com
`gateway-service`, autenticado, sobre dado real — ver
[../../CLAUDE.md](../../CLAUDE.md) para convenções do workspace frontend e
[DESIGN.md](DESIGN.md) para identidade visual/marca.

## Stack

Next.js 16 (App Router, TypeScript, Turbopack), Tailwind v4, shadcn/ui
(base `radix`, style `nova`) escalfolded via `npx shadcn@latest`. RTK +
RTK Query — primeira implementação real dessa convenção do workspace (ver
gap em [../CLAUDE.md](../CLAUDE.md)). `next/font/google` (Inter) em vez
de um `fonts.css` vazio como no `site`.

Diferente do `site` (Vite + React Router SPA), este é o primeiro app
Next.js do monorepo — sem precedente de build/Docker a copiar; o setup
foi desenhado do zero (ver `Dockerfile`/`docker-compose.yml`).

**Convenção de idioma**: todo código (identificadores, arquivos, pastas,
rotas) é em inglês (`src/app/sales/`, `Store`, `useGetStoresQuery`, etc.).
Texto de UI (labels, títulos, badges) fica em português, já que o público
do painel é a operação do Agiliz.AI no Brasil — mesma convenção do
`site`.

## Estrutura

- `src/app/layout.tsx` — só chrome global (`Providers`, tooltip, toaster).
  Não monta sidebar nenhuma — `/login` e as rotas de gestão precisam de
  shells diferentes. **Não grava classe de tema no `<html>`**: quem escreve
  `.dark` é o `next-themes`, no cliente.
- `src/app/providers.tsx` — Redux **e** `ThemeProvider` (`next-themes`,
  `defaultTheme="system"`). O padrão é o tema do SO; a escolha explícita do
  operador sobrevive em `localStorage`.
- `src/components/theme-toggle.tsx` — Claro/Escuro/Sistema no rodapé da
  sidebar. Sem flag `mounted`: `useTheme()` devolve `theme=undefined` antes
  de montar, e cair em "Sistema" nesse intervalo já faz servidor e cliente
  concordarem.
- `src/components/brand-mark.tsx` — único lugar que conhece os arquivos de
  logotipo (`public/brand/`). Ver [DESIGN.md](DESIGN.md) para qual variante
  vai onde e por quê.
- `src/components/status-badge.tsx` — badge semântico por `tone`; existe
  para não editar `ui/badge.tsx`, que a CLI reescreve.
- `src/components/app-breadcrumb.tsx` — rótulo do header derivado do `nav`
  exportado por `app-sidebar.tsx`, não de uma segunda tabela de títulos.
- `src/app/login/page.tsx` — rota pública, formulário de e-mail/senha
  (`react-hook-form` + `zod`).
- `src/app/(app)/` — route group que concentra toda rota autenticada
  (`/`, `/sales`, `/supply`, `/inventory`, `/products`,
  `/stores`, `/ingestion`). `(app)/layout.tsx` é quem monta `AuthGate` +
  `SidebarProvider`/`AppSidebar`/`SidebarInset` — um group novo nasce
  protegido só por estar dentro dessa pasta.
- `src/components/auth-gate.tsx` — chama `GET /auth/me`; segura a
  renderização (skeleton) até ter identidade. Um 401 é tratado **fora**
  daqui, globalmente, em `gatewayBaseQuery`.
- `src/components/request-state.tsx` — o único lugar que decide
  loading/vazio/erro/sem-permissão; toda tela com dado passa por ele em
  vez de reescrever o próprio `if (isLoading)`.
- `src/components/store-period-picker.tsx` — seletor de loja+range
  compartilhado por vendas/abastecimento/estoque/financeiro; `allowNetwork`
  liga a opção "Rede (todas as lojas)", hoje ligada nas quatro telas.
  Range vem de `src/components/month-range-picker.tsx` (presets Mês/
  Trimestre/Semestre/Ano sobre `src/lib/period-range.ts`), não um único mês.
- `src/components/app-sidebar.tsx` — navegação lateral (shadcn
  `sidebar.tsx`), item ativo destacado com `.brand-gradient`; rodapé tem
  identidade do operador (`GET /auth/me`) + logout.
- `src/components/page-header.tsx` — título + descrição + slot de ações,
  reusado em todas as páginas de módulo.
- `src/components/ui/` — componentes shadcn vendorizados via CLI
  (`components.json` real, diferente do export bruto do `site`).
  Regenerados via `npx shadcn@latest add`; não editar manualmente
  arquivos que a CLI reescreve. Exceção: `form.tsx` foi escrito à mão —
  ver Gaps conhecidos.
- `src/lib/api/base-query.ts` — `gatewayBaseQuery`: `fetchBaseQuery`
  (`credentials: "include"`, `baseUrl` de `NEXT_PUBLIC_GATEWAY_URL`)
  envolto em `retry()`. 401 → navegação completa para `/login` (nunca
  client-side — o cache do RTK Query da sessão anterior não pode
  sobreviver). 403 passa intocado (nunca desloga). 503 é o único status
  que tenta de novo, via `retry.fail` em todo o resto.
- `src/lib/api/` — um `createApi` por domínio (`auth`, `stores`,
  `products`, `sales`, `supply`, `inventory`, `finance`, `overview`,
  `ingestion`), todos sobre `gatewayBaseQuery`, cada um contra a rota
  real do gateway.
- `src/lib/auth/use-permission.ts` — `useHasPermission(permission)`,
  reaproveita o cache de `getMe`; é cortesia de UX, nunca a fronteira de
  segurança (o gateway continua validando e pode devolver 403 mesmo para
  uma ação que este hook disse estar disponível).
- `src/lib/removal-reasons.ts` — rótulos PT dos 6 motivos de remoção,
  espelhando (não substituindo) a tabela autoritativa em
  `supply-service`.
- `src/lib/store.ts` / `src/lib/hooks.ts` — `configureStore` com os 9
  reducers de API e hooks tipados `useAppDispatch`/`useAppSelector`.
- `src/app/globals.css` — tokens de marca, `:root` (tema claro) e `.dark`
  (escuro) com valores **diferentes**, em hex do manual. Não há `theme.css`
  separado: é assim que a CLI do shadcn v4 estrutura o CSS.
- `scripts/contrast.mjs` (`pnpm contrast`) — verifica 20 pares de contraste
  WCAG e sai != 0 se algum reprovar. Rodar ao mexer em token.
- `scripts/generate-contour-pattern.py` — gera `public/brand/contour.svg` e
  `contour-surface.svg` (o padrão de fundo da marca, ver DESIGN.md
  `.brand-canvas`). `numpy` só; rodar de novo para mudar o padrão, nunca
  editar o `.svg` na mão.

## Rotas e navegação

Vinte e uma rotas em sete grupos (`navGroups` em `src/components/app-sidebar.tsx`).
Lista plana com vinte e um itens é inutilizável, e o agrupamento é o que separa
"o que a loja fez" de "o que a empresa deve":

| Grupo | Rotas |
|---|---|
| Operação | `/` · `/sales` · `/commercial-intelligence` (Inteligência Comercial) · `/supply` (movimentos + reconciliação) · `/inventory` · `/inventory/central` |
| Financeiro | `/finance/pnl` (DRE) · `/finance/stores` (resultado por loja) · `/finance/cash-flow` |
| Tesouraria | `/treasury` · `/treasury/imports` · `/treasury/mappings` |
| Comercial | `/billing/clients` · `/billing/contracts` · `/billing/invoices` |
| Investimento | `/capex` · `/capex/investors` |
| Cadastros | `/products` · `/stores` · `/suppliers` |
| Sistema | `/ingestion` |

Cada item some para quem não tem a permissão de leitura
(`useHasPermission`, que agora aceita `undefined` como "não exige nenhuma").
Continua sendo cortesia de UX — o gateway é a fronteira e pode devolver 403
para uma ação que o menu deixou visível.

**`/supply` reúne quatro assuntos em abas — Visão geral · Reposição ·
Perdas · Reconciliação** (pedido do operador 2026-09-18: a antiga rota
`/finance`, dedicada só à reconciliação, foi removida por redundante —
"as informações são de abastecimento" — e depois a própria página de
abastecimento foi reorganizada porque "perda é um dos maiores pontos de
impacto na rentabilidade das lojas, ela merece uma análise própria").
`Reposição` é `NetworkSupplyMovementsView`/`StoreSupplyMovementsView`
(restocks/remoções/ajustes brutos, sem mudança). `Reconciliação` é
`NetworkReconciliationView`/`StoreReconciliationView` (o que era
`NetworkFinanceView`/`StoreFinanceView`) — abastecido/CMV/sobra/perda
real/ajuste, evolução mensal e a tabela de lojas; o detalhe de perda por
motivo/produto que antes vivia aqui (`LossTables`/`ReasonSkuBreakdown`,
o drill-down por loja em `NetworkStoreDetail`) foi removido daqui — ficou
só em `Perdas`, pra não duplicar a mesma informação em duas abas.

**Pendências mês a mês, desde julho** (`src/lib/reconciliation-pending.ts`, `components/supply/pending-dialog.tsx`; pedido do operador 2026-10-07: "o time não sabia mexer no
sistema de abastecimento, vai ter muita coisa errada antes de julho" e, depois, "venda sem abastecimento no mês pode ser estoque que sobrou do mês anterior"): em `Reconciliação`,
o selo "Pendente · N produtos" de cada loja (e o link no aviso da visão de uma loja) abre a lista do MÊS (abas jul/ago/set + tendência). Em cada mês, `esperado = contagem de fim do mês
anterior (`recorded_closing_balance`) + abastecido − vendido − retirado + ajuste`; só entra quem fica negativo, e a contagem de fim de mês reancora o mês seguinte (o erro de um mês não se acumula).
Classifica **entrada não lançada** (há estoque contado no fim: o produto existia; faltam `contagem_fim − esperado` un. de entrada) × **saiu mais do que entrou**. Produto sem contagem do mês
anterior conta como 0 e é dito. É só uma lista para achar onde corrigir: NÃO muda o saldo do serviço de estoque nem as cifras da reconciliação e não diz a causa.
Medido (SQL em `stock_snapshot`): negativos jul 117 (3,5%), ago 65 (1,9%), set 70 (1,9%) — bem menos que as visões acumuladas (699 desde janeiro; 229 acumulando jul–set) e em queda.
Ex.: Sprite Zero (100114), loja 17: abastecido 0, vendido 15, contagem de fim de set = 5 ⇒ faltam ~20 un. de entrada lançada; nenhuma linha de abastecimento dele existe em mês algum
e as importações recentes não recusaram nenhuma. As "visitas sem Cliente" (`no_client_*`: jul 40 / ago 27 / set 10 ops) são contagens do centro de distribuição, NÃO abastecimento de loja.
Mudar o cálculo do saldo no `inventory-service` para reancorar a cada mês ficou como passo posterior (muda cifras; pede aprovação).
**Armadilha do `/inventory/:storeId?period=`**: o serviço devolve, por produto, o ÚLTIMO registro até o mês pedido; um produto sem movimento em jul–set volta com o registro (e os
movimentos) de fevereiro. `sumStock` somava isso em cada mês (venda de fevereiro contada 3×: o "Suco de uva Ades vendeu 6" que o operador estranhou) — agora só entra o item cujo
`item.period` é o do mês (`getStockMonths`/`getNetworkStockMonths` já devolvem só registros do próprio mês; `inventory.spec.ts`, `reconciliation-pending.spec.ts`).

**`Perdas`** (`src/components/supply/loss-tab.tsx` + `src/lib/
loss-insights.ts`) é o centro de investigação de perda: 6 KPIs com
tendência vs. mês anterior, "Perda por loja" (toggle R$/Perda%/Unidades,
pra não deixar loja grande sempre parecer pior), donut "Perda por
motivo", "Evolução das perdas" (6 meses), um card de insights
regra-a-regra (evidência primeiro, recomendação só quando a evidência
aponta pra uma ação específica — nunca "reduza abastecimento" solto),
ranking "Produtos com maior perda" (Qtd. + R$ + % das vendas daquele SKU
+ lojas afetadas + motivo principal, com abas por motivo), matriz
Produto × Loja (distingue produto ruim de loja com problema) e
"Abastecido × Vendido × Perdido por validade" (distingue produto ruim de
excesso de abastecimento). Tudo client-side sobre dado que as outras
abas já buscam (`useGetNetworkReconciliationRangeQuery` — que ganhou
`monthlyLossByReason` pra alimentar a evolução —, `useGetNetworkSalesRangeQuery`,
`useGetNetworkSupplyRangeQuery`), zero endpoint novo.
`aggregateAcrossStores` (`src/lib/reconciliation-aggregate.ts`) faz pra
lojas o que `sumReconciliations` já fazia pra meses — permite tratar rede
e loja única com o mesmo código.

**Três correções do operador logo após a primeira versão da aba
Perdas** (2026-09-18): (1) o seletor de "Período" ficava preso aos meses
do range escolhido lá em cima na página (`StorePeriodPicker`, muitas vezes
um único mês) — agora é independente, sempre lista os últimos 24 meses a
partir de `lastCompleteMonth()`, porque Perdas tem seu próprio conceito de
período/comparação. (2) A matriz "Produto × Loja" e o `topSkus` que a
alimenta agora respeitam a aba de motivo selecionada na tabela ("Geral/
Validade/Avaria/Outros") — o operador usa "Outro motivo" na prática pra
registrar suspeita de furto, então isolar essa aba isola o padrão
loja-a-loja daquele motivo específico ("produto suscetível a furto" vs.
"furto isolado numa loja"), em vez de misturar com validade/avaria. (3) Uma
linha da tabela "Produtos com maior perda" agora expande ao clicar
(`SkuStoreBreakdownTable`, `skuStoreBreakdown` em `loss-insights.ts`) —
mostra, por loja, os motivos que perderam aquele SKU lado a lado com a
venda da mesma loja pro mesmo SKU, sempre com TODOS os motivos (não filtra
pela aba ativa: o ponto de abrir um produto é comparar motivos entre lojas,
não estreitar pra um só).

O KPI "Divergência de estoque não explicada" usa
`unclassified_stock_adjustment_value_cents` — não é somado à "Perda
total": é contagem de estoque que não bate com nenhuma remoção
registrada (pode ser furto, contagem errada ou lançamento faltando), tema
diferente de perda com motivo conhecido. **A heatmap "Perda por dia da
semana e horário" do mockup original não foi construída** — o mesmo gap
já documentado abaixo ("Perda por dia de visita de abastecimento":
`supply-service` não guarda nada mais fino que o mês) segue de pé; construir
essa visão exigiria mudança de schema a montante, não é um filtro novo na
tela.

## Componentes que a Fase C trouxe

- `src/components/resource-form-dialog.tsx` — o formulário de CRUD de todo
  domínio novo. Sem ele, cada uma das doze telas reescreveria a mesma
  combinação de Dialog + `react-hook-form` + zod + mutation, e cada cópia
  trataria 403 e erro de validação de um jeito ligeiramente diferente.
  `toCents`/`fromCents` moram aqui: o formulário fala R$, a API fala inteiro.
- `src/lib/format.ts` — moeda, data, período e basis points. Estava
  duplicado como um `Intl.NumberFormat` solto em cada página.
- `src/lib/api/{suppliers,treasury,accounting,billing,capex}.ts` — um
  `createApi` por domínio, como os nove anteriores. São 14 reducers em
  `src/lib/store.ts`.

## Tesouraria: upload/conferência (`add-treasury-review-ui`) e dashboard (`add-treasury-dashboard`)

- **Três telas, uma fila de estado**: `/treasury/imports/upload` (envia até 6
  arquivos, um por fonte, todos opcionais) → `/treasury/imports/:period`
  (conferência — aparece com `?sources=<lista>` vindo do upload) →
  `/treasury` (dashboard + tabela, já confirmado). `/treasury/imports` (sem
  período) é só a listagem histórica de todo `PendingImport`, entrada pelo
  item "Importar extratos" da sidebar.
- **"Arquivos no Drive"** — nova seção em `/treasury/imports`, acima do histórico
  de upload manual, espelhando `/ingestion`'s padrão próprio de Drive
  (`add-drive-ingestion-source`). Escaneia a pasta "Extratos" do Google Drive
  mensalmente (06:00 America/Sao_Paulo ou "Sincronizar agora"), detecta extratos
  Itaú e faturas/extratos C6, lista para revisão e importação com um clique,
  entregando as mesmas filas de `treasury.raw-rows` que o upload manual já usa
  — `treasury-service` vê as linhas identicamente. Scoped a Itaú/C6 por enquanto;
  as outras 4 fontes (Nubank, PagBank, Bradesco, PagSeguro) virão depois quando
  houver real file groundwork (ver
  [backend/apps/ingestion-worker-service/CLAUDE.md](../../../backend/apps/ingestion-worker-service/CLAUDE.md),
  seção "A fonte Drive de tesouraria").
- **Polling da tela de conferência não usa `pollingInterval` alimentado por
  ref/estado derivado do próprio resultado da query.** A config de ESLint
  deste app aplica as regras de pureza do React Compiler
  (`react-hooks/refs`, `react-hooks/set-state-in-effect`,
  `react-hooks/purity`) — leitura/escrita de ref durante o render, `setState`
  síncrono no corpo de um efeito, e `Date.now()` durante o render são todos
  erro de lint, não só de estilo. As três tentativas óbvias para "poll até a
  condição bater" caem numa dessas. O que passa: um `useEffect` cujo
  dependency array é o booleano `stillWaiting` (derivado puro do resultado
  da query, sem ref nem estado), que cria um `setInterval` chamando
  `refetch()` — quando `stillWaiting` vira `false`, o efeito roda de novo,
  limpa o `setInterval` anterior e não cria um novo. `refetch()` dentro do
  callback do timer (não síncrono no corpo do efeito) é o que evita o aviso
  de "setState síncrono".
- **`supplier_id` agora está ligado a `suppliers-service` para as despesas
  já classificadas** (~680 lançamentos, ~123 fornecedores cadastrados
  cobrindo estoque/frutas/equipamento/serviços/sistema — sócios, impostos,
  tarifas bancárias e repasse de receita também viraram fornecedor, por
  pedido explícito; CDB, transferência entre contas e demais `movement`
  ficam de fora de propósito, não são compra de fornecedor).
  `CounterpartyMapping.supplier_id` também foi preenchido para as regras
  correspondentes, então uma confirmação nova do mesmo favorecido já herda
  o fornecedor sem passar por este backfill de novo.
- **"Despesa por fornecedor" em `/treasury` tem 2 níveis: grupo financeiro →
  fornecedor → lançamento** (`groupByExpenseGroupThenSupplier`/
  `groupBySupplier`, `src/app/(app)/treasury/page.tsx`). O grupo do topo
  (`EXPENSE_GROUPS`, mesmo arquivo) é por `bank_transaction.category`
  (texto livre do de-para — "Combustível", "Estoque", "Pró-labore" etc.),
  **não** por `Supplier.category` (vocabulário fechado de
  `suppliers-service`) — são dois eixos diferentes que coincidem de nome
  ("categoria" no fornecedor é congelados/bebidas/mercearia/atacado/
  equipamentos/serviços/sistema; "categoria" no lançamento é o rótulo
  específico do de-para). Agrupar pelo lançamento, não pelo fornecedor, é
  o que separa por exemplo o pró-labore do Josias ("Despesas fixas") do
  empréstimo dele — sempre R$3.852,44 — que vai para o grupo "Empréstimos";
  o mesmo fornecedor `Supplier.category="services"` gera lançamentos nos
  dois grupos dependendo só do `bank_transaction.category` daquela linha.
  Categoria sem grupo mapeado cai em "Outras despesas" (catch-all, nunca
  esconde). "Empréstimos" é o único grupo que inclui `kind: movement`
  (`category = "Financiamento/empréstimo"`) — pedido explícito do operador
  para acompanhar Josias/Gerson no mesmo painel, mesmo esse valor não
  somando ao resultado. Fornecedor sem `supplier_id` cai no bucket "Sem
  fornecedor" dentro do grupo, mesma filosofia de nunca esconder dado
  incompleto que já vale para `sem_natureza`. `GET /treasury/transactions/
  by-supplier` (`useGetTransactionsBySupplierQuery`) já devolve dado real
  agora, mas nenhuma tela chama — o agrupamento client-side acima cobre o
  mesmo caso e já tem o drill-down por lançamento.
  **Gap que continua aberto**: os formulários "Novo lançamento"/"Corrigir
  classificação" ainda não pedem/setam `supplier_id` (só um campo de texto
  livre para `counterparty_raw`) — um lançamento novo digitado à mão só
  ganha fornecedor se, mais tarde, uma regra de de-para com `supplier_id`
  já setado o classificar automaticamente.
- **O card "Pendente" do resumo é clicável** — abre um `Dialog` (`Lançamentos
  pendentes — {período}`) com a lista completa via `PendingTable` (mesmo
  componente usado no card "Pendentes" menor, agora com banco/direção além
  de data/favorecido/valor). Clicar numa linha fecha o diálogo e abre o
  mesmo `ResourceFormDialog` de "Editar lançamento" — não existe um
  formulário de classificação separado, é o mesmo de "Novo lançamento".
- **Edição de lançamento confirmado agora existe** (`/treasury`, ícone de
  lápis por linha) — reusa exatamente o mesmo `fields`/`transactionSchema`
  de "Novo lançamento" via `submitValues()`, e `useUpdateTransactionMutation`
  (já existia, sem chamador até esta mudança).
- **`/treasury`'s resumo (4 cards + despesa por categoria) e a tabela
  principal usam `RequestState` em fronteiras separadas** — o resumo depende
  só de `getTransactionSummaryQuery({period})` (sem o filtro de natureza
  da tabela: o resumo do mês não deve mudar quando o operador filtra a
  tabela abaixo por natureza), despesa-por-fornecedor/pendentes dependem de
  uma segunda `getTransactionsQuery({period})`, e a tabela em si tem sua
  própria terceira fronteira com o filtro de natureza aplicado. Uma falha
  numa query não apaga as seções que não dependem dela.
- **Dois gráficos de barra ("Classificação por tipo", por `kind`, e
  "Despesa por natureza") vêm da mesma `periodTransactions` (mês inteiro,
  nunca do filtro de natureza/range de dias da tabela)** — cores via
  `ChartConfig`/`<Cell fill="var(--color-<key>)">`: `kind` reaproveita os
  tons semânticos dos `SummaryCard` (`--success`/`--destructive`/
  `--warning`/`--muted-foreground`); `nature` (só existe para
  `kind: expense`) não tem precedente de cor em nenhuma tela (nem o DRE
  colore por natureza), então usa a paleta de dataviz dedicada
  `--chart-1..5` — o 5º bucket (`sem_natureza`) é o catch-all para uma
  despesa ainda sem `nature` resolvida, mesma filosofia de nunca esconder
  dado incompleto. Tooltip de proveniência (ícone `Info` ao lado do badge
  "Sem fornecedor") resolve `pending_import_id`/`mapping_rule_id` via
  `useGetMappingsQuery()`/`useGetPendingImportsQuery({period})`, join
  client-side em `Map` (`mappingById`/`importById`) — mesmo raciocínio de
  volume pequeno que já vale para `normalizeCounterpartyForGrouping`.
- **`src/components/date-range-picker.tsx`** — range de DIAS reais
  (`occurred_on`), só afeta a tabela principal (nunca `periodTransactions`,
  os dois gráficos, o resumo ou os imports), resetado ao trocar de período.
  Não confundir com `month-range-picker.tsx` (range de MESES inteiros,
  usado por `store-period-picker.tsx` em vendas/abastecimento/estoque/
  financeiro) — `treasury` é o único domínio do painel com granularidade
  diária real por lançamento, os outros só têm mês. `Calendar`/`Popover`
  (shadcn, `react-day-picker@10`) já estavam vendorizados mas sem nenhum
  consumidor antes deste componente.
- **Performance de `/treasury`**: todo o estado interativo (período,
  natureza, range de dias, edição, categoria/fornecedor expandido, diálogo
  de pendentes) vive num componente só (`TreasuryPage`), então qualquer
  clique re-renderiza a função inteira. Com até ~2.300 lançamentos/período,
  isso tinha dois efeitos que juntos mediam 1-4s por clique (medido com
  Chrome DevTools Performance trace, escalando com o nº de linhas — ~1s em
  período leve/226 linhas, ~4,3s em período cheio/2272): (1) os valores
  derivados (`porGrupo`/`porTipo`/`porNatureza`/os `Map` de id→entidade)
  recalculando do zero a cada render — corrigido com `useMemo`; (2), a causa
  maior, a tabela principal ("Lançamentos", até ~2 mil `<TableRow>` com
  `Tooltip` do Radix cada) sendo reconciliada inteira mesmo quando o clique
  não tinha nada a ver com ela — corrigido extraindo `TransactionsTable`
  como componente próprio envolto em `memo`, com `provenanceLabel` em
  `useCallback` (referência estável é obrigatória pro `memo` funcionar; sem
  isso ele re-renderiza igual). Qualquer novo bloco grande/frequente nesta
  tela (nova tabela extensa, novo gráfico) deveria seguir o mesmo padrão:
  componente próprio + `memo` + props estáveis, não ficar inline na função
  de `TreasuryPage`.
- **`/finance/cash-flow` é dois arquivos, não um**: `page.tsx` (o dashboard
  real, regime de caixa — `GET /treasury/transactions/cash-flow`, dado
  agregado pelo `computeCashFlow` puro em `treasury-service/.../utils/
  cash-flow.ts`) e `premises/page.tsx` (o formulário mensal antigo,
  `accounting-service`, PREMISSA digitada — ainda vivo porque
  `capex-service`/`billing-service` dependem dele enquanto payback/repasse
  forem métrica derivada, ver CLAUDE.md raiz). Os números de Entrada/Despesa
  do dashboard **divergem de propósito** dos cards de Lançamentos: aqui
  inclui `kind: movement` não-transferência (empréstimo, sócio, CDB) porque
  é caixa real, e exclui as categorias "Movimentação entre contas" e
  "Pagamento de fatura" (mesmo motivo estrutural: cada uma grava duas
  pernas — saída de um lado, entrada do outro — então soma zero no
  consolidado; achado e corrigido na revisão final deste plano) — nunca as
  demais `movement` ao mesmo tempo. Ver
  `docs/superpowers/specs/2026-09-16-fluxo-de-caixa-design.md` para a
  regra completa.

## O que as telas novas recusam mostrar como zero

Repetido aqui porque é a decisão que mais aparece no código:

- **DRE**: `break_even_cents === -1` vira "—" com explicação. O serviço usa
  -1 para indefinido; "R$ 0,00" diria que já está no equilíbrio.
- **CAPEX**: `payback_months === null` vira badge "Indefinido". Nenhum
  número de meses paga uma loja sem lucro.
- **Produtos**: margem só aparece com custo E preço na mesma data. Faltando
  um, "—" — 0% se leria como margem nula real.
- **Visão geral**: KPI sem resposta do backend mostra "Indisponível". Um
  zero fabricado numa visão geral parece um número.
- **Estoque central**: o valor parado vem com "sobre N de M lotes", porque
  só conta lote com custo informado.

## Vendas, abastecimento, estoque e financeiro são por loja+mês

Nenhum dos quatro tem endpoint "rede inteira" nem "range de meses" no
backend — cada um é `GET /<dominio>/:storeId?period=` (um mês). `/sales` e
`/supply` devolvem **404** (não lista vazia) para uma loja+mês nunca
ingerido — tratado como estado vazio próprio (`RequestState`), distinto de
um erro real. A visão geral (`/`) por isso só soma o que é de fato
agregável na rede — `GET /overview` (lojas + produtos) — e não fabrica um
"vendas hoje" ou "abastecimentos pendentes" de rede inteira que o backend
não tem como responder honestamente.

**Range e rede são construídos no cliente, não no backend.** Os hooks
`useGet*RangeQuery` (`src/lib/api/{sales,supply,inventory}.ts`) fazem
fan-out de uma request por mês do range via `queryFn` e somam client-side
(`src/lib/api/fan-out.ts`'s `fetchOr404`/`firstError` distingue "sem dado
no mês" de erro real — nunca trata um 403/500 como mês vazio). `finance`
é diferente: `GET /finance/:storeId` já devolve o histórico inteiro da
loja sem filtro de período, então o range ali é só filtro+soma
(`src/lib/reconciliation-aggregate.ts`), e a visão de rede
(`useGetNetworkReconciliationRangeQuery`) busca essa série completa uma
vez por loja (nunca uma vez por loja por mês) e soma no cliente —
`sales`/`supply`/`inventory` seguem o mesmo padrão de fan-out client-side
descrito acima, cada um com sua própria opção "Rede (todas as lojas)".

## `/sales` — reconstruída sobre detalhe por transação (`add-sales-transaction-detail`)

Deixou de ser só "quanto vendemos por SKU" (`SalesRecord`, ainda usado por
`/supply`'s aba Perdas e pela reconciliação — `getSalesRangeQuery`/
`getNetworkSalesRangeQuery` continuam intocados) e virou 5 abas — **Visão
geral | Produtos | Lojas | Comportamento | Pagamentos** — sobre
`SalesTransaction` (um registro por transação: horário, método, adquirente,
bandeira, desconto, comprador, PDV/máquina, resultado), só disponível para
loja/período ingeridos do formato de vendas por rede (ago/2026 em diante —
ver `add-sales-transaction-detail`). Um mês do formato antigo não tem
nenhuma dessas colunas; a tela mostra o estado vazio do `RequestState`
nesse caso, nunca zero fabricado.

**`result !== 'OK'` é excluído de toda métrica de venda** (receita,
unidades, ticket, margem, mix, heatmap) via `onlyOk()`
(`src/lib/sales-insights.ts`) — só a seção "Resultado das transações" (aba
Pagamentos) lê o conjunto completo, porque o ponto dela é justamente
comparar aprovadas com não-concluídas.

**"Compra" é agrupada por `Cupom`, não por linha** (`groupBaskets()`) —
cada linha do arquivo é um SKU vendido, várias linhas com o mesmo Cupom na
mesma loja são a mesma compra. Uma linha sem Cupom vira uma compra de um
item só (degradado, mas honesto — o arquivo não deu como agrupar). É o que
faz "itens por compra"/"ticket médio" serem reais em vez de sempre 1,0.

**Margem usa `products-service`'s custo datado** (`getCostsAsOfQuery`,
`asOf: "${period}-01"`), nunca o CMV do arquivo de vendas (que tem colunas
`CMV`/`Margem`/`Margem(%)` — deliberadamente nunca lidas, ver
`add-sales-transaction-detail`) nem o CMV do `finance-service` (grão
loja-mês, não serve para margem por produto). Um SKU sem custo resolvido
não zera a margem do agregado — é excluído do cálculo e contado em
`unresolvedSkuCount`, mostrado como aviso no card, nunca escondido.

**"Loja vs rede" é comparação de primeira classe em toda a página** (spec
do operador, 2026-09-18: "a média da rede deve servir como benchmark, e
não como regra"). Por isso `page.tsx` busca `getNetworkSalesTransactionsQuery`
**sempre na largura da rede inteira** (`{stores: allStores, period}`),
mesmo com uma loja específica selecionada — o escopo da tela (uma loja ou
a rede) é filtro client-side sobre esse mesmo cache, nunca uma fetch
diferente. Trocar de loja no seletor nunca dispara uma nova requisição;
só trocar de período dispara. `networkCurrentByStore`/`networkPreviousByStore`
(sempre a rede inteira) e `currentByStore`/`previousByStore` (o escopo
selecionado) convivem nas mesmas props (`SalesTabProps`,
`src/components/sales/shared.tsx`) — a aba Lojas é a que mais depende dos
dois ao mesmo tempo (perfil da loja + afinidade de produto comparam contra
a rede mesmo com uma loja só selecionada).

**Afinidade de produto é relativa, nunca absoluta** (`productAffinity()`):
participação do SKU nas vendas da loja ÷ participação nas vendas da rede —
o que evita que lojas grandes pareçam "afins" a tudo só por venderem mais
em volume absoluto.

**O heatmap "por dia da semana e horário" existe aqui** (ao contrário do
que foi descartado na aba Perdas de `/supply` por falta de dado) porque
`SalesTransaction.occurred_at` é real, por transação — o gap documentado
em `ingestion-worker-service/CLAUDE.md` ("Perda por dia de visita de
abastecimento") é sobre abastecimento, nunca existiu para vendas.

**Não construído** (fora do escopo desta primeira versão): "Perfis de
lojas" agrupados automaticamente por comportamento (spec seção 18 —
clustering, não um filtro) e PDVs/máquinas com alerta automático de
comportamento anômalo (seção 17's "criar alertas") — ambos exigiriam um
modelo dedicado, não só leitura+agregação como o resto da tela.

## `/` — Visão geral = Resumo Executivo Mensal

A rota `/` não tem mais KPIs soltos: é o resumo mensal da rede, só de **meses
fechados** (DRE da rede com `status = closed` no `accounting-service`; o
seletor "Competência" lista só esses). Dado + variação (vs. mês anterior e vs.
média dos 3 meses anteriores; `%` para valor, `p.p.` para margem) + insight +
ponto de atenção, e um PDF próprio (A4 paisagem, não é print da tela).

- **Motor puro** em `src/lib/overview/` (sem React/fetch; um spec por módulo):
  `compare` (delta %/p.p., `null` nunca vira 0), `materiality` (limiares
  **PREMISSA inicial, validar com a distribuição real antes de fixar** — AND de
  relevância no todo e no item), `product-behavior` (série de 4+ meses →
  estável/crescimento ou queda consistente/volátil/mudança recente/novo, e
  distribuição entre lojas), `kpis`, `stores`, `products`, `loss`, `cash-uses`,
  `insights` (≤ 6, todo texto vem de fato calculado), `reading`, `build`
  (`buildOverview` → o objeto único que a tela **e** o PDF renderizam).
  `assemble.ts` adapta respostas de API → entrada do motor; `use-monthly-overview.ts`
  compõe as queries existentes (fan-out de vendas por loja × mês, série de
  finance por loja, caixa/resumo da tesouraria por mês). Seção que falhou entra
  como `null` e vira "Indisponível".
- **Hierarquia executiva** (refino 2026-10-06): a tela responde "como foi o mês? o que mudou? onde? o que
  acompanhar?" — KPIs (com valor do mês anterior), Destaques (`highlights.ts`), "O que mudou" (`insights.ts`),
  lojas que EXPLICAM o crescimento/queda (`stores.ts` `explainers`), produtos em 5 colunas com análise por loja só
  no clique, perdas com "o que mudou" (`loss.ts` `lossChanges`), movimentos financeiros escolhidos pelos dados
  (`cash-uses.ts`), e "O que merece atenção no próximo mês" (`watchlist.ts`, ≤ 5, só observação, nunca causa).
  Ordem dos insights = `ranking.ts` `rankScore` (impacto R$, representatividade, recorrência, lojas) — NÃO o tamanho do %;
  limiares são PREMISSA a validar. Percentual que distorce mostra a base ("1 → 12 un.", `needsBase`/`baseText`).
  Dado × zero × sem dados: `null` = sem dados (cartão "Sem dados"), erro de busca = "Indisponível", zero só com fonte existente.
  O PDF repete a mesma lógica em 6 páginas no tema escuro do painel (`pdf/report.tsx`: fundo carvão, cards arredondados, magenta de destaque, logo `lockup-dark.png` via `meta.logoSrc`), não imprime a tela.
- **Preço × volume** (`lib/overview/price-volume.ts`): decompõe a variação da receita de produtos por SKU em efeito
  preço `(p1−p0)·q1` e volume `(q1−q0)·p0`, com preço REALIZADO = receita ÷ unidades do mês (vem das vendas, porque o
  catálogo só tem preço datado de parte dos produtos). Reajustado = variou ≥ 3% com ≥ 10 un. nos dois meses (PREMISSA).
  Compara unidades dos reajustados × demais e cita o calendário (31 × 30 dias); é observação, nunca causa. Faturamento
  caindo com reajuste entra em "O que acompanhar". set/2026 real: 51 reajustados (50 subiram), unidades −14,2% nos
  reajustados × +2,4% nos demais, preço +R$ 5,3 mil, volume −R$ 8,9 mil (estimativa).
- **Notas vencidas** (`lib/overview/overdue.ts`): "A receber vencido" vira "Notas vencidas e não pagas" com cliente e dias de atraso
  (notas em aberto de `GET /billing/invoices?status=issued`). Ascenty e Rolls-Royce pagam 30 dias após a emissão. O billing grava
  `paid_on` = `due_on` nas notas baixadas (não é a data real do banco), então o histórico não mostra o atraso habitual. Atraso de até
  `OVERDUE.SHORT_DAYS` (5, PREMISSA) é tratado como baixa pendente (extrato não lançado) e NÃO entra em "O que acompanhar"; só o que passa disso.
- **Reajustes de preço no mês** (`price-changes-card.tsx`, página 3 do PDF; `buildPriceChanges` em `price-volume.ts`): lista produto a
  produto (preço antes → depois, unidades antes → depois, margem, Δ receita) dos SKUs reajustados, além da frase-resumo nos insights.
  O preço é o REALIZADO (receita ÷ unidades, com descontos), não a etiqueta: por isso aparece "R$ 15,71" onde o cadastro diz R$ 15,90.
  Para mostrar a etiqueta seria preciso ler as transações; o histórico datado do catálogo (`price_version`) ainda está incompleto.
  O topo do bloco é o SALDO do reajuste (`priceImpactReading`, `PriceImpact`): faturamento dos reajustados antes → depois, margem de
  contribuição em R$ e % (custo datado do catálogo; só SKUs com custo), ganho de preço × efeito das unidades na margem (fecham com a
  variação), unidades dos reajustados × demais. set/2026 real: faturamento −R$ 3,6 mil (−6%), margem +R$ 1,4 mil (46% → 52%), unidades −14%.
  Texto em linguagem simples ("lucro bruto" = sobra após o custo), com 3 quadros pergunta→resposta: "Vendeu menos — o lucro compensou?",
  "E se os dois meses tivessem o mesmo número de dias?" (média por dia + projeção, ESTIMATIVA) e "O ticket médio subiu — e o reajuste explica?"
  (`ticket.ts`: faturamento ÷ compras, regra de compra da tela de Vendas; o ticket sem o reajuste = mesmas compras aos preços do mês anterior).
  O ticket vem das transações por loja (`useGetNetworkSalesTransactionsQuery`, mês e anterior). Ago e set/2026 vieram SEM cupom: cada linha
  conta como uma compra e a tela avisa que o ticket é aproximado. Real: ticket R$ 9,07 → R$ 9,58 (+5,7%), reajuste explica R$ 0,51 dos R$ 0,51.
- **Linguagem simples** (relatório para sócios que não são de números; do CEO à operação): PDF e tela em CAMADAS. Página 1 = "O mês em 1 minuto"
  (`brief.ts`: frase-resumo, 6 cards com pergunta e semáforo, "3 coisas para saber"); cada bloco abre com uma pergunta, a resposta em uma frase e
  "para Sócios/Operação/Financeiro" (`buildPageIntros`); "O que cada área pode olhar" (`areas.ts`, PERGUNTAS, nunca ordens nem causa, ≤ 3 por área);
  "Como ler este relatório" (glossário em `plain.ts`). `plain.ts` guarda o dicionário (`KPI_PLAIN`, `GLOSSARY`), `friendlyMoney` ("R$ 120 mil"),
  `moreOrLess` e `plainify` (troca DRE/CAPEX/SKU/p.p./margem de contribuição… no texto de apresentação; o motor continua com os nomes técnicos).
  Semáforo `trafficLight`: melhor / parecido / pior que o normal (mês anterior + média 3 meses; faixa `PLAIN.SAME_BAND` 3% e 1 p.p., PREMISSA);
  se as duas comparações discordam vale "parecido"; sem dado = "sem dados", nunca "parecido". `brief.spec.ts` varre todo o texto atrás de jargão e de causa.
- **Definições fixas** (aparecem na tela): Faturamento = receita líquida do DRE;
  Margem operacional = resultado operacional ÷ receita líquida; perda sempre com
  os dois denominadores (÷ receita líquida, ÷ custo abastecido); participação por
  motivo/SKU usa a soma do próprio detalhamento (nunca > 100%); CAPEX =
  **o que o Fluxo de caixa classifica como investimento** (tesouraria, `nature = investment`),
  que inclui o que Bárbara e Josias pagam no cartão de sócios (categoria "Investimento (cartão
  sócio)", ex.: R$ 24.867 em ago/2026). Os itens de CAPEX por loja do `capex-service`
  (`fixed`/`initial` datados; `operating_expense` é despesa, fora) aparecem à parte e NÃO se somam —
  em ago e set/2026 não havia nenhum item datado, e o card mostrava R$ 0 enquanto o Fluxo de caixa
  tinha R$ 26.703 (ago) e R$ 1.311 (set); compras de estoque = categoria `Estoque` da tesouraria (caixa),
  distinta do CMV do finance — nunca somadas; aportes de investidores nunca são
  receita.
- **PDF**: `src/lib/overview/pdf/report.tsx` (`@react-pdf/renderer`, carregado só
  no clique em `export-pdf-button.tsx`). Helvetica padrão não tem `−`/setas/`≥`:
  `t()` troca por equivalentes (`→` vira `->`). Cada exportação chama
  `POST /accounting/monthly-summary/:period` (hash do conteúdo + parâmetros);
  a versão sobe só se a base do DRE ou o conteúdo mudaram.
- **Produtos em teste** (`lib/overview/tests.ts`, `components/overview/tests-card.tsx`):
  não há cadastro; a lista é DERIVADA do abastecimento (9 meses, fan-out por loja):
  SKU cujo primeiro abastecimento na rede caiu nos últimos 3 meses, depois do início
  do histórico importado, **em qualquer número de lojas** (o teto de 9 lojas que eu tinha chutado
  escondia Irreal/pipoca/batata-doce, abastecidos em 12-13 de 20). Constantes `TESTS` são PREMISSA provisória
  (validar com a lista real). O supply guarda só o MÊS, não a data da visita. Sinal
  (positivo/atenção/mais dados) vem com os fatos ao lado, nunca aprovado/reprovado.
- **Troca de código de barras** (`lib/overview/sku-match.ts`, `sku-links-card.tsx`):
  SKU "sem histórico" ou em teste é comparado por nome (Jaccard sem pesos/volumes,
  mín. 50%) com o catálogo, e só sugere quando o código antigo já vendia (pico ≥ 10 un./mês) e na competência caiu a ≤ 50% desse pico ("passagem de bastão", `SKU_MATCH`; calibrado nos pares reais de set/2026: Snickers 314→58 entra, Monster 473 × 269 e sabores de leite em pó, que vendem juntos, não). A tela PERGUNTA ("É o mesmo produto"/"Não é") e grava em
  `products-service` (`SkuLink`, rota `/sku-links`, `products:write`). Vínculo "same"
  soma o histórico de vendas/abastecimento ao SKU novo (custo continua pelo código
  original de cada venda); "different" silencia a sugestão. Nada é vinculado sozinho; "Decisões já tomadas" no card permite desfazer.
- **Distribuição por loja**: a coluna "Por loja" de cada produto abre o detalhe (lojas
  que venderam, mês anterior, e lojas sem venda no mês). "Sem venda" não prova que a
  loja não tem o produto no mix. O texto diz o que se distribui ("70% do aumento de
  unidades veio de 2 lojas").
- **Lacunas declaradas na própria tela** (`PHASE1_LIMITATIONS`): investidores só têm
  aporte, notas fiscais a emitir não existem, "a vencer" é o total em aberto
  (sem corte em 30 dias), categorias de despesa são rótulo livre do de-para.
- Drill-down: links "Ver … →" levam às telas especializadas sem período
  (`/supply` e `/commercial-intelligence` guardam período/aba em estado local;
  só `/finance/pnl` lê `?period=`).
- **Competência**: só meses com DRE da rede `closed` **e** ≤ `lastCompleteMonth()` (o
  mês em curso já apareceu como "closed" com receita zero). Se o mês anterior ainda
  está `open` no DRE, a tela avisa que a comparação é provisória.
- **"Cresceu/recuou" por loja = venda da loja (sales-service), não receita líquida do DRE.**
  O DRE por loja mistura venda com receita de contrato (mensalidade, coffee break,
  frutas) que entra por fontes diferentes de um mês para o outro; em set/2026 ele dizia
  "0 cresceram, 16 recuaram" enquanto as vendas mostravam lojas crescendo (JDI02 +22%,
  VIN01 +9%, SUM01 +8%). `buildStoreSummary` usa venda quando os dois meses estão
  importados (`basis: "vendas"`) e cai para o DRE (`basis: "dre"`, dito no card) senão.
  Margem, perdas e resultado das "Pontos de atenção" continuam do DRE. O insight
  `stores-vs-network` mostra venda das lojas × receita líquida da rede lado a lado quando
  divergem ≥ 5 p.p. As listas de contribuição só citam lojas classificadas como cresceu/recuou.
- **Venda importada pela metade** (`lib/overview/sales-coverage.ts`): loja com < 25% dos
  SKUs que costuma vender (mediana dos outros meses, ≥ 20 SKUs) é marcada e a tela avisa
  que faturamento/DRE do mês podem estar abaixo do real. Caso real: ago/2026 tinha 7
  lojas com 1 linha (vs. 58–90) — a importação de 19/09 foi anterior à correção de
  `completeChunk` (23519e5, 30/09) e finalizou um lote parcial; o arquivo original
  (R$ 100.486,64, 11.080 linhas, 20 lojas) estava completo, o banco guardou R$ 63.160
  (6.746 transações). Remédio: reimportar o arquivo em `/ingestion` e depois "Reapurar e
  fechar" o DRE do mês. Fechar o DRE antes disso congela a receita baixa.
- Conferido contra o stack real (leitura direta dos serviços, set/2026): DRE, caixa,
  perdas (R$ 4.145; 20/20 lojas com reconciliação incompleta — aviso na tela),
  abastecido e a receber batem com as fontes. O motor roda sobre esses dados reais sem erro.

## `/commercial-intelligence` — Inteligência Comercial

Página somente-leitura, item de Operação logo depois de Vendas (`sales:read`).
**Redesenhada em 2026-09-24** (`add-commercial-intelligence-restock-mix`,
pedido explícito do operador) em torno de duas perguntas operacionais — "o que
devo levar para esta loja?" e "estou com os produtos certos nesta loja?" —
substituindo como experiência primária as seis abas antigas (Visão geral,
Produtos, Comportamento, Lojas, Combos, Central de oportunidades), paradas
desde 2026-09-19 aguardando meses reais importados e o `Cupom` conferido
(`add-commercial-intelligence-page`).

**Terceira aba, "Qualidade do saldo"** (`add-stock-quality-phase0`,
`src/components/commercial-intelligence/balance-quality/`): mede quanto o saldo
do sistema pode ser confiado, comparando **contagem física × saldo** e
**consumo entre visitas × venda registrada**, com as lacunas ao lado. Lê
`GET /inventory/audit/balance` e `GET /ingestions/gaps` (ambos `inventory:read`,
cliente em `src/lib/api/balance-audit.ts`). É da **rede inteira**: o seletor de
loja some nessa aba, porque as outras duas é que dependem de loja.

O que ela **se recusa a afirmar**, de propósito:

- **Nenhum veredito nem tolerância.** Nada é "aceitável/inaceitável/passou/
  falhou"; o backend não devolve campo assim e há teste que varre o texto
  renderizado atrás dessas palavras. A tolerância só será definida com o dono
  depois de ver as distribuições reais.
- **Nem verdade física.** Um aviso fixo diz que consumo e venda vêm do mesmo
  PDV, então a concordância valida o alinhamento dos dados, não o estoque real.
- **Faixas de giro/saldo são do backend**, vêm na resposta (`presentation`,
  `provisional`) e são mostradas como "provisórias, só para fatiar" — o navegador
  não tem cópia delas.
- **"Venda não importada" ≠ "sem venda"**: loja sem mês de venda carregado tem giro
  desconhecido; dizer que o SKU não vende seria falso.
- **Toda cifra mostra sua contagem de linhas e o período.** Linha sem contagem
  aparece como cobertura (ao lado de quantas foram contadas), nunca como "igual".
- Estados via `RequestState` (carregando, vazio — "ainda não há dados de visitas",
  erro, sem permissão). Sem `inventory:read` nada é pedido: `skip` nas duas queries.

**O código antigo não foi apagado, só desligado da tela** — pedido explícito
do operador para reaproveitar em fases futuras: `src/lib/
commercial-intelligence/*` (motor de medição, 95 parâmetros, disponibilidade,
qualidade) e `src/components/commercial-intelligence/{combos-tab,
overview-tab,quality-tab,held-tab,...}` continuam completos, só não estão mais
importados por `page.tsx`. `synthetic.ts` (`partitionSynthetic`/`isSynthetic`)
é o único módulo do motor antigo reaproveitado diretamente pelo novo — ver
abaixo.

### Abastecimento Inteligente — "o que levar"

Por loja × SKU: uma quantidade sugerida sempre como **faixa** (nunca um número
solto — "faixa estimada 25–35, sugestão operacional 30"), uma ação (aumentar/
manter/reduzir/não abastecer/testar/dados insuficientes) e uma confiança.
**Nunca infere estoque atual** — nenhum cálculo de "estoque alvo − estoque
atual" nem "abastecido − vendido − perdido"; o rótulo é sempre "quantidade
recomendada de abastecimento", nunca "reposição necessária" (TouchPay
continua sendo a lista de pick operacional; esta tela só sugere o número).
"Gerar lista de abastecimento" separa as linhas em **quatro** grupos —
Abastecer / Não abastecer / Sem dados suficientes / Testes — dados
insuficientes nunca cai sob "não abastecer": são evidências diferentes
(decisão vs. falta de dado), e misturá-las esconderia do operador que a IA
não tem base para opinar.

### Mix das Lojas — "são os produtos certos"

Classifica cada SKU já presente na loja (manter/explorar/reduzir/suspender
abastecimento/avaliar retirada/dados insuficientes) e separa "Oportunidades
de novo mix" — SKUs ausentes na loja com bom desempenho em outras lojas da
rede (`computeNetworkAffinity`, não o `productAffinity` de
`sales-insights.ts`, que só teria 1 mês de `SalesTransaction` por vez).
Confiança de oportunidade nunca chega a "alta" — teto estrutural. Uma loja só
conta como "bom desempenho" se não tiver sinal ativo de perda (suspender/
reduzir/avaliar retirada ou permanência) para aquele SKU; e um SKU sob
`avaliar_retirada_rede` em qualquer loja nunca vira oportunidade em nenhuma
outra — a Central de Perdas já está dizendo para reconsiderar esse produto na
rede, recomendá-lo como "novo mix" em outro lugar contradiria isso.

**As duas abas sempre consomem a Inteligência de Perdas como camada de
precedência, nunca re-derivam a regra**: um sinal ativo de
`suspender_abastecimento`/`avaliar_retirada_*` vence qualquer evidência de
venda (inclusive `dados_insuficientes`); `reduzir_abastecimento` sempre
escala a fórmula para baixo. A janela de análise é sempre a mesma da
Inteligência de Perdas (`resolveAnalysisWindow`), nunca uma janela própria.

### Motores puros

`src/lib/commercial-intelligence/restock-mix/` (`types`, `series`, `trend`,
`restock/*`, `mix/*`): mesmo padrão do `@/lib/loss-intelligence/` — sem
React/fetch/storage, só `import type` de `lib/api/*`; cada motor com seu
próprio `parameters`/`parameter-docs`/`env`/`parameter-rows`/`logic-version` e
namespace de env var (`NEXT_PUBLIC_RESTOCK_*`/`NEXT_PUBLIC_MIX_*`, distinto de
`NEXT_PUBLIC_LI_*`/`NEXT_PUBLIC_CI_*`). Todos os parâmetros são "provisório"
(mesma filosofia do motor antigo — guardrail escrito antes de ver uso real,
nunca ajustado para fazer aparecer resultado); calibração via
`/commercial-intelligence/calibration` (2 abas, uma por motor), acessível pela
folha "Regras de negócio" no cabeçalho (`BusinessRulesSheet`, mesmo componente
do motor antigo, agora combinando as regras de negócio dos dois motores numa
única folha).

### Parametrização — nível de par, mínimo crítico e quantidade atual

`page.tsx` busca `inventory-service`'s `MinimumLevel` rede inteira (fan-out
por loja, `useGetNetworkMinimumsQuery`, mesmo padrão de sales/supply) e
monta um lookup `storeId:sku`, passado aos dois motores como
`parametrizacaoFor`. **`quantidadeAtual` é só referência, exibida na UI —
nunca entra na fórmula de nenhum dos dois motores** (`quantidadeSugeridaIA`,
`faixaEstimada`/`necessidadeEstimada`, `deltaVsParametrizado` são todos
calculados sem ela): é um valor observado, pontual, sem garantia de estar
atualizado, e a regra de negócio explícita do operador (2026-09-24) é nunca
inferir estoque atual por subtração. **`minimoCritico`/`nivelDePar` também
não alimentam `quantidadeSugeridaIA`** — a sugestão vem só da tendência de
venda (`trend.estimativaCentral`/`faixaEstimada`, `restock/engine.ts`);
`nivelDePar` alimenta só a exibição (`deltaVsParametrizado`, a coluna "Δ vs.
parametrizado"), nunca o cálculo da sugestão em si.

O motor de reposição também aplica um "lean" de arredondamento — quando a
evidência é mais fraca, troca o centro da faixa estimada (`estimativaCentral`)
por um ponto mais perto do PISO da própria faixa (`faixaEstimada.min`), nunca
do `minimoCritico` parametrizado — controlado por três parâmetros `business`
em `rounding` (`restock/parameters.ts`): `shortShelfLifeDays` (produto com
validade curta demais para justificar excesso), `lowAproveitamentoThreshold`
(histórico de baixo aproveitamento do abastecimento anterior) e
`leanToMinFraction` (o quanto do caminho entre o piso e o teto da faixa o
lean percorre). Um terceiro gatilho, confiança baixa ou insuficiente
(`confianca === "baixa" | "insuficiente"`), também dispara o lean — não é só
validade curta ou baixo aproveitamento. Só se aplica no ramo de fórmula
normal (tier 3/4) — nunca sobrepõe um hard-stop/reduce/evidence-gate já
decidido por um tier mais alto.

### Fluxo de dados e guarda de dado sintético

Página sempre busca a rede inteira (nunca por loja) — trocar de loja no
seletor é filtro client-side, nunca uma nova requisição, mesmo padrão do motor
antigo; trocar de loja também fecha qualquer drawer aberto (nunca deixa o
conteúdo de uma loja anterior visível sob o nome da nova). `partitionSynthetic`/
`ALLOW_SYNTHETIC` (reaproveitados de `src/lib/commercial-intelligence/
{synthetic,env}.ts`) excluem loja/produto marcado antes de qualquer motor
rodar. Erro de qualquer fonte (lojas, produtos, vendas, abastecimento,
reconciliação, custo datado) aparece no mesmo `RequestState`, com "Tentar
novamente" reexecutando todas as consultas que falharam — nenhuma falha
silenciosa vira "sem dados".

### Gap conhecido

`computeNetworkAffinity` (mix) e o scan de oportunidades são
O(lojas×SKUs)² — seguro no tamanho de rede atual (~24 lojas), mas deve ser
revisitado (indexação por `Map`, não recomputar tendência/margem por
loja-alvo) antes da rede crescer bastante além disso.

### Motor antigo — preservado, não usado pela tela (fases 2-5 futuras)

- **Motor puro** em `src/lib/commercial-intelligence/` (`types`, `parameters`,
  `parameter-docs`, `logic-version`, `env`, `confidence`, `availability`,
  `synthetic`, `dataset`, `kpis`, `loss-index`, `quality`): sem React, fetch nem
  storage; só imports relativos ou `import type`; TS "apagável" (sem
  enum/namespace), para rodar em Node puro. `env.ts` é o único arquivo que lê
  `process.env` e não entra no barrel `index.ts`;
  `components/commercial-intelligence/runtime-parameters.ts` é quem o converte
  nos parâmetros da página. Nada aqui toca `localStorage`.
- **Parâmetros** (`CommercialParameters`, 95 valores): um objeto tipado com
  padrões documentados. Cada um tem **tipo** (`business`/`quality`/`analytic`) e
  documentação completa em `PARAMETER_DOCS` (finalidade, fórmula, unidade, motivo
  do padrão, onde é usado, efeito de subir e de descer) — tipada sobre todo
  caminho numérico, então um parâmetro sem documentação não passa no `tsc`. Toda
  função do motor recebe `p` como argumento — nenhum módulo guarda limiar próprio.
  Override por `NEXT_PUBLIC_CI_<CAMINHO>`
  (`coupon.exclusionCoverage` → `NEXT_PUBLIC_CI_COUPON_EXCLUSION_COVERAGE`), lido
  em **build**: o Next só inlina `process.env.NEXT_PUBLIC_X` escrito literal, por
  isso `env.ts` lista as 95 uma a uma (gerado a partir de `PARAMETER_PATHS`, e
  conferido contra ele). Em `admin-prod` um valor novo pede build arg, que o
  `docker-compose.yml` ainda não repassa: lá vale o padrão. Valor inválido, fora
  do intervalo ou que quebre um par ordenado (piso > teto, cenário conservador >
  esperado > otimista) é ignorado e reportado no aviso — nunca derruba a página.
  **Todos são "provisório"** até a calibração (`APPROVED_PARAMETERS` está vazio):
  são guardrails escritos antes de ver cupom real, para evitar falso sinal sem
  bloquear análise útil — **nunca ajustados para fazer aparecer resultado**. Cada
  recomendação registrará a versão da lógica (`LOGIC_VERSION`,
  `ci-logic/0.1.0-provisional`) e os valores em vigor, para que mudar um valor não
  reescreva o que uma recomendação anterior usou.
- **Disponibilidade da análise** (`assessAvailability`): cada análise (combos,
  retorno dos produtos, perdas, comportamento por horário, lojas parecidas,
  comparação e histórico) sai como "Análise disponível", "Disponível com
  ressalvas" ou "Dados insuficientes", com os indicadores que decidem e a
  ressalva escrita. Só bloqueia o que torna a análise impossível ou enganosa; o
  que só enfraquece continua disponível com confiança menor. Vive na aba
  "Qualidade dos dados"; os limites são texto de referência, não ajuste.
- **"Estimativa de impacto"** (antes "captura da lacuna"): três cenários —
  conservador 20%, esperado 40%, otimista 60% da diferença observada recuperada —
  sempre com a frase de que é premissa de potencial, não resultado medido nem
  garantido, e o valor Observado ao lado do Estimado. Sem lacuna observável, "impacto
  não estimável".
- **Portão de cobertura de cupom** (`assessCouponGate`). Cobertura da loja =
  linhas concluídas com cupom ÷ todas as linhas concluídas da loja; da rede =
  soma ÷ soma (agregada: loja grande pesa mais, não é média de percentuais); em
  receita, só informativa. Loja < 80% sai das análises de cesta e é listada;
  rede ≥ 95% sem loja excluída = aberta; rede em [80%, 95%) ou loja excluída =
  parcial (confiança de cesta ≤ Média); menos de 300 cestas elegíveis ou < 5%
  das cestas com 2+ produtos = bloqueada. Linha sem cupom **nunca** vira cesta de
  1 item (inflaria o lift). Cupom com linhas a mais de 30 min é reaproveitado:
  cesta descartada e contada. A aba Combos mostra isso, a cobertura por loja com
  os dois limites desenhados e o diagnóstico cupom × sem cupom (categoria, valor
  da linha, hora, modelo de máquina, PDV, com a diferença entre as duas
  distribuições) que alimenta a calibração — só mede, não recomenda.
- **Margem só sobre linha com custo resolvido** (`computeMarginBreakdown`): a
  receita e o custo de um SKU sem custo saem juntos e o SKU é contado; sem custo
  carregado, ou sem nenhuma linha resolvida, a margem é `null`, nunca 0 nem 100%.
  Receita, ticket e itens por compra usam a definição do `/sales`
  (`groupBaskets`): paridade verificada. **Difere de propósito do `/sales`** com
  SKU sem custo: o `computeMargin` de lá mantém a receita e tira só o custo,
  inflando a margem (achado de 2026-09-19; a correção é change à parte).
  "Margem após perdas" só existe onde há margem **e** reconciliação, com "sobre N
  de M lojas"; loja sem reconciliação do período é perda desconhecida, não zero.
- **Hora de parede via UTC** (`wallClock`): `occurred_at` é o relógio da loja
  gravado como se fosse UTC; `getHours()` num navegador em BRT desloca −3h e
  manda venda de 00:00–02:59 para o dia anterior. O mesmo defeito está no
  `heatmapData` e no perfil de loja do `/sales` (follow-up; não corrigido aqui).
- **Fluxo de dados**: hooks em duas ondas — lojas, produtos e transações da rede
  primeiro; comparação, custos datados (chaveados na lista de SKUs da rede, do
  período e do de comparação), reconciliação de 6 meses e abastecimento só depois
  que as transações resolvem, para não abrir ~100 requisições juntas. **Trocar de
  loja não faz requisição nenhuma**: a rede inteira já está carregada e o escopo é
  filtro no cliente. Fonte sem permissão nem é pedida e vira "Sem permissão"; só
  as transações (ou o catálogo) derrubam a página, com "Tentar novamente".
  `getNetworkReconciliationRange` engole erro por loja: uma falha ali aparece como
  perda desconhecida.
- **Guarda de dado sintético** (`isSynthetic`/`partitionSynthetic`): loja ou
  produto com o marcador (`sintético`, `synthetic`, `[teste]`) fica fora de todo
  número no gateway real, e o aviso diz o que saiu. Só
  `NEXT_PUBLIC_ALLOW_SYNTHETIC=true` (execução contra um mock) os mantém — rotulados.
- **Confiança graduada** (`computeConfidence`): pontuação sobre o que se aplica
  mais tetos duros — cobertura entre 80% e 95% → Média; SKU com estoque
  inconsistente e perda como motor → Baixa; contradição entre as metades, < 7
  dias com venda, loja com < 100 compras, conclusão por aproximação → Baixa. Sem
  evidência mínima: "Dados insuficientes para recomendar X: … (mínimo N)". Os pesos
  da régua (`RUBRIC_POINTS`) são a própria régua; os limiares que escolhem o
  patamar são parâmetros.
- **Limites que a página mostra**: sem estoque diário nem histórico de promoção
  (elasticidade não é medida), sem data de visita (perda só mensal por loja ×
  produto), catálogo com só 4 categorias (as ~22 marmitas estão como snack; nada é
  deduzido do nome) e um único mês completo com detalhe (sem estabilidade entre
  meses). O filtro de Categoria existe, mas desligado até as análises que o usam.
- **Sem suíte de testes no app.** O motor foi verificado por script descartável
  **fora** do repo (Node 24 + um hook `module.registerHooks` que resolve `.ts` e
  `@/`), com fixtures calculadas à mão — 13 checagens do núcleo (rodadas em UTC,
  America/Sao_Paulo e Asia/Tokyo) e 19 das regras (parâmetros, tipos,
  disponibilidade) —, e a tela por um gateway simulado (dados 100%
  `[SINTÉTICO]`, fora de qualquer banco). Trazer isso para dentro do repo é a
  change `add-admin-test-runner`.
- **Deriva de documentação vista, não corrigida aqui**: `add-sales-transaction-
  detail` ainda diz que `Cupom` não é lido (o schema e o código já persistem), e,
  pela exploração de 2026-09-19, `gateway-service/CLAUDE.md` documenta rotas de
  preço e estoque central que o gateway não implementa.

## `/products/sync` — Sincronizar precificação

Tela (link em `/products`, exige `products:write` para aplicar) que lê o `precificação(1).xlsx` no
navegador, mostra uma PRÉVIA (nada é gravado) com produtos novos, mudanças de custo e de preço e
avisos, e só aplica o que o operador marcar, com as duas datas de vigência. Detalhes de regra em
[products-service/CLAUDE.md](../../../backend/apps/products-service/CLAUDE.md). Existe porque o
PDV passa a vender produto antes de ele estar no catálogo e as linhas são rejeitadas como
`unknown_sku` (set/2026: 662 de abastecimento e 77 de vendas, 25 códigos). Não foi vista no
navegador logado; typecheck, lint, specs do parser e a prévia contra o catálogo real passam.

### Fornecedores da planilha (`components/catalogue-sync/supplier-review.tsx`)

Cartão em `/products/sync` (precisa de `products:write`): lista os nomes de fornecedor da planilha com quantos produtos do catálogo vincularia. O painel **sugere** (igual ao cadastro, alias já confirmado, ou nome que contém/está contido) mas nunca pré-seleciona; o operador vincula, cria fornecedor (nome + categoria) ou pula, e confirma num diálogo. Ao confirmar, cada grafia vira alias do fornecedor (a próxima sincronização casa sozinha) e `Product.supplier_id` é gravado por `PATCH /products/:id` — só nos produtos sem fornecedor. Lógica pura e testada em `lib/catalogue-sync/supplier-review.ts`. Em 2026-10-06 a planilha tinha 26 nomes (249 linhas, 248 SKUs no catálogo); 0 casavam por alias, ~9 tinham candidato por semelhança.

## `/products` — Cadastro de produtos

Tela majoritariamente somente-leitura (catálogo, custo e preço do dia,
margem) — a única capacidade de edição é o diálogo "Editar embalagem"
(`add-restock-mix-operational-revision`, tarefa 14), escopado só aos 3
campos de embalagem (`unitsPerPackage`/`packageType`/`fractionable`).
`ProductView`/`toView()` em `products-service` ainda não devolve a maior
parte dos outros campos nullable de `Product` (`subcategory`, `ean`,
`supplier_id`, `net_weight`, `ncm`, `cest`, `shelf_life_days`, `status`) —
gap conhecido, deixado de propósito pela tarefa 2 desta mudança. Um editor
futuro para esses campos precisa primeiro de trabalho no backend
(`toView()` e o tipo `ProductView`), não só de frontend.

## `/ingestion` — "Arquivos no Drive" (`add-drive-ingestion-source`)

Seção abaixo do envio manual: os relatórios que caem no Google Drive todo mês,
achados e conferidos pelo `ingestion-worker-service` (ver
[o CLAUDE.md dele](../../../backend/apps/ingestion-worker-service/CLAUDE.md)).
**A tela nunca importa sozinha — só o clique em "Importar".** Arquivos:
`src/components/ingestion/{drive-files-section,drive-file-row,drive-import-dialog}.tsx`,
`src/lib/drive-findings.ts` (texto em português por `code` de achado; a
`message` em inglês do backend é só rede de segurança para um código que a
tela ainda não conhece) e os seis endpoints em `src/lib/api/ingestion.ts`
(tags `DriveFile`/`DriveStatus`).

- **Importar** fica desabilitado até haver tipo e período válidos e para
  arquivo bloqueado, duplicado ou sintético; o motivo aparece sob o botão. Tipo
  e período nascem da sugestão, mas o que a pessoa escolhe vale mais, e trocar
  qualquer um chama `POST /:id/validate`, que reavalia pelos agregados
  guardados — sem baixar o arquivo de novo.
- **`needs_validation`** abre o diálogo com as inconsistências (loja, cobertura,
  datas faltando) e o "Revisei…"; o corpo do import leva
  `confirm_validation.content_sha256` **do hash que ela viu**. **`would_replace`**
  pede a confirmação de substituição (`confirm_replace: true`). O servidor
  refaz toda conferência e pode recusar; a mensagem dele é a que aparece.
- Sem `ingestion:upload` não há nenhuma ação (as linhas continuam visíveis);
  com o Drive não configurado, só "Drive não configurado".
- **Polling** (3s) usa o padrão lint-safe de sempre (efeito por booleano
  derivado + `setInterval` + `refetch`), liga enquanto há scan, validação ou
  import em andamento e por 60s depois de uma ação, e **desiste após 15 min
  contínuos**: um job perdido na fila ou um worker parado deixaria o arquivo
  "em andamento" para sempre, e cada aba aberta consultaria o servidor sem fim.
  `Date.now()` só dentro de callbacks (regra de pureza do React Compiler).
- **Layout — dois pegadores**: o `TableCell` do shadcn é `whitespace-nowrap`,
  então todo texto corrido dentro de uma célula precisa de `whitespace-normal`;
  e o container de rolagem do `Table` conta para a largura mínima do `main`
  (flex sem `min-w-0`), então o cartão da tabela leva `contain-inline-size` —
  sem isso, em janela abaixo de ~1300px a tabela estica a página inteira em
  vez de rolar dentro do cartão.
- Verificado no browser contra um gateway **mock sintético** (nunca contra a
  pasta real; a aceitação real é a tarefa 13.3 da change): todos os estados,
  os corpos das requisições, claro/escuro e janela de 1170px.

## `/purchases` — Compras e Fornecedores (`add-supplier-product-analysis`)

Abas "Por fornecedor" / "Por produto", filtros (categoria, fornecedor, produto, loja), período com seta
de mês anterior e "Comparar com: mês anterior | média 3 meses". Todos os números e insights vêm de
`GET /analysis/*` no gateway → `intelligence-service` (`src/lib/api/supplier-analysis.ts`); o painel só
renderiza. Cada cifra é `Figure` (disponível **ou** com o motivo da ausência): nada que falta vira 0
(`lib/supplier-analysis/format.ts`). Compras ainda não existem (Fase 2: nota fiscal + lançamento
manual), então valor/unidades compradas dizem "Sem histórico de compras" e os insights que dependem
delas não são gerados. Com loja filtrada, compras (da rede) ficam "—". Produto só pertence a fornecedor
pelo vínculo cadastrado (`link-supplier.tsx` grava `supplierId` via `PATCH /products/:id`); hoje 0 dos
255 produtos têm vínculo, então o modo fornecedor começa vazio até alguém vincular. Sem botões de
Importar nota/Lançar compra nem itens Pedidos/Notas fiscais no menu até a Fase 2.

## `/purchases` — Compras e Fornecedores (`add-supplier-product-analysis`)

Grupo "Compras" no menu (`supply:read`). Abas **Por fornecedor / Por produto**, filtros (categoria, fornecedor, produto, loja), período com mês anterior, comparação *Mês anterior | Média 3 meses*. Consome `GET /analysis/{suppliers/:id,products/:sku,cross}` do gateway → `intelligence-service` (`lib/api/supplier-analysis.ts`); **o frontend só renderiza**: situação por loja, "perda acima da média" e insights (com `evidence` e rótulo FATO/MÉTRICA DERIVADA/ESTIMATIVA) vêm do backend, com limiares em `parameters.analysis` (provisórios).

- Cifra é `Figure` (`available` ou `reason`), nunca número solto: sem compra registrada vira "Sem histórico de compras" (`lib/supplier-analysis/format.ts`), nunca 0; parcial leva `~`. Compras são da rede: com loja filtrada ficam "—".
- Não existe modelo de compras (Fase 2: nota fiscal + lançamento manual). Por isso não há botões "Importar nota fiscal"/"Lançar compra" nem itens Pedidos/Notas fiscais no menu.
- Produto só pertence a um fornecedor pelo vínculo cadastrado (`Product.supplier_id`, gravado por `components/supplier-analysis/link-supplier.tsx`); nada é inferido. Na base real nenhum produto tinha vínculo (2026-10-06), então "Por fornecedor" nasce vazio até vincular.
- Gaps: comparação entre fornecedores do mesmo produto depende de compras; venda/abastecimento passa de 100% porque a venda do mês também sai de estoque anterior (ver intelligence-service); sem gráfico de linhas na evolução (só tabela).

## Scripts

`pnpm dev` (Turbopack) / `build` / `start` / `lint` / `typecheck`. ESLint flat
config (`next lint` foi removido no Next 16) que importa o flavour
compartilhado `eslint.frontend.mjs` da raiz. Pacote: `@agiliz/admin`, membro do
workspace pnpm — instale sempre pela raiz.

## Docker

`Dockerfile` multi-stage (`base → dev → build → prod`). O estágio `prod`
roda `node server.js` a partir de `.next/standalone` (não nginx — Next
precisa de um servidor Node em runtime, diferente do `site` estático).

**Gotcha resolvido**: o `server.js` do modo standalone lê `process.env.HOSTNAME`
como endereço de bind; o Docker seta `HOSTNAME` automaticamente para o ID
do container, então sem `ENV HOSTNAME=0.0.0.0` no Dockerfile o servidor
só escuta no IP do container, não em loopback — quebra o healthcheck.
Além disso, o `wget` do Alpine resolve `localhost` para `::1` primeiro
(Next só escuta em IPv4), por isso o healthcheck do `docker-compose.yml`
usa `http://127.0.0.1:3000` explicitamente, não `localhost`.

**Gotcha do monorepo**: com pnpm workspace, o build roda com a **raiz do repo**
como contexto (`context: ../../..`) e o output standalone preserva a forma do
workspace — `server.js` fica em `.next/standalone/frontend/apps/admin/`, e seus
`node_modules` são symlinks apontando para o store virtual pnpm na raiz do
bundle. Por isso o Dockerfile copia a árvore inteira e roda
`node frontend/apps/admin/server.js`: achatar quebra todos os symlinks e o
servidor morre com "Cannot find module 'next'". `outputFileTracingRoot` no
`next.config.ts` fixa essa forma.

`docker-compose.yml`: serviços `admin-dev` (porta `3000`) e `admin-prod`
(porta `8080:3000`) na rede externa `agiliz_network`. Registrado no
`agiliz-cli` (ver [../../../cli/CLAUDE.md](../../../cli/CLAUDE.md)).

**`NEXT_PUBLIC_GATEWAY_URL`** — a única env var deste app, lida no
browser (RTK Query roda client-side). Next não tem runtime env
client-side: `next build` embute o valor no bundle. Por isso
`admin-prod` recebe como **build arg** (`docker-compose.yml`'s
`build.args`, não `environment:` — settar como `environment:` não teria
efeito nenhum no build já compilado), enquanto `admin-dev` recebe como
`environment:` normal mesmo (o `next dev` recompila a cada request).
Default `http://localhost:3080`, o `GATEWAY_HOST_PORT` padrão. Ver
também `ADMIN_ORIGIN` em
[gateway-service/CLAUDE.md](../../../backend/apps/gateway-service/CLAUDE.md)
— o painel e o gateway são origens diferentes mesmo em dev (portas
diferentes em localhost), então CORS-com-credenciais nos dois lados é o
que faz a sessão funcionar.

## Gaps conhecidos

- **CLI do shadcn não instala `form` no registry `radix-nova`** — o item
  existe no registry mas devolve um JSON vazio (`{"name":"form","type":"registry:ui"}`,
  sem `files`), então `npx shadcn@latest add form` roda com exit 0 e não
  instala nada. `form.tsx` foi escrito à mão, seguindo os componentes já
  vendorizados (import unificado `radix-ui`, `cn`, mesma estrutura de
  props) — se um dia o registry ganhar o conteúdo real, comparar antes
  de sobrescrever.
- **`useHasPermission` agora tem um uso real**: `/ingestion` gate o
  formulário de upload por `ingestion:upload`. `PUT
  /inventory/:sku/minimum` (`useSetMinimumMutation`) continua sem botão
  que o chame.
- **Upload das três planilhas tem tela própria em `/ingestion`**
  (`src/app/(app)/ingestion/page.tsx`): formulário de envio +
  histórico de ingestões com detalhe de linhas rejeitadas. Dois
  follow-ups documentados, não construídos — cada um pede sua própria
  proposta OpenSpec:
  - **Reversão real de upload** (delete-by-ingestion_id em
    `sales-service`/`supply-service` + recompute a jusante). Não existe
    endpoint de cancelamento/rollback hoje — a correção é reenviar e
    sobrescrever o período.
  - **Perda por dia de visita de abastecimento.** A data da visita
    (`IngestionOperation.finished_at`, parseada da célula "Finalizado
    em" de cada aba) é real e precisa no momento do parse, mas é
    descartada antes mesmo das linhas de remoção chegarem ao
    `supply-service` (`publishSupplyByStore` do
    `ingestion-worker-service` agrega remoções só por `${sku} ${reason}`,
    perdendo o vínculo com a aba/data; a tabela de staging que
    brevemente guardava isso é apagada no `finalize()`). `supply-service`
    não guarda nada mais fino que o mês. Não é "adicionar um endpoint" —
    precisa de mudança de schema/contrato (um campo de data em
    `SupplyRemovalRow`/`RemovalRecord`) mais uma decisão sobre
    reprocessar meses já ingeridos.
- **O `.prettierrc` da raiz não bate com o estilo deste app.** A raiz pede
  aspas simples e sem `;`; o admin inteiro foi escrito com aspas duplas e
  `;`, e nunca passou por `pnpm format`. Rodar hoje reformata o app todo —
  decisão à parte.
- **Sem suíte de testes automatizados no app** — a verificação é manual,
  ao vivo, contra o stack real. Com 21 rotas isso ficou grande demais para
  seguir assim; levar o painel a ter testes é proposta OpenSpec própria.
- **Das 12 telas novas, nem todas renderizaram com dado real ainda.** Login,
  visão geral, financeiro e agora tesouraria (`/treasury`,
  `/treasury/imports*`, `/treasury/mappings` — `add-treasury-classification-
  model`, `add-treasury-statement-ingestion`, `add-treasury-review-ui`,
  `add-treasury-dashboard`) foram vistas no browser contra o stack real,
  com upload → conferência → confirmação → dashboard passando de ponta a
  ponta. As demais telas de back-office (billing, capex, accounting) ainda
  só têm typecheck/lint/build verificados.
- `frontend/common/` continua vazio; este app não compartilha nada com o
  `site` ainda (nenhum ganho óbvio de baixo risco identificado).
