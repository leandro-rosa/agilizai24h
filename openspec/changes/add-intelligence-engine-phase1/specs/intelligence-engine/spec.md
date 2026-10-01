## Purpose

Decides, for each Product × Store, whether the product should stay, what quantity makes sense, what operational attention it needs and how far its estimated balance can be trusted — from facts the platform already holds, reproducibly, and without ever acting on its own.

## ADDED Requirements

### Requirement: Product × Store is the unit of analysis

The engine SHALL produce one result per store and SKU. A SKU's behavior in one store SHALL NOT change the result of another store, except through an explicit network-comparison evidence field that is never the decision itself.

#### Scenario: Same SKU, two stores

- **GIVEN** a SKU that sells steadily in store A and rarely in store B
- **WHEN** the engine runs
- **THEN** the two results are computed independently from each store's own cycles
- **AND** the network comparison appears only as evidence on each result

### Requirement: Restock cycles are built from visits

The engine SHALL build restock cycles from the stored supply visits: a cycle runs from one restocking of the SKU to the next, with the starting balance, the quantity restocked, removals, the consumption observed between the visits and the number of days. A cycle whose balance before the following visit was zero SHALL be marked as censored, and its consumption SHALL be treated as a lower bound of demand, never as demand.

#### Scenario: A stock-out ends a cycle

- **GIVEN** a SKU whose balance before a visit was 0
- **WHEN** cycles are built
- **THEN** the cycle ending at that visit is marked censored
- **AND** its consumption is not used as an uncensored demand observation

#### Scenario: Removals of every reason reduce the balance

- **GIVEN** a cycle with a return, a transfer and an expired removal
- **WHEN** the cycle is built
- **THEN** all three reduce the balance of the cycle
- **AND** only the loss reasons count as loss in the economics

### Requirement: Demand is estimated robustly, never as a simple average

The engine SHALL estimate a daily demand rate per Product × Store that weights recent cycles more, ignores censored cycles as demand, and reports the spread between a lower and an upper rate. It SHALL NOT use a plain mean of monthly sales as the demand estimate.

#### Scenario: Recency matters

- **GIVEN** two SKUs with the same mean consumption, one steady and one that fell by 70% in the latest cycles
- **WHEN** the engine runs
- **THEN** the second SKU's estimated rate is lower than the first's

### Requirement: A temporal pattern is reported as evidence

The engine SHALL classify each Product × Store as stable, growing, declining, volatile, new or insufficient, and SHALL present the pattern as evidence only: the pattern alone SHALL NOT produce a Mix or Quantity decision.

#### Scenario: Three series with the same range

- **GIVEN** the series 20, 19, 21, 18, 20, 21 and 20, 17, 14, 10, 7, 4 and 3, 18, 4, 16, 5, 20
- **WHEN** the engine classifies them
- **THEN** they are reported as stable, declining and volatile respectively

### Requirement: Mix, Quantity and Operation are separate decisions

For every Product × Store the engine SHALL produce three independent decisions: Mix (keep, test, evaluate removal, insufficient data), Quantity (keep current, reduce, increase, test a new quantity, no evidence to change) and Operation (none, investigate losses, expiry attention, investigate damage, review balance, other factual alert). A value in one SHALL NOT be derived from the label of another.

#### Scenario: Keep the product and investigate the operation

- **GIVEN** a product that sells well and has a high "other reason" loss
- **WHEN** the engine runs
- **THEN** Mix is keep, Quantity is keep, and Operation includes investigate losses

### Requirement: Quantity is judged against the current baseline for a replenishment interval

The current baseline quantity SHALL be the value imported from the pricing sheet for the SKU, applied to every store. The suggested quantity SHALL always be stated together with the replenishment interval it was computed for. A suggestion SHALL NOT be rounded to a multiple of any package size, and when a package size is known the result SHALL show only the operational implication.

#### Scenario: Reduction without rounding

- **GIVEN** a baseline of 21 and a demand that supports 12 for the stated interval
- **WHEN** the engine runs
- **THEN** the suggestion is reduce 21 to 12 with a difference of −9 and the interval it assumes
- **AND** it is not rounded to 21, 42 or 63

#### Scenario: No evidence of a stock-out

- **GIVEN** a baseline lower than the demand-supported quantity but no censored cycle and no growing pattern
- **WHEN** the engine runs
- **THEN** the Quantity decision is no evidence to change
- **AND** the result does not claim that stock is missing

### Requirement: Loss alone never removes a product

The engine SHALL NOT recommend evaluating removal, and SHALL NOT reduce quantity, solely because losses or low sales are high. A removal evaluation SHALL require sufficient exposure, recurrently low demand and low or negative contribution after losses; removal from the network SHALL require the same pattern in the majority of stores where the SKU was actually exposed. "Other reason" SHALL keep that classification and SHALL NOT be inferred as theft.

