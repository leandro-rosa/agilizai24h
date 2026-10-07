## Purpose

Lets the operator open one screen and see, in seconds, which products have the wrong price, what price the engine recommends, why, and what it is worth, without turning the page into a dashboard of charts. It only recommends; every change of price is a separate, explicit action.

## ADDED Requirements

### Requirement: The screen is reachable and permissioned

The screen SHALL be available at `/purchases/pricing` and listed in the Compras group of the sidebar as "Precificação Inteligente". It SHALL require the product read permission and SHALL show the actions that change data (apply a price, edit the rules) only to users with the matching write permission. The screen SHALL NOT include any Smart Supply (Abastecimento Inteligente) content.

#### Scenario: Read-only user

- **GIVEN** a user with the product read permission and no write permission
- **WHEN** they open the screen
- **THEN** they see the report and the drawer, and the "Aplicar novo preço" and "Regras de negócio" editing actions are not offered

### Requirement: Header and period/store scope

The screen SHALL show the title "Precificação Inteligente" and the subtitle "A IA analisa custos, vendas, perdas e estrutura financeira para sugerir preços mais saudáveis para cada produto.". It SHALL offer a month selector, a store selector with "Todas as lojas" as the network option, "Regras de negócio", "Exportar Excel" and "Exportar PDF". Changing the month or the store SHALL load the report for that scope.

#### Scenario: Whole network

- **WHEN** "Todas as lojas" is selected
- **THEN** the report of the whole network is shown

### Requirement: Filters

The screen SHALL filter the products by category, supplier, product (name, code or EAN), status, margin band, "abaixo da meta" and "com alteração de custo". Filters SHALL combine, SHALL be clearable one by one, and SHALL update the table and the sections consistently while the top cards keep describing the analysed catalogue of the selected scope.

#### Scenario: Combined filters

- **WHEN** the user selects the category "Bebidas" and the status "Ajustar"
- **THEN** only beverage products with that status are listed
- **AND** each filter shows a control to clear it

### Requirement: Top cards

The screen SHALL show six cards: average margin (with the target and the difference in percentage points), products within target (count and share of the analysed catalogue), products below target, products with an adjustment opportunity, products without a trustworthy cost (stating they receive no automatic recommendation), and the potential impact in R$ per month, always labelled "Impacto potencial estimado" and never as guaranteed profit. A figure the backend cannot give SHALL read "Indisponível" and SHALL NOT be shown as zero.

#### Scenario: Impact wording

- **WHEN** the impact card is shown
- **THEN** it carries the label "Impacto potencial estimado"

#### Scenario: No answer from the backend

- **GIVEN** the report cannot be loaded
- **WHEN** the screen renders
- **THEN** the cards and table show an unavailable state with a retry action, not zeros

### Requirement: The product table is the centre of the screen

The table SHALL list, per product: product (name, code), category, average cost, current price, current margin, target, recommended price, potential impact (R$/month), status and an action to open the drawer. It SHALL be sortable by greatest impact, lowest margin, most sold, greatest cost variation and greatest opportunity, and SHALL be paginated. A product without a recommendation SHALL show "—" in the recommended price and impact columns and the reason it has none.

#### Scenario: Sorting by impact

- **WHEN** the user sorts by greatest impact
- **THEN** the product with the highest estimated impact in R$ per month comes first

#### Scenario: Product without a recommendation

- **GIVEN** a product with status "Dados insuficientes"
- **WHEN** it is listed
- **THEN** the recommended price and the impact show "—" and the reason is visible

### Requirement: Status and confidence use the agreed vocabulary

Each product SHALL show one status among Saudável, Ajustar, Oportunidade, Revisar and Dados insuficientes, and a confidence among Alta, Média, Baixa and Dados insuficientes. Colours SHALL be limited to green for healthy, yellow for attention and red for a problem, with the brand magenta for the main actions, following the admin design.

#### Scenario: Status labels

