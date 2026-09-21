## Purpose

Lets operators pull the monthly report files that live in a shared Google Drive folder into the existing ingestion pipeline: new and changed files are noticed and checked automatically, but nothing is imported until a person confirms, and an incomplete, duplicated, synthetic or wrong-period file cannot get in silently.

## ADDED Requirements

### Requirement: The Drive source is optional and inert when unconfigured

The system SHALL treat the Drive source as optional. When neither the Drive credential nor the root folder is configured, the ingestion service SHALL start and operate exactly as before, SHALL NOT run or schedule any scan or validation, and the admin SHALL state that the Drive is not configured. A configuration containing only one of the two SHALL be rejected at startup with an error naming the missing setting.

#### Scenario: Unconfigured

- **GIVEN** no Drive settings
- **WHEN** the ingestion service starts
- **THEN** it starts normally and no scan is scheduled
- **AND** the Drive status reports "not configured"

#### Scenario: Half configured

- **GIVEN** a root folder id and no credential
- **WHEN** the ingestion service starts
- **THEN** startup fails with an error naming the missing credential

#### Scenario: Turned off after being on

- **GIVEN** a scan schedule left registered by an earlier run with Drive settings
- **WHEN** the service starts without those settings
- **THEN** the schedule is removed and no further scan runs

### Requirement: Scans run daily and on demand and read metadata only

The system SHALL scan the configured root folder every day at 06:00 America/Sao_Paulo (the schedule being configurable) and whenever a person requests "Sincronizar agora". A scan SHALL read only file metadata (name, folder path, size, checksum or modified time) and SHALL NOT download or export file content. Concurrent on-demand scans SHALL collapse into one.

#### Scenario: The scheduled scan

- **GIVEN** a configured Drive source
- **WHEN** it is 06:00 in São Paulo
- **THEN** a scan runs and records its outcome

#### Scenario: A scan lists without downloading

- **GIVEN** a root folder with a month subfolder holding two report files
- **WHEN** a scan runs
- **THEN** both files are recorded with their metadata
- **AND** no file content is read from the Drive by the scan itself

#### Scenario: Two clicks on "Sincronizar agora"

- **GIVEN** a scan already queued or running
- **WHEN** another on-demand scan is requested
- **THEN** no second scan runs concurrently

### Requirement: Only files matching the configured name patterns are tracked

The system SHALL track a file only when its name, or the name of a folder between the month folder and the file, matches one of the configured name patterns (by default the sales report and the restocking report, case and accent insensitive). Files that do not match SHALL NOT be tracked and SHALL be counted in the scan summary. Recorded types SHALL be limited to `.xlsx`, `.xls`, `.csv` and native Google Sheets; trashed items and temporary lock files SHALL be skipped.

#### Scenario: Legacy per-store files do not clutter the list

- **GIVEN** a month folder holding `Relatório_2026`, `Abastecimentos 2026-07-01 _ 2026-07-31.xlsx` and twenty per-store files named `venda …`
- **WHEN** a scan runs
- **THEN** only the first two are tracked
- **AND** the scan summary reports the others as skipped by pattern

#### Scenario: The report is a folder

- **GIVEN** a folder named `Relatório_2026` inside a month folder, containing a spreadsheet
- **WHEN** a scan runs
- **THEN** the spreadsheet is tracked, its month taken from the month folder

### Requirement: Each Drive file is tracked with a status

The system SHALL track every matching file by its Drive file id, with a status of new, changed, importing, imported, ignored, missing or error. A file already imported and unchanged SHALL NOT be proposed again. A file whose content changed since it was imported SHALL be proposed again as a replacement. A file that disappears from the Drive SHALL be marked missing, and nothing already ingested SHALL be removed because of it. An ignored file SHALL stay ignored until its content changes.

#### Scenario: A new file

- **GIVEN** a report file never seen before
- **WHEN** a scan runs
- **THEN** it appears with status new

#### Scenario: An unchanged imported file

- **GIVEN** a file that was imported and whose checksum has not changed
- **WHEN** a scan runs
- **THEN** it stays imported and is not proposed for import again

#### Scenario: A changed imported file

