## Purpose

Turns the per-transaction sales data the admin already holds into explainable commercial recommendations (what is bought together, what is missing from the cart, which products really earn money after losses, which store behaves differently), each with its evidence, an honest confidence level and the ability to say "not enough data". It is read-only: it suggests, and never acts.

## ADDED Requirements

### Requirement: The page is a read-only item of the Operação group

The admin SHALL expose a page named "Inteligência Comercial" at `/commercial-intelligence` as an item of the sidebar group "Operação", placed after "Vendas", visible only to users holding the `sales:read` permission. The page SHALL NOT contain any control that creates, changes or deletes data anywhere in the platform.

#### Scenario: A user without sales:read does not see the item

- **GIVEN** a signed-in user who does not hold `sales:read`
- **WHEN** the sidebar renders
- **THEN** the "Inteligência Comercial" item is absent

#### Scenario: The item does not collide with its neighbours in navigation

- **GIVEN** a user on `/commercial-intelligence`
- **WHEN** the sidebar and breadcrumb resolve the current location
- **THEN** only "Inteligência Comercial" is highlighted and the breadcrumb reads "Inteligência Comercial"

### Requirement: Filters scope the analysis without refetching on store change

The page SHALL offer Store/Network (default Network), Period, Comparison ("Mês anterior" or "Sem comparação") and Category filters. Changing the store or the category SHALL NOT trigger a new request for sales transactions; changing the period or the comparison MAY. Network-wide and similar-store benchmarks SHALL always be computed over all stores regardless of the selected store. The Category filter SHALL restrict what is shown, not which baskets are analysed, and the page SHALL disclose that only the catalog's four categories (meal, snack, beverage, essential) exist.

#### Scenario: Selecting a store reuses the loaded data

- **GIVEN** the network's transactions for the selected period are loaded
- **WHEN** the user selects a specific store
- **THEN** no new transaction request is issued
- **AND** the KPIs and lists show that store's figures while benchmarks still reflect the whole network

#### Scenario: Category is a view filter

- **GIVEN** a basket that contains a beverage and a snack
- **WHEN** the user filters by "beverage"
- **THEN** the basket still counts once in every pair statistic
- **AND** only rows involving a beverage are listed

### Requirement: A period without transaction detail is an empty state, never zeros

When the selected period has no per-transaction sales for any store (for example a month ingested before the network-wide format existed), the page SHALL show an explanatory empty state and SHALL NOT render zeros as if there had been no sales. When the comparison period has no data, the page SHALL show "Sem comparação" for deltas and SHALL NOT block the current period.

#### Scenario: A pre-format month

- **GIVEN** a period for which no store has per-transaction sales
- **WHEN** the page renders
- **THEN** it explains that the period likely predates the per-transaction format and shows no zero-valued KPI

#### Scenario: Missing comparison month

- **GIVEN** the current period has data and the previous month has none
- **WHEN** the KPIs render with Comparison "Mês anterior"
- **THEN** each delta reads "Sem comparação" and the current values are shown normally

### Requirement: Overview shows seven KPIs with provenance and honest unknowns

The Overview tab SHALL show Receita, Ticket médio, Itens por compra, Margem por compra, Margem total, Margem após perdas and Oportunidades identificadas (broken down by priority), each with an Observed/Estimated label and a delta or "Sem comparação". It SHALL NOT show an "Experimentos ativos" indicator. Receita, Ticket médio and Itens por compra SHALL use the same definitions as the Vendas page (only completed transactions; a purchase is the set of lines sharing a coupon within a store). Margin SHALL be computed only over lines whose product cost resolves, and the number of unresolved products SHALL be shown. Margem após perdas SHALL be shown only where both margin and reconciled loss are known, stated as "sobre N de M lojas" when partial, and SHALL NOT be shown as zero when loss is unavailable.

#### Scenario: Parity with Vendas

