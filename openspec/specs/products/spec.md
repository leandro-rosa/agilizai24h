# products Specification

## Purpose
The canonical catalogue of SKUs sold across the store network, together with the dated cost
reference that every currency figure in the platform is derived from and the matching rules
that connect names appearing in POS exports to catalogue entries.

## Requirements

### Requirement: Product record

The system SHALL store, for each product, a stable internal identifier, a SKU, a display
name, and a category. The SKU SHALL be unique across products.

#### Scenario: Creating a product

- **WHEN** a product is created with a SKU not already in use
- **THEN** it is persisted with a stable internal identifier

#### Scenario: Duplicate SKU is rejected

- **WHEN** a product is created with a SKU that already exists
- **THEN** the request is rejected with a conflict error
- **AND** the existing product is unchanged

### Requirement: Dated cost versions

The system SHALL record product costs as dated versions, each with the date it takes effect
from. A product MAY have many cost versions over time. The system SHALL NOT overwrite or
discard a previous cost version when a new one is recorded.

#### Scenario: Recording a new cost keeps the old one

- **GIVEN** a product with a cost effective from 2026-01-01
- **WHEN** a new cost effective from 2026-06-01 is recorded
- **THEN** both versions exist
- **AND** the January version is still retrievable

#### Scenario: Re-recording the same effective date replaces that version

- **GIVEN** a product with a cost effective from 2026-06-01
- **WHEN** another cost for the same product effective from 2026-06-01 is recorded
- **THEN** that version's value is updated
- **AND** no additional version for that date is created

### Requirement: As-of cost lookup

The system SHALL resolve a product's cost as of a given date, returning the most recent
cost version whose effective date is on or before that date. A cost lookup SHALL always be
relative to a date; there SHALL be no lookup that returns a "current" cost implicitly.

#### Scenario: Valuing a historical period uses the cost of that period

- **GIVEN** a product with costs effective from 2026-01-01 and from 2026-06-01
- **WHEN** its cost is resolved as of 2026-03-15
- **THEN** the January cost is returned, not the June one

#### Scenario: Re-reading a historical period is stable

- **GIVEN** a period previously valued with the January cost
- **WHEN** a later, higher cost is recorded effective from a date after that period
- **AND** the same period is valued again
- **THEN** the result is unchanged

#### Scenario: Date precedes every known cost

- **WHEN** a product's cost is resolved as of a date earlier than its earliest cost version
- **THEN** the system reports that no cost is known for that date
- **AND** it SHALL NOT fall back to the earliest known cost

#### Scenario: Bulk lookup for a period

- **WHEN** costs are resolved for a set of SKUs as of one date
- **THEN** each SKU resolves independently using the same as-of rule
- **AND** the response distinguishes SKUs that resolved from those that did not

### Requirement: Product name matching

The system SHALL resolve an externally supplied product name to a catalogue product by
first applying normalisation — case folding, accent removal, and whitespace collapsing —
and then, if that fails, consulting a curated table of known name overrides. A curated
override SHALL take precedence over a normalised match when both apply.

#### Scenario: Match differing only by case, accents or spacing

- **GIVEN** a catalogue product named "Refrigerante Guaraná 350ml"
- **WHEN** the name "REFRIGERANTE GUARANA  350ML" is resolved
- **THEN** it matches that product

#### Scenario: Curated override resolves a name normalisation cannot

- **GIVEN** an override mapping "Guaraná lata 350" to a catalogue product
- **WHEN** that name is resolved
- **THEN** it matches the mapped product

#### Scenario: Override wins over normalisation

- **GIVEN** a name that normalises to one product but is overridden to another
- **WHEN** it is resolved
- **THEN** the override's product is returned

#### Scenario: Ambiguous normalisation does not guess

- **WHEN** a normalised name matches more than one catalogue product and no override applies
- **THEN** the system reports the name as unmatched
- **AND** it SHALL NOT return an arbitrary one of the candidates

#### Scenario: Unknown name is reported

- **WHEN** a name matches no product by normalisation and has no override
- **THEN** the system reports it as unmatched, returning the original name

### Requirement: Unmatched and unpriced reporting

The system SHALL report every SKU it could not match or could not price for a requested
date, and callers SHALL be able to distinguish those SKUs from ones priced at zero. The
system SHALL NOT silently omit an unresolvable SKU from a response.

#### Scenario: Unpriced SKUs are reported alongside priced ones

- **WHEN** costs are requested for a set of SKUs and some have no cost version for that date
- **THEN** the response lists the resolved costs
- **AND** separately lists the SKUs that could not be priced, with a reason

#### Scenario: Zero cost is distinct from no cost

- **GIVEN** one product with a recorded cost of zero and another with no cost version
- **WHEN** both are resolved as of the same date
- **THEN** the first returns a cost of zero
- **AND** the second is reported as unpriced

#### Scenario: A partial result is never presented as complete

- **WHEN** any requested SKU cannot be priced
- **THEN** the response makes that explicit, so a caller cannot mistake the priced subset
  for the whole set
