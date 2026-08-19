## Context

See proposal.md — Why. What follows is the evidence the design rests on, measured across
the operators' 7 months of exports (106 sales files, 7 restocking workbooks, 89,252 product
rows), because several decisions below are only defensible with the numbers attached.

The restocking export's shape:

```
sheet "Operação N"
  row 0  ID PDV | Cliente | Local | ... | Tipo de operação | ... | Total de Perdas | ...
  row 1  68     | Ascenty - HTL05 | Hortolândia | ... | Abastecimento | ...
  row 2  (blank)
  row 3  ID produto | Código Produto | Nome produto | ... | Qtd. Anterior |
         Qtd. abastecida | Remoções | Diferença | Qtd. final | ... | Detalhes das Remoções
  row 4+ product rows
```

Four measurements that decide the design:

1. **`Qtd. final = Qtd. Anterior + Qtd. abastecida + Remoções + Diferença` holds on
   100.000% of 89,252 rows** — zero exceptions across every month and every operation kind.
2. **`Remoções` is never positive**: 3,368 negative, 85,884 zero, 0 positive. It is a
   removal count, always signed negative or absent.
3. **`Diferença` is non-zero only in `Inventário` (1,443 rows) and `Combinado` (178)**,
   never in plain `Abastecimento`. 1,067 positive, 554 negative, net +31,063 units.
4. **Headers do not drift**: 106 sales files share one layout; 7 restocking workbooks share
   one operation-header layout and one product-table layout.

The reason vocabulary matches the existing loss classification exactly, with no unknown
label anywhere in the history: Outro motivo 1,865 · Devolução 968 · Validade vencida 512 ·
Produto danificado 93 · Transferência 29 · Uso e consumo 6.

## Goals / Non-Goals

**Goals:**

- Parse the exports as they are, without asking the operators to change their process.
- Make a layout change fail loudly at the file level rather than quietly at the row level.
- Keep the loss rule where it is and untouched — the real data validates it.
- Make `add-finance-service` task 11.3 checkable against the operators' own reconciliation.

**Non-Goals:**

- Supporting historical variants of the layout. Only the shape present in the seven months
  is supported; anything else fails and is reported.
- Reading bank statements, contracts, or the other workbook tabs (`Estoque`, `DASHBOARD`,
  `orçamento`). They are in the same folder and are out of scope.
- Automatic store registration. Store records are created deliberately, not as a side
  effect of an upload.

## Decisions

### D1 — Fail on an unknown column instead of aliasing to it

Column names come from the export, and a missing expected column fails the whole file.

The current design's alias list (`quantidade`, `abastecido`, `removido`) was invented, and
those names appear in none of the 113 real files. Keeping them as accepted aliases would
preserve the illusion that the parser was ever right about them, and would leave the
alias-matching machinery — which is what produced the worst bug here.

That bug is the argument for failing loudly. `remocoes` matched the `Remoções` column,
which holds a *number*; the reason text lives in `Detalhes das Remoções` and was never
read. Nothing raised an error. A parser that guesses among candidate names will eventually
guess the wrong column, and reading the wrong column is strictly worse than reading none.

*Alternative considered*: keep aliases and add the real names. Rejected — it makes the
failure mode above permanent, and there is no file in existence that needs the old names.

Case, accent and whitespace folding stays, because `Plena Saude - Mogi ` really does carry
a trailing space. That is normalisation of one name, not a choice among several.

### D2 — Take the store from the operation, not from the uploader

For restocking, the store comes from `Cliente` on each operation's header row. For sales it
comes from the uploader, because the sales workbook contains no store identity at all — not
in a column, not in a sheet name, not in the file properties. Only the filename has it, and
a filename is not data.

This splits one rule into two, which is worth stating plainly as a cost. The alternative —
requiring the uploader to state a store for every file — would attribute all 21 stores'
rows in a restocking workbook to whichever one was picked. That is not a degraded result;
it is a wrong one that looks fine.

A store that fails to resolve fails only its own operation. One unregistered store must not
block the other twenty.

### D3 — Product code is the key; name is the fallback

`Código Produto` (restocking), `Código` (sales) and `sku` (price list) are the same
identifier. Measured on one month: 79/79 sales codes and 133/140 restocking codes resolve
against the price list, and sales ∩ restocking is 78/79.

