# supply Specification

## Purpose
Restocking and removal records per store and period, and the classification that decides
which removed units count as real loss. This capability owns the loss rule that the whole
reconciliation is built to get right, and the per-reason breakdown every currency figure for
loss is derived from.

## Requirements

### Requirement: Removal reasons and their loss classification

The system SHALL recognise each removal reason explicitly and SHALL record, for each,
whether it counts as real loss. Expired, damaged product, and other reason SHALL count as
real loss. Return, transfer, and internal use SHALL NOT count as real loss.

#### Scenario: Loss-counting reasons

- **WHEN** units are removed as expired, as damaged product, or as other reason
- **THEN** those units count toward real loss

#### Scenario: Non-loss reasons

- **WHEN** units are removed as a return, as a transfer, or as internal use
- **THEN** those units do not count toward real loss
- **AND** they are still recorded as removals

#### Scenario: Classification is explicit data, not inferred

- **WHEN** the set of recognised reasons is inspected
- **THEN** each reason states whether it counts as loss
- **AND** the classification can be reported on without re-deriving it from a query

#### Scenario: An unrecognised reason is not silently treated as loss or as non-loss

- **WHEN** a removal arrives with a reason the system does not recognise
- **THEN** it is rejected or flagged for review
- **AND** it SHALL NOT be silently assigned to either bucket

### Requirement: Per-reason removal quantities

The system SHALL store removal quantities broken down by reason, at the grain of store,
period, SKU and reason. A removal that spans multiple reasons SHALL be stored as one record
per reason.

#### Scenario: Single-reason removal

- **WHEN** 4 units are removed from a store for a SKU as expired
- **THEN** one removal record exists for that store, period, SKU and the expired reason,
  with a quantity of 4

#### Scenario: Mixed-reason removal is stored split

- **WHEN** a removal of 9 units is reported as 6 return and 3 other reason
- **THEN** two records exist for that store, period and SKU: 6 under return and 3 under
  other reason
- **AND** no record carries the combined quantity of 9

#### Scenario: Split quantities reconcile to the reported total

- **WHEN** a mixed-reason removal is stored
- **THEN** the sum of its per-reason quantities equals the total quantity removed

### Requirement: Real loss derivation

The system SHALL derive real loss for a store and period as the sum of removal quantities
whose reason counts as loss, and SHALL expose that figure broken down by reason and by SKU
as well as in total.

#### Scenario: Mixed-reason removal contributes only its loss portion

- **GIVEN** a removal of 9 units recorded as 6 return and 3 other reason
- **WHEN** real loss is derived for that store, period and SKU
- **THEN** it is 3 units, not 9

#### Scenario: A period of only non-loss removals has zero real loss

- **GIVEN** a store and period whose only removals are returns and transfers
- **WHEN** real loss is derived
- **THEN** it is zero
- **AND** the removals are still reported as removals

#### Scenario: Loss broken down by reason

- **WHEN** real loss is requested for a store and period broken down by reason
- **THEN** each loss-counting reason reports its own quantity
- **AND** the reported reasons exclude the non-loss ones

#### Scenario: Breakdowns sum to the total

- **WHEN** real loss is requested both in total and broken down by SKU
- **THEN** the per-SKU quantities sum to the total

### Requirement: Restock records

The system SHALL store restocked quantities at the grain of store, period and SKU,
independently of removals.

#### Scenario: Recording a restock

- **WHEN** a restock of a SKU at a store for a period is recorded
- **THEN** it is persisted at that grain and is retrievable by store and period

#### Scenario: Restocks and removals are distinct

- **GIVEN** a store, period and SKU with both a restock and a removal
- **WHEN** the period is read
- **THEN** the restocked quantity and the removed quantities are reported separately
- **AND** neither is netted into the other

### Requirement: Idempotent ingestion

The system SHALL make repeated ingestion of the same store and period converge to the same
result rather than accumulating, replacing that period's restock and removal records for
that store.

#### Scenario: Re-ingesting the same report does not double quantities

- **GIVEN** a store and period whose supply data has been ingested
- **WHEN** the identical data is ingested again
- **THEN** the stored restock and removal quantities are unchanged

#### Scenario: A corrected report replaces the period

- **GIVEN** a store and period already ingested
- **WHEN** corrected data for the same store and period is ingested
- **THEN** the stored records reflect the corrected figures
- **AND** no record from the superseded ingestion remains

#### Scenario: Other periods are unaffected

- **GIVEN** a store with ingested supply data for two periods
- **WHEN** one period is re-ingested
- **THEN** the other period's records are unchanged

### Requirement: Period data updated event

The system SHALL publish an event when a store's period data changes, so that downstream
reconciliation can recompute without this service knowing how reconciliation works.

#### Scenario: Ingestion publishes the event

- **WHEN** a store's period restock or removal data is created or replaced
- **THEN** an event identifying that store and period is published

#### Scenario: The event carries no reconciliation logic

- **WHEN** the event is inspected
- **THEN** it identifies the store and period that changed
- **AND** it contains no computed monetary figures

#### Scenario: No event when nothing changed

- **WHEN** an ingestion completes without altering any stored record
- **THEN** no period-data-updated event is published

### Requirement: Reads for reconciliation

The system SHALL expose, for a given store and period, the restocked quantities per SKU and
the removal quantities per SKU and reason, so that a caller valuing the period in currency
receives quantities it does not have to re-derive.

#### Scenario: Reading a period for valuation

- **WHEN** a caller requests a store's period
- **THEN** it receives restocked quantities per SKU and removal quantities per SKU and
  reason, each marked with whether the reason counts as loss

#### Scenario: Reading a period with no data

- **WHEN** a store and period that was never ingested is requested
- **THEN** the system reports that no data exists
- **AND** it SHALL NOT return zeroes, which would be indistinguishable from a period with no
  restocks or removals