#### Scenario: High loss, good sales

- **GIVEN** a Product × Store with high expiry loss and demand well above the baseline's cover
- **WHEN** the engine runs
- **THEN** Mix is keep and Operation includes expiry attention

#### Scenario: Never tested is not "does not sell"

- **GIVEN** a SKU with no visit line and no restock in a store
- **WHEN** the engine runs
- **THEN** its presence state is never tested
- **AND** it is not classified as low adherence

### Requirement: New products are not penalised

A Product × Store whose first appearance is recent, or that has too few cycles with stock, SHALL be reported as new or insufficient data, never as low adherence. Because no test flag exists, the first appearance SHALL be used as a proxy and labelled as an approximation.

#### Scenario: First appearance two cycles ago

- **GIVEN** a SKU first restocked two cycles ago with low sales so far
- **WHEN** the engine runs
- **THEN** Mix is test or insufficient data
- **AND** the result labels the newness as an approximation

### Requirement: Estimated balance carries a reliability status governed by the tolerance

The engine SHALL estimate the current balance of a Product × Store from the most recent anchor — the latest count when one exists, otherwise the latest recorded balance after a visit — and the estimated demand since then, and SHALL call it "estimated balance", never "stock". For each Product × Store it SHALL classify the balance as within tolerance, outside tolerance or not verifiable, using the configured tolerance: a count is acceptable when the difference between the count and the system balance is at most the larger of the configured percentage of the system balance and the configured number of units.

#### Scenario: One or two units never block by percentage

- **GIVEN** a system balance of 4 and a count of 6
- **WHEN** the tolerance is evaluated with 10% and 3 units
- **THEN** the difference of 2 is within tolerance

#### Scenario: Both limits exceeded

- **GIVEN** a system balance of 30 and a count of 22
- **WHEN** the tolerance is evaluated with 10% and 3 units
- **THEN** the difference of 8 exceeds both limits and the count is outside tolerance

#### Scenario: No recent count

- **GIVEN** a Product × Store whose last count is older than the configured maximum age, or with fewer counts than the configured minimum
- **WHEN** the balance is classified
- **THEN** the status is not verifiable and the reason is stated

#### Scenario: The gate

- **WHEN** a Product × Store is not within tolerance
- **THEN** its balance is exposed labelled as estimated balance with low reliability
- **AND** it is flagged as not releasing balance-driven use
- **AND** a Product × Store within tolerance is flagged as releasing it

### Requirement: Conflicting data is detected and reported

The engine SHALL flag a Product × Store as having conflicting data when its facts contradict each other: a balance that rose between visits with no recorded event, consumption in a month with no imported sales for the store, a SKU rejected at ingestion for the store's reports, or a baseline imported with conflicting values. The flag SHALL list the conflicts, and such a Product × Store SHALL NOT release balance-driven use regardless of its tolerance status.

#### Scenario: Balance rose without an event

- **GIVEN** a Product × Store whose balance before a visit exceeds the balance after the previous visit
- **WHEN** the engine runs
- **THEN** the result flags conflicting data and lists that interval

#### Scenario: Conflict blocks the gate

- **GIVEN** a Product × Store within tolerance but with conflicting data
- **WHEN** the gate is evaluated
- **THEN** balance-driven use is not released and the conflict is the stated reason

### Requirement: Confidences are separate and explained

The result SHALL carry three separate values: confidence of the recommendation, reliability of the estimated balance, and priority, each with the facts behind it. A high recommendation confidence with a low balance reliability SHALL be a valid combination.

#### Scenario: Reduce with high confidence and a doubtful balance

- **GIVEN** a clear, long history of excess and a balance outside tolerance
- **WHEN** the engine runs
- **THEN** the recommendation confidence is high and the balance reliability is low, both shown with their reasons

### Requirement: Results are deterministic and auditable

For the same input data, engine version and parameter version the engine SHALL return the same result. Every result SHALL list the facts, the evidence for keeping, the evidence for changing and the limitations that produced it, so a person can reproduce the decision. A generative model, if used later, SHALL only phrase those facts and SHALL NOT decide.

#### Scenario: Same input, same output

- **WHEN** the engine runs twice over unchanged data and parameters
- **THEN** the two results are identical

### Requirement: The engine takes no action

The engine SHALL NOT change a baseline, a parameter, a restock plan or any other system data as a consequence of a result. Every result SHALL be a recommendation for a person to accept or ignore.

#### Scenario: Results never write elsewhere

- **WHEN** the engine runs
- **THEN** no record outside the engine's own results is created or changed
