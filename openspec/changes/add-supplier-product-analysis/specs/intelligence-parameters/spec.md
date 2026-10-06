## ADDED Requirements

### Requirement: Supplier and product analysis parameters

The thresholds that classify a store's situation for a product (Bom, Atenção, Crítico by sold-over-restocked ratio and loss share) and the margin by which a loss rate is "above network average" SHALL be backend parameters, versioned like the others, labelled provisional until the owner has reviewed their effect on the real distribution stratified by turnover.

#### Scenario: Provisional defaults

- **WHEN** the service starts with no owner change
- **THEN** the analysis parameters have labelled provisional defaults

#### Scenario: Recalibration

- **WHEN** the owner changes a situation threshold
- **THEN** a new parameter version exists and later analyses use it
