# ingestion Specification

## Purpose
Accepting the operational spreadsheets that drive the platform, parsing them away from the
request path, normalising their rows into domain records, and reporting precisely what each
upload did — including what it could not interpret.

## Requirements

### Requirement: Upload accepted without waiting for parsing

The system SHALL accept an uploaded spreadsheet, persist the raw file to object storage, and
return an ingestion identifier without parsing the file during the request.

#### Scenario: Upload returns promptly

- **WHEN** an operator uploads a spreadsheet
- **THEN** the response returns an ingestion identifier
- **AND** parsing has not been performed during that request

#### Scenario: Raw file is retained

- **WHEN** an upload is accepted
- **THEN** the original file is stored in object storage unmodified
- **AND** it remains retrievable by the ingestion identifier

#### Scenario: Structured data is not stored as a file

- **WHEN** parsing completes
- **THEN** the resulting records are persisted as structured data in the owning services
- **AND** the parsed rows are not written back as a file in place of database records

### Requirement: File type determines the parser

The system SHALL treat the three operational file types — sales report, restocking/removal
report, and price/cost reference — as distinct, each with its own parsing path and its own
result contract, and SHALL reject a file whose contents do not match its declared type
rather than parsing it as something else.

#### Scenario: Each type is routed to its own parser

- **WHEN** a file of a given type is uploaded
- **THEN** it is queued for the parser belonging to that type only

#### Scenario: A file that does not match its declared type is rejected

- **WHEN** an uploaded file's contents do not match the structure expected for its declared
  type
- **THEN** the ingestion fails with an error naming the mismatch
- **AND** no records are written to any domain service

#### Scenario: A file is parsed as its stated type

- **WHEN** a file is uploaded as a given type
- **THEN** it is parsed with the layout that type defines

#### Scenario: Contents contradicting the stated type are rejected

- **WHEN** a file's columns do not match the layout its stated type defines
- **THEN** the ingestion fails, naming the stated type and what was found
- **AND** no other layout is attempted

### Requirement: Store resolution

The system SHALL resolve each set of ingested rows to a store, taking the store from the
report itself where the report names one and from the uploader where it does not, and
SHALL fail the affected rows when the store cannot be resolved.

A restocking workbook names its store per operation and covers many stores in one file, so
requiring the uploader to state a single store would attribute other stores' rows to it.
A sales report carries no store anywhere in the file, so there the uploader must state it.

#### Scenario: Report resolves to a store

- **GIVEN** a store registered with a matching external code
- **WHEN** a report carrying that code is parsed
- **THEN** the resulting records are attributed to that store

#### Scenario: Unknown store code fails the ingestion

- **WHEN** a report carries an external code matching no store
- **THEN** the ingestion fails with an error naming the unresolved code
- **AND** no records are written for that file

#### Scenario: A report that names its own store

- **GIVEN** a store registered with a matching external code
- **WHEN** an operation naming that store is parsed
- **THEN** the resulting records are attributed to that store
- **AND** the store the uploader stated, if any, is not used for those rows

#### Scenario: A report that names no store

- **WHEN** a report carries no store identity of its own
- **THEN** the records are attributed to the store the uploader stated
- **AND** an upload with no store stated is rejected before parsing

#### Scenario: Unknown store fails only its own rows

- **WHEN** one operation names a store matching no registered store
- **THEN** that operation is reported as unresolved, naming the value it carried
- **AND** operations in the same file that did resolve are still ingested

#### Scenario: Store names are matched tolerantly

- **WHEN** a store name differs from the registered code only by surrounding whitespace,
  letter case or accents
- **THEN** it still resolves to that store

### Requirement: Removal reason parsing

The system SHALL parse the removal reason text into quantities per reason, SHALL treat a
field naming several reasons as several quantities rather than one, and SHALL sum a reason
that appears more than once in the same field.

#### Scenario: Single reason

- **WHEN** a removal field states 4 units expired
- **THEN** one quantity of 4 is produced against the expired reason

#### Scenario: Multiple reasons in one field

- **WHEN** a removal field states 6 units returned and 3 units under other reason
- **THEN** two quantities are produced — 6 against return and 3 against other reason
- **AND** no single quantity of 9 is produced

#### Scenario: The same reason stated twice in one field

- **WHEN** a removal field states 1 unit expired and 3 units expired
- **THEN** one quantity of 4 is produced against the expired reason
- **AND** the second statement does not replace the first

#### Scenario: Parsed quantities reconcile to the reported total

- **WHEN** a removal field is parsed
- **THEN** the sum of the parsed per-reason quantities equals the total quantity the row
  reports as removed
- **AND** a mismatch fails the row rather than being silently adjusted

#### Scenario: Unrecognised reason text is reported

- **WHEN** a removal field names a reason the system does not recognise
- **THEN** the row is rejected and reported with the store, period, product and the
  unrecognised text
- **AND** it is not assigned to any reason

#### Scenario: Empty removal field produces no removals

- **WHEN** a row has no removal text
- **THEN** no removal quantities are produced for that row
- **AND** the row's restock quantity is still processed

### Requirement: Product resolution

The system SHALL resolve each parsed row to a catalogue product by the product code the
report carries, SHALL fall back to the product name only when no code is present, and
SHALL report rows whose product cannot be resolved rather than discarding them.