- **GIVEN** the same store or network scope and period, with every sold product's cost resolved
- **WHEN** the Overview and the Vendas page render
- **THEN** Receita, Ticket médio, Itens por compra and margin are equal on both

#### Scenario: Unresolved cost is excluded, not zeroed

- **GIVEN** a product sold in the scope whose cost cannot be resolved
- **WHEN** margin renders
- **THEN** that product's revenue and cost are both left out of the margin
- **AND** the page states how many products were excluded

#### Scenario: Partial loss coverage

- **GIVEN** reconciled loss is available for 22 of 24 stores
- **WHEN** Margem após perdas renders for the network
- **THEN** it reads "sobre 22 de 24 lojas" and does not treat the missing stores as zero loss

### Requirement: Basket analysis uses only coupon baskets and is gated by coupon coverage

Association analyses (product pairs and the missing-from-cart comparison) SHALL be built only from purchases that carry a coupon; lines without a coupon SHALL NOT be turned into one-item baskets for these analyses. The page SHALL measure coupon coverage per store and for the network (share of completed lines and of revenue carrying a coupon). A store with coverage below the configured exclusion threshold (default 80%) SHALL be excluded from these analyses and listed as excluded. When network coverage is between the exclusion threshold and the configured full-coverage threshold (default 95%), the analyses SHALL run on eligible stores only and basket-based recommendations SHALL NOT exceed Medium confidence. When there are too few eligible baskets (below the configured minimum), or coupons do not group lines (the share of coupon baskets with more than one item is below the configured minimum, default 5%), the analyses SHALL be blocked and only the coverage card SHALL be shown, stating what would unblock them.

#### Scenario: A store below the exclusion threshold

- **GIVEN** the default exclusion threshold of 80% and a store where 70% of completed lines carry a coupon
- **WHEN** pair statistics are computed
- **THEN** none of that store's baskets is used
- **AND** the store is listed as excluded with its coverage

#### Scenario: Coupons that do not group

- **GIVEN** a period where the share of coupon baskets containing more than one item is below the configured minimum (default 5%)
- **WHEN** the Combos tab renders
- **THEN** no pair and no missing-from-cart result is shown and the coverage card explains why

### Requirement: Each product pair shows plain-language metrics

For every listed product pair the page SHALL show: purchases containing A, containing B and containing both; the joint frequency; the share of purchases with A that also contain B and the reverse; the joint ticket; the pair's margin; and the pair's margin after losses. Statistical terms SHALL appear only in explanatory tooltips. A pair SHALL be listed only when the association is reliable: at least the configured minimum of joint purchases (default 8), at least the configured minimum of purchases of each product (default 20), and an association strength whose conservative lower bound exceeds chance by the configured margin.

#### Scenario: A reliable pair

- **GIVEN** a pair with 40 joint purchases, 100 purchases of A and 100 of B among 1,000 baskets
- **WHEN** the pair table renders
- **THEN** the pair is listed with "40% das compras com A levam B"

#### Scenario: A pair that could be chance

- **GIVEN** 3 joint purchases among 10 baskets with 4 purchases of each product
- **WHEN** the pair table renders
- **THEN** the pair is not listed

### Requirement: Pairs are classified as strong association, cross-sell potential or promotional opportunity

Each listed pair SHALL be classified, and the classification SHALL control the suggested action. If at least the configured strong-association conversion (default 25%) of purchases with the anchor product already include the partner, the pair SHALL be a **strong association** and the suggestion SHALL be joint exposure only; when those joint purchases already happen at full price the page SHALL say that a discount would reduce margin without selling more. Otherwise the pair SHALL be a **cross-sell potential** (communication or offer, no price cut) unless the partner shows a demand-side reason for a promotion and a discount within the configured discount grid (default up to 15%) keeps the combo at or above the minimum margin with a plausible extra conversion, in which case it SHALL be a **promotional opportunity**, presented as a candidate test. The page SHALL state that it cannot measure price elasticity.

#### Scenario: Naturally bought together at full price

