## ADDED Requirements

### Requirement: Supply operations are forwarded per visit

The system SHALL forward, for every accepted restocking-report operation, the operation's
kind, start and end instants and, per SKU, the balance before, the confirmed count when one
is present, the quantity to restock when present, the restocked quantity, the removed total,
the adjustment and the balance after, in addition to the quantities it already forwards per
store and period. A line whose arithmetic identity does not hold SHALL continue to be
rejected and SHALL NOT be forwarded as a visit line.

#### Scenario: A counted line carries its count

- **GIVEN** a restocking-report line with a confirmed count
- **WHEN** the report is parsed
- **THEN** the forwarded visit line carries that confirmed count

#### Scenario: A line without a count is forwarded without one

- **GIVEN** a restocking-report line whose confirmed-count cell is empty
- **WHEN** the report is parsed
- **THEN** the forwarded visit line carries no confirmed count, not zero

#### Scenario: A line that breaks the balance identity is not forwarded

- **GIVEN** a line where balance before plus restocked plus removals plus adjustment differs from balance after
- **WHEN** the report is parsed
- **THEN** the line is rejected with its reason
- **AND** it does not appear in the forwarded visit lines

### Requirement: Operations without a client are counted, not silently dropped

The system SHALL count the operations and lines of a restocking report whose client (store)
cannot be identified, keep rejecting them for store-level ingestion, and make the counts
observable on the ingestion outcome so a consumer can tell them apart from data that was
never present.

#### Scenario: Distribution-center inventory operations are counted

- **GIVEN** a restocking report containing inventory operations with an empty client
- **WHEN** the report is ingested
- **THEN** no store receives their quantities
- **AND** the ingestion outcome reports how many operations and lines were set aside for having no client
