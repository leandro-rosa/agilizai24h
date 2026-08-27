# treasury-dashboard Specification

## Purpose
Presents a period's confirmed treasury lançamentos the way finance actually reviews them every
month — what came in, what was really spent, what's still unresolved, and what was just money
moving between the company's own accounts — instead of a generic entrada/saída/saldo summary.

## Requirements

### Requirement: Resumo shows four distinct figures, not three

The `/treasury` summary SHALL show Entrada consolidada, Despesa confirmada, Pendente, and
Movimentação as four separate figures for the selected period. Movimentação SHALL be visually
marked as informational and SHALL NOT be included in any total presented as the period's
result.

#### Scenario: Movimentação is shown but marked informational

- **GIVEN** a period with R$2.000 in `kind: expense` transactions and R$15.000 in `kind: movement`
  transactions (e.g. a fatura payment)
- **WHEN** the resumo renders
- **THEN** Despesa confirmada shows R$2.000
- **AND** Movimentação shows R$15.000, visibly distinguished as not part of the result

### Requirement: Despesa por categoria replaces the flat DRE-nature breakdown

The dashboard SHALL show one row per `category` among the period's `kind: expense` transactions,
with that category's total, in place of the previous by-`nature` breakdown.

#### Scenario: Categories, not DRE natures, are listed

- **GIVEN** a period with expenses categorized "Estoque", "Frete", and "Combustível"
- **WHEN** the despesa-por-categoria section renders
- **THEN** it shows three rows — Estoque, Frete, Combustível — each with its total
- **AND** it does not render a row per DRE `nature` instead

### Requirement: Despesa por fornecedor consolidates across accounts

The dashboard SHALL show each fornecedor's total spend for the period as a single figure, summed
across every account it was paid from, using the cross-account consolidation the ledger provides.

#### Scenario: A fornecedor paid from two accounts shows one total

- **GIVEN** a fornecedor paid R$300 from PagBank and R$450 from C6 in the same period
- **WHEN** the despesa-por-fornecedor section renders
- **THEN** that fornecedor appears once, with a total of R$750
- **AND** it does not appear as two separate rows, one per account

### Requirement: Pendentes lists every unresolved transaction for the period

The dashboard SHALL show a dedicated list of every `kind: pending` transaction for the selected
period, separate from the despesa and movimentação sections.

#### Scenario: A pending transaction appears in its own list

- **GIVEN** a period containing one `kind: pending` transaction (e.g. an unresolved Itaú SISPAG
  line)
- **WHEN** the dashboard renders
- **THEN** that transaction appears in the pendentes list
- **AND** it is not counted in Despesa confirmada or in any category/fornecedor total

### Requirement: An empty section states there is nothing to show, distinct from a loading or error state

Each of the four sections SHALL distinguish "no data yet for this period" from "still loading" and
from "the request failed", consistent with the app's existing loading/empty/error pattern.

#### Scenario: A period with no movement shows an empty movement section, not an error

- **GIVEN** a period with confirmed expense and revenue transactions but no `kind: movement`
  transactions
- **WHEN** the dashboard renders
- **THEN** the movimentação section shows its empty state
- **AND** it does not show an error or a loading indicator
