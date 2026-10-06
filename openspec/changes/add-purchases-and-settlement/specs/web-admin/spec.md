## ADDED Requirements

### Requirement: Orders and invoices pages

The admin SHALL provide "Pedidos" and "Notas fiscais" pages under "Compras" listing purchases and invoices with supplier, date, items, condition and payment status, and SHALL provide the header actions "Importar nota fiscal" and "Lançar compra" on "Compras e Fornecedores".

#### Scenario: Importing an invoice from the page

- **WHEN** an operator imports an NF-e file
- **THEN** the resolved items are shown for confirmation and the unresolved ones are listed for review before anything is recorded

#### Scenario: Entering a purchase by hand

- **WHEN** an operator opens "Lançar compra"
- **THEN** supplier, date, products, quantities, unit costs and the condition of each item can be entered, with the invoice number optional

### Requirement: Settlement screen

The admin SHALL provide a screen to review the weekly settlement per supplier with its evidence, confirm it, and mark it paid, labelling an unconfirmed settlement a proposal and never moving money.

#### Scenario: Reviewing a settlement

- **WHEN** the operator opens the week of an on-sale supplier
- **THEN** delivered, sold, expired, unsold and the amount owed are shown with the formula, and the amount is not final until confirmed
