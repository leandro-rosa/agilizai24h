## Purpose

Accepting the operational spreadsheets that drive the platform, parsing them away from the
request path, normalising their rows into domain records, and reporting precisely what each
upload did — including what it could not interpret.

## ADDED Requirements

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
result contract.

#### Scenario: Each type is routed to its own parser

- **WHEN** a file of a given type is uploaded
- **THEN** it is queued for the parser belonging to that type only

#### Scenario: A file that does not match its declared type is rejected

- **WHEN** an uploaded file's contents do not match the structure expected for its declared
  type
- **THEN** the ingestion fails with an error naming the mismatch
- **AND** no records are written to any domain service

### Requirement: Store resolution

The system SHALL resolve each uploaded report to a store using the external store code, and
SHALL fail the ingestion when the code cannot be resolved.

#### Scenario: Report resolves to a store

- **GIVEN** a store registered with a matching external code
- **WHEN** a report carrying that code is parsed
- **THEN** the resulting records are attributed to that store

#### Scenario: Unknown store code fails the ingestion

- **WHEN** a report carries an external code matching no store
- **THEN** the ingestion fails with an error naming the unresolved code
- **AND** no records are written for that file

### Requirement: Removal reason parsing

The system SHALL parse the free-text removal reason field into quantities per reason, and
SHALL treat a field naming several reasons as several quantities rather than one.

#### Scenario: Single reason

- **WHEN** a removal field states 4 units expired
- **THEN** one quantity of 4 is produced against the expired reason

#### Scenario: Multiple reasons in one field

- **WHEN** a removal field states 6 units returned and 3 units under other reason
- **THEN** two quantities are produced — 6 against return and 3 against other reason
- **AND** no single quantity of 9 is produced

#### Scenario: Parsed quantities reconcile to the reported total

- **WHEN** a removal field is parsed
- **THEN** the sum of the parsed per-reason quantities equals the total quantity the row
  reports as removed
- **AND** a mismatch fails the row rather than being silently adjusted

#### Scenario: Unrecognised reason text is reported

- **WHEN** a removal field names a reason the system does not recognise
- **THEN** the row is rejected and reported with the store, period, SKU and the
  unrecognised text
- **AND** it is not assigned to any reason

#### Scenario: Empty removal field produces no removals

- **WHEN** a row has no removal text
- **THEN** no removal quantities are produced for that row
- **AND** the row's restock quantity is still processed

### Requirement: Product resolution

The system SHALL resolve each parsed row's product name to a catalogue product, and SHALL
report rows whose product cannot be resolved rather than discarding them.

#### Scenario: Product resolves

- **WHEN** a row's product name resolves to a catalogue product
- **THEN** the resulting record references that product

#### Scenario: Unresolvable product is reported

- **WHEN** a row's product name cannot be resolved
- **THEN** the row is reported as unresolved, naming the original product name
- **AND** it is not silently omitted from the ingestion result

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
