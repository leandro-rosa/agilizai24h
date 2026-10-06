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
