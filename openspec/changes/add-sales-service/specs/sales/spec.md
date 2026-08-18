## Purpose

The authoritative record of what was sold: quantities and revenue per store, per period,
per SKU, as reported by the POS platform. It is the input the reconciliation uses to derive
cost of goods sold and to account for stock that left a store through the checkout.

## ADDED Requirements

### Requirement: Sales record grain

The system SHALL store sales at the grain of store, reporting period and SKU, recording the
quantity sold and the revenue for that combination. It SHALL NOT require per-transaction
detail, which the source reports do not provide.

#### Scenario: Recording a sales row

- **WHEN** a sales row for a store, period and SKU is recorded with a quantity and revenue
- **THEN** it is persisted at that grain and is retrievable by store and period

#### Scenario: One row per SKU per store per period

- **GIVEN** an existing sales row for a store, period and SKU
- **WHEN** another row for the same combination is recorded
- **THEN** the result is a single row for that combination, not two

### Requirement: Idempotent ingestion

The system SHALL make repeated ingestion of the same store and period converge to the same
result rather than accumulating. Re-ingesting a period SHALL replace that period's rows for
that store.

#### Scenario: Re-uploading the same report does not double figures

- **GIVEN** a store and period whose sales have been ingested
- **WHEN** the identical report is ingested again
- **THEN** the stored quantities and revenue are unchanged

#### Scenario: Re-uploading a corrected report replaces the old data

- **GIVEN** a store and period already ingested
- **WHEN** a corrected report for the same store and period is ingested
- **THEN** the stored rows reflect the corrected figures
- **AND** no row from the superseded ingestion remains

#### Scenario: A SKU absent from the corrected report is removed

- **GIVEN** an ingested period containing a SKU
- **WHEN** a corrected report for that store and period omits that SKU entirely
- **THEN** that SKU no longer has a sales row for that period

#### Scenario: Ingesting a different period leaves other periods intact

- **GIVEN** a store with ingested sales for two periods
- **WHEN** one of those periods is re-ingested
- **THEN** the other period's rows are unchanged

### Requirement: Provenance

The system SHALL record, for each sales row, which ingestion produced it, so any stored
figure can be traced back to the uploaded file it came from.

#### Scenario: Tracing a figure to its upload

- **GIVEN** a stored sales row
- **WHEN** its provenance is inspected
- **THEN** it identifies the ingestion that produced it

#### Scenario: Provenance updates on replacement

- **GIVEN** a period ingested once and then re-ingested
- **WHEN** the resulting rows' provenance is inspected
- **THEN** it identifies the most recent ingestion, not the superseded one

### Requirement: Aggregated reads

The system SHALL expose sales for a given store and period, and SHALL expose totals
aggregated across SKUs, so callers deriving cost of goods sold or stock movement do not
recompute the aggregation themselves.

#### Scenario: Reading a store's period

- **WHEN** sales are requested for a store and period
- **THEN** every SKU row for that combination is returned with its quantity and revenue

#### Scenario: Reading totals

- **WHEN** totals are requested for a store and period
- **THEN** the total quantity and total revenue equal the sums of the individual rows

#### Scenario: Reading a period with no data

- **WHEN** sales are requested for a store and period that was never ingested
- **THEN** the system reports that no data exists for that period
- **AND** it SHALL NOT return zeroes, which would be indistinguishable from a period that
  genuinely had no sales

### Requirement: Revenue representation

The system SHALL represent revenue as an exact decimal value in integer minor units of
currency, and SHALL NOT use binary floating point for any stored or transported monetary
amount.

#### Scenario: Revenue survives aggregation exactly

- **WHEN** many sales rows are summed
- **THEN** the total equals the exact sum of the individual amounts, with no rounding drift
