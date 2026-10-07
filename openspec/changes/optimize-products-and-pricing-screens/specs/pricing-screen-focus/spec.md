## ADDED Requirements

### Requirement: Pricing is for analysis, simulation and approval

The Pricing screen SHALL consult the central registry, SHALL NOT repeat the registration form or the catalogue import, and SHALL link each product to "Editar cadastro". It SHALL show three cards (margin of the analysable products, products to review, estimated monthly impact) and the coverage of the analysis (analysed over total). A product without enough data SHALL never count as margin zero.

#### Scenario: Coverage

- **GIVEN** 255 products of which 22 are analysable
- **THEN** the screen says 22 of 255 were analysed and counts the rest apart with the reason

### Requirement: Products without a reliable cost are one compact pending list

The screen SHALL group products without a reliable cost in a compact, clickable list with the reason and a way to fix it.

#### Scenario: Stale cost

- **WHEN** a cost comes from an initial load and nothing was bought in the window
- **THEN** the pending list says the cost is old and links to the product's costs

### Requirement: A period is history, a newer cost is not part of it

A report for a period SHALL value cost as of the end of that period. When the registry holds a newer cost, the product SHALL say so with its value and date, never presenting it as that period's cost.

#### Scenario: October cost in a September report

- **GIVEN** a cost effective 2026-10-10
- **WHEN** the September report is read
- **THEN** September uses the cost in force on 2026-09-30 and shows "custo novo depois do período"

### Requirement: The estimate states its premise and nothing is claimed as published

The estimated impact SHALL be labelled an estimate with its premise (sales volume held constant) and SHALL NOT promise that volume is kept. The screen SHALL NOT say a price was published to the POS or the card machine.

#### Scenario: Approval

- **WHEN** a price is approved
- **THEN** the user, date, previous price, new price, store (when applicable) and start of validity are recorded and the old price stays in force until that start