- **GIVEN** a file that was imported and was later edited in the Drive
- **WHEN** a scan runs
- **THEN** it appears with status changed, as a candidate replacement

#### Scenario: A file removed from the Drive

- **GIVEN** an imported file that is no longer in the folder
- **WHEN** a scan runs
- **THEN** it is marked missing
- **AND** the data ingested from it is untouched

#### Scenario: An ignored file

- **GIVEN** a file the operator ignored
- **WHEN** a scan runs and its content is unchanged
- **THEN** it stays ignored

### Requirement: Type and period are suggestions, never guessed

The system SHALL propose a period from the month folder name (Portuguese month names, case and accent insensitive, with an optional two- or four-digit year suffix, or a numeric month), using the year of the folder or of an ancestor folder when the name carries none, and SHALL propose a file type from the file name (a restocking report, or a report that is a sales report). When the period or type cannot be determined, or when the folder and the file name contradict each other, the suggestion SHALL be empty and SHALL carry the reason. Once a file has been validated, the dates and structure found in it SHALL refine the suggestion, and a contradiction between the folder and the content SHALL be reported. Suggestions SHALL be editable by the person importing.

#### Scenario: Month folder

- **GIVEN** a `Relatório_2026` file in a folder named `agosto-26`
- **WHEN** it is discovered
- **THEN** the suggested period is 2026-08 and the suggested type is sales

#### Scenario: Accents and case

- **GIVEN** a file in a folder named `Março-26`
- **WHEN** it is discovered
- **THEN** the suggested period is 2026-03

#### Scenario: A restocking report named with a date range

- **GIVEN** a file named `Abastecimentos 2026-07-01 _ 2026-07-31.xlsx` in a folder named `julho-26`
- **WHEN** it is discovered
- **THEN** the suggested type is supply and the suggested period is 2026-07

#### Scenario: Folder and file name disagree

- **GIVEN** a file in the folder `agosto-26` whose name carries the range 2026-07-01 to 2026-07-31
- **WHEN** it is discovered
- **THEN** the suggested period is empty with the reason "conflict"

#### Scenario: Folder and content disagree

- **GIVEN** a file in the folder `julho-26` whose dates are all in August 2026
- **WHEN** it is validated
- **THEN** the validation reports 2026-08 as the observed month and the conflict with the folder

### Requirement: Files are validated automatically and never imported by validation

For every new or changed matching file the system SHALL validate it without a person asking, unless automatic validation is switched off, in which case a "Validar" action SHALL be available. Validation SHALL read the file into temporary storage, SHALL compute the checks and keep only an aggregated report (counts by month, per-store day counts, format, size, a content hash and the inconsistencies found), SHALL delete the temporary file, and SHALL NOT write to object storage, SHALL NOT create an ingestion and SHALL NOT keep any row-level content, card digits or buyer numbers. A scan or a validation SHALL NEVER import.

#### Scenario: A new file is validated on its own

- **GIVEN** a new sales report found by a scan
- **WHEN** the validation job runs
- **THEN** the file shows a validation result
- **AND** no ingestion exists and nothing was written to object storage

#### Scenario: The report holds no row-level content

- **GIVEN** a validated sales report
- **WHEN** its stored validation report is read
- **THEN** it contains counts, dates, store names, coverage figures and a content hash
- **AND** it contains no card digits and no buyer numbers

#### Scenario: Automatic validation switched off

- **GIVEN** automatic validation disabled
- **WHEN** a scan finds a new file
- **THEN** it is tracked without a validation result and a "Validar" action is offered

### Requirement: Format and period identity are checked and block on mismatch

A sales file SHALL be recognised only in the network-wide per-transaction format and a restocking file only in the restocking layout; a file whose structure does not match its type SHALL be blocked with a reason, an old per-store sales report explicitly so. The system SHALL compare the selected period with the dates found in the file (transaction dates for sales, operation finish dates for restocking, read as the wall-clock values stored in the file) and SHALL block the file when fewer than the configured share of dated rows (default 90%) fall inside the selected month, naming the month actually observed. When the file has no readable dates it SHALL be blocked, stating that the period could not be verified. A blocked file SHALL NOT be importable until the cause is fixed and it is validated again.

