## Purpose

Takes the pricing report out of the screen as a spreadsheet and a printable PDF, from the same data the screen shows, so what is exported can never disagree with what was seen.

## ADDED Requirements

### Requirement: Excel export

"Exportar Excel" SHALL produce a spreadsheet of the report in view with one row per product (code, name, category, supplier, cost, price, margin, target, minimum, target and recommended price, estimated impact in R$ per month, status, confidence), a sheet of the costs that changed, a sheet of margin by category, and a sheet with the period, scope, engine and parameter versions and the data-quality notes. Values SHALL be numbers, not formatted text, and a missing value SHALL be an empty cell, not zero. The filters in view SHALL apply.

#### Scenario: Filtered export

- **GIVEN** the table is filtered to the category "Bebidas"
- **WHEN** the user exports to Excel
- **THEN** the product sheet contains only beverage products

#### Scenario: Missing value

- **GIVEN** a product with no recommendation
- **WHEN** it is exported
- **THEN** its recommended price and impact cells are empty

### Requirement: PDF export

"Exportar PDF" SHALL produce a PDF in the admin's dark brand theme with the period and scope, the average margin, the products below target, the main opportunities, the changes in cost, the recommended prices with their estimated impact (labelled "Impacto potencial estimado"), and the observations on data quality. It SHALL be generated from the report in view, not from a screenshot of the screen.

#### Scenario: Data quality is stated

- **GIVEN** the report notes that no fee is registered for a payment method
- **WHEN** the PDF is produced
- **THEN** that note appears in the observations section

### Requirement: Export waits for a report

Export actions SHALL be unavailable while no report is loaded and SHALL say why.

#### Scenario: Nothing loaded

- **GIVEN** the report failed to load
- **WHEN** the screen renders
- **THEN** both export actions are disabled with an explanation
