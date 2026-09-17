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
  (`/`, `/sales`, `/finance`, `/supply`, `/inventory`, `/products`,
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

Vinte rotas em sete grupos (`navGroups` em `src/components/app-sidebar.tsx`).
Lista plana com vinte itens é inutilizável, e o agrupamento é o que separa
"o que a loja fez" de "o que a empresa deve":

| Grupo | Rotas |
|---|---|
| Operação | `/` · `/sales` · `/supply` · `/inventory` · `/inventory/central` |
| Financeiro | `/finance` (reconciliação) · `/finance/pnl` (DRE) · `/finance/cash-flow` |
| Tesouraria | `/treasury` · `/treasury/imports` · `/treasury/mappings` |
| Comercial | `/billing/clients` · `/billing/contracts` · `/billing/invoices` |
| Investimento | `/capex` · `/capex/investors` |
| Cadastros | `/products` · `/stores` · `/suppliers` |
| Sistema | `/ingestion` |

Cada item some para quem não tem a permissão de leitura
(`useHasPermission`, que agora aceita `undefined` como "não exige nenhuma").
Continua sendo cortesia de UX — o gateway é a fronteira e pode devolver 403
para uma ação que o menu deixou visível.

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
  é caixa real, e exclui só a categoria "Movimentação entre contas" — nunca
  os dois ao mesmo tempo. Ver
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
  ao vivo, contra o stack real. Com 20 rotas isso ficou grande demais para
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
