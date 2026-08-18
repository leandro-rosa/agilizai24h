## ADDED Requirements

### Requirement: Upload routes

The system SHALL expose routes for uploading each of the three operational file types,
accepting a file and the store and period it applies to, and SHALL require a named
permission to use them. These routes SHALL hand the work to the ingestion queue rather than
to a domain service.

#### Scenario: Authorized upload is accepted

- **GIVEN** a caller holding the upload permission
- **WHEN** they upload a file of a supported type
- **THEN** the request is accepted and an ingestion identifier is returned

#### Scenario: Upload requires permission

- **GIVEN** an authenticated caller lacking the upload permission
- **WHEN** they attempt an upload
- **THEN** the request is rejected as forbidden
- **AND** no file is stored and no work is queued

#### Scenario: Oversized or unsupported file is rejected at the edge

- **WHEN** an upload exceeds the configured size limit or is not a supported spreadsheet
  format
- **THEN** it is rejected with an error describing the limit or the supported formats
- **AND** no work is queued

### Requirement: Ingestion status routes

The system SHALL expose routes to retrieve the status of an ingestion by its identifier and
to list recent ingestions, subject to a named permission.

#### Scenario: Retrieving an ingestion's status

- **GIVEN** an ingestion identifier returned by an upload
- **WHEN** its status is requested by a permitted caller
- **THEN** the current status, counts of accepted and rejected rows, and any errors are
  returned

#### Scenario: Listing recent ingestions

- **WHEN** a permitted caller lists recent ingestions
- **THEN** they receive each ingestion's identifier, file type, store, period, status and
  upload time

#### Scenario: Unknown ingestion identifier

- **WHEN** the status of an identifier that does not exist is requested
- **THEN** the system reports it as not found
