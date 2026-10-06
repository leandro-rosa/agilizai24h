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

### Requirement: A purchase can be entered at any stage

The system SHALL let a purchase be created directly at `requisition`, `awaiting_invoice`, `invoiced`, `awaiting_receipt` or `received`, because orders are often recorded only after the order was placed and the invoice issued. The history SHALL show the stage it was created at and by whom. Creating at `invoiced` or later SHALL require the invoice number or an imported NF-e; creating at `received` SHALL record the quantity received (default: ordered) and the receipt date.

#### Scenario: A purchase already invoiced

- **WHEN** an operator records a purchase with an invoice number and no earlier requisition
- **THEN** it is created at `invoiced` and the history shows it was created at that stage

#### Scenario: Already received

- **WHEN** an operator records a purchase as already received on a given date
- **THEN** it is created at `received` with that receipt date and counts as a purchase from then on

#### Scenario: An invoiced stage without a number

- **WHEN** a purchase is created at `invoiced` with neither an invoice number nor an NF-e
- **THEN** it is refused

### Requirement: Delivery deadline and payment term

Each order SHALL carry an optional expected delivery date and a payment term: `on_receipt` (paid when received) or a due date (boleto). The system SHALL show both on the order, SHALL flag an order whose delivery date passed without receipt, and SHALL flag a payment whose due date passed without being paid. A payment term `on_receipt` SHALL become due on the receipt date.

#### Scenario: Pay on receipt

- **GIVEN** an order with payment term `on_receipt`
- **WHEN** it is received on a date
- **THEN** its payment is due on that date

#### Scenario: A boleto for day X

- **WHEN** an order is recorded with a due date
- **THEN** the due date is shown, and the order is flagged overdue after that date while the payment is pending

#### Scenario: A late delivery

- **GIVEN** an expected delivery date that has passed and an order not yet received
- **THEN** the order is flagged as late

### Requirement: What is to be paid and when

The system SHALL list pending payments of paid-condition items by due date, with the total per due date, so the owner can see what to pay and when; on-sale items are paid by the weekly settlement, not by this list.

#### Scenario: Pending payments

- **GIVEN** two orders with boletos due on different days
- **WHEN** the pending payments are listed
- **THEN** they appear by due date with a total per date, and orders paid on receipt appear once received
