## MODIFIED Requirements

### Requirement: Dated cost versions

The system SHALL record product costs as dated versions, each with the date it takes effect
from. A product MAY have many cost versions over time. The system SHALL NOT overwrite or
discard a previous cost version when a new one is recorded, including when the new one has
the same effective date as an existing version.

#### Scenario: Recording a new cost keeps the old one

- **GIVEN** a product with a cost effective from 2026-01-01
- **WHEN** a new cost effective from 2026-06-01 is recorded
- **THEN** both versions exist
- **AND** the January version is still retrievable

#### Scenario: Re-recording the same effective date replaces that version

- **GIVEN** a product with a cost effective from 2026-06-01
- **WHEN** another cost for the same product effective from 2026-06-01 is recorded
- **THEN** the later recorded cost is the version in force from that date
- **AND** the earlier version is kept in the history and is not overwritten
