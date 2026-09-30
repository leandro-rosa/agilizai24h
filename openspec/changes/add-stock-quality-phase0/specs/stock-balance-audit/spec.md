## Purpose

Measures how far the balance the system holds for a SKU at a store can be trusted, by comparing it with physical counts and with registered sales, and presents the evidence in the admin panel without deciding what is acceptable.

## ADDED Requirements

### Requirement: Counts are compared with the system balance

The system SHALL compare, for every visit line that carries a confirmed count, the count
with the balance the system held before the operation, and report the number of counted
lines, the share in which the two are equal, and the distribution of the absolute and of the
relative difference. The comparison SHALL be reported separately for each turnover band and
each balance band, and SHALL state for each figure how many lines it covers.

#### Scenario: Equal and different counts

- **GIVEN** counted lines where most counts equal the system balance and a few differ
- **WHEN** the audit is read
- **THEN** it reports the number of counted lines, the share equal, and the distribution of the differences
- **AND** the difference is reported both in units and relative to the system balance

#### Scenario: Stratification by turnover

- **GIVEN** counted lines of high-turnover and low-turnover SKUs
- **WHEN** the audit is read
- **THEN** the figures are given per turnover band, each with its own line count

#### Scenario: A line without a count is not a match

- **GIVEN** visit lines without a confirmed count
- **WHEN** the audit is computed
- **THEN** they are excluded from the count comparison and reported as uncounted coverage
- **AND** they are never treated as counts equal to the system balance

### Requirement: Count coverage is reported

The system SHALL report, per store and per month, how many operations contained at least one
counted line, how many lines were counted, and what share of the lines with a positive system
balance were counted, so a reader can judge how much of the stock the counts represent.

#### Scenario: Partial counting is visible

- **GIVEN** an operation in which only some lines with positive balance were counted
- **WHEN** the audit is read
- **THEN** the share of positive-balance lines that were counted is reported for that store and month

### Requirement: Consumption between visits is compared with registered sales

The system SHALL compute, for each SKU at a store, the consumption between consecutive
visits as the balance after one visit minus the balance before the next, allocate it over
calendar months in proportion to the days each interval spends in the month, and compare it
with the registered sales of the same store, SKU and month. Only months fully covered by the
visit chain SHALL be compared. The comparison SHALL be reported as the difference in units
and relative, per turnover band, and as the ratio of total consumption to total sales per
store and month.

#### Scenario: Interval spanning two months

- **GIVEN** two consecutive visits of a SKU, one in March and one in April, with consumption 10
- **WHEN** consumption is allocated to months
- **THEN** each month receives the part of the 10 proportional to the days of the interval inside it

#### Scenario: A month not fully covered is not compared

- **GIVEN** a store whose visit chain ends in the middle of a month
- **WHEN** the audit is computed
- **THEN** that month is not included in the consumption-versus-sales comparison

#### Scenario: The balance rises between visits without an event

- **GIVEN** consecutive visits where the balance before the next visit exceeds the balance after the previous one
- **WHEN** the audit is computed
- **THEN** the pair is counted and reported as a balance increase without a recorded event
- **AND** it is not reported as negative consumption in the distributions

### Requirement: Data gaps are reported next to the figures

The system SHALL report the store-months in which registered sales are absent while visits
show consumption, the operations and lines set aside for having no client, the share of lines
that report a capacity, and the period covered by the visits, and SHALL exclude
store-months with absent sales from the consumption-versus-sales distributions while listing
them.

#### Scenario: A store-month with consumption and no sales

- **GIVEN** a store and month with consumption from visits and no registered sales for any SKU
- **WHEN** the audit is read
- **THEN** the store-month is listed as a gap
- **AND** it is excluded from the distributions rather than counted as a large difference

#### Scenario: Capacity is empty

- **GIVEN** visit lines whose capacity is always empty
- **WHEN** the audit is read
- **THEN** it reports that capacity is not available, rather than a capacity of zero

### Requirement: The audit sets no tolerance

The system SHALL present distributions and counts only. It SHALL NOT label a store, SKU or
month as passing or failing, SHALL NOT expose a tolerance threshold, and SHALL NOT use the
audit result to enable or disable any recommendation, until a tolerance is defined and
recorded by the business in a later change.

#### Scenario: No verdict is shown

- **WHEN** the audit is presented
- **THEN** no figure is labelled acceptable, unacceptable, passing or failing

#### Scenario: No behavior depends on the audit

- **WHEN** the audit result changes
- **THEN** no recommendation, estimated balance or supply suggestion in the system changes

### Requirement: Quality of balance is presented in the admin panel

The admin panel SHALL provide a read-only "Qualidade do saldo" view under Commercial
Intelligence that shows the audit, distinguishes loading, empty, error and forbidden states,
and labels every figure with its line count and the period it covers. The view SHALL state
that consumption and sales originate from the same point-of-sale source, so their agreement
validates alignment of the data and does not establish physical truth.

#### Scenario: Viewing the audit

- **WHEN** an authorised user opens the view
- **THEN** count-versus-system, count coverage, consumption-versus-sales and data gaps are shown with their line counts

#### Scenario: No visits recorded yet

- **GIVEN** a system where visits have not been ingested
- **WHEN** an authorised user opens the view
- **THEN** an empty state explains that no visit data exists, not an error and not zero differences

#### Scenario: Forbidden

- **WHEN** a user without permission opens the view
- **THEN** a forbidden state is shown and no audit data is requested from the user's session beyond the permission check
