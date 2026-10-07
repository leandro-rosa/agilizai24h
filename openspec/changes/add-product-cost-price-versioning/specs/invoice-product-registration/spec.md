## Purpose

Lets an invoice be the door into the product registry: a line whose product does not exist yet can be registered from the invoice itself, with its barcode linked, its first cost recorded and a price suggested by the same pricing engine, while there is still only one product record in the system.

## ADDED Requirements

### Requirement: A product can be registered from an invoice line

When an invoice line matches no product, the system SHALL offer to register the product from that line. The form SHALL be filled with what the invoice carries (description, EAN, supplier, invoice unit, quantity bought, units per package, purchase cost, invoice date and number) and SHALL ask only for what is missing (SKU, category, subcategory, sale unit, package type, fractionable). The product created SHALL be the same record the product registry shows: there SHALL NOT be a product that exists only in the invoice. Its registration origin SHALL be recorded as created from an invoice, with the invoice number, the supplier, the date and the user.

#### Scenario: Registering from the invoice

- **GIVEN** an invoice line "Novo sabor de marmita", EAN 789…, 20 units at R$ 8,50, with no matching product
- **WHEN** the user registers the product from that line
- **THEN** the product exists in the registry with the SKU, the EAN linked, the supplier and the origin "Cadastro originado de NF-e"
- **AND** the line shows the product and the status "Produto cadastrado"

### Requirement: The SKU is suggested, never created alone

When the invoice has no SKU, the system SHALL suggest one, taken as the next number after the highest six-digit numeric SKU, and SHALL label it a suggestion. The user SHALL confirm or change it. A SKU that already exists SHALL be refused. A suggestion that conflicts SHALL not be applied without the user's confirmation.

#### Scenario: Suggestion

- **GIVEN** the highest six-digit SKU is 110023
- **WHEN** the registration form opens for a line with no SKU
- **THEN** it suggests 110024 as a suggestion, not as a rule

#### Scenario: Duplicate SKU

- **WHEN** the user submits a SKU that already exists
- **THEN** it is refused and nothing is created

### Requirement: The invoice EAN becomes an EAN of the new product

The EAN of the invoice line SHALL be linked to the new product as its principal EAN, with the origin "invoice".

#### Scenario: EAN linked

- **WHEN** the product is registered from a line with EAN A
- **THEN** A is an active, principal EAN of that product

### Requirement: A known product with a new EAN is never duplicated

When the invoice EAN is not registered but the product may already exist, the system SHALL say "Este produto pode já existir no cadastro" with the likely matches and SHALL offer to link the EAN to an existing product. After the user confirms, the EAN SHALL belong to that SKU and the cost, price, purchase, sales, loss and margin history SHALL stay under it. A product SHALL NOT be created only because an EAN changed.

#### Scenario: Link instead of creating

- **GIVEN** a line with an unregistered EAN that looks like product X
- **WHEN** the user chooses "Vincular EAN a produto existente" and X
- **THEN** the EAN is linked to X and no product is created

### Requirement: An EAN that belongs to another product blocks the registration

When the invoice EAN is already linked to a product, the system SHALL NOT create a product. It SHALL say "Este EAN já está vinculado ao produto X" and offer to view that product or to correct the link, and SHALL NOT decide for the user.

#### Scenario: EAN of another product

- **GIVEN** the EAN is active on product X
- **WHEN** the line is checked
- **THEN** the message names X, offers "Ver produto" and "Corrigir vínculo", and no product is created

### Requirement: The invoice cost is the first cost version

The cost of the invoice line SHALL be the first cost version of the new product, from the invoice (source invoice, supplier, invoice number, original quantity and total), effective on the receipt date as for every invoice cost. When the purchase is not yet received, the cost version SHALL be created at receipt, and until then the price suggestion SHALL use the invoice cost labelled as not yet received. No separate manual cost SHALL be asked for.

#### Scenario: Already received

- **GIVEN** an invoice entered as received on 2026-10-10 with a unit cost of R$ 8,50
- **WHEN** the product is registered from it
- **THEN** a cost of R$ 8,50 effective 2026-10-10 exists with source invoice, the supplier and the invoice number

#### Scenario: Not yet received

- **GIVEN** an invoice awaiting receipt
- **WHEN** the product is registered from it
- **THEN** no cost version exists yet and the suggestion says the cost is from an invoice not yet received
- **AND** the cost version is created when the purchase is received

### Requirement: Leaving it for later keeps the invoice line

The user SHALL be able to leave a line unregistered. Then no product and no SKU SHALL be created, the line SHALL NOT be discarded, the purchase SHALL show "Aguardando cadastro de produto", and the user SHALL be able to come back and finish the registration, link an EAN or choose a product.

#### Scenario: Leave for later

- **WHEN** the user chooses "Deixar para depois" on a line
- **THEN** the line stays on the purchase as pending, with its description, EAN, quantity and cost
- **AND** no product is created

### Requirement: A suggested price comes from the same pricing engine

After the product is registered, the system SHALL offer a suggested price computed by the same engine and parameters as the pricing screen, with no formula of its own. For a product with no sales history the result SHALL say "Produto novo — sem histórico de vendas", SHALL lower the confidence, and SHALL state which data it used (cost and its origin, category, tax, payment fees, loss of the category, operating allocation, target and minimum margin, rounding). The user SHALL be able to use the suggested price, set another, or save without a price. Whichever is chosen SHALL be recorded: suggested and accepted, changed by hand, or left without a price. No price SHALL be applied without that choice.

#### Scenario: New product

- **GIVEN** a product registered from an invoice with a cost and no sales
- **WHEN** the suggestion is shown
- **THEN** it shows a price, the label "Produto novo — sem histórico de vendas" and a reduced confidence

#### Scenario: Saving without a price

- **WHEN** the user chooses "Salvar sem preço"
- **THEN** no price version is created and the choice is recorded

### Requirement: The new product is visible everywhere at once

The product SHALL appear immediately in the product registry and be found by the pricing screen as "Produto novo" (and "Sem histórico de vendas" when it has none), reading the same product record, with its cost, the date of that cost, its supplier and its EAN.

#### Scenario: Same product everywhere

- **WHEN** a product is registered from an invoice
- **THEN** the registry, the purchase and the pricing screen all show the same SKU