- **GIVEN** a pair where 30% of anchor purchases include the partner and 90% of joint purchases have no discount
- **WHEN** the pair is classified
- **THEN** it is a strong association
- **AND** its suggestion is joint exposure with no discount

#### Scenario: Low conversion without a demand reason

- **GIVEN** a reliable pair where 12% of anchor purchases include the partner and the partner shows no expiry-related loss and is not classified as under-explored
- **WHEN** the pair is classified
- **THEN** it is a cross-sell potential and no price reduction is suggested

### Requirement: "What is missing from the cart" compares purchases with and without a category

For each anchor category the page SHALL show the share of its purchases that contain no item of a partner category, and compare ticket and margin with and without that category. It SHALL be computed only when the anchor category has at least the configured minimum of purchases (defaults 100 for the network, 60 for a single store) and the partner's base rate is neither negligible nor near-universal; otherwise it SHALL state that data is insufficient. The ticket comparison SHALL state that the "with" ticket includes the partner item's own price.

#### Scenario: Enough anchor purchases

- **GIVEN** 600 purchases with a snack, of which 420 contain no beverage
- **WHEN** the missing-from-cart section renders
- **THEN** it shows "70% das compras com snack não têm bebida" with ticket and margin with versus without a beverage

#### Scenario: Too few anchor purchases

- **GIVEN** 40 purchases with a category in a single store
- **WHEN** the section renders for that store
- **THEN** it shows "Dados insuficientes para recomendar" for that category and computes no gap

### Requirement: The combo simulator evaluates a discount against a minimum margin

For a selected pair the page SHALL provide a simulator showing current prices, joint cost, current margin (R$ and %), a proposed price, the resulting discount, the margin after the discount (R$ and %), and the extra volume needed to keep the same total contribution. The proposed price SHALL be a user input labelled as an assumption; the minimum margin is a business rule (30% until the company sets it) read from the official value for the operation, shown read-only in the simulator, never a constant in the code and never changeable by one viewer for themselves; only the proposed price is a what-if input. The simulator SHALL flag a proposal that falls below the minimum margin, or has non-positive margin, and SHALL show the maximum discount compatible with the minimum margin. It SHALL refuse to simulate when either product's cost is unresolved. It SHALL NOT persist anything.

#### Scenario: Break-even volume

- **GIVEN** a combo with joint price R$15,00 and joint cost R$7,00
- **WHEN** the proposed price is R$13,50
- **THEN** the margin after discount is R$6,50 (48,1%) versus R$8,00 (53,3%) before
- **AND** the break-even extra volume is 23,1%

#### Scenario: Unresolved cost

- **GIVEN** a pair where one product has no resolved cost
- **WHEN** the user opens the simulator
- **THEN** it explains that it does not simulate with a zero cost and shows no margin figure

### Requirement: Products are classified by financial return relative to peers in scope

The Products tab SHALL classify each product with enough evidence into result driver, star, under-explored potential, volume without return, or low economic return, using several metrics together (revenue, quantity, margin R$ and %, losses, margin after losses, turnover) and percentiles among the products of the same scope. No class SHALL derive from a single metric, and margin percentage alone SHALL NOT make a product a result driver. A product with fewer than the configured minimum of sold units (default 10) or an unresolved cost SHALL be "Dados insuficientes". A product with fewer than the configured minimum of days with sales in the period (default 14) SHALL be "Em observação" and be judged by sales rate per selling day, never by total volume. A product whose sales gaps suggest possible unavailability, or that was restocked in fewer units than the configured minimum (too little exposure), SHALL NOT receive an adverse class and SHALL read as being under observation, never as if it had had normal exposure. "Potencial subexplorado" SHALL always be labelled Estimated with at most Low confidence, and its text SHALL NOT claim a stock-out was observed.

#### Scenario: A new product is not compared by total volume