The code is the same key across the sales report, the restocking report and the cost
reference, which makes it the only identifier that joins them. Names differ in spelling,
casing and trailing spaces between the same three files.

#### Scenario: Product resolves

- **WHEN** a row's product name resolves to a catalogue product
- **THEN** the resulting record references that product

#### Scenario: Unresolvable product is reported

- **WHEN** a row's product name cannot be resolved
- **THEN** the row is reported as unresolved, naming the original product name
- **AND** it is not silently omitted from the ingestion result

#### Scenario: Product resolves by code

- **WHEN** a row carries a product code matching a catalogue product
- **THEN** the resulting record references that product
- **AND** the row's product name is not used to resolve it

#### Scenario: Product resolves by name when no code is present

- **WHEN** a row carries no product code
- **THEN** the row's product name is used to resolve it

#### Scenario: A code matching no product is reported

- **WHEN** a row's product code matches no catalogue product
- **THEN** the row is reported as unresolved, naming both the code and the product name
- **AND** it is not silently omitted from the ingestion result

#### Scenario: A code is not re-derived from the name

- **WHEN** a row carries a code that matches no product but a name that would
- **THEN** the row is still reported as unresolved
- **AND** the name is not used to override the code the report stated

### Requirement: Row-level failures do not discard the file

The system SHALL report every row it could not process, and SHALL make the ingestion's
outcome distinguish a fully successful import from a partial one.

#### Scenario: Partial success is reported as partial

- **GIVEN** a file where some rows fail to parse
- **WHEN** the ingestion completes
- **THEN** its status reports that some rows were rejected
- **AND** the count of accepted and rejected rows is available

#### Scenario: Rejected rows are individually inspectable

- **WHEN** an ingestion has rejected rows
- **THEN** each rejection identifies the row and the reason it failed

#### Scenario: A fully successful import is distinguishable

- **WHEN** every row of a file is processed successfully
- **THEN** the ingestion status reports full success, distinct from partial success

### Requirement: Idempotent re-ingestion

The system SHALL make re-uploading a report for the same store and period replace that
period's data rather than adding to it.

#### Scenario: Re-uploading the same file does not double figures

- **GIVEN** a store and period already ingested
- **WHEN** the same file is uploaded again
- **THEN** the resulting stored figures are unchanged

#### Scenario: Re-uploading a corrected file supersedes the previous import

- **GIVEN** a store and period already ingested
- **WHEN** a corrected file for the same store and period is uploaded and parsed
- **THEN** the stored data reflects the corrected file
- **AND** the previous import's records for that store and period no longer apply

### Requirement: Ingestion status is observable

The system SHALL expose the status of an ingestion by its identifier, covering at least
accepted, processing, completed, partially completed, and failed.

#### Scenario: Status progresses

- **WHEN** an ingestion is created and then processed
- **THEN** its status reflects its progress and reaches a terminal state

#### Scenario: Failure states carry a reason

- **WHEN** an ingestion fails
- **THEN** its status includes an error describing why, sufficient for an operator to act on

#### Scenario: Status is traceable to the upload

- **WHEN** an ingestion's status is inspected
- **THEN** it identifies the uploaded file it refers to and when it was uploaded

### Requirement: Processing does not block the request path

The system SHALL perform all parsing and record-writing outside the HTTP request that
accepted the upload.

#### Scenario: Large file does not affect the upload response

- **WHEN** a large workbook is uploaded
- **THEN** the upload response is returned without waiting for the workbook to be read

#### Scenario: Parsing failure does not fail the upload request

- **GIVEN** an upload that was accepted
- **WHEN** parsing subsequently fails
- **THEN** the failure is reflected in the ingestion status rather than in the already
  completed upload response

### Requirement: Operations are accumulated per store and period

The system SHALL sum every operation for the same store and period within a file, and
SHALL NOT treat a later operation for a store as replacing an earlier one.

A store is restocked several times in a month, and each visit is its own operation. Taking
only one would silently discard the rest of the month's movement.

#### Scenario: One store restocked several times

- **WHEN** a file contains several operations for the same store and period
- **THEN** their restocked quantities are summed per product
- **AND** their removals are summed per product and reason
- **AND** their inventory adjustments are summed per product

#### Scenario: A combined operation contributes to both totals

- **GIVEN** a combined operation carrying both a restocked quantity and an adjustment for
  the same product
- **WHEN** the store's period is accumulated
- **THEN** the restocked quantity contributes to restocked value
- **AND** the adjustment contributes to the unclassified stock adjustment figure
- **AND** neither is read from or folded into the other

#### Scenario: An adjustment on a restocking-only operation is unexpected

- **GIVEN** an operation whose kind is restocking
- **WHEN** it carries a non-zero adjustment quantity
- **THEN** the row is reported as inconsistent with its stated kind, naming both
- **AND** the adjustment is not silently accumulated

#### Scenario: Operations for different stores stay separate

- **WHEN** a file contains operations for different stores
- **THEN** each store's quantities are accumulated only with that store's other operations

#### Scenario: Re-uploading the same file replaces rather than adds

- **WHEN** the same file is ingested twice
- **THEN** the resulting quantities are the same as after the first ingestion