#### Scenario: The period matches

- **GIVEN** a sales file whose dated rows are all in August 2026
- **WHEN** it is validated for 2026-08
- **THEN** the identity check passes

#### Scenario: The period does not match

- **GIVEN** the same file
- **WHEN** it is validated for 2026-07
- **THEN** it is blocked naming 2026-08 as the observed month
- **AND** Import is unavailable for 2026-07

#### Scenario: An old per-store sales report

- **GIVEN** a sales file without the network `Cliente` column
- **WHEN** it is validated
- **THEN** it is blocked with a reason explaining that the old per-store format must be uploaded manually with a store

#### Scenario: No readable dates

- **GIVEN** a file whose date column cannot be read
- **WHEN** it is validated
- **THEN** it is blocked with "period could not be verified"

### Requirement: Sales coverage is measured on expected operating days

For a sales file the system SHALL measure coverage per store on the days the store is expected to operate, not on calendar days. A store's normal weekdays SHALL be those on which it has at least one dated row (of any result) on at least the configured share (default 50%) of that weekday's occurrences within the month. Its expected operating days SHALL be the days of the month, up to the validation date for a month still in progress, that fall on its normal weekdays. Its coverage SHALL be the share of its expected operating days with at least one row, and the file's coverage SHALL be the pooled share across stores. The system SHALL also compare the first and last dated rows of the file with the month boundaries. Coverage SHALL be insufficient, and the file SHALL require validation, when the file's coverage is below the configured minimum (default 90%), when any store's coverage is below the configured store minimum (default 70%), when a store's normal weekdays cannot be established (fewer than two normal weekdays or fewer than eight expected days), or when the first or last dated row lies more than the configured tolerance (default three days) inside the month boundaries. Restocking files have no daily grain and are checked for period identity only.

#### Scenario: A store that never sells on weekends is not penalised

- **GIVEN** a store with rows on every Monday to Friday of August 2026 and none on Saturdays or Sundays
- **WHEN** the file is validated
- **THEN** Saturdays and Sundays are not expected days for that store
- **AND** its coverage is 100%

#### Scenario: A store missing two weeks

- **GIVEN** a store that sells Monday to Friday but has no rows from 10 to 21 August 2026
- **WHEN** the file is validated
- **THEN** its coverage is 11 of 21 expected days
- **AND** the file requires validation, listing that store and the missing dates

#### Scenario: A file that stops early

- **GIVEN** a sales file whose last dated row is on the 15th of a 31-day month
- **WHEN** the file is validated
- **THEN** it requires validation with an end-of-month gap inconsistency

#### Scenario: Coverage that cannot be established

- **GIVEN** a store whose rows cover so few days that no weekday reaches the normal-weekday share
- **WHEN** the file is validated
- **THEN** the store's coverage is reported as not verifiable and the file requires validation

### Requirement: Insufficient coverage requires explicit validation by a person

A file that requires validation SHALL NOT be imported automatically and SHALL NOT be silently refused: the inconsistencies SHALL be shown and Import SHALL become available only after a person explicitly confirms that they reviewed them. That confirmation SHALL be recorded with who gave it and when, SHALL be bound to the content hash that was reviewed, and SHALL NOT apply to a file whose content later changes.

#### Scenario: Import needs the validation confirmation

- **GIVEN** a file that requires validation
- **WHEN** its import is requested without the validation confirmation
- **THEN** the import is refused and nothing is written

#### Scenario: Confirming the validation

- **GIVEN** the same file and a person who reviewed the inconsistencies
- **WHEN** they import it with the validation confirmation
- **THEN** the import proceeds and the record shows who validated it and when

#### Scenario: The file changes after being reviewed

- **GIVEN** a file whose inconsistencies were confirmed
- **WHEN** the file is edited in the Drive and imported before it is validated again
- **THEN** the earlier confirmation does not apply and the import is refused as unvalidated

### Requirement: Import requires explicit confirmation of type and period

The system SHALL import a file only when a person explicitly requests it, naming the file type and the period they confirmed. Nothing SHALL be imported automatically: not by a scan, not by a validation, not by a schedule. The import SHALL support only the network-wide per-transaction sales report and the restocking/removal report. The system SHALL record who confirmed the import and when.