- **GIVEN** a product with 9 of 10 units sold over 10 days with sales, in a scope where established products sold hundreds
- **WHEN** the Products tab renders
- **THEN** the product is "Em observação" and is not classified as low return because of its total volume

#### Scenario: High revenue alone is not a good product

- **GIVEN** a product in the top revenue percentile whose margin after losses is negative
- **WHEN** it is classified
- **THEN** it is "Baixo retorno econômico"

#### Scenario: Under-explored potential is an estimate

- **GIVEN** a product with low sales volume and high unit margin
- **WHEN** it is classified as "Potencial subexplorado"
- **THEN** it carries the Estimated label, a confidence of at most Low, and text that says low sales may mean low exposure or missing stock, which the page cannot tell apart

### Requirement: Hourly behavior uses the store's wall-clock time

Weekday, hour and daypart analyses SHALL interpret each transaction timestamp as the store's local wall-clock time, as recorded in the source report, and SHALL NOT shift it by the viewer's time zone. The page SHALL state that the hour is the store's local clock. Heatmap cells with fewer than the configured minimum of purchases (default 5) SHALL not show ticket or margin. A daypart insight SHALL require at least the configured minimum of purchases (default 40) in that daypart.

#### Scenario: Timestamps near midnight

- **GIVEN** a transaction stored as `2026-08-31T23:58:47Z` and another as `2026-08-31T01:30:00Z`
- **WHEN** they are bucketed by weekday and hour
- **THEN** the first falls on Monday at hour 23 and the second on Monday at hour 1, regardless of the viewer's time zone

#### Scenario: A concentration with low attach

- **GIVEN** a category that accounts for at least 1.5 times its usual revenue share in a daypart and whose partner category is attached at least 10 percentage points less often in that daypart
- **WHEN** the Behavior tab renders
- **THEN** it suggests a segmented test for that daypart, with the evidence and the reference rate

### Requirement: Each store has its own profile, benchmarked against similar stores

The Stores tab SHALL show, per store, ticket, items per purchase, category mix, characteristic products, daypart shape, margin, coupon coverage and loss rate, and SHALL compare the store with stores of a similar demand pattern rather than only with the network. The store's own history and its similar stores come first and the network figure is only a secondary reference, labelled as such and never a target or rule. When fewer than two comparable stores exist, the page SHALL fall back to the network reference and say "sem lojas parecidas suficientes", and confidence SHALL reflect the weaker benchmark. A store with fewer than the configured minimum of purchases (default 100) SHALL NOT receive store-level recommendations above Low confidence.

#### Scenario: Not enough comparable stores

- **GIVEN** a store with only one comparable store
- **WHEN** its benchmark renders
- **THEN** the page says "sem lojas parecidas suficientes" and shows the network reference instead

### Requirement: Loss is consumed with its cause and never presented as theft or as an automatic removal

Margin after losses and loss-related wording SHALL use the reconciled loss by reason that the Perdas analysis uses, and the page SHALL NOT add another loss analysis screen. Wording SHALL follow the dominant cause: expiry points to turnover and supply quantity, damage to handling, and "Outro motivo" to "sem classificação confiável". "Outro motivo" SHALL NOT be described as theft. No recommendation SHALL instruct removing or withdrawing a product. A product with good turnover and margin that has operational loss SHALL be described as a loss to investigate, not a product to drop. The page SHALL state that loss is only known monthly.

#### Scenario: Other-reason loss

- **GIVEN** a product where 60% of its loss value is recorded as "Outro motivo"
- **WHEN** its row or opportunity renders
- **THEN** the text says the loss has no reliable classification and asks for standardized recording
- **AND** the text contains neither "furto" nor "roubo"

#### Scenario: A good product with operational loss

- **GIVEN** a product with sell-through of at least 80%, margin at or above the scope median and some loss
- **WHEN** its text renders
- **THEN** it says the loss is operational and to be investigated and does not suggest dropping the product

### Requirement: Every recommendation carries a documented confidence and can declare insufficient data

