## ADDED Requirements

### Requirement: Orders board

The "Pedidos" page SHALL show a board with one column per stage (Requisição de compra, Aguardando faturamento, Faturado, Aguardando recebimento, Recebido), and one card per order with supplier, invoice number, total value, who created it, the creation, issue and receipt dates, and who received it. Each card SHALL offer the action for the next stage, and the current list SHALL remain available as an alternative view.

#### Scenario: The next step

- **WHEN** a card is in "Requisição de compra"
- **THEN** it offers "Enviar ao fornecedor" and no action that skips a stage

### Requirement: Requisition, send, invoice and receive

The admin SHALL provide a new-requisition form (supplier, date, items with quantity, cost and condition), the send dialog with preview and confirmation, an invoicing step that accepts an invoice number or an imported NF-e, and a receiving step with the quantity received per item and the difference highlighted.

#### Scenario: Receiving with a difference

- **WHEN** the operator enters 90 received for an item ordered at 100
- **THEN** the difference of 10 is highlighted before confirming

### Requirement: Register a new product from the purchase form

The requisition, manual-purchase and NF-e import forms SHALL let the operator register a product that is not in the catalogue (SKU, name, category, optional barcode) without leaving the form, make it selectable immediately, and offer to register the purchase cost as the product's reference cost from the purchase date. Only users allowed to write products SHALL see the option.

#### Scenario: A new product on an invoice line

- **GIVEN** an invoice line with no matching product
- **WHEN** the operator registers the product from that line
- **THEN** the product exists, the line resolves to it, and no other line changes

### Requirement: Entry stage, deadline and payment term in the forms

The forms SHALL let the operator choose the stage the purchase enters at (defaulting to invoiced when an invoice number or NF-e is present), set the expected delivery date and the payment term (on receipt, or a due date), and the board and list SHALL show late deliveries and overdue payments.

#### Scenario: Importing an NF-e that was already received

- **WHEN** the operator imports an NF-e and ticks "já recebi"
- **THEN** the purchase is created as received on the receipt date given

### Requirement: Pending payments view

The admin SHALL show the pending payments by due date with the total per date.

#### Scenario: Viewing what to pay

- **WHEN** the operator opens the pending payments
- **THEN** boletos and receipt-paid orders are listed by due date with totals
