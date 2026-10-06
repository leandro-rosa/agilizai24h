## ADDED Requirements

### Requirement: Purchase invoice files

The ingestion SHALL accept NF-e XML files as a purchase-invoice file type, keep the raw file, parse issuer, number, issue date and items, and hand the result to purchasing, reporting items it could not resolve instead of dropping them.

#### Scenario: A valid NF-e

- **WHEN** an NF-e XML is uploaded
- **THEN** its invoice and items are parsed and sent to purchasing, and the file is kept in object storage

#### Scenario: A file that is not an NF-e

- **WHEN** an XML that is not an NF-e is uploaded as a purchase invoice
- **THEN** it is rejected with a reason and nothing is recorded