Every recommendation SHALL show a confidence of High, Medium or Low, derived from a documented rubric that weighs the amount of evidence, days with sales, months analysed, stability, comparable stores, coupon coverage, cost resolution and reconciliation quality, and SHALL list the factors and any cap applied. Confidence SHALL be capped at Medium when coupon coverage is between the exclusion and the full-coverage thresholds, and at Low when fewer than the configured minimum of days have sales (default 7), when the evidence contradicts itself between halves of the period, when the main claim is a proxy estimate, or when loss is the main driver and the product is flagged with inconsistent stock. When evidence is below the minimum, the page SHALL NOT recommend and SHALL say "Dados insuficientes para recomendar {X}: {condition}. {what is missing}." Such items SHALL appear under "O que ainda não sabemos".

#### Scenario: Inconsistent stock cannot be high confidence

- **GIVEN** a recommendation whose main driver is a product's loss and that product is flagged with inconsistent stock
- **WHEN** its confidence is computed
- **THEN** it is at most Low and the flagged cap is shown

#### Scenario: Insufficient evidence

- **GIVEN** a store with 46 coupon purchases where the minimum is 100
- **WHEN** the page would recommend combos for that store
- **THEN** it shows "Dados insuficientes para recomendar combos nesta loja: só 46 compras com cupom (mínimo 100)" and lists it under what is not yet known

### Requirement: Observed values and estimates are distinguished

Every number SHALL be labelled Observed (recorded facts and metrics derived from them without assumptions) or Estimated (model projections and values that depend on an assumption, including any user-entered assumption). Observed and Estimated values SHALL appear side by side, and a projection SHALL NOT be presented as a fact. Every impact estimate SHALL state its assumption.

#### Scenario: Observed next to estimated

- **GIVEN** an opportunity about a product pair
- **WHEN** its numbers render
- **THEN** the margin appears labelled Observed, for example "Margem observada: R$ X"
- **AND** the potential appears labelled Estimated, for example "Impacto potencial estimado: R$ Y–Z", with the confidence beside it

#### Scenario: No observable gap

- **GIVEN** an opportunity for which no reference gap can be observed
- **WHEN** its impact renders
- **THEN** it says the impact cannot be estimated and shows no number

### Requirement: The opportunities center answers where attention pays off now, and exposes its evidence

The opportunities center SHALL show only the few most relevant opportunities on the main screen (a business rule, default 5), with the others available on demand, and SHALL answer "where does my attention pay off now?". Each opportunity SHALL show evidence, interpretation, impact, recommendation and confidence, and SHALL be clickable to drill down from network to store to product to up to 10 real sample baskets (coupon, local time, items, total, discount flag). Opening it SHALL also show the data that led to it, the period, the benchmark used, the sample size, the confidence factors and the limitations. The recommendation text SHALL propose a test or a review, never an order. Priority SHALL combine potential impact, confidence, the effort or complexity of the action and the risk to margin or loss, and a larger but weakly supported potential SHALL NOT automatically outrank a smaller, strongly supported one; Low confidence SHALL cap priority at Medium. Every opportunity SHALL state its origin (baskets, product, time, similar store, loss, margin, mix).

#### Scenario: Drilling to evidence

- **GIVEN** an opportunity about a product pair
- **WHEN** the user opens it and drills down to a store and then to the pair
- **THEN** the page lists real baskets that contain both products, so the claim can be checked

#### Scenario: Strong evidence beats a larger weak estimate

- **GIVEN** an opportunity with an estimated potential of R$ 500 per month and Low confidence, and another with R$ 350 and High confidence
- **WHEN** the center ranks them
- **THEN** the second ranks above the first
- **AND** the first is marked to be validated before acting

#### Scenario: Few on the main screen

- **GIVEN** twelve opportunities that pass every rule
- **WHEN** the main screen renders
- **THEN** it shows the number set by the business rule and offers the rest on demand

