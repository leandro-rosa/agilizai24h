## ADDED Requirements

### Requirement: Purchase figures come from recorded purchases

Once purchases exist, the analysis SHALL report bought units and value, orders, invoices, average paid cost and bought-versus-restocked from them, per supplier and product and per month; months without purchase history SHALL stay unavailable ("Sem histórico de compras"), and the purchase-dependent insights SHALL be generated from the recorded data with their evidence.

#### Scenario: A month with purchases

- **GIVEN** 300 units bought from a supplier in October/2026 and 270 restocked
- **WHEN** the supplier analysis for October is requested
- **THEN** bought units is 300 and 10% of the units bought are reported as not yet restocked, with that evidence

#### Scenario: A month before the base

- **WHEN** the analysis is requested for September/2026
- **THEN** purchase figures are still unavailable, not zero

### Requirement: Bonus items are left out of margin and markup

Margin, markup, gross profit and the products-with-attention count SHALL exclude items received as bonus, and the analysis SHALL report bonus units separately, so a zero-cost bonus item never reads as a 100% margin.

#### Scenario: A bonus product

- **GIVEN** a product received only as bonus and sold in the month
- **WHEN** its analysis is requested
- **THEN** its margin and markup are unavailable with the reason "bonificação", and its bonus units are shown
