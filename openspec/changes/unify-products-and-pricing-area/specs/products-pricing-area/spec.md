## ADDED Requirements

### Requirement: One area for products and pricing

The menu SHALL have one entry "Produtos e Precificação" with the views Catálogo, Precificação and Categorias, all using the same product identifier. The old routes SHALL redirect to the matching view. "Novo produto" SHALL be available in the area and open an integrated form without leaving it.

#### Scenario: Old pricing route

- **WHEN** the operator opens `/purchases/pricing?sku=110024`
- **THEN** they land on the Precificação view with that product open

### Requirement: The new-product form suggests a price while it is filled

As soon as a valid purchase cost is given, the form SHALL show the cost per sold unit, the suggested price, the estimated margin at it and the target used, computed by the pricing engine with its rules. It SHALL recalculate when cost, conversion factor, category or another relevant parameter changes. For a product with no sales it SHALL say the suggestion is initial and SHALL NOT show a sales volume or a monthly impact. When a required parameter is missing it SHALL list what is missing and SHALL NOT show zero as a price or margin.

#### Scenario: Box converted to unit

- **GIVEN** a box of 12 at R$ 60,00
- **THEN** the form shows a cost of R$ 5,00 per unit and a price suggested from that cost

#### Scenario: Cost changes

- **WHEN** the cost is changed
- **THEN** the suggestion is recalculated

### Requirement: Saving and approving are separate

Saving the registration SHALL NOT approve a price. Approving SHALL be an explicit action with a start of validity and SHALL be recorded with the user and the previous price. The registration SHALL be saveable with the price pending.

#### Scenario: Pending price

- **WHEN** the operator saves with the price pending
- **THEN** the product exists with its cost and no price, and appears in the catalogue as "Preço pendente"