### Requirement: Each analysis shows whether its data is available, available with caveats, or insufficient

The page SHALL show, for each analysis it offers (combos and cross-sell, product return, loss and margin after losses, behavior by time, stores and similar stores, and comparison and history), one of three states, "Análise disponível", "Disponível com ressalvas" or "Dados insuficientes", together with the indicators that decide it (coupon coverage, resolved costs, reconciliation, history, timestamps, sample sizes) and the reason. Only a deficiency that makes an analysis impossible or misleading SHALL block it; a deficiency that merely weakens it SHALL keep the analysis available with the caveat listed and a lower confidence. The thresholds that separate the states are data-quality rules of the advanced area and SHALL NOT be presented as settings of the main experience.

#### Scenario: A weakness that does not block

- **GIVEN** a network whose coupon coverage is between the exclusion and the full-coverage thresholds
- **WHEN** the availability view renders
- **THEN** combos and cross-sell read "Disponível com ressalvas", listing the excluded stores and stating that confidence is capped at Medium

#### Scenario: A deficiency that blocks

- **GIVEN** a network with too few eligible coupon baskets
- **WHEN** the availability view renders
- **THEN** combos and cross-sell read "Dados insuficientes" with the blocking indicator and what would unblock it
- **AND** the other analyses that do not depend on coupons keep their own state

### Requirement: Financial impact is an estimate in three scenarios, never a single figure

Every impact SHALL be shown as a monthly range (for example "potencial estimado de R$ 220–660 por mês") broken into a conservative, an expected and an optimistic scenario. Each scenario is the observed gap multiplied by a scenario premise, the share of the gap an action is assumed to recover. The premises SHALL be labelled a premise of potential, not a measured or guaranteed result, SHALL appear with the impact, and SHALL be analytic parameters of the advanced area presented here in business language. The page SHALL NOT show an impact as a single precise figure.

#### Scenario: Scenarios with the premise stated

- **GIVEN** an opportunity with an observed monthly gap
- **WHEN** its impact renders
- **THEN** it shows conservative, expected and optimistic values in R$ per month, labelled Estimated
- **AND** it states that they assume recovering only part of the gap and are not a measured or guaranteed result

### Requirement: An insight and a recommendation are different things

The page SHALL present an observation ("o ticket no almoço é 18% maior") as an insight, with its evidence, comparison and confidence and no action, and SHALL turn it into a recommendation only when a rule links it to a concrete, testable action ("testar exposição conjunta de marmita e bebida entre 11h e 14h"). A correlation alone SHALL NOT produce a recommendation, and insights SHALL be viewable without being ranked as opportunities.

#### Scenario: An insight without an action

- **GIVEN** a daypart whose ticket is 18% above the scope but with no rule linking it to an action
- **WHEN** the behavior tab renders
- **THEN** it shows the observation as an insight and creates no opportunity

### Requirement: No classification or recommendation rests on a single threshold

Any classification or recommendation, for example "baixo retorno econômico", SHALL combine several signals (volume, financial contribution, margin, availability, history, loss and store context) and SHALL NOT be produced by one percentile or one threshold being crossed.

#### Scenario: One low percentile is not enough

- **GIVEN** a product below the contribution percentile but with a possible stock-out, few restocks and a short history
- **WHEN** it is classified
- **THEN** it is not "baixo retorno econômico" and is shown as under observation with the signals that prevented the class

### Requirement: Absence of evidence is a valid answer

When no analysis for a scope reaches sufficient evidence, the page SHALL say "não há evidência suficiente para recomendar uma ação" with the reasons, and SHALL NOT create opportunities to fill the screen.

#### Scenario: Nothing reaches the bar

- **GIVEN** a store where every candidate is below its evidence minimum
- **WHEN** the opportunities center renders for that store
- **THEN** it says there is not enough evidence to recommend an action and lists what is missing, instead of showing weak opportunities

### Requirement: Opportunities that share a cause are consolidated

