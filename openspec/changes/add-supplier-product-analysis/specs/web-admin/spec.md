## ADDED Requirements

### Requirement: Purchases and suppliers analysis page

The admin SHALL provide a "Compras e Fornecedores" page under a new "Compras" navigation group, available to users with the supply read permission. It SHALL offer the modes "Por fornecedor" and "Por produto", filters for supplier, category, product and store, a period selector with previous-month navigation, a comparison choice (previous month or 3-month average), KPI cards with variation, an insights block with expandable evidence, a movement summary and a 6-month evolution.

#### Scenario: Opening the page

- **WHEN** a permitted user opens "Compras e Fornecedores"
- **THEN** the supplier mode is shown with period, filters and comparison controls

#### Scenario: Missing purchase data

- **WHEN** purchase figures are unavailable
- **THEN** cells and months show "Sem histórico de compras" or "—", never 0
- **AND** the header states that the purchase base starts in October/2026

#### Scenario: Failed section

- **WHEN** one section fails to load
- **THEN** it shows "Indisponível" without hiding the other sections

### Requirement: Invoice and purchase entry actions are not offered yet

Until a purchase source exists, the page SHALL NOT show working "Importar nota fiscal" or "Lançar compra" actions, nor navigation entries for Pedidos and Notas fiscais.

#### Scenario: No purchase actions

- **WHEN** the page is open
- **THEN** no control suggests that purchases can be imported or entered

### Requirement: Link a product to its supplier

From the page a user SHALL be able to link a product that has no supplier to a registered supplier. The link SHALL be saved in the product registry and SHALL be the only basis for attributing products to suppliers.

#### Scenario: Linking a product

- **GIVEN** a product listed as "sem fornecedor cadastrado"
- **WHEN** the user links it to a supplier
- **THEN** the product appears under that supplier from then on
