## Purpose

Makes product cost and sale price a traceable, append-only history, so the system can say what the cost and price were on any past date, who or what set them, and from which purchase, without ever recomputing the past with today's values.

## ADDED Requirements

### Requirement: Every cost and price version records its provenance

Each cost and each sale-price version SHALL record its source (`manual`, `invoice`, `pricing_intelligence`, `catalogue_sync`, `legacy_import` or `other`), the user when it was entered by a person, the reason when one was given, and the time it was recorded. A cost version from a purchase SHALL also record the supplier, the purchase and invoice number, and the original purchase quantity and total. A price version from the pricing recommendation SHALL record the decision it came from. Versions that existed before this capability SHALL be marked `legacy_import` with no user or supplier invented.

#### Scenario: Manual cost needs a reason and the session user

- **WHEN** a user records a manual cost
- **THEN** the version stores the user of the session, the reason and `manual` as source
- **AND** a request without a reason is rejected

#### Scenario: Existing versions are not given a made-up origin

- **GIVEN** a version recorded before this capability
- **WHEN** it is read
- **THEN** its source is `legacy_import` and its user and supplier are empty

### Requirement: Versions are never overwritten

Recording a cost or a price for a date that already has a version SHALL add a new version and SHALL keep the earlier one readable. The version in force on a date SHALL be the one with the latest effective date up to that date and, among those with the same effective date, the latest recorded. When the two have the same date and one comes from an invoice, the invoice-originated version SHALL be the one in force and the manual one SHALL be shown as superseded.

#### Scenario: Correction on the same date

- **GIVEN** a cost of R$ 5,70 effective 2026-08-01
- **WHEN** a manual correction of R$ 5,80 for 2026-08-01 is recorded
- **THEN** the history shows both and the cost in force from 2026-08-01 is R$ 5,80

#### Scenario: Invoice beats manual on the same date

- **GIVEN** a manual cost effective 2026-10-10
- **WHEN** an invoice-originated cost effective 2026-10-10 is recorded
- **THEN** the invoice cost is in force and the manual version is shown as superseded

#### Scenario: Later date beats earlier source

- **GIVEN** an invoice cost effective 2026-10-10 and a manual cost effective 2026-10-15
- **WHEN** the cost in force on 2026-10-20 is read
- **THEN** it is the manual one

### Requirement: Validity is derived, and history starts where the data starts

The end of a version's validity SHALL be derived from the next version's effective date, never stored. The history SHALL state the date it is available from, and SHALL NOT assert a cost or price before its first version.

#### Scenario: Honest start

- **GIVEN** a product whose first cost version is effective 2026-08-01
- **WHEN** its history is read
- **THEN** it says the history is available from 2026-08-01 and shows nothing before

### Requirement: A received purchase creates the cost version

When a purchase is received, the system SHALL create a cost version for each paid or consigned item whose unit cost differs from the cost in force on the receipt date, effective on the receipt date, with source `invoice`, the supplier, the purchase, the invoice number and the original quantity and total. It SHALL NOT create a cost for a bonus item. The invoice issue date, the receipt date and the time the system processed it SHALL all be kept. A failure SHALL leave the purchase received and the failure visible and retryable, and repeating the sync SHALL NOT create a second version.

#### Scenario: Cost rises on an invoice

- **GIVEN** a cost of R$ 5,70 in force
- **WHEN** a purchase of 150 units for R$ 930,00 is received on 2026-10-10
- **THEN** a cost of R$ 6,20 effective 2026-10-10 exists, with its supplier and invoice
- **AND** the R$ 5,70 version is still in the history

#### Scenario: Bonus never sets a cost

- **WHEN** a purchase item with condition bonus is received
- **THEN** no cost version is created for it

#### Scenario: Same cost, no new version

- **GIVEN** a cost of R$ 6,20 in force
- **WHEN** a purchase is received at R$ 6,20 per unit
- **THEN** no new version is created

#### Scenario: Repeated sync

- **WHEN** the cost sync of the same purchase item runs twice
- **THEN** there is one cost version

### Requirement: The original of the packaging is kept

A purchase SHALL keep, for each item bought in a package, the package quantity, the package price, the units per package and the purchase unit, together with the unit cost computed from them, and the invoice issue date. A purchase recorded before this capability SHALL show the original as not recorded.

#### Scenario: Box of 21

- **GIVEN** an invoice line of 10 boxes at R$ 63,00 with 21 units per box
- **WHEN** the purchase is recorded
- **THEN** it keeps 10, R$ 63,00 and 21 and the unit cost R$ 3,00

### Requirement: A cost in a closed month is flagged, not recomputed

When a cost version takes effect inside a month whose financial result is closed, the system SHALL flag it as affecting a closed month and SHALL NOT recompute any financial result by itself. A variation above a configured limit SHALL also be flagged.

#### Scenario: Late invoice

- **WHEN** a purchase received in a closed month creates a cost version
- **THEN** the version is flagged as affecting that closed month
- **AND** no result is recomputed

### Requirement: Historical margin uses the cost in force on that date

Margin for a date or month SHALL use the cost and the price in force on that date, so a change of today's cost never alters a past margin. The monthly margin SHALL use the same valuation as the existing CMV (the cost in force at the end of the month) and SHALL say so; months where the cost changed during the month SHALL be marked.

#### Scenario: Past stays past

- **GIVEN** a cost of R$ 5,70 and a price of R$ 11,90 in August, and a cost of R$ 6,20 from October
- **WHEN** the August margin is read before and after the October cost exists
- **THEN** both reads show 52,1%

### Requirement: Cost is shown with its meaning

The system SHALL NOT present a bare "cost". It SHALL distinguish the cost in force, the last purchase cost, the average purchase cost over a stated window, the cost used in the month's CMV and the cost used by pricing, each with its source and date.

#### Scenario: Two different numbers

- **GIVEN** a cost in force of R$ 5,70 and a last purchase at R$ 6,20 not yet in force
- **WHEN** the product is shown
- **THEN** both are shown, labelled, with their dates
