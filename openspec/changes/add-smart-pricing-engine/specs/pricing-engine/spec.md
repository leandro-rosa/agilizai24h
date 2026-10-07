## Purpose

Computes, for each product, the minimum, target and recommended price from the real cost structure of the operation, with the reasons and a confidence level, as a decision layer over existing data. It recommends only; it never changes a price.

## ADDED Requirements

### Requirement: Three prices per product

For each product the engine SHALL return a minimum price (the lowest price that does not fall below the configured minimum margin), a target price (the price that reaches the configured target margin) and a recommended price. The recommended price SHALL consider margin, cost, losses, sales volume, cost and price history, the current price and rounding, and SHALL be explained by reasons. The engine SHALL NOT compute the price as only `cost × markup` or only `cost ÷ (1 − margin)`.

#### Scenario: Price below the target

- **GIVEN** a cost of R$ 3.09, a current price of R$ 5.90 and a target margin of 35%
- **WHEN** the engine runs with the registered tax, loss, fee and operating components
- **THEN** it returns a minimum, a target and a recommended price, and the current margin
- **AND** it returns at least one reason for the recommendation

#### Scenario: Two products with different losses

- **GIVEN** two products with the same cost and the same tax, where one has 2% loss and the other 12%
- **WHEN** the engine runs
- **THEN** the target prices differ, and the higher-loss product has the higher target

### Requirement: The cost structure is built from existing sources

The engine SHALL build the cost structure from the product's acquisition cost, the tax rate, the loss rate, the weighted payment fee, the voucher fee weighted by the real voucher share, and an operating allocation. It SHALL read these from the services that own them and SHALL NOT ask the user to re-enter any of them. Loss SHALL come from real loss data, preferring the product's own history, then its category, then the store, and SHALL state which level was used. The payment fee SHALL be the average of the rates in force weighted by the real mix of payment methods, never a fee applied to 100% of sales.

#### Scenario: Weighted payment cost

- **GIVEN** a period where 22% of sales are voucher, 40% pix, 20% debit and 18% credit
- **WHEN** the payment cost is computed
- **THEN** it equals the sum of each method's share times its rate in force, with voucher using the effective voucher fee

#### Scenario: Loss source fallback

- **GIVEN** a product with too little history of its own
- **WHEN** the loss rate is chosen
- **THEN** the category loss is used and the result states that it did

#### Scenario: A component is missing

- **GIVEN** no tax rate is configured
- **WHEN** the engine runs
- **THEN** products are reported as having insufficient data and no price is recommended

### Requirement: Operating allocation is not a new expense

The operating allocation used for price analysis SHALL come from the existing financial data (fixed expenses, travel, revenue) and SHALL NOT be counted again where the same expense is already represented in another component. The result SHALL carry the statement: "Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro." The engine SHALL NOT write any financial entry.

#### Scenario: No double counting

- **GIVEN** an expense that is already included in the operating allocation
- **WHEN** the cost structure is built
- **THEN** that expense appears once

#### Scenario: Labelled as analysis

- **WHEN** the cost structure is returned
- **THEN** it includes the statement that the allocation is for price analysis only

### Requirement: Products without a trustworthy cost get no recommendation

A product with no cost, a cost older than the configured limit, or a cost flagged as unreliable SHALL be returned with status `insufficient_data`, SHALL carry the reason, and SHALL NOT receive a recommended price. It SHALL be counted separately.

#### Scenario: No cost

- **GIVEN** a product with no registered cost
- **WHEN** the engine runs
- **THEN** its status is `insufficient_data`, its recommended price is empty, and the reason names the missing cost

### Requirement: Every recommendation carries a confidence level

Each result SHALL carry a confidence of `high`, `medium`, `low` or `insufficient_data`, derived from cost quality, sales history, units sold, cost stability, data completeness and loss history. Results below the configured minimum confidence SHALL NOT be presented as recommendations. The confidence SHALL NOT imply more precision than the data supports.

#### Scenario: Few sales

- **GIVEN** a product with fewer units sold than the configured minimum
- **WHEN** the engine runs
- **THEN** its confidence is not `high`

#### Scenario: Simple voucher average lowers confidence

- **GIVEN** the voucher fee was a simple average
- **WHEN** the confidence is derived
- **THEN** it is lower than with a sales-weighted voucher fee, other inputs equal

### Requirement: Status classifies each product

Each product SHALL have one status: `healthy` (margin at or above target), `adjust` (margin below target and a price increase is supported), `opportunity` (margin can improve without relevant commercial risk), `review` (data needs analysis, such as a margin below target with a cost that moved or no clear price room) and `insufficient_data`.

#### Scenario: Below target with room

- **GIVEN** a margin of 32.1% against a target of 35% and a supported higher price
- **WHEN** the status is set
- **THEN** it is `adjust`

### Requirement: Impact is shown in money per month, labelled as an estimate

The engine SHALL return the potential impact of the recommended price in R$ per month, computed from the recent monthly volume and the change in unit margin, and SHALL label it as an estimated potential impact, never as guaranteed profit. A product's margin in R$ per month SHALL be returned alongside its margin percentage so high-volume low-margin and low-volume high-margin products are comparable.

#### Scenario: Volume changes the ranking

- **GIVEN** product A with a 20% margin and 1,000 units a month, and product B with a 70% margin and 10 units a month
- **WHEN** the margin in R$ per month is computed
- **THEN** product A's is higher and both are returned

### Requirement: Pricing parameters live in the backend and are versioned

The target margin, minimum margin, per-category margin overrides, rounding rule, psychological-price rule, minimum sales quantity, minimum confidence and tax rate SHALL be backend configuration with a version history; no such value SHALL be fixed in code or in the browser. Payment fees and loss rates SHALL NOT be duplicated in these parameters. Each result SHALL record the engine version and the parameter version used. The initial target margin SHALL be 35%, labelled as the owner's reference and not a constant.

#### Scenario: Changing the target

- **WHEN** the owner sets the target margin to 38%
- **THEN** a new parameter version exists and the previous one is readable
- **AND** results computed afterwards use 38% and record the new version

#### Scenario: Category override

- **GIVEN** a 30% minimum margin set for a category
- **WHEN** a product in that category is priced
- **THEN** the category value is used instead of the default

### Requirement: The engine never changes a price

The engine SHALL only recommend. It SHALL NOT write to the product catalogue or change any price.

#### Scenario: Running the engine

- **WHEN** the engine runs for any scope
- **THEN** no price version is created in the products service
