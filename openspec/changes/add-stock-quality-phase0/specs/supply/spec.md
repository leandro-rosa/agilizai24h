## ADDED Requirements

### Requirement: Supply visits are recorded per operation

The system SHALL record each supply operation (visit) of a store, with its kind
(restocking, inventory or combined), its start and end instants and the instant of the
previous operation's end when reported, together with one line per SKU carrying the
quantities reported for that operation: balance before, confirmed count when one was
made, quantity to restock when reported, restocked quantity, removed quantity, signed
adjustment and balance after. Visit records SHALL be stored in addition to, and SHALL
NOT change, the monthly restock, removal, adjustment and recorded-closing-balance
records.

#### Scenario: A combined operation is recorded with its count

- **GIVEN** a combined operation at a store in which a SKU had balance before 8, confirmed count 8, restocked 21 and balance after 29
- **WHEN** the operation is ingested
- **THEN** a visit of kind combined exists with the operation's start and end instants
- **AND** its line for that SKU reports balance before 8, confirmed 8, restocked 21 and balance after 29

#### Scenario: A line without a count keeps the count empty

- **GIVEN** an operation line in which no confirmed count was reported
- **WHEN** the operation is ingested
- **THEN** the stored line has no confirmed count
- **AND** the absence is distinguishable from a confirmed count of zero

#### Scenario: Monthly records are unaffected

- **GIVEN** a store and period ingested before and after visits were recorded
- **WHEN** the restock, removal, adjustment and recorded closing balance for the period are read
- **THEN** they are identical to what the same data produced without visit recording

### Requirement: Visit records converge on re-ingestion

The system SHALL replace the visit records of a store and period when that store and period
are ingested again, so repeated or corrected ingestion neither duplicates nor leaves behind
visits from a superseded ingestion, and other periods of the same store are unchanged.

#### Scenario: Re-ingesting the same report does not duplicate visits

- **GIVEN** a store and period whose visits have been recorded
- **WHEN** the identical data is ingested again
- **THEN** the number of visits and lines for that store and period is unchanged

#### Scenario: A corrected report replaces the period's visits

- **GIVEN** a store and period whose visits have been recorded
- **WHEN** corrected data for the same store and period is ingested
- **THEN** no visit from the superseded ingestion remains

### Requirement: Visits are readable by store and range

The system SHALL return the visits and lines of a store for a range of periods, ordered by
the end instant of the visit, so a consumer can follow the balance of a SKU from one visit
to the next without re-parsing any report.

#### Scenario: Reading a range

- **GIVEN** a store with visits in March and April
- **WHEN** the range March to April is read
- **THEN** all visits of both periods are returned ordered by end instant

#### Scenario: A range with no visits

- **WHEN** a range with no recorded visits is read
- **THEN** the result is an empty list, not an error
