## Purpose

Gives the pricing screen the data it needs from the backend: a catalogue report that is computed once and stored with the versions that produced it, a monthly history and a simulation for one product, a per-store view, and the extra fields that make the table readable. All rules that shape a recommendation stay in the backend.

## ADDED Requirements

### Requirement: The catalogue report is computed by a run and stored

A report for a period and a store (or the network) SHALL be produced by a run that is started explicitly, executed in the background, and stored with its period, scope, engine version, parameter version, computation time and status. Reading the report SHALL return the latest completed run for the scope without recomputing it, together with its freshness. Starting a run for a scope that already has one in progress SHALL NOT start a second one. A failed run SHALL keep its reason and SHALL NOT replace the latest completed run.

#### Scenario: Reading the stored report

- **GIVEN** a completed run for 2026-09 and the network
- **WHEN** the report is read
- **THEN** it is returned with its engine version, parameter version and computation time, without running the engine

#### Scenario: A run already in progress

- **GIVEN** a run for the same period and scope is running
- **WHEN** another run is requested
- **THEN** the running one is returned and no second run starts

#### Scenario: A failed run

- **GIVEN** a completed run exists and a newer run fails
- **WHEN** the report is read
- **THEN** the completed run is returned and the failure is reported separately

#### Scenario: No run yet

- **WHEN** a scope has never been run
- **THEN** the read says so explicitly and does not return an empty report as if it were a result

### Requirement: The report carries what the table needs

Each product in the report SHALL carry its code (SKU), EAN, supplier (id and name), category as a key and as a Portuguese label (unknown categories labelled "Outros"), subcategory, the previous cost and the variation, the margin at the previous cost and at the current cost, and the change in margin caused by the cost change in percentage points. A product with no supplier SHALL carry none rather than a placeholder.

#### Scenario: Cost change impact

- **GIVEN** a product whose cost rose from R$ 2,80 to R$ 3,09 at an unchanged price
- **WHEN** the report is read
- **THEN** it shows the margin at each cost and the drop in percentage points

### Requirement: Monthly history of a product

The system SHALL return, for one product and a number of months, one row per month with the cost and the price in force at the end of the month, the margin `(price − cost) / price` and the markup `price / cost`, and flags for a cost rise, a price change, a margin fall and a margin improvement against the previous month. A month with no cost or no price in force SHALL carry no value for it, and its margin and markup SHALL be empty, not zero. The margin SHALL be labelled as the product margin, not the economic margin of the engine.

#### Scenario: Month without a cost

- **GIVEN** no cost is in force at the end of a month
- **WHEN** the history is read
- **THEN** that month has an empty cost, margin and markup

#### Scenario: Price change flagged

- **GIVEN** the price in force changed between July and August
- **WHEN** the history is read
- **THEN** August is flagged as a price change

### Requirement: Simulation of a typed price

The system SHALL compute, for a product, a scope and a typed price, the estimated economic margin, the markup, the unit profit, the estimated monthly impact against the current price (volume held constant) and the difference to the target margin, using the cost structure of the stored report. The result SHALL be labelled as an estimate. A typed price that is not a positive whole number of centavos SHALL be rejected. A product without a cost structure SHALL be reported as not simulable and SHALL NOT get invented figures. Simulating SHALL NOT change any price.

#### Scenario: Typed price above current

- **GIVEN** a stored structure and a current price of R$ 5,90
- **WHEN** R$ 6,50 is simulated
- **THEN** the margin, markup, unit profit, monthly impact and difference to the target are returned for R$ 6,50

#### Scenario: Product without a structure

- **GIVEN** a product with insufficient data
- **WHEN** a price is simulated
- **THEN** the answer says it cannot be simulated and why

### Requirement: Per-store view of a product

The system SHALL return, for one product and the report period, each store's units sold, revenue, loss and the estimated margin at the current price using the store's own loss and the network's payment cost and operating allocation, and SHALL say so. Stores that never recorded the period SHALL be listed as missing, not as zero sales.

#### Scenario: Store without data

- **GIVEN** a store whose sales were never ingested for the period
- **WHEN** the per-store view is read
- **THEN** the store is listed as missing data, not as zero sales