The 7 codes that do not resolve are the honest case, not a defect — they are exactly the
"unpriced SKU" path reconciliation already implements, and they will surface as an
incomplete month naming the products, which is the intended behaviour.

Names cannot be the key: the same product is written `coca cola lata` in the price list and
`Refrigerante Coca-Cola Lata 350 ml` in the sales report, and several carry trailing spaces.
Name resolution stays only as a fallback for a row with no code.

*Alternative considered*: keep name-first with code as a tiebreak. Rejected — it inverts
reliability, and a name collision would silently attribute movement to the wrong product.

### D4 — The adjustment is a third movement kind, not a restock and not a removal

`Diferença` is the value that makes each product row's own arithmetic balance (Context).
The human, who runs restocking operations, confirmed it captures at least three distinct
real events, indistinguishable from the data alone: deliberate transfers between stores
(units brought in from elsewhere, or taken out to transfer or return, to move stock away
from an underperforming location before it becomes loss), a self-checkout customer taking
a different item than the one they paid for, and data-entry error when confirming
quantities. See D6 for why the platform does not attempt to tell these apart.

Modelling it as a restock would state a purchase that did not happen. Modelling it as a
removal would require a reason, and none of the three causes maps cleanly onto the existing
removal reasons — the closest, `Transferência`, is already classified non-loss and covers
only the deliberate-transfer case's outbound side. An inbound adjustment has no removal
equivalent at all, so the removal model cannot represent half of the data (1,067 of 1,621
rows), and neither model can represent a self-checkout mismatch or a data-entry error at
all.

A signed quantity of its own is the smallest model that represents all three causes without
lying about any of them. It flows into stock (D5) and gets its own currency figure, labeled
for what it is rather than assumed to be a transfer (D6).

*Alternative considered*: infer a matching outbound adjustment in the origin store, making
transfers double-entry. Rejected for now — the export does not name a counterpart store,
and D6 measures that pairing does not resolve reliably even within one month. Recorded
under Open Questions.

### D5 — Derive stock; store the recorded balance, but do not cross-check it against a month

Stock stays derived from movements, gaining the adjustment term. The operators' own
`Qtd. final` is stored alongside the derived figure, but is **not** compared against a
month-end total — reversed after building it that way and testing it against real data (see
below).

The identity in Context (each row's own arithmetic) holds without exception, which means the
export is internally consistent — but that identity is checked at ingestion, per row, against
that row's own `Qtd. Anterior`/`Qtd. abastecida`/`Remoções`/`Diferença` (unchanged, still
enforced — see `report-layout` spec). What this decision originally added on top was a
*second*, month-level check: derived closing stock for the whole period against the latest
operation's `Qtd. final`. That second check is the part being reversed.

**Why it was reversed**: reconciling a real store-month (`Ascenty - JDI01`, 2026-03) against
the operators' own manual sheet surfaced that `Qtd. final` is a reading taken at the moment
of a specific restocking visit, not a month-end closing figure. That store had 5 visits in
March, the last finishing the 26th — any unit sold between the 26th and the 31st is real, and
correctly included in the derived month-end total, but absent from that visit's `Qtd. final`.
The sales report carries no per-sale date (confirmed against 106 real files), and neither
does the one payment-processor export checked for a substitute (PagSeguro's detailed CSV has
a transaction date but no product/SKU column at all — it is payment data, not line-item
data — so it cannot attribute a sale to a SKU regardless of date). With the month-level
cross-check in place, 51 of roughly 70 SKUs in that one store-month came back "disputed" —
not because any movement was lost or double-counted, but because the store sold something
after its last visit, which is the common case, not the exception.