Opportunities from different detectors that manifest the same cause (for example low cross-sell, a cart gap and a store deviation on the same product or category in the same store) SHALL be consolidated into a single opportunity that lists the detectors that support it, instead of appearing as separate cards.

#### Scenario: Three detectors, one opportunity

- **GIVEN** a cross-sell detector, a cart-gap detector and a store-deviation detector all pointing at beverages missing from meal purchases in one store
- **WHEN** the center is built
- **THEN** it shows one opportunity that names the three supporting detectors

### Requirement: Benchmarks prefer the store's own history and visible similar stores

Comparisons SHALL prefer the store's own history, then stores of a similar demand pattern, and SHALL use the network only as a secondary, labelled reference; when no reliable peers exist the page SHALL say so. Whenever similar stores are used, the page SHALL list which stores were used and the main factors of similarity, so that "similar stores" is never a black box.

#### Scenario: Similar stores are inspectable

- **GIVEN** a benchmark computed from similar stores
- **WHEN** the viewer opens the benchmark
- **THEN** the page lists the stores used and the factors that made them similar

### Requirement: Commercial suggestions try actions without a discount first

For associated products the page SHALL suggest joint exposure, communication, positioning or cross-sell before any price action. A discount SHALL be suggested only with evidence that it can produce incremental behavior and only if the minimum margin, a business rule, is preserved.

#### Scenario: A pair that is not a discount case

- **GIVEN** a reliable pair with no demand-side reason for a promotion
- **WHEN** it is classified
- **THEN** the suggestion is exposure, communication or positioning, and no discount is suggested

### Requirement: Every recommendation records the logic that produced it

Each recommendation SHALL carry the version of the analytic logic and the values of the parameters in force when it was produced, so that a later change of parameters or of the logic never rewrites what an earlier recommendation was based on. The confidence rubric is a versioned MVP whose structure SHALL allow later recalibration against the observed performance of recommendations. Persisting these records and the decisions taken on them (accepted, rejected, turned into an experiment) belongs to `add-commercial-intelligence-governance`.

#### Scenario: A recommendation knows its version

- **GIVEN** a recommendation produced under logic version X with a given set of parameter values
- **WHEN** it is opened after a parameter has changed
- **THEN** it still shows version X and the parameter values it was produced with

### Requirement: A calibration report precedes any production release

Before the analytic groups are released for production use, a calibration report over the real imported months SHALL show the distribution of the data and how the provisional parameters would behave: how many stores would be excluded, how many products would be left without data, how many pairs would pass the filters, how many opportunities would be generated and how many recommendations would be blocked. Thresholds SHALL be calibrated to avoid false signals without blocking useful analyses, and SHALL NOT be adjusted to make results appear.

#### Scenario: The report shows the effect of each guardrail

- **GIVEN** the real months are imported
- **WHEN** the calibration report is produced
- **THEN** it lists, for the provisional parameters, how many stores are excluded, products without data, pairs that pass, opportunities generated and recommendations blocked

### Requirement: Nothing executes automatically

The page SHALL only read data. It SHALL NOT withdraw products, change mix, change prices, create promotions or transfer stock, and SHALL NOT call any generative model or external analysis service. Suggestions SHALL be marked as suggestions, with an explanation that they are rule-based statistics over observed data and are never applied automatically.

#### Scenario: Page load issues only reads

- **GIVEN** a user opening the page
- **WHEN** it loads and the user changes every filter and opens every tab
- **THEN** only read requests are issued

### Requirement: Data-quality problems are visible and lower confidence

The page SHALL show a data-quality banner listing, each with its effect: coupon coverage (network and excluded stores), products without a resolved cost and their share of revenue, stores without transaction detail, stores whose reconciliation is incomplete or has inconsistent stock (with the number of recommendations affected), the catalog vocabulary limitation computed from the data, secondary data that failed to load, and a period still in progress. The banner SHALL be expanded when any item is critical or needs attention.

