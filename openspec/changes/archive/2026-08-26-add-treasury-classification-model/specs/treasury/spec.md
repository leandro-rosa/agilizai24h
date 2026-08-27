## Purpose

Classifies every bank/card lançamento in `treasury-service`'s ledger along the axes finance's
monthly reconciliation actually needs — is it revenue, an expense, a movement between the
company's own money, or still unidentified — and keeps a fornecedor's spend comparable across
every account it was paid from.

## ADDED Requirements

### Requirement: A transaction has a kind, independent of the DRE nature

Every `BankTransaction` SHALL carry a `kind` of `revenue`, `expense`, `movement`, or `pending`.
The existing `nature` (`cogs | operating | administrative | investment`) SHALL remain required
only when `kind = expense`; it SHALL be absent for `revenue`, `movement`, and `pending`.

#### Scenario: An expense carries both kind and nature

- **WHEN** a transaction is classified as a fornecedor payment
- **THEN** `kind` is `expense`
- **AND** `nature` is one of the four DRE buckets

#### Scenario: A movement never carries a DRE nature

- **WHEN** a transaction is classified as a transfer between the company's own accounts, a
  card-bill payment, a CDB movement, a loan, or a partner draw
- **THEN** `kind` is `movement`
- **AND** `nature` is absent

#### Scenario: An unidentified transaction is pending, not forced into a bucket

- **WHEN** a transaction's favorecido cannot yet be resolved to a mapping rule
- **THEN** `kind` is `pending`
- **AND** the transaction is excluded from every `revenue`/`expense` total until reclassified

### Requirement: Only expense and revenue transactions count toward totals

Summary and consolidation totals SHALL include only transactions with `kind = revenue` or
`kind = expense`. Transactions with `kind = movement` or `kind = pending` SHALL be reported
separately and SHALL NOT be added into either total.

#### Scenario: A movement is visible but excluded from the expense total

- **GIVEN** a period with one `expense` transaction of R$500 and one `movement` transaction of
  R$10.000 (fatura payment)
- **WHEN** the period's expense total is computed
- **THEN** the total is R$500
- **AND** the R$10.000 movement is reported in its own section, not folded into the total

### Requirement: Mapping rules resolve a transaction's classification

A `CounterpartyMapping` rule SHALL specify a `match_type` of `exact` or `contains`, and SHALL
resolve a matching transaction's `kind`, `category`, `nature` (when `kind = expense`), and
`supplier_id`. An `exact` rule SHALL match only when the transaction's normalized counterparty
text equals the rule's normalized `match_text`. A `contains` rule SHALL match when the
transaction's normalized counterparty text contains the rule's `match_text` as a substring.

#### Scenario: Exact rule resolves a known fornecedor

- **GIVEN** a rule with `match_type: exact`, `match_text: "ambev"`, `kind: expense`,
  `category: "Estoque"`
- **WHEN** a transaction's counterparty normalizes to "ambev"
- **THEN** the transaction is classified `kind: expense`, `category: "Estoque"`

#### Scenario: Contains rule resolves a keyword pattern

- **GIVEN** a rule with `match_type: contains`, `match_text: "posto"`, `kind: expense`,
  `category: "Combustível"`
- **WHEN** a transaction's counterparty text contains "POSTO IPIRANGA CENTRO"
- **THEN** the transaction is classified `kind: expense`, `category: "Combustível"`

#### Scenario: Exact rule does not match a substring

- **GIVEN** a rule with `match_type: exact`, `match_text: "ambev"`
- **WHEN** a transaction's counterparty normalizes to "ambev distribuidora filial 2"
- **THEN** the rule does not match
- **AND** the transaction remains unresolved (`kind: pending`) unless another rule matches

### Requirement: Own-entity transfers are always movement, regardless of value

A transfer between two accounts belonging to the company's own registered razões sociais SHALL
be classified `kind: movement` and SHALL never be counted as revenue or expense, regardless of
amount.

#### Scenario: A large Pix between own accounts is not revenue

- **GIVEN** the company's own razões sociais are registered as own-entity mapping rules
- **WHEN** a Pix of R$50.000 arrives with counterparty text naming one of those razões sociais
- **THEN** the transaction is classified `kind: movement`
- **AND** it is not counted in the period's revenue total, no matter the amount

### Requirement: Fornecedor spend consolidates across accounts

The system SHALL provide a summary of `expense` transactions grouped by resolved `supplier_id`
for a period, summing every account the fornecedor was paid from into one total rather than
reporting a separate total per account.

#### Scenario: One fornecedor paid from two accounts sums to one total

- **GIVEN** a fornecedor paid R$300 from the PagBank account and R$450 from the C6 account in
  the same period
- **WHEN** the fornecedor consolidation summary is requested for that period
- **THEN** that fornecedor's entry shows a single total of R$750

### Requirement: A pair of transactions can be marked as neutralizing each other

Two transactions in the same period SHALL be linkable as a neutralizing pair. Once linked,
neither transaction SHALL be counted in the period's revenue or expense totals. The system SHALL
NOT link a pair automatically without confirmation; it SHALL only surface candidate pairs for a
human to confirm.

#### Scenario: A confirmed pair is excluded from both totals

- **GIVEN** an outflow of R$7.248,16 (Pix recusado) and an inflow of R$7.248,16 (estorno) on the
  same day, confirmed as a neutralizing pair
- **WHEN** the period's revenue and expense totals are computed
- **THEN** neither the R$7.248,16 outflow nor the R$7.248,16 inflow is included in either total

#### Scenario: Candidate pairs are suggested, never linked silently

- **GIVEN** an outflow and a same-value, same-day inflow that look like a Pix
  recusado/estornado pair
- **WHEN** the neutralization-candidates endpoint is queried for that period
- **THEN** the pair is returned as a suggestion
- **AND** the two transactions remain unlinked, still counted in their totals, until a human
  confirms the link

#### Scenario: Neutralization only pairs transactions in the same month

- **WHEN** a candidate pairing would link two transactions from different periods
- **THEN** the system does not suggest that pair

### Requirement: A confirmed transaction's classification can be corrected

An operator with write access SHALL be able to change a transaction's `kind`, `category`,
`nature`, or `supplier_id` after it has already been counted in a period's totals, without
deleting and recreating the transaction.

#### Scenario: Correcting a miscategorized transaction updates the totals

- **GIVEN** a transaction classified `category: "Estoque"` that should have been `"Frete"`
- **WHEN** an operator edits its `category` to `"Frete"`
- **THEN** the transaction's category is updated in place
- **AND** subsequent category summaries reflect the correction
