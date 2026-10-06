## ADDED Requirements

### Requirement: Delivered means received

For the weekly settlement of on-sale items, the delivered quantity of an item SHALL be the quantity received, and an item SHALL enter a settlement only after its order is `received`.

#### Scenario: Not received yet

- **GIVEN** an on-sale item in an order awaiting receipt
- **WHEN** the week is settled
- **THEN** the item is not part of the settlement

#### Scenario: Received less than ordered

- **GIVEN** an on-sale item ordered at 100 and received at 90
- **WHEN** the week is settled
- **THEN** 90 units are delivered, so at most 90 can be owed
