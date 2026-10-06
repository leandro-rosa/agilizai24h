# supplier-product-analysis Specification

## Purpose
Answers, per supplier and per product, how much was restocked, sold and lost, what it earned and cost, and in which stores it actually sells, with insights that always carry their evidence and an honest absence of purchase data.

## Requirements

### Requirement: Analysis by supplier

The system SHALL return, for a supplier and a month, the products linked to that supplier with restocked, sold and lost quantities, revenue, loss value, cost and margin, plus the same aggregated for the supplier, each compared with the previous month or the 3-month average as requested. Only product-supplier links declared in the product registry SHALL be used.

#### Scenario: Supplier with linked products

- **GIVEN** a supplier with 6 linked products
- **WHEN** the analysis is requested for October/2026
- **THEN** each product row shows restocked, sold, lost, revenue, margin and variation against the chosen comparison
- **AND** the supplier totals equal the sum of the rows

#### Scenario: Product without a declared supplier

- **WHEN** a product has no supplier link
- **THEN** it is never attributed to any supplier by inference
- **AND** it is listed as "sem fornecedor cadastrado" in the product mode

### Requirement: Analysis by product

The system SHALL return, for a product and a month, its supplier (and any supplier history that exists), restocked, sold, lost and revenue totals, loss value, average cost with cost variation, the comparison with the previous month or 3-month average, and a per-store table of restocked, sold, lost and sold-over-restocked ratio.

#### Scenario: Per-store performance

- **GIVEN** a product restocked in three stores
- **WHEN** its analysis is requested
- **THEN** each store row has restocked, sold, lost, sold-over-restocked and a situation
- **AND** a store with 30 restocked and 0 sold is marked critical

#### Scenario: Store questions are answered from the table

- **WHEN** the per-store table is shown
- **THEN** stores where the product sells, stores restocked without return, and stores that should receive more, less or none are identifiable
- **AND** any such recommendation is labelled ESTIMATIVA

### Requirement: Supplier × product cross view

The system SHALL allow filtering by supplier and product together, returning only the movement of that product linked to that supplier. When a product has more than one supplier, the system SHALL list them side by side with quantity, average cost, purchases, generated sales and losses.

#### Scenario: Single declared supplier

- **WHEN** supplier X and product P are both selected
- **THEN** only P's movement under supplier X is shown

#### Scenario: Several suppliers for one product

- **GIVEN** purchase history shows two suppliers for the same product
- **WHEN** the cross view is requested
- **THEN** the suppliers are compared on quantity, average cost, purchases, sales and losses

#### Scenario: No multi-supplier data

- **GIVEN** no purchase history exists
- **WHEN** the cross view is requested
- **THEN** the comparison is not fabricated and states that it needs purchase history

### Requirement: Six-month evolution

For a supplier or a product the system SHALL return at least the last 6 months of bought, restocked, sold and lost quantities. A month with no purchase record SHALL be returned as unavailable with reason `no_purchase_history`, never as zero. Months with restock, sales or loss data SHALL show their real values.

#### Scenario: Months before purchase history

- **WHEN** the evolution covers June to October/2026 and purchases exist only from October
- **THEN** June to September "bought" is unavailable ("Sem histórico de compras") while restocked, sold and lost show real values
- **AND** October bought shows the recorded value

#### Scenario: Store month never ingested

- **WHEN** restock or sales were never ingested for a store and month
- **THEN** the figure is treated as missing data, not as zero

### Requirement: Purchase figures are unavailable until a purchase source exists

While no purchase source exists, bought quantity and value, orders, invoices, average paid cost and bought-versus-restocked figures SHALL be returned as unavailable with reason `no_purchase_history`, and insights that depend on them SHALL NOT be generated. A later purchase source SHALL fill these figures without changing the response contract.

#### Scenario: Supplier opened without purchases

- **WHEN** a supplier analysis is requested and no purchases are recorded
- **THEN** purchase KPIs are unavailable with the reason
- **AND** restocked, sold, lost, revenue and margin are still returned

### Requirement: Contextual insights with evidence

Each insight SHALL relate several figures, SHALL carry the evidence that originated it (numbers and the numerator/denominator of any ratio) and SHALL be labelled FATO, MÉTRICA DERIVADA or ESTIMATIVA. Insights SHALL be generated only from data that exists, and any conclusion that is only an estimate SHALL say so.

#### Scenario: Insight shows its evidence

- **GIVEN** a store restocked with 30 units, sold 5 and lost 8
- **WHEN** the product insights are generated
- **THEN** an insight states those three figures, that performance is below the network, and shows the ratio 5/30 with the network reference used

#### Scenario: Insight depending on missing data

- **WHEN** purchases are unavailable
- **THEN** no insight about bought-versus-restocked or purchases-versus-sales is produced

### Requirement: Store situation and loss comparison rules are parameterised

The situation of a store for a product (Bom, Atenção, Crítico) and the "loss above network average" comparison SHALL be computed in the backend from versioned parameters, and the response SHALL record the parameter version used.

#### Scenario: Result traceable to its parameters

- **WHEN** an analysis is returned
- **THEN** it carries the parameter version in force

### Requirement: Inherited data-quality warnings

The response SHALL flag months and stores whose underlying data is known to be incomplete (for example sales not fully ingested, months without receipts), and figures derived from them SHALL be marked partial rather than presented as complete.

#### Scenario: Incomplete sales month

- **WHEN** a requested month has incomplete sales for some stores
- **THEN** the response lists those stores and marks the affected figures as partial
