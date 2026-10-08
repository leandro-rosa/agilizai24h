## ADDED Requirements

### Requirement: One product list drives the price decision
The system SHALL present a single product list with cost per unit, current price ("Não definido" when absent), suggested price, contribution margin at the current price and a situation, and SHALL NOT show a margin or suggestion computed for a different cost or price than the registry holds today.

#### Scenario: Price changed after the calculation
- **GIVEN** a calculation that used a price of R$ 28,00
- **WHEN** the registry now holds R$ 30,00
- **THEN** the row shows no margin or suggestion and is marked out of date until the calculation is refreshed

### Requirement: The decision basis is today
The price decision SHALL be computed with the cost and the price in force today, in the request, with `meta.basis = "current"`; period reports SHALL keep valuing the last day of their period and keep their original metric.

#### Scenario: A cost bought after the period
- **GIVEN** a cost bought on 05/10 and a report of September
- **WHEN** the current basis is requested on 08/10
- **THEN** the product is valued at the cost of 05/10 and the September report is unchanged

### Requirement: Suggestion failures are told apart
The price suggestion SHALL report missing information (listing it), an unreachable target (without inventing a price), a possible calculation with caveats, or a technical failure with a retry, SHALL discard answers to superseded inputs, SHALL preserve what the user typed, and SHALL NOT allow saving a price while the answer for the current input is pending.

#### Scenario: Pricing service unavailable
- **WHEN** the pricing service does not answer
- **THEN** the form says so with the technical detail, keeps every field, disables saving a price and offers a retry

### Requirement: Automatic SKU
A product registered without a SKU SHALL receive the next six-digit number from a persistent counter that never goes back, is unique under simultaneous registrations, skips codes already used, is never reused after a deletion and moves above any six-digit SKU brought from outside. The number shown before saving SHALL be labelled a forecast.

#### Scenario: Ten simultaneous registrations
- **WHEN** ten products are registered at the same time without a SKU
- **THEN** each receives a different, increasing SKU

### Requirement: Price scope is stated, never invented
Saving a price SHALL show the scope and the effective date before confirming, and SHALL state that the price is one for the network because the registry holds no per-store price.

#### Scenario: Saving a price
- **WHEN** the user saves a new price
- **THEN** a confirmation shows the product, the scope "todas as lojas", the old and new price and the effective date before anything is written

### Requirement: Batch review blocks and explains
The batch review SHALL start with nothing selected, propose only the current calculation's recommendation, and show the reason for every product that cannot be saved.

#### Scenario: A product without cost
- **GIVEN** a selected product with no cost
- **THEN** it is listed as blocked with the reason, cannot be ticked and is never saved