#### Scenario: Incomplete reconciliation

- **GIVEN** a store whose reconciliation for the period is incomplete
- **WHEN** the banner renders
- **THEN** it names the store, states that its loss-based recommendations have reduced confidence, and states how many are affected

#### Scenario: Catalog vocabulary

- **GIVEN** only one sold product is catalogued as meal while many meal-like products are catalogued as snack
- **WHEN** the banner renders
- **THEN** it states the counts and that meal-based analyses are limited by the catalog

### Requirement: A partial failure degrades one block, not the page

If costs, reconciliation or supply data fail to load or are not permitted, the affected figures SHALL show "—", "Indisponível" or "Sem permissão" and the banner SHALL say so, while every analysis that does not depend on the missing data SHALL keep working. If the sales transactions themselves fail, the page SHALL show the error state with a retry action.

#### Scenario: Finance is not permitted

- **GIVEN** a user with `sales:read` but without the finance read permission
- **WHEN** the page renders
- **THEN** loss cells read "Sem permissão", Margem após perdas is unavailable, and combos, behavior and store analyses still render

### Requirement: Rules are kept apart as business rules, data-quality rules and the analytic model

The page SHALL keep three kinds of rule apart, in the code and in the interface. A **business rule** is a decision of the company: the minimum acceptable combo margin, the largest discount worth testing, the smallest impact worth attention, how many opportunities the main screen shows. A **data-quality rule** decides whether there is enough data for an analysis: coverage, sample sizes, cost resolution. The **analytic model** decides how association, trend, similarity, confidence and opportunity are computed. A business rule SHALL have a single value for the whole operation, SHALL NOT be changeable by an individual viewer in their own browser, and SHALL appear in the main experience read-only with its source stated. Its editing, permission and change history belong to the official register delivered by `add-commercial-intelligence-governance`; until that exists the value is the deployment default and the page SHALL say that the official register is pending. Data-quality and analytic parameters SHALL live in a separate "Configurações avançadas / calibração" area, out of the main experience, each documented with its name, purpose, formula, unit, current value, reason for the default, where it is used and the effect of raising or lowering it, and every one of them SHALL be marked provisional until calibrated against real data. Only presentation preferences, such as which section is collapsed, MAY be kept in the browser.

#### Scenario: Two viewers see the same business rule

- **GIVEN** two viewers on different computers
- **WHEN** both open the page
- **THEN** both see the same minimum combo margin
- **AND** the page offers neither of them a way to change it locally

#### Scenario: Technical thresholds are not settings of the main experience

- **GIVEN** the page
- **WHEN** a viewer goes through the overview, combos, products, behavior and stores tabs
- **THEN** no tab presents a statistical or sample threshold as a setting
- **AND** those thresholds appear only in the advanced and calibration area, each documented and marked "provisório"

#### Scenario: A provisional value is a guardrail

- **GIVEN** a technical parameter that has not been calibrated
- **WHEN** it excludes a store or blocks an analysis
- **THEN** the reason states the value in use and that it is provisional

### Requirement: Synthetic data is identified and never mixed with real analysis

Any store or product whose name carries the configured synthetic marker SHALL be excluded from every analysis unless the page is explicitly running against a mock data source, and the data-quality banner SHALL say that synthetic data was detected and excluded. Data used to verify the page SHALL be served only by a mock outside the real databases, with every synthetic entity visibly labelled as synthetic.

#### Scenario: A marked store on the real gateway

- **GIVEN** the page reading from the real gateway and a store named "[SINTÉTICO] Loja A" in the response
- **WHEN** the page analyses the period
- **THEN** that store contributes to no KPI, pair, class or opportunity
- **AND** the banner reports that synthetic data was detected and excluded

#### Scenario: A mock data source

- **GIVEN** the page explicitly configured to run against a mock data source
- **WHEN** it renders
- **THEN** synthetic entities are included and every one of them is visibly labelled as synthetic

