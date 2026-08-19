## Why

The ingestion layer was built against an assumed report format. The operators' real
exports — 7 months, 106 sales files and 7 restocking workbooks, 89,252 product rows —
have now been read, and the parser does not fit them.

Run against a real file today, **every sales row would be rejected**: the parser looks for
a `quantidade` column and the export writes `Qtd. vendida`. The restocking side fails
worse than that. The parser's removal-reason column matches `Remoções`, which in the real
export is a *number*; the reason text lives in `Detalhes das Remoções`, which is never
read. That is not a loud failure — it reads the wrong column and gets a plausible value.

Three structural assumptions are also wrong. A restocking file is not one store's month:
it is **one workbook per month covering every store**, one sheet per operation, with the
store named inside each sheet and the same store appearing across many operations that
must be summed. Each sheet holds **two stacked tables**, not one. And operations come in
three kinds — `Abastecimento`, `Inventário`, `Combinado` — where the parser assumes only
restocking.

This must land before `add-web-real-data`. Wiring the panel to data the ingestion reads
incorrectly makes the error more expensive to find, not less.

What the investigation also confirmed: the domain model is right. All six removal reason
labels in the real data match the loss classification exactly, the mixed-reason format is
as specified, and the parser already sums a reason repeated within one cell — which the
real data does constantly.

## What Changes

- **BREAKING** — Restocking ingestion accepts the **multi-sheet, multi-store workbook**
  the operators actually export. One upload covers every store in the month; the store is
  read from each operation's `Cliente` field rather than stated by the uploader. The
  current one-store-per-upload contract for this file type is replaced.
- **BREAKING** — Column names are taken from the real export (`Nome produto`,
  `Qtd. abastecida`, `Remoções`, `Detalhes das Remoções`, `Qtd. final`, `Diferença`;
  `Descrição`, `Qtd. vendida`, `Valor Vendido`). The invented names are removed rather
  than kept as aliases, so an export drifting back to them fails loudly.
- **BREAKING** — Products resolve by **product code** (`Código Produto` / `Código`), which
  is present in every file and matches the cost reference. Name resolution becomes the
  fallback, not the primary key. Measured: 79/79 sales codes and 133/140 restocking codes
  resolve against the price list; the 7 that do not are exactly the "unpriced SKU" case
  reconciliation already handles.
- A **new movement kind: the inventory adjustment**. `Diferença` is the field that makes
  each row's own quantity arithmetic balance — it mixes deliberate transfers between
  stores, self-checkout mismatches, and data-entry error, indistinguishable from the data
  alone. It is stock movement, it is **not** a loss, and it is not a purchase. 1,621 rows
  carry it, net +31,063 units. Reported and valued as `unclassified stock adjustment` —
  see below.
- Operations are summed per store and month across every sheet of the workbook, including
  repeats of the same store.
- The closing balance the operators themselves record (`Qtd. final`) becomes a
  **cross-check** on derived stock rather than a second source of truth. The identity
  `Qtd. final = Qtd. Anterior + Qtd. abastecida + Remoções + Diferença` holds on
  **100.000%** of the 89,252 rows, so a disagreement means the platform is wrong, not the
  file.
- The acceptance bar for `add-finance-service` (task 11.3, still open) becomes checkable:
  the operators' own manual reconciliation is the `Venda x abastecimento` sheet of
  `Relatórios/agiliz.ai - abastecimento.xlsx`, per store and month, with cost.

### Inventory adjustment valuation — resolved

Stock arriving through an inventory adjustment came from another store, not from a
supplier. Counting it as **restocked value** would state money the network did not spend
again; counting it as nothing understates what reached the shelf. Resolved with the human
(CFO review) as its own figure, **`unclassified stock adjustment`**, valued at current cost
in the current period, with no attempt to trace which store or month originally restocked
the units — the export has no field that would make such tracing reliable, and the
never-restated-history rule the platform already applies elsewhere makes it unnecessary.
"Unclassified" rather than "transfer": the field also carries self-checkout mismatches and
data-entry error, not only deliberate transfers, and treating the whole figure as a clean
transfer would misrepresent it. See design D6 and
[`.fpa/decisions/inventory-adjustment-valuation.md`](../../../.fpa/decisions/inventory-adjustment-valuation.md)
for the full analysis.

## Capabilities

### New Capabilities

- `ingestion/report-layout`: How the real exports are shaped — the multi-sheet workbook,
  the two stacked tables per sheet, the operation kinds, and the column vocabulary — kept
  separate from ingestion's existing behavioural requirements so a future export change is
  a change to one spec.

### Modified Capabilities

- `ingestion`: store resolution moves from an uploader-stated store to a per-operation
  `Cliente` for restocking files; product resolution becomes code-first; removal reason
  text is read from its own column.
- `supply`: gains the inventory adjustment as a movement that is neither restock nor
  classified removal, and must never reach the real-loss figure.
- `inventory`: the closing balance accounts for the adjustment, and the operators'
  recorded `Qtd. final` becomes a stated cross-check that surfaces disagreement.
- `reconciliation`: reports the inventory adjustment as its own `unclassified stock
  adjustment` figure, valued at current cost, separate from the four core figures.

## Impact

- `backend/apps/ingestion-worker-service` — the parser, row mapping and chunking. This is
  where most of the work is: the two-level sheet layout and per-operation store attribution
  do not exist today.
- `backend/apps/supply-service` — a movement kind and its storage; the loss rule itself is
  unchanged and stays where it is.
- `backend/apps/inventory-service` — derivation gains the adjustment term and the
  cross-check against `Qtd. final`.
- `backend/apps/finance-service` — a new `unclassified stock adjustment` figure, valued at
  current cost, separate from the four core figures; the valuation and loss rules for
  those four are unaffected.
- `backend/apps/stores-service` — store records need the `Cliente` names as external
  codes. Note the vocabularies already drift: `Plena Saude - Mogi ` carries a trailing
  space, and `Ascenty - SP03 2` and `Ascenty - SP03 DH4` appear in sales filenames but
  never in `Cliente`.
- `backend/apps/products-service` — the price list (`PREÇOS`: `sku`, `Produto`, `Custo`)
  is the real cost source and keys on the same code.
- No frontend impact. No change to the loss classification, which the real data confirms.
