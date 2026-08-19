## Purpose

Describes the shape of the operators' real exports — how a workbook is arranged, which
operation kinds it contains, and what each column is called — so that a change to the
export is a change to one spec rather than a hunt through parsing behaviour.

## ADDED Requirements

### Requirement: Restocking workbook layout

A restocking export SHALL be read as one workbook per month containing one sheet per
operation, where each sheet holds an operation header followed by a product table, and the
system SHALL fail an upload whose sheets do not have that shape rather than parsing what
it can.

#### Scenario: A sheet is read as two stacked tables

- **GIVEN** a sheet whose first rows describe one operation and whose later rows list products
- **WHEN** the sheet is parsed
- **THEN** the operation attributes are read from the header rows
- **AND** the product rows are read from the table that follows it

#### Scenario: A workbook covers many stores

- **WHEN** a workbook contains sheets for several different stores
- **THEN** every sheet is attributed to the store its own operation header names
- **AND** the upload is not required to name a single store

#### Scenario: A sheet that does not match the expected shape fails

- **WHEN** a sheet has no recognisable product table
- **THEN** the ingestion reports that sheet as unparseable, naming it
- **AND** rows are not read from arbitrary positions

### Requirement: Operation kinds

The system SHALL recognise the operation kinds the export produces — restocking, inventory,
and combined — and SHALL reject an unrecognised kind rather than assuming restocking.

#### Scenario: A restocking operation

- **WHEN** an operation is a restocking
- **THEN** its restocked quantities and its removals are ingested

#### Scenario: An inventory operation

- **WHEN** an operation is an inventory
- **THEN** its adjustment quantities and its removals are ingested
- **AND** an absent restocked quantity is read as none, not as an error

#### Scenario: A combined operation

- **WHEN** an operation is a combined one
- **THEN** its restocked quantities, adjustments and removals are all ingested

#### Scenario: An unrecognised operation kind is rejected

- **WHEN** an operation states a kind the system does not recognise
- **THEN** the operation is rejected and reported, naming the unrecognised kind
- **AND** its rows are not attributed to any movement type

### Requirement: Column vocabulary is the export's own

The system SHALL read each field by the column name the real export writes, and SHALL fail
a file that does not carry an expected column rather than treating the missing value as zero.

#### Scenario: A missing expected column fails the file

- **WHEN** a file lacks a column the parser requires
- **THEN** the ingestion fails, naming the missing column and the file
- **AND** no rows are ingested from it

#### Scenario: A removal count is not mistaken for reason text

- **GIVEN** the export carries the removed quantity and the removal reason text in separate columns
- **WHEN** a row is parsed
- **THEN** the reason text is read from the reason column
- **AND** the quantity column is never parsed as reason text

#### Scenario: Column names are matched case- and accent-insensitively

- **WHEN** a header differs only by letter case, accents or surrounding whitespace
- **THEN** it is still matched to its field

### Requirement: The recorded closing balance is a cross-check

The system SHALL verify each product row against the closing balance the operators
recorded, and SHALL surface a disagreement rather than silently preferring either value.

#### Scenario: The row balances

- **WHEN** a row's recorded closing balance equals its opening balance plus restocked
  quantity plus removals plus adjustment
- **THEN** the row is ingested normally

#### Scenario: The row does not balance

- **WHEN** a row's recorded closing balance does not equal that sum
- **THEN** the row is reported as disagreeing, naming the store, period, product and both values
- **AND** the disagreement is visible in the ingestion result rather than resolved silently
