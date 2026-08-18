## Purpose

The per-store, per-month valuation that replaces the manual spreadsheet process: what was
restocked, what it cost to sell what was sold, what is left on the shelf, and what was
genuinely lost — each expressed in currency, and each traceable to the quantities and costs
that produced it.

## ADDED Requirements

### Requirement: Reconciliation figures

The system SHALL compute, for a store and month, the restocked value, the cost of goods sold,
the remaining stock value, and the real loss, each as a currency amount derived from recorded
quantities valued at cost.

#### Scenario: Computing a month

- **WHEN** a reconciliation is computed for a store and month with recorded movements
- **THEN** it reports restocked value, cost of goods sold, remaining stock value and real loss

#### Scenario: Figures derive from quantities and cost

- **GIVEN** a SKU with 10 units restocked at a cost of 2.50 each
- **WHEN** the restocked value is computed
- **THEN** that SKU contributes 25.00

#### Scenario: A month with no data

- **WHEN** a reconciliation is requested for a store and month with no recorded movements
- **THEN** the system reports that no data exists for that month
- **AND** it SHALL NOT report zeroes, which would be indistinguishable from a month of no
  activity

### Requirement: Valuation uses the cost effective for the month

The system SHALL value each month using the cost that was effective for that month, and
re-computing a past month SHALL NOT adopt a cost recorded with a later effective date.

#### Scenario: Historical month keeps its original valuation

- **GIVEN** a month reconciled using a cost effective from January
- **WHEN** a higher cost effective from June is recorded
- **AND** the same month is recomputed
- **THEN** its figures are unchanged

#### Scenario: A month is valued at its own cost, not the latest

- **GIVEN** costs effective from January and from June for one SKU
- **WHEN** March is reconciled
- **THEN** that SKU is valued at the January cost

#### Scenario: The valuation date is stated

- **WHEN** a reconciliation is produced
- **THEN** it states the date used to resolve costs, so the valuation can be reproduced

### Requirement: Real loss valuation

The system SHALL value real loss using only removal quantities whose reason counts as loss,
and SHALL report it broken down by reason and by product, in units and in currency.

#### Scenario: Only loss-counting reasons are valued as loss

- **GIVEN** a month where 6 units were returned and 3 removed under other reason
- **WHEN** real loss is valued
- **THEN** only the 3 units are included

#### Scenario: Loss broken down by reason

- **WHEN** a reconciliation's loss is requested by reason
- **THEN** each loss-counting reason reports its own quantity and value
- **AND** non-loss reasons are excluded from the loss figure

#### Scenario: Loss broken down by product

- **WHEN** a reconciliation's loss is requested by product
- **THEN** each product reports its lost quantity and value

#### Scenario: Breakdowns reconcile to the total

- **WHEN** loss is requested in total, by reason, and by product
- **THEN** the by-reason values sum to the total
- **AND** the by-product values sum to the same total

### Requirement: Completeness of a reconciliation

The system SHALL report, with every reconciliation, any SKU whose cost or product identity
could not be resolved, and SHALL mark a reconciliation containing such SKUs as incomplete.

#### Scenario: Unpriced SKU makes a reconciliation incomplete

- **GIVEN** a month containing a SKU with no cost for that month
- **WHEN** the reconciliation is computed
- **THEN** it is marked incomplete
- **AND** the unpriced SKU is listed with its quantity and the reason it could not be valued

#### Scenario: An unpriced SKU is never treated as zero cost

- **GIVEN** a month containing an unpriced SKU
- **WHEN** the figures are computed
- **THEN** that SKU's quantity does not contribute a value of zero to any total
- **AND** the affected totals are identified as incomplete

#### Scenario: A complete reconciliation is distinguishable

- **WHEN** every SKU in a month resolves to a product and a cost
- **THEN** the reconciliation is marked complete

#### Scenario: Incompleteness is visible on rollups

- **WHEN** figures are aggregated across stores and any contributing reconciliation is
  incomplete
- **THEN** the aggregate is also marked incomplete

### Requirement: Recomputation

The system SHALL recompute a store's month when its underlying data changes, and
recomputation SHALL be idempotent.

#### Scenario: Period data change triggers recomputation

- **WHEN** a store's period data changes
- **THEN** that store's month is recomputed

#### Scenario: Repeated recomputation is stable

- **WHEN** the same store and month is recomputed more than once with no change to the
  underlying data or costs
- **THEN** the resulting figures are identical each time

#### Scenario: Recomputation is scoped

- **GIVEN** a change affecting one store's month
- **WHEN** recomputation runs
- **THEN** other stores and other months are unchanged

### Requirement: Monetary precision

The system SHALL perform all monetary arithmetic exactly, without binary floating point, and
SHALL state the rounding rule applied wherever a value is rounded for presentation.

#### Scenario: Totals sum exactly

- **WHEN** per-SKU values are summed into a total
- **THEN** the total equals the exact sum of its components with no accumulated drift

#### Scenario: Rounding is applied once and disclosed

- **WHEN** a value is rounded for display
- **THEN** the rounding happens at presentation, not during intermediate arithmetic

### Requirement: Reads

The system SHALL expose a store's reconciliation for a month, the network-wide rollup for a
month, and comparisons across months for a store.

#### Scenario: Reading one store's month

- **WHEN** a store's month is requested
- **THEN** the four figures, the loss breakdowns, and the completeness statement are returned

#### Scenario: Reading a network rollup

- **WHEN** a month is requested across all stores
- **THEN** the figures are aggregated across stores
- **AND** the result states how many stores contributed

#### Scenario: Comparing months

- **WHEN** several months are requested for one store
- **THEN** each month's figures are returned
- **AND** each carries its own completeness statement