- **WHEN** the engine reports `adjust`, `healthy`, `opportunity`, `review` and `insufficient_data`
- **THEN** they are shown as Ajustar, Saudável, Oportunidade, Revisar and Dados insuficientes

### Requirement: Supporting sections

Below the table the screen SHALL show "Principais oportunidades de precificação" (the products with the largest estimated impact, each with one factual sentence), "Custos que mais mudaram" (product, previous cost, current cost, variation and impact on margin) and "Margem por categoria" (average margin, target, difference, revenue and share of sales). Every sentence SHALL be built from computed figures and SHALL NOT state a cause the data does not show.

#### Scenario: Costs that changed

- **GIVEN** a product whose cost rose 10.4%
- **WHEN** the section is shown
- **THEN** it lists the previous cost, the current cost, +10.4% and the change in margin in percentage points

### Requirement: Product drawer

Clicking "Ver" SHALL open a side drawer without leaving the page, with the tabs Visão geral, Simulador, Histórico and Lojas. Visão geral SHALL show the product (name, code, category, supplier), the current situation (average cost, current price, margin, markup, units sold, revenue), the three prices (mínimo, meta, recomendado) with the confidence, "Por que a IA recomenda esse preço?", the estimated impact and the considered cost structure (product cost, taxes, losses, payment fees, VR/VA, operating allocation, economic cost). The operating allocation SHALL carry the statement "Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro.".

#### Scenario: Cost structure is visible

- **WHEN** the drawer is open on a product with a recommendation
- **THEN** each component of the structure is listed with its value and its share of the price

### Requirement: Simulator

The Simulador tab SHALL let the user type another price and SHALL show, from the backend, the estimated margin, markup, unit profit, estimated monthly impact against the current price and the difference to the target. Typing a price SHALL NOT change any price.

#### Scenario: What if R$ 6,50

- **GIVEN** a current price of R$ 5,90
- **WHEN** the user types R$ 6,50
- **THEN** the screen shows the estimated margin, markup, unit profit, monthly impact and difference to the target for R$ 6,50

### Requirement: History tab

The Histórico tab SHALL list, per month, cost, price, margin and markup, and SHALL mark the months in which the cost rose, the price changed, the margin fell and the margin improved. Months without a cost or a price SHALL show "—".

#### Scenario: A price change is visible

- **GIVEN** a price changed in August
- **WHEN** the history is shown
- **THEN** the August row is marked as a price change

### Requirement: Stores tab

The Lojas tab SHALL list, per store, units sold, revenue, loss and the estimated margin of the product at the current price, stating that payment fees and the operating allocation are the network's.

#### Scenario: Store comparison

- **WHEN** the tab is open
- **THEN** stores are listed with their own units, revenue, loss and margin

### Requirement: Business rules modal

"Regras de negócio" SHALL show and let an authorised user edit the pricing parameters (target margin, minimum margin, per-category margins, rounding, psychological price, minimum sales quantity, minimum confidence, tax rate, brand aliases), SHALL show the version in force and let the user open earlier versions, and SHALL show the payment fees in force read-only with a link to where they are registered. Saving SHALL create a new version, never edit an earlier one, and a rejected value SHALL show every problem at once. A change SHALL take effect on the next report run and SHALL say so.

#### Scenario: Saving a target

- **WHEN** an authorised user sets the target margin to 38% and saves
- **THEN** a new parameter version exists and the previous one is still listed
- **AND** the modal says the new value applies on the next run

#### Scenario: Invalid change

- **WHEN** the minimum margin is set above the target
- **THEN** nothing is saved and the problem is shown

### Requirement: Insufficient setup is explained

When no payment fee is registered, the tax rate is unset or the report notes any other gap, the screen SHALL show those notes in a visible banner that links to where to fix them, and SHALL NOT present products as healthy because inputs are missing.

#### Scenario: Tax rate unset

- **GIVEN** the tax rate is not configured
- **WHEN** the screen loads
- **THEN** a banner states that no product receives a recommendation until it is set, with a link to the rules modal
