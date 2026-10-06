## ADDED Requirements

### Requirement: Orders move through five stages

An order SHALL be in exactly one stage: `requisition`, `awaiting_invoice`, `invoiced`, `awaiting_receipt` or `received`. It SHALL move only forward, one stage at a time, and SHALL NOT change after `received`. Each move SHALL record who made it and when, and the history of moves SHALL be readable.

#### Scenario: Moving forward

- **WHEN** an order in `requisition` is sent to the supplier
- **THEN** it is in `awaiting_invoice` and the history shows who moved it and when

#### Scenario: Skipping a stage

- **WHEN** a move from `requisition` straight to `received` is requested
- **THEN** it is refused

#### Scenario: A received order is final

- **WHEN** a change of stage is requested for a received order
- **THEN** it is refused

### Requirement: Each step asks for what it needs

Moving to `invoiced` SHALL require the invoice number or an imported NF-e. Moving to `received` SHALL record the quantity received per item, defaulting to the quantity ordered, and SHALL show any difference from the ordered quantity.

#### Scenario: Invoicing without a number

- **WHEN** an order is moved to `invoiced` with neither an invoice number nor an NF-e
- **THEN** it is refused

#### Scenario: Receiving less than ordered

- **GIVEN** an item ordered at 100 units
- **WHEN** 90 units are received
- **THEN** the item records 90 received and shows the difference of 10

### Requirement: Only received orders count as purchases

Purchased quantity and value, the purchase base month, and the units delivered for on-sale items SHALL come only from `received` orders, dated by the receipt, using the quantity received. Orders in earlier stages SHALL be shown as open orders and SHALL NOT count as purchased.

#### Scenario: An open order

- **GIVEN** an order in `awaiting_receipt`
- **WHEN** the month's purchases are read
- **THEN** it is not counted as purchased

#### Scenario: Existing purchases

- **WHEN** the stage change is introduced
- **THEN** purchases recorded before it are `received` and keep counting

### Requirement: Actors are recorded

The system SHALL record the logged-in user as the creator, sender, invoicer and receiver of an order, taken from the session and never from what the client sends.

#### Scenario: Who received

- **WHEN** a user receives an order
- **THEN** the order shows that user as the receiver and the date of receipt
