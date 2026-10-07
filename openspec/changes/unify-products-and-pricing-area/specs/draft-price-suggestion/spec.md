## ADDED Requirements

### Requirement: A suggestion for a product that is not registered yet

The pricing engine SHALL compute a suggestion from a category and a unit cost without a registered product, using the same cost structure and parameters as the report (payment fees, tax, category loss, operating share, target margin, rounding). It SHALL return the cost per unit used, the suggested price, the margin at it, the target and the data it used, and, when a price is typed, the margin at that price. It SHALL list every missing parameter and SHALL NOT return a price when one is missing.

#### Scenario: Missing tax

- **GIVEN** no tax rate is configured
- **WHEN** a draft suggestion is requested
- **THEN** it says the tax rate is missing and returns no price
