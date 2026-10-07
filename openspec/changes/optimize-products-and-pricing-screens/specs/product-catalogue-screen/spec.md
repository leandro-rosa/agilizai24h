## ADDED Requirements

### Requirement: Products is the catalogue maintenance screen

The Products screen SHALL list the single product registry with SKU, name, category, principal EAN (with a marker when there are more active EANs), sale unit, last unit cost with its date and status, and an action to open the product. It SHALL NOT show the sale price or the margin in the table. The search SHALL find a product by name, SKU or any EAN linked to it, including inactive ones; the filters SHALL be category and status.

#### Scenario: Search by an inactive EAN

- **GIVEN** a product whose old EAN is inactive
- **WHEN** the operator searches that EAN
- **THEN** the product is listed

#### Scenario: No cost is not zero

- **WHEN** a product has no cost version
- **THEN** its cost cell says "Sem custo" and never R$ 0,00

### Requirement: One creation flow

A product created by hand, by Excel import or from an invoice line SHALL go through the same registration service, SHALL get the same checks (unique SKU, an EAN belongs to one product only) and SHALL record its origin.

#### Scenario: EAN of another product

- **WHEN** a new product is submitted with an EAN already linked to another product
- **THEN** nothing is created and the other product is named

### Requirement: The product detail edits the registry

The detail SHALL edit identification, category, brand and packaging, define purchase unit, sale unit and the box-to-unit factor, manage several EANs, show the cost history and link to the product in Pricing. The cost SHALL be stored per sold unit.

#### Scenario: Box converted to unit

- **GIVEN** a box of 12 bought for R$ 60,00
- **THEN** the unit cost recorded is R$ 5,00
