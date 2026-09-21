## ADDED Requirements

### Requirement: Network-wide sales format transaction detail is captured

The system SHALL, for a sales report in the network-wide per-transaction format (identified,
as today, by the presence of a `Cliente` column), read and stage each transaction-level column
the report carries — timestamp, original amount, discount, payment method, acquirer, card
brand, card's last digits, internal and acquirer transaction codes, point-of-sale identifier,
machine model, and buyer number — in addition to the columns already read for store
resolution, product resolution and the per-SKU aggregate. It SHALL treat a column's absence as
that field being unavailable for every row of that report, never as a reason to reject the
report or the row.

The old, pre-aggregated per-SKU sales format carries none of these columns and SHALL NOT be
expected to.

#### Scenario: A network-format row's transaction columns are captured

- **WHEN** a network-wide sales report row is parsed
- **THEN** the transaction-level columns it carries are read and staged alongside the row's
  quantity and amount, for the transaction detail capability to persist

#### Scenario: A missing optional column does not fail the file

- **WHEN** a network-wide sales report is missing one of the transaction-level columns (for
  example, no acquirer column)
- **THEN** the file is still parsed successfully
- **AND** rows from it are staged without a value for that column, not rejected

#### Scenario: The old format is unaffected

- **WHEN** an old-format sales report (no `Cliente` column) is parsed
- **THEN** no transaction-level columns are read or staged for it
- **AND** its per-SKU aggregate is produced exactly as before this requirement existed

### Requirement: A resolved but non-completed transaction is staged for detail, not only rejected

The system SHALL continue to report a network-wide sales report row whose result is not a
completed sale as a rejection and exclude it from the per-SKU aggregate, exactly as before
this requirement existed. In addition, when that row's store and product both resolve, the
system SHALL ALSO stage it for transaction detail, carrying its actual result — the rejection
and the staged detail row are not exclusive of each other.

#### Scenario: A declined transaction is still reported as a rejection

- **GIVEN** a network-wide sales report row whose result is not a completed sale
- **WHEN** the row is processed
- **THEN** it is reported as a rejection, the same as before this requirement existed
- **AND** it does not contribute to the per-SKU aggregate's quantity or revenue

#### Scenario: A declined transaction with a resolvable product and store is also staged for detail

- **GIVEN** a network-wide sales report row whose result is not a completed sale
- **WHEN** its store and product both resolve
- **THEN** it is, in addition to being reported as a rejection, staged as a transaction detail
  row carrying its actual result

#### Scenario: An unresolvable row produces no transaction detail

- **GIVEN** a network-wide sales report row whose store or product cannot be resolved
- **WHEN** the row is processed
- **THEN** it is reported as a rejection, the same as any other row with an unresolvable store
  or product
- **AND** no transaction detail row is staged for it, regardless of its result
