## MODIFIED Requirements

### Requirement: Reconciliation figures

The system SHALL compute, for a store and month, the restocked value, the cost of goods
sold, the remaining stock value, and the real loss, each as a currency amount derived from
recorded quantities valued at cost, and SHALL report the value of net inventory adjustments
as an unclassified stock adjustment figure of its own, valued at current cost, rather than
folding it into any of the four or attributing it to the store or month that originally
restocked the units.

An inventory adjustment mixes several real causes the platform cannot currently tell
apart — a deliberate transfer between stores, a self-checkout customer taking a different
item than the one they paid for, and a data-entry error when confirming quantities — so it
is reported as its own figure rather than assumed to be only a transfer. Counting it as
restocked value would state money the network did not spend a second time, inflating a
headline figure the operators reconcile by hand. Counting it as nothing would leave stock
appearing on a shelf with no accounting for it, and would also hide a self-checkout mismatch
or a process error behind silence. Its own figure keeps the four comparable with the manual
reconciliation while keeping the adjustment visible for operational review.

#### Scenario: Computing a month

- **WHEN** a reconciliation is computed for a store and month with recorded movements
- **THEN** it reports restocked value, cost of goods sold, remaining stock value and real loss

#### Scenario: Figures derive from quantities and cost

- **GIVEN** a SKU with 10 units restocked at a cost of 2.50 each
- **WHEN** the restocked value is computed
- **THEN** that SKU contributes 25.00

#### Scenario: An adjustment is not restocked value

- **GIVEN** a SKU whose only inbound movement is an inventory adjustment
- **WHEN** the month is reconciled
- **THEN** the restocked value for that SKU is zero
- **AND** the unclassified stock adjustment figure reports the units received at current cost

#### Scenario: An adjustment is reported in both directions

- **WHEN** a month contains both inbound and outbound adjustments
- **THEN** the unclassified stock adjustment figure is their net, at current cost
- **AND** an outbound adjustment does not reduce the real loss

#### Scenario: An adjustment never restates a prior month

- **GIVEN** a SKU whose units arrived at a store through an inbound adjustment
- **WHEN** the month is reconciled
- **THEN** no other store's or month's already-computed restocked value is changed
- **AND** the system does not attempt to identify which store or month originally
  restocked those units

#### Scenario: Frequent or large adjustments are flagged for review

- **WHEN** a store and SKU carry adjustments repeatedly or in large quantity across a
  window of months
- **THEN** that store and SKU combination is surfaced for manual operational review
- **AND** the figures are not adjusted or corrected on the basis of the flag alone

#### Scenario: Adjustments still affect remaining stock

- **GIVEN** a SKU that received units through an adjustment and sold none of them
- **WHEN** the month is reconciled
- **THEN** those units are included in the remaining stock value

#### Scenario: A month with no data

- **WHEN** a reconciliation is requested for a store and month with no recorded movements
- **THEN** the system reports that no data exists for that month
- **AND** it SHALL NOT report zeroes, which would be indistinguishable from a month of no
  activity

### Requirement: Completeness of a reconciliation

The system SHALL state whether a reconciliation is complete, and SHALL mark it incomplete
when any SKU could not be priced, or when any SKU's stock was reported as inconsistent
(a negative derived balance).

The operators' own recorded closing balance (`Qtd. final`) is read and stored, but is
**not** cross-checked against the derived month-end balance: it is a reading taken at the
moment of the last restocking visit within the month, not a month-end closing figure, and
the sales report carries no per-sale date to attribute what sold before or after that visit.
Comparing it to a whole-month derived total would flag most months as disputed regardless of
whether anything is actually wrong — measured live, on real data, doing exactly that against
a real store-month. See `ingestion-worker-service/CLAUDE.md` for the finding.

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

- **WHEN** every SKU in a month resolves to a product and a cost, and no SKU's stock is
  inconsistent
- **THEN** the reconciliation is marked complete

#### Scenario: Incompleteness is visible on rollups

- **WHEN** figures are aggregated across stores and any contributing reconciliation is
  incomplete
- **THEN** the aggregate is also marked incomplete

#### Scenario: The stores responsible for an incomplete aggregate are named

- **WHEN** an aggregate is reported as incomplete
- **THEN** the stores responsible are named, so the gap can be closed rather than noticed