#### Scenario: Nothing imports by itself

- **GIVEN** new files in the Drive that passed validation
- **WHEN** the scheduled scan and the validations complete
- **THEN** no ingestion has been created

#### Scenario: Confirmation is recorded

- **GIVEN** a person confirming the import of a validated file
- **WHEN** the import is accepted
- **THEN** the file's record shows who confirmed it and when

### Requirement: Replacing an already-ingested period needs explicit confirmation

For every file the system SHALL show whether importing it would replace data, meaning a completed or partially completed ingestion of the same file type and period already exists, together with when that ingestion happened. The import SHALL be refused unless replacement was explicitly confirmed in the request.

#### Scenario: The period is already ingested

- **GIVEN** a completed sales ingestion for 2026-08
- **WHEN** a new sales file is listed with period 2026-08
- **THEN** it shows "vai substituir 2026-08" with the date of the earlier ingestion

#### Scenario: Import without confirming replacement

- **GIVEN** a file that would replace an ingested period
- **WHEN** its import is requested without confirming replacement
- **THEN** the import is refused and nothing is written

#### Scenario: Import confirming replacement

- **GIVEN** the same file
- **WHEN** its import is requested confirming replacement
- **THEN** an ingestion is created and the existing idempotent-replace behavior applies

### Requirement: Import uses the existing ingestion pipeline

An accepted import SHALL store the raw file in object storage as evidence, under the same key scheme as a manual upload with no store, SHALL create an ingestion through the same path as a manual upload, and SHALL link the Drive file to that ingestion. The checks SHALL be recomputed on the downloaded content before anything is written. Parsing, rejections, idempotent replace, status and downstream events SHALL be unchanged. The request that asks for an import SHALL return without waiting for the download or the parsing.

#### Scenario: A normal ingestion results

- **GIVEN** a confirmed import
- **WHEN** it is accepted
- **THEN** an ingestion exists whose status progresses and whose rejected rows are readable through the existing ingestion endpoints
- **AND** the Drive file shows that ingestion's identifier

#### Scenario: The request does not wait

- **GIVEN** a large file
- **WHEN** its import is requested
- **THEN** the response returns before the file is downloaded and the file shows an importing status

#### Scenario: Nothing is written before the checks pass

- **GIVEN** an import whose recomputed checks now find a blocking problem
- **WHEN** the import job runs
- **THEN** nothing is written to object storage and no ingestion is created
- **AND** the file shows the reason

### Requirement: Duplicate imports are prevented

The system SHALL prevent duplicate imports at several layers: a Drive file SHALL be tracked once by its id; two simultaneous import requests for the same file SHALL create at most one ingestion; a file already imported and unchanged SHALL NOT be proposed again; and a file whose content is identical (same content hash) to one already imported for the same file type and period SHALL be marked as a duplicate and be blocked from import, whichever folder or Drive file id it comes from. The duplicate block SHALL name the earlier import.

#### Scenario: A double click

- **GIVEN** a file with status new
- **WHEN** two import requests for it arrive together
- **THEN** exactly one ingestion is created and the second request is rejected as already in progress

#### Scenario: The same content in another file

- **GIVEN** an imported August sales report and a copy of it saved under another name in the same month folder
- **WHEN** the copy is validated
- **THEN** it is marked as a duplicate naming the earlier import and cannot be imported

#### Scenario: A corrected file is not a duplicate

- **GIVEN** an imported report that was edited so its content hash differs
- **WHEN** it is validated
- **THEN** it is not a duplicate and is proposed as a replacement

### Requirement: File size limit is configurable and defaults to 25 MiB

The system SHALL refuse to import a file larger than the configured size limit, defaulting to 25 MiB, before downloading it and again while streaming it, and SHALL refuse a native Google Sheet whose export exceeds the Drive export limit, with a message that says so.

#### Scenario: An oversized file

- **GIVEN** the default limit and a file of 30 MiB
- **WHEN** it is validated or imported
- **THEN** it is blocked with a size message and nothing is written

#### Scenario: A raised limit

- **GIVEN** the limit configured at 40 MiB
- **WHEN** a 30 MiB file is validated
- **THEN** the size check passes

