## Purpose

Lets one product (SKU) carry several EANs over time, so a new barcode or packaging never splits the product, and any invoice, purchase or import can find the SKU by an active or a historical EAN. The SKU identifies the product; the EAN identifies a package.

## ADDED Requirements

### Requirement: A product has several EANs

A product SHALL be able to have any number of EANs. Each EAN link SHALL record the EAN, the product, a status (`active` or `inactive`), the start of its validity when known, the end of its validity when it ended, the origin of the registration, when it was registered and an optional note. A link whose start of validity was never recorded SHALL show it as not recorded, not as a made-up date.

#### Scenario: Adding a second EAN

- **GIVEN** a product with the EAN A
- **WHEN** the EAN B is added to the same product
- **THEN** the product has both EANs and is still the same product

### Requirement: An EAN is never active on two products

An EAN SHALL NOT be active on two products at the same time, nor twice on the same product. Adding an EAN that is active on another product SHALL be refused, naming that product.

#### Scenario: EAN already active elsewhere

- **GIVEN** the EAN B is active on product X
- **WHEN** it is added to product Y
- **THEN** the request is refused and says the EAN belongs to product X

### Requirement: An EAN is never deleted

An EAN link SHALL NOT be deleted. It MAY be marked inactive, which records the end of its validity and keeps it in the history. Adding a new EAN MAY retire the current one in the same step. A reactivated EAN returns to `active` on the same link.

#### Scenario: Retiring the old EAN

- **GIVEN** a product whose principal EAN is A
- **WHEN** the EAN B is added as the new principal and A is retired
- **THEN** A is inactive with an end of validity and is still listed
- **AND** B is active and principal

### Requirement: One principal EAN per product, never by deleting

A product SHALL have at most one principal EAN, and it SHALL be active. Changing the principal SHALL NOT remove or deactivate any other EAN. Deactivating the principal SHALL leave the product without a principal until another is chosen.

#### Scenario: Changing the principal

- **GIVEN** a product with active EANs A (principal) and B
- **WHEN** B is made the principal
- **THEN** B is principal and A stays active and linked

### Requirement: The SKU is found by an active or a historical EAN

Looking up an EAN SHALL return the SKU when the EAN is active on a product, preferring the active link. When the EAN is only historical on exactly one product, it SHALL resolve to that product and say it is historical. When it is only historical on more than one product, it SHALL be reported as ambiguous and SHALL NOT be resolved. When it is on no product, it SHALL be reported as "EAN não identificado" and the system SHALL NOT create a product.

#### Scenario: Old EAN still resolves

- **GIVEN** the EAN A is inactive on product X
- **WHEN** an invoice line with the EAN A is matched
- **THEN** it resolves to product X and is marked as a historical EAN

#### Scenario: Unknown EAN

- **WHEN** an invoice line carries an EAN no product has
- **THEN** the line is reported as "EAN não identificado" and no product is created

#### Scenario: Historical in two products

- **GIVEN** the EAN A is inactive on product X and on product Y
- **WHEN** it is looked up
- **THEN** it is reported as ambiguous and not resolved

### Requirement: A change of EAN keeps the product and its history

Adding, retiring or changing an EAN SHALL NOT create a product, and the cost, price, purchase, sales, loss and margin history SHALL stay under the SKU whatever EAN was used. An invoice that used the old EAN and one that used the new EAN SHALL both feed the same SKU.

#### Scenario: Two invoices, two EANs, one SKU

- **GIVEN** a product with the old EAN A (inactive) and the new EAN B (active)
- **WHEN** an invoice with A and a later one with B are received
- **THEN** both create cost versions of the same SKU

### Requirement: The registry shows every EAN

The product registry SHALL list all the EANs of a product with their status, validity, origin and note, and SHALL offer to add one, retire or reactivate one, change the principal and edit a note, without any action that deletes an EAN.

#### Scenario: Listing

- **WHEN** a product with one inactive and one active EAN is opened
- **THEN** both are listed with their status and validity

### Requirement: Sheet sync respects historical EANs

When the sync plan finds an EAN that is linked to an existing product, active or historical, it SHALL say which product it belongs to and SHALL NOT register that EAN on another product.

#### Scenario: Historical EAN in the sheet

- **GIVEN** the EAN A is inactive on product X
- **WHEN** a new SKU in the sheet carries the EAN A
- **THEN** the plan warns that A belongs to X and the new product is registered without it
