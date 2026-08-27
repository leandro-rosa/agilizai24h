# treasury-review-ui Specification

## Purpose
Gives finance the screen where the monthly reconciliation actually happens: upload the six raw
files, see what the system understood, fix what it got wrong, resolve what it couldn't identify,
and confirm — the workflow that replaces the spreadsheet.

## Requirements

### Requirement: A single screen submits any subset of the six monthly sources

The upload screen SHALL present one file input per source (extrato PagBank, extrato C6, fatura do
cartão C6, extrato Nubank, extrato Bradesco, extrato Itaú) and a single period selector shared by
all of them, and SHALL allow submitting with only some of the six files chosen.

#### Scenario: Submitting fewer than six files works

- **WHEN** an operator selects files for three of the six sources and submits
- **THEN** the upload succeeds for those three
- **AND** the screen does not require the other three before allowing submission

### Requirement: The review screen groups pending transactions the way finance thinks about them

The review screen SHALL present a staged period's pending transactions grouped into: despesa por
categoria, despesa por fornecedor, movimentação (informational, visibly separate from the expense
groups), and pendentes — mirroring the confirmed dashboard structure, using each transaction's
suggested classification.

#### Scenario: A movement is shown separately from expense groups

- **GIVEN** a staged import containing an expense line and a movement line (e.g. a fatura payment)
- **WHEN** the review screen renders
- **THEN** the movement line appears in its own section
- **AND** it is not counted within the despesa-por-categoria or despesa-por-fornecedor groups

### Requirement: A reviewer can correct a pending transaction's classification before confirming

The review screen SHALL allow changing a pending transaction's kind, category, nature, or
fornecedor before the import is confirmed, and SHALL send that correction to the backend so it is
what gets written when the import is confirmed.

#### Scenario: A corrected category is what gets confirmed

- **GIVEN** a pending transaction suggested as `category: "Estoque"`
- **WHEN** a reviewer changes it to `category: "Frete"` and then confirms the import
- **THEN** the resulting `BankTransaction` has `category: "Frete"`, not the original suggestion

### Requirement: An unresolved Itaú SISPAG line can be resolved with an attached image

For a pending transaction with no resolved fornecedor, the review screen SHALL offer attaching an
image (the comprovante) and typing the payee, and SHALL send both to the backend before the line
can be treated as resolved on that screen.

#### Scenario: Attaching a comprovante resolves a SISPAG line

- **GIVEN** a pending Itaú SISPAG transaction with no fornecedor
- **WHEN** a reviewer attaches an image and types a payee name
- **THEN** the pending transaction is updated with the attached image reference and the typed payee
- **AND** the review screen no longer shows it as unresolved

### Requirement: A likely-duplicate line is visibly flagged before confirmation

A pending transaction the backend has flagged as matching an already-confirmed transaction SHALL be
visibly marked as a likely duplicate on the review screen, distinct from an ordinary pending line.

#### Scenario: A flagged duplicate is visually distinct

- **GIVEN** a pending transaction flagged `likely_duplicate_of_id`
- **WHEN** the review screen renders it
- **THEN** it is shown with a duplicate warning, not as an ordinary new line

### Requirement: Confirming or rejecting an import is an explicit, separate action

The review screen SHALL require an explicit "Confirmar" action before any of an import's pending
transactions become real, and SHALL offer a separate "Rejeitar" action that discards the import
without creating any transaction.

#### Scenario: Nothing is confirmed by merely viewing the review screen

- **WHEN** an operator opens the review screen for a staged import and takes no action
- **THEN** none of that import's pending transactions have been confirmed

### Requirement: An already-confirmed transaction can be edited in place

The existing `/treasury` transaction table SHALL offer an edit action on each row that opens a form
pre-filled with that transaction's current kind, category, nature, and fornecedor, and submits
changes without deleting and recreating the row.

#### Scenario: Editing a confirmed transaction updates it without deletion

- **GIVEN** a confirmed `BankTransaction` with `category: "Estoque"`
- **WHEN** an operator opens its edit action and changes the category to `"Frete"`
- **THEN** the same transaction row now shows `category: "Frete"`
- **AND** no new transaction was created and the original was not deleted