### Requirement: Failures are visible and retryable

A Drive error during a scan, a validation or an import (permission, not found, quota, export limit, network) SHALL be recorded with a reason and SHALL NOT change the status of files that were not affected. A failed scan SHALL leave every known file and its status intact and the status view SHALL show when it ran and why it failed. A file whose validation or import failed, including one whose ingestion later failed, SHALL be shown with its error and SHALL be retryable.

#### Scenario: A failed scan

- **GIVEN** known files with various statuses
- **WHEN** a scan fails because the folder is no longer shared
- **THEN** every known file keeps its status
- **AND** the status view shows the failure time and reason

#### Scenario: A failed import can be retried

- **GIVEN** an import that failed because the Drive returned an error
- **WHEN** the person requests the import again
- **THEN** it is attempted again

### Requirement: Credentials are read-only and never exposed

The system SHALL access the Drive with a read-only scope, SHALL NOT write, move or delete anything in the Drive, and SHALL NOT log the credential or return it from any endpoint.

#### Scenario: Status does not leak credentials

- **GIVEN** a configured Drive source
- **WHEN** the status endpoint is read
- **THEN** it reports configuration state and scan outcome without any credential or key material

### Requirement: Synthetic files cannot be imported

A file whose name or folder path matches the configured synthetic marker SHALL be tracked as synthetic, SHALL be visibly identified as such, and SHALL NOT be importable into the platform's real data.

#### Scenario: A synthetic test file

- **GIVEN** a file whose name carries the synthetic marker
- **WHEN** it is listed
- **THEN** it is labelled synthetic and its Import is unavailable with the reason

### Requirement: Thresholds are configurable settings

The size limit, the schedule, the name patterns, the synthetic marker, and every validation threshold (period match share, normal-weekday share, pooled coverage minimum, store coverage minimum, edge tolerance) SHALL be settings with documented defaults, and the validation report SHALL state the values that were applied.

#### Scenario: The applied thresholds are shown

- **GIVEN** a validated file
- **WHEN** its validation report is read
- **THEN** it states the thresholds that were used, so the result can be reproduced

### Requirement: Permissions follow the ingestion permissions

Listing Drive files and reading the Drive status SHALL require `ingestion:read`. Requesting a scan, requesting a validation, importing and ignoring SHALL require `ingestion:upload`. The admin SHALL hide those actions from users without `ingestion:upload`.

#### Scenario: A read-only user

- **GIVEN** a user with `ingestion:read` and without `ingestion:upload`
- **WHEN** they open the Drive section
- **THEN** they see the files, statuses and validation results and no Importar, Validar, Ignorar or "Sincronizar agora" action

### Requirement: The admin shows Drive files, validation results and actions

The `/ingestion` page SHALL contain a section "Arquivos no Drive" with one row per tracked file showing its path, status, validation result with its inconsistencies expandable, editable file type and period pre-filled with the suggestions, the replace warning when applicable, and the actions Importar and Ignorar. Importar SHALL be unavailable until type and period are valid and unavailable for a blocked, duplicate or synthetic file, and for a file that requires validation it SHALL first show the inconsistencies and require the validation confirmation. The section SHALL show the last scan time and outcome, an action "Sincronizar agora", and an explanatory state when the Drive is not configured. Loading, empty and error states SHALL use the shared request-state handling.

#### Scenario: A validated file with suggestions

- **GIVEN** a new file that passed validation, with a suggested type and period
- **WHEN** the section renders
- **THEN** the row shows them pre-filled and editable and Importar is enabled

#### Scenario: A file that requires validation

- **GIVEN** a file whose coverage is insufficient
- **WHEN** the person clicks Importar
- **THEN** a dialog lists the inconsistencies and requires an explicit confirmation before the import is requested

#### Scenario: A file without a period suggestion

- **GIVEN** a file whose period suggestion is empty
- **WHEN** the section renders
- **THEN** Importar is disabled until a valid period is entered

#### Scenario: Not configured

- **GIVEN** the Drive source is not configured
- **WHEN** the section renders
- **THEN** it says "Drive não configurado" and offers no scan, validation or import action
