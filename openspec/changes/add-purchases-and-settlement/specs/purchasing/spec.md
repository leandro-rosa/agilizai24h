## Purpose

Records what was bought from each supplier, by order, invoice and item, so purchased quantity and value exist as facts instead of "Sem histórico de compras".

## ADDED Requirements

### Requirement: Purchases are recorded as orders, invoices and items

The system SHALL record a purchase as an order from a supplier on a date, optionally tied to one or more invoices, with items each holding a product, quantity, unit cost paid in integer cents, and the condition of the item. A purchase SHALL reference the supplier declared in the supplier registry and the products of the product catalogue.

#### Scenario: Recording a purchase

- **WHEN** a purchase of 300 units of a product at R$ 8,00 from a supplier is recorded
- **THEN** it can be read back with supplier, product, quantity 300, unit cost 800 cents and its date

#### Scenario: Unknown supplier or product

- **WHEN** a purchase names a supplier or product that does not exist
- **THEN** it is refused, not stored with a placeholder

### Requirement: Manual entry for suppliers that issue no invoice

The system SHALL let an operator enter a purchase by hand, with the invoice number optional, so suppliers that issue no invoice are recorded the same way as the others.

#### Scenario: Purchase without an invoice

- **WHEN** an operator records a purchase and leaves the invoice number empty
- **THEN** the purchase is stored with origin `manual` and no invoice

### Requirement: Invoice import

The system SHALL import purchase invoices from NF-e XML files: one invoice with its supplier (matched by tax id), number, issue date and items. The raw file SHALL be kept, and an import that cannot resolve a supplier or a product SHALL list those lines for review instead of guessing.

#### Scenario: Importing an invoice

- **GIVEN** an NF-e whose issuer tax id matches a registered supplier
- **WHEN** it is imported
- **THEN** an invoice and its items are recorded with origin `nfe`

#### Scenario: Unresolved lines

- **WHEN** an invoice has an item whose product cannot be resolved
- **THEN** that item is listed as unresolved for the operator and is not recorded as a purchase until resolved

#### Scenario: Importing the same invoice twice

- **WHEN** an invoice with the same issuer and number is imported again
- **THEN** it is not duplicated

### Requirement: Purchase history starts in October 2026

The system SHALL treat months before the first recorded purchase as having no purchase history, and a purchase figure for such a month SHALL be reported as unavailable, never as zero.

#### Scenario: A month before the base

- **WHEN** purchases are requested for September/2026 and none are recorded
- **THEN** the answer is "no purchase history", not 0 units
