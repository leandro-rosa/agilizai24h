## Purpose

Handles suppliers that are paid in different ways: outright, as a bonus, or only for what sells, with a weekly settlement the owner reviews and confirms.

## ADDED Requirements

### Requirement: Each item has a condition

Every purchase item SHALL have exactly one condition: `paid` (owed at the unit cost), `bonus` (nothing owed) or `on_sale` (owed only for units that sell). The condition SHALL be chosen when the purchase is recorded and SHALL be changeable until the item is settled.

#### Scenario: A bonus item

- **WHEN** an item is recorded as `bonus`
- **THEN** its amount owed is zero and it is not counted as spend

#### Scenario: Changing the condition after settlement

- **WHEN** an item already settled has its condition changed
- **THEN** the change is refused

### Requirement: Weekly settlement of on-sale items

For `on_sale` items the system SHALL compute, per supplier and week, the units sold in that week from the sales records and the amount owed as units sold times the agreed unit cost, and SHALL show the evidence: units delivered, sold, expired or returned, unsold, and the formula. Units not sold, expired or returned SHALL NOT be owed. The settlement SHALL be a proposal until the operator confirms it.

#### Scenario: Paying only what sold

- **GIVEN** 100 units delivered at R$ 5,00 on sale, of which 62 sold, 8 expired and 30 are unsold in the week
- **WHEN** the week is settled
- **THEN** the amount owed is 62 × R$ 5,00 = R$ 310,00
- **AND** the evidence shows 100 delivered, 62 sold, 8 expired and 30 unsold

#### Scenario: Not confirmed yet

- **WHEN** a settlement has been computed but not confirmed
- **THEN** it is labelled a proposal and is not counted as owed

#### Scenario: Missing sales data

- **WHEN** sales for the week were not imported for some stores
- **THEN** the settlement is marked partial and says which stores are missing, rather than owing less silently

### Requirement: Payment status

A confirmed settlement and each `paid` purchase SHALL carry a payment status of `pending` or `paid` with the date and optional note, recorded by the operator. The system SHALL NOT make or post any payment.

#### Scenario: Marking as paid

- **WHEN** the operator marks a confirmed settlement as paid on a date
- **THEN** it reads `paid` with that date and leaves the pending total

### Requirement: Expired and returned units are recorded, not inferred

Units that expired or were returned for an on-sale item SHALL come from the supply removal records (reasons expired, return) for that product and week, and SHALL be shown separately from unsold units.

#### Scenario: Expired units

- **WHEN** 8 units of the item are removed in the week with reason expired
- **THEN** the settlement shows 8 expired and does not owe them