*Alternative considered, and initially built*: derive stock, then compare the derived
month-end total against `Qtd. final` from the latest operation in the period, flagging a
disagreement into reconciliation completeness (D7). Reverted for the reason above — the two
figures answer different questions (month-end vs. visit-moment), so comparing them manufactures
false disagreements rather than surfacing real ones. Revisit if a future sales export carries
a per-sale date: that would allow a true per-visit comparison (derived balance as of the visit
date vs. that visit's `Qtd. final`), which is what D5 originally intended.

*Alternative considered*: trust `Qtd. final` and derive nothing. Rejected — it is simpler
and it discards the row-level identity signal, which is unaffected by this reversal and stays
in place.

### D6 — `Diferença` is an unclassified adjustment, valued at current cost with no origin tracing, reported as a fifth figure

**Resolved with the human (CFO review), after two facts changed the shape of the decision.**

First, `Diferença` is not only transfers. The human, who runs restocking operations, named
two more real causes: a self-checkout customer taking a different item than the one they
paid for (a phantom surplus of one SKU and an unrecorded shortage of another), and plain
data-entry error when confirming quantities in the app. `Diferença` is definitionally the
value that makes each row's own arithmetic balance — `Qtd. final = Qtd. Anterior +
Qtd. abastecida + Remoções + Diferença` holds on 100.000% of 89,252 rows — so all three
causes land in the same column, and the export carries no reason code for `Diferença` the
way it does for removals. There is no way to tell the three apart from the data alone.

Second, pairing an outbound `Diferença` to the inbound side of the same transfer does not
resolve reliably even within one month: of 43 SKUs carrying any `Diferença` in April, only
5 show both a positive and a negative entry, and even those don't match 1:1 (SKU 1013: +3
vs −4). The month's net was +66 units (122 in, 56 out), not the ~0 a closed transfer ledger
would produce. Tracing a `Diferença` unit back to the store and month that originally
restocked it is not implementable from this export — there is no transfer ID, no lot ID,
and no reliable pairing.

That resolves the question the human actually asked — *when a unit returns to stock and
its original restocking cost was already recognized, how do we know which store to reverse
it from?* — **you don't need to know, and the system should not try to find out.**
Restocked value is recognized once, in the month the sending store was actually restocked,
and that figure is never edited retroactively — same rule the platform already applies to
every historical month (the historical-cost-stability property `add-finance-service`
already tests for). The adjustment is a same-period event, valued at the **current**
catalog cost — the same source COGS and remaining stock already use — recognized at
whichever store the movement was recorded against. Because it is same-period and uses the
current cost reference, it structurally cannot re-touch a prior month's restocked value,
regardless of which of the three causes produced the row. Leaving it out of everything
would be wrong the other way: the units really are on the shelf and appear in remaining
stock, so a reader comparing restocked against remaining would find stock with no source.

Its own figure — separate from the four core figures — keeps those four comparable with
the operators' manual reconciliation. It is labeled **`unclassified stock adjustment`**,
not `transfer`: presenting it as a clean transfer figure would misrepresent what the
evidence shows it actually is, and two of its three causes are not economically neutral.
A self-checkout mismatch is a real revenue/shrinkage leak — the platform got paid for the
wrong item, or didn't get paid for the item that actually left. A data-entry error is a
training/process gap. Netting all three silently into a "no impact" line would bury
exactly the signal reconciliation exists to surface. Store, period and SKU combinations
with high `Diferença` frequency or magnitude should be flagged for manual operational
review, the same way dead or slow-moving stock is flagged elsewhere — not because the
figure needs correcting, but because a growing pattern here is itself the finding.

*Alternative considered*: trace to the origin store and reverse its historical restocked
value. Rejected as not implementable with this data source (see pairing test above). If a
future export version adds a transfer or lot reference, that would let a later change add
proper pairing without touching how the four core figures are computed today — the current
design does not foreclose it.

### D7 — Superseded by D5's reversal

This decision said a disputed recorded balance makes the month incomplete, the same rule the
unpriced SKU follows. It has no effect now that D5 no longer computes a disagreement to
propagate — `complete` is driven by pricing and by a negative (inconsistent) derived balance
only. Left here, rather than deleted, so the reasoning that motivated it is not lost: if a
future export change makes a true per-visit comparison possible (see D5), this is the rule
that would apply to whatever disagreement that comparison produces.

### D8 — Chunking follows the sheet, and the store, not the row count

`sheeter.smartChunk` splits by rows today. A restocking workbook must be split so that one
store's operations for a period stay together, because sinks replace a store-period
wholesale and two chunks touching the same store-period would overwrite each other.

The existing staging-table handover (`expected_chunks` / `processed_chunks`, one chunk
finalises) already solves the "N chunks, one commit" problem and is reused unchanged. What
changes is the partition key.

## Risks / Trade-offs

- **The export changes shape and everything stops** → D1 is a deliberate trade of
  availability for correctness. Mitigated by the failure naming the file, the sheet and the
  missing column, so the fix is a one-line alias rather than an investigation. Seven months
  of stability suggests the layout is a product output, not a hand-built sheet.

- **A store name changes and its operations stop resolving** → Fails only that store's
  operations, names the unresolved value, and the other stores ingest. Two vocabularies
  already differ (`Ascenty - SP03 2` and `Ascenty - SP03 DH4` appear in sales filenames but
  never in `Cliente`), so this will happen.

- **A sales file uploaded against the wrong store is undetectable** → The sales export
  carries no store identity, so nothing can cross-check the uploader's choice. This risk
  exists today and is not made worse; it is the strongest argument for eventually asking
  the exporter to include the store.

- **D6 is wrong about the business** → It is flagged for review before implementation. If
  adjustments should count as restocked value, the change is contained to one figure in
  reconciliation; the ingestion and stock work is unaffected either way.

- **D5's original month-level cross-check produced false disagreements** → Realized during
  the actual acceptance-bar reconciliation (Migration Plan step 4), not before. `Qtd. final`
  is a visit-moment reading, not a month-end one; comparing it to a whole month's derived
  total flagged the large majority of one real store-month's SKUs as disputed with no real
  error behind any of them. Reversed — see D5's revised text. The row-level balance identity
  (checked at ingestion, per row, against that row's own numbers) is unaffected and stays in
  place; only the month-level derived-vs-recorded comparison was removed.

- **Reprocessing 7 months at once** → Each month is one workbook covering ~21 stores across
  up to 90 operations, and every store-period touched republishes a period event that fans
  into stock derivation and reconciliation. Backfill runs month by month, oldest first, so
  the forward-propagation window stays small and the queue does not see the whole history
  at once.

## Migration Plan

1. Register the 21 `Cliente` values as store external codes before any ingestion, so the
   first run does not fail on every operation.
2. Load the price list (`PREÇOS`: `sku`, `Produto`, `Custo`) into products, dated from the
   earliest month being backfilled.
3. Ingest January, verify, then proceed month by month. Verification at each step is the
   ingestion report: rows rejected, products unresolved, stores unresolved, balances
   disagreeing.
4. **Acceptance**: reconcile a month and compare against the operators' own manual
   reconciliation — the `Venda x abastecimento` sheet of
   `Relatórios/agiliz.ai - abastecimento.xlsx`, which carries store, month, quantity sold,
   restocked quantity and cost. This closes `add-finance-service` task 11.3, which is still
   open precisely because this reference was not available then.
5. Rollback is per-month: ingestion replaces a store-period wholesale, so re-running an
   earlier month restores it. No schema rollback is needed for the adjustment column, which
   is additive.

## Open Questions

- Should an outbound adjustment in one store be matched to an inbound one in another, so a
  transfer is visible as a single movement across the network? The export does not name the
  counterpart store, and pairing within one month already resolves for only 5 of 43 SKUs
  with imperfect quantity matches (D6) — this needs either a process change (a transfer ID
  in the export) or accepting that pairing stays a heuristic. Deferrable: it does not change
  the specs here, only adds a capability later.
- Should high-frequency or high-magnitude `Diferença` by store/SKU be surfaced as a standing
  operational-review report, and if so where (a finance-service endpoint, a CLAUDE.md-level
  manual query, a panel view)? D6 recommends flagging it but does not specify the mechanism.
  Deferrable: does not change how the figure is computed, only how visible it is.
- The `Total de Perdas`, `Total Perdas Custos (R$)` and `Total de Perdas (R$)` fields on the
  operation header are the export's own loss totals. They are a second cross-check on the
  computed real loss, in units and in currency. Worth using, but not needed to make the
  ingestion correct, and adding it now would widen the change.
- A "Distribution Center" node appears in the export starting 2026-05 — operations with
  `Estoque: Distribution Center`, kind `Inventário`, and no `Cliente` (not a retail store).
  Absent from every one of the 4 months this change's design was originally audited against
  (zero in Jan-Apr; 52/33/40 sheets in May/June/July). Since the store comes from `Cliente`
  (D2), every such operation is currently rejected and its rows dropped entirely — a real,
  ongoing loss of DC-level inventory data for three of the seven backfilled months. Not
  designed around here: what a DC-level `Inventário` operation should mean for reconciliation
  (does its stock count toward any store's CMV? is it a pool that later reaches stores via
  `Diferença`?) is a business-model question, not a parsing one. Recorded as a known gap in
  `ingestion-worker-service/CLAUDE.md`. Does not affect this change's acceptance bar — the
  manual reference sheet only covers March, before the DC existed.
