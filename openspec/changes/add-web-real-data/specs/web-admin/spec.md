## Purpose

The operator-facing behaviour of the Agiliz.AI management panel: how someone signs in,
uploads the month's spreadsheets, and reads real figures — including how the panel behaves
when data is missing, incomplete, or inconsistent.

## ADDED Requirements

### Requirement: Authentication is required

The system SHALL require an authenticated session before showing any operational data, and
SHALL send the operator to the login screen when they have none.

#### Scenario: Unauthenticated visitor is sent to login

- **WHEN** someone without a session opens any panel route
- **THEN** they are shown the login screen
- **AND** no operational data is displayed

#### Scenario: Successful login opens the panel

- **WHEN** valid credentials are submitted
- **THEN** the operator reaches the panel
- **AND** subsequent requests are authenticated without them re-entering credentials

#### Scenario: Failed login explains without revealing

- **WHEN** invalid credentials are submitted
- **THEN** a generic failure message is shown
- **AND** it does not indicate whether the email or the password was wrong

#### Scenario: Session expiry returns to login

- **GIVEN** an operator whose session has expired
- **WHEN** they perform an action requiring data
- **THEN** they are returned to the login screen

#### Scenario: Logout ends the session

- **WHEN** the operator logs out
- **THEN** their session ends
- **AND** returning to a panel route shows the login screen

#### Scenario: The panel never stores the session token itself

- **WHEN** the operator is authenticated
- **THEN** the session is carried by an HTTP-only cookie
- **AND** no page script reads or stores a session token

### Requirement: Real data replaces fixtures

The system SHALL source every operational screen from the backend, and SHALL NOT ship
in-memory fixtures as a data source.

#### Scenario: Screens show backend data

- **WHEN** any of the stores, products, sales, finance, supply or inventory screens is opened
- **THEN** the data shown comes from the backend

#### Scenario: No fixture fallback

- **WHEN** the backend returns no data for a screen
- **THEN** the screen shows an empty state
- **AND** it SHALL NOT fall back to placeholder or sample data

### Requirement: Request states are distinguishable

The system SHALL visually distinguish loading, empty, error, and permission-denied states
from one another on every data-backed screen.

#### Scenario: Loading

- **WHEN** a screen's data is being fetched
- **THEN** a loading state is shown rather than an empty result

#### Scenario: Empty

- **WHEN** a request succeeds and returns no records
- **THEN** an empty state explains that there is nothing to show

#### Scenario: Error

- **WHEN** a request fails
- **THEN** an error state is shown with a retry affordance
- **AND** it is not presented as an empty result

#### Scenario: Forbidden

- **WHEN** a request is rejected because the operator lacks the required permission
- **THEN** the panel explains that they are not permitted
- **AND** it does not send them to the login screen, since they are authenticated

### Requirement: Uploading operational files

The system SHALL let an operator upload each of the three spreadsheet types, stating the
store and period the file applies to, and SHALL confirm acceptance without waiting for
parsing.

#### Scenario: Uploading a file

- **WHEN** an operator selects a file, its type, and the store and period it applies to
- **THEN** the upload is submitted
- **AND** the panel confirms it was accepted, without waiting for parsing to finish

#### Scenario: Store and period are required

- **WHEN** an operator attempts to upload without choosing a store and period
- **THEN** the panel prevents submission and says what is missing

#### Scenario: Rejected upload explains why

- **WHEN** an upload is rejected for size, format, or type mismatch
- **THEN** the reason is shown in terms the operator can act on

### Requirement: Ingestion outcome is visible

The system SHALL show the status of each upload, and SHALL make a partially successful import
distinguishable from a fully successful one.

#### Scenario: Following an upload's progress

- **WHEN** an operator views an upload they submitted
- **THEN** they see its current status through to a terminal state

#### Scenario: Partial success is not shown as success

- **GIVEN** an import where some rows were rejected
- **WHEN** its outcome is shown
- **THEN** it is presented as partially completed
- **AND** the counts of accepted and rejected rows are shown

#### Scenario: Rejected rows are readable

- **WHEN** an operator inspects an import with rejected rows
- **THEN** each rejection identifies the row and why it failed, in terms that indicate what to
  fix in the file

### Requirement: Reconciliation figures are presented with their trustworthiness

The system SHALL present the reconciliation figures for a store and month, and SHALL indicate
when a figure is derived from an incomplete reconciliation.

#### Scenario: Showing a month

- **WHEN** an operator opens a store's month
- **THEN** restocked value, cost of goods sold, remaining stock value and real loss are shown

#### Scenario: Loss breakdowns

- **WHEN** an operator inspects real loss for a month
- **THEN** it is broken down by reason and by product

#### Scenario: Incompleteness is shown next to the figure

- **GIVEN** a reconciliation marked incomplete
- **WHEN** its figures are displayed
- **THEN** the incompleteness is indicated where the figures are shown, not only on a separate
  screen
- **AND** the operator can see which SKUs could not be valued

#### Scenario: An incomplete total is never presented as final

- **WHEN** an incomplete reconciliation's total is displayed
- **THEN** it is not presented as an authoritative figure

### Requirement: Data inconsistencies are surfaced

The system SHALL make inconsistent derived data visible rather than hiding or normalising it.

#### Scenario: Negative stock is shown

- **GIVEN** a store and SKU whose derived stock is negative
- **WHEN** inventory is displayed
- **THEN** the negative value is shown and flagged as an inconsistency
- **AND** it is not displayed as zero

### Requirement: Interface language

The system SHALL present all operator-facing text in Portuguese, while identifiers, routes and
code remain in English.

#### Scenario: Operator-facing text

- **WHEN** any screen, label, message or error is shown to an operator
- **THEN** it is written in Portuguese

#### Scenario: Terminology is consistent with the domain glossary

- **WHEN** domain terms appear in the interface
- **THEN** they use the project's established Portuguese terms, matching the glossary
