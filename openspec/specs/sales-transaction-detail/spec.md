# sales-transaction-detail Specification

## Purpose

Persisting one record per sales transaction — timestamp, payment method, discount, buyer and
point-of-sale identifiers, and the transaction's own outcome — for stores whose sales report
carries that detail, so behavioral analysis (when people buy, how they pay, whether a machine
is failing, whether a promotion moved volume) does not have to be reconstructed from the
per-SKU aggregate `sales` already provides.

## Requirements

### Requirement: Transaction record grain

The system SHALL store a sales transaction detail record per individual transaction — one row
per line of the source report — distinct from and in addition to the per-SKU-per-period
aggregate the `sales` capability maintains. It SHALL NOT replace, recompute, or otherwise
derive the aggregate from this detail.

#### Scenario: Recording a transaction

- **WHEN** a sales transaction for a store is reported with its timestamp, SKU, quantity and
  amount
- **THEN** it is persisted as its own record, distinguishable from every other transaction
  even when another transaction shares the same store, period and SKU

#### Scenario: The aggregate is unaffected

- **GIVEN** a store and period whose transaction detail has been recorded
- **WHEN** that store and period's per-SKU aggregate is read
- **THEN** the aggregate reflects only what the aggregate ingestion path itself produced,
  never a recomputation from transaction detail records

### Requirement: Detail is only as complete as the source report

The system SHALL persist a transaction detail field only when the source report actually
carries it, SHALL leave a field absent (never a fabricated or zero value) when the report does
not carry it, and SHALL NOT require every field to be present for a transaction to be
recorded.

#### Scenario: A report without a given field

- **WHEN** a sales report carries no payment method column
- **THEN** transaction records from that report have no payment method value
- **AND** they are still recorded with whatever fields the report did carry

#### Scenario: A report with no transaction detail at all

- **WHEN** a sales report carries none of the transaction-level columns, only the per-SKU
  totals the `sales` capability's aggregate requires
- **THEN** no transaction detail records are produced for that store and period
- **AND** the per-SKU aggregate is still recorded normally

### Requirement: Every attempted transaction is recorded, not only completed sales

The system SHALL record a transaction detail row regardless of the transaction's own result
(completed, declined, cancelled, or any other outcome the source report distinguishes), and
SHALL preserve that result on the record, so completed and non-completed transactions remain
distinguishable from each other.

#### Scenario: A declined transaction is recorded

- **WHEN** a sales report includes a transaction whose result is not a completed sale
- **THEN** a transaction detail record is created for it, carrying that result
- **AND** it is distinguishable from a completed transaction when the records are read back

#### Scenario: A declined transaction's outcome is never invented

- **WHEN** a transaction detail record is read back
- **THEN** its result reflects exactly what the source report stated, never inferred or
  defaulted to a completed outcome

### Requirement: Reading transaction detail

The system SHALL expose transaction detail records for a given store and period.

#### Scenario: Reading a store's period

- **WHEN** transaction detail is requested for a store and period
- **THEN** every transaction detail record for that store and period is returned

#### Scenario: Reading a period with no transaction detail

- **WHEN** transaction detail is requested for a store and period that has no transaction
  detail records — either because it was never ingested, or because it was ingested from a
  report that carried no transaction-level columns
- **THEN** the system reports that no transaction detail exists for that store and period
- **AND** it SHALL NOT return an empty list indistinguishable from "ingested, zero
  transactions"

### Requirement: Provenance and idempotent replacement

The system SHALL record which ingestion produced each transaction detail record, and SHALL
make re-ingesting a store's period for transaction detail replace that period's transaction
detail records rather than accumulating duplicates — the same contract the `sales` capability
already guarantees for the aggregate.

#### Scenario: Re-ingesting a period replaces its transaction detail

- **GIVEN** a store and period with transaction detail already recorded
- **WHEN** that store and period is ingested again
- **THEN** the stored transaction detail reflects only the new ingestion
- **AND** no transaction detail record from the superseded ingestion remains

### Requirement: Monetary and quantity fields are exact

The system SHALL represent every monetary transaction detail field (amount paid, original
amount, discount) as an exact integer number of minor currency units, and SHALL NOT use
binary floating point for any stored or transported amount.

#### Scenario: A discount is recorded exactly

- **WHEN** a transaction with a stated discount is recorded
- **THEN** the discount, the original amount and the amount paid are each stored as exact
  integer minor units
- **AND** original amount minus discount equals the amount paid whenever the source report's
  own figures satisfy that relationship
