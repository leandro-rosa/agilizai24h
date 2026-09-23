## Purpose

Turns the seven raw monthly bank/card files finance receives into `treasury`-classified pending
transactions ready for review, without requiring every file to arrive at once and without ever
guessing at a line it cannot read.

## ADDED Requirements

### Requirement: A monthly import accepts any subset of the seven sources

The system SHALL accept an upload of one or more files among: extrato PagBank, extrato C6, fatura
do cartão C6, fatura PagSeguro/PagBank, extrato Nubank, extrato Bradesco, extrato Itaú, each
declared with its account/period, in a single submission. It SHALL NOT require all seven to be
present to accept the ones that are.

#### Scenario: Uploading three of the seven sources succeeds

- **WHEN** an operator submits extrato PagBank, extrato C6, and extrato Nubank for the same period,
  without the other four
- **THEN** the system accepts and stages all three
- **AND** does not reject the submission for the missing sources

### Requirement: Each source is parsed by its own format-specific parser

The system SHALL route each of the seven sources to a parser matching its actual measured format
(PDF text extraction for six sources, spreadsheet parsing for Bradesco), and SHALL NOT apply one
source's parsing rules to another's file.

#### Scenario: A file that doesn't match its declared source is rejected

- **WHEN** an uploaded file's content does not match the structure expected for the source it was
  declared as
- **THEN** the import for that source fails with an error naming the mismatch
- **AND** no pending transactions are created from that file

### Requirement: An unparseable line is rejected and reported, never guessed

When a line within an accepted file does not match any recognized shape for its source, the system
SHALL reject that line and report it with enough detail to find it in the original file (page/row
reference and the raw text), and SHALL NOT invent a classification or silently drop it from the
count of rejected lines.

#### Scenario: An unrecognized line type is reported, not skipped silently

- **GIVEN** a statement line that matches none of the known patterns for its bank
- **WHEN** the file is parsed
- **THEN** the line is counted as rejected and reported with its raw text
- **AND** the import's rejected-line count reflects it

### Requirement: A monetary value with no space before the currency mark still parses

The amount parser SHALL correctly extract a negative value written with no space between the sign
and the currency mark (e.g. `-R$150,00`), not only the spaced form.

#### Scenario: Concatenated negative sign is parsed correctly

- **WHEN** a statement line contains the amount `-R$1.234,56` with no space
- **THEN** the parsed amount is R$1.234,56 in the outflow direction
- **AND** the line is not rejected for an unparseable amount

### Requirement: Itaú SISPAG lines are staged as pending, never assigned a guessed payee

A `SISPAG PAGAMENTO DE FORNECEDOR` line from the Itaú extrato, which carries no payee name in the
statement itself, SHALL be staged with `suggested_kind: pending` and no `suggested_supplier_id`.
The system SHALL NOT attempt to infer a fornecedor for this line from any other signal.

#### Scenario: SISPAG line has no guessed fornecedor

- **WHEN** an Itaú extrato line reads "SISPAG PAGAMENTO DE FORNECEDOR" with an amount and date but
  no payee
- **THEN** the resulting pending transaction has `suggested_kind: pending`
- **AND** no fornecedor is assigned

### Requirement: Extracted lines are auto-classified on arrival, as a suggestion

Every successfully parsed line SHALL be run through the classification engine (mapping resolution,
own-entity detection, keyword rules) immediately, and its result stored as a *suggested*
classification on the pending transaction — never written as a confirmed `BankTransaction`.

#### Scenario: A known fornecedor is pre-classified while still pending

- **GIVEN** a parsed line whose counterparty matches an existing exact mapping rule
- **WHEN** the line is staged
- **THEN** its `suggested_kind`/`suggested_category`/`suggested_nature`/`suggested_supplier_id` are
  set from that rule
- **AND** no `BankTransaction` exists yet for this line

### Requirement: Nothing counts until the import is confirmed

A pending transaction SHALL NOT appear in any `treasury` total, summary, or consolidation until its
`PendingImport` is explicitly confirmed. Confirming an import SHALL convert every one of its
non-rejected pending transactions into real `BankTransaction` rows, using each one's classification
as it stands at confirmation time (suggested, or corrected by a reviewer), in a single batch.

#### Scenario: A staged import does not affect totals

- **GIVEN** a staged import with R$5.000 of pending transactions
- **WHEN** the period's expense total is computed before that import is confirmed
- **THEN** the R$5.000 is not included

#### Scenario: Confirming an import creates real transactions in one batch

- **GIVEN** a staged import with 40 pending transactions, none rejected
- **WHEN** the import is confirmed
- **THEN** 40 real `BankTransaction` rows exist, matching each pending transaction's classification
  at the time of confirmation
- **AND** the import's status becomes `confirmed`

### Requirement: An import can be confirmed with unresolved lines remaining

The system SHALL allow confirming an import even when one or more of its pending transactions still
carry `suggested_kind: pending` and no resolved fornecedor.

#### Scenario: Confirming with an unresolved SISPAG line

- **GIVEN** a staged import containing one Itaú SISPAG line still unresolved
- **WHEN** the import is confirmed
- **THEN** that line becomes a real `BankTransaction` with `kind: pending`
- **AND** the rest of the import's lines are confirmed normally

### Requirement: Re-uploading a still-staged source replaces its pending lines

Uploading a source again for an account+period whose import has not yet been confirmed SHALL
replace that import's pending transactions with the new file's result, not add to them.

#### Scenario: Re-upload before confirmation supersedes the previous parse

- **GIVEN** a staged import for extrato C6, period 2026-07, with 30 pending transactions
- **WHEN** extrato C6 for the same account and period is uploaded again, this time producing 32
  lines
- **THEN** the import now has 32 pending transactions
- **AND** the original 30 are gone, not duplicated alongside the new 32

### Requirement: Re-uploading a confirmed source creates a new, flagged import

Uploading a source again for an account+period whose import was already confirmed SHALL create a
new `PendingImport` rather than modifying the existing `BankTransaction` rows. Each new pending
transaction that matches an existing confirmed transaction (same date, amount, and normalized
counterparty) SHALL be flagged as a likely duplicate.

#### Scenario: Re-upload after confirmation does not silently duplicate

- **GIVEN** a confirmed import for extrato PagBank, period 2026-07
- **WHEN** extrato PagBank for the same account and period is uploaded again
- **THEN** a new `PendingImport` is created, separate from the confirmed one
- **AND** any of its lines matching an already-confirmed transaction by date, amount, and
  counterparty is flagged as a likely duplicate before it could be confirmed again

### Requirement: Historical backfill uses the same import flow

Uploading a source for a period earlier than the current month SHALL follow the identical
accept-parse-classify-stage-confirm flow as the current month, with no separate backfill mechanism.

#### Scenario: A past month imports the same way as the current one

- **WHEN** an operator uploads extrato Nubank for 2026-03
- **THEN** it is parsed, classified, and staged exactly as an upload for the current month would be
