## Context

See `proposal.md` — Why. This is the service that owns the platform's defining business
rule, and the first one to publish an event other services react to.

Two constraints from `openspec/project.md` drive everything: the six removal reasons split
three-and-three into loss and non-loss, and a single reported removal line can mix reasons,
so classification happens per reason and never per line.

`sales-service` has already established the idempotency contract (whole-period replacement
in one transaction); this service follows it deliberately rather than inventing a second
pattern.

## Goals / Non-Goals

**Goals:**

- Make the loss rule inspectable data rather than a condition hidden in a query.
- Store removals already split by reason, so no downstream consumer ever re-parses text.
- Decouple ingestion from reconciliation with an event that carries facts, not figures.

**Non-Goals:**

- No parsing of the free-text `Removals` field — `add-ingestion-flow` owns that and delivers
  already-split quantities. This service's contract is quantities-per-reason in, never a
  string to interpret.
- No currency. This service deals in units; `finance-service` multiplies by cost.
- No stock levels — that is `inventory-service`, derived from restock, sales and removals.
- No approval or scheduling workflow, despite what the admin panel's placeholder mock shows.

## Decisions

### D1 — Reasons are a first-class table with an explicit `countsAsLoss` flag

Not an enum in code, and not a hard-coded list in a `WHERE` clause.

*Why:* the spec requires the classification to be reportable and inspectable. A rule
expressed as `WHERE reason IN ('expired','damaged','other')` is invisible to the operators,
duplicated at every call site, and silently wrong the moment a seventh reason appears in a
report. As data, the rule has one home and can be shown in the UI next to the number it
produced.

*Consequence:* a new reason arriving from the POS is an operational event with a decision
attached ("does this count?"), which is exactly the visibility the spec's
unrecognised-reason scenario demands.

### D2 — Unrecognised reasons are rejected, never bucketed by default

*Why:* both defaults are wrong in a way that hides itself. Defaulting to loss inflates the
figure the business is trying to reduce; defaulting to non-loss quietly deletes real loss
from the books. Rejecting forces a human decision once, at ingestion, when the file that
caused it is still in hand.

*Cost:* an unfamiliar reason blocks part of an upload. Acceptable, and better than a
plausible wrong total. `add-ingestion-flow` must surface this as a reportable ingestion
failure rather than a crash.

### D3 — Store split quantities, never the original combined line

The persisted record for `-6 Devolução, -3 Outro motivo` is two rows. The combined 9 exists
nowhere as a quantity.

*Why:* if the combined figure were stored alongside the split, the two could disagree, and
every consumer would have to know which to trust. Storing only the split makes the
reconciliation scenario ("9 units removed yields 3 units of loss") structurally true rather
than dependent on a correct query.

*Trade-off:* the original line's raw text is still worth keeping for provenance and dispute
resolution — but as an audit field, explicitly not as a quantity anything computes from.

### D4 — Real loss is derived on read, not stored

*Why:* a stored loss column is a denormalisation that can drift from the per-reason rows it
summarises, and the drift is invisible. Deriving it means the rows are the single source of
truth and the classification flag can be corrected without a backfill.

*Cost:* a sum per read. Trivial at this data volume — one store-month is tens of SKUs.

### D5 — The period-data-updated event carries identifiers, not figures

The event says "store X, period Y changed". It does not carry loss totals or any monetary
value.

*Why:* this is what keeps `supply` from knowing how reconciliation works. If the event
carried computed figures, changing the reconciliation formula would mean changing this
service, and the two would be coupled through the message bus — the exact coupling the
event was introduced to avoid. It also sidesteps stale-payload bugs: the consumer reads
current state when it processes the event.

### D6 — No event when nothing actually changed

*Why:* re-uploading an identical file is a normal operator action (they often re-run a
month). Publishing unconditionally would trigger a recomputation storm in `finance-service`
for no reason. Requires comparing against stored state before publishing, which is cheap
and makes the event meaningful.

### D7 — Whole-period replacement in one transaction, matching `sales-service`

*Why:* consistency across the two ingestion sinks matters more than any local optimisation.
Row-by-row upsert leaves stale SKUs behind when a corrected report drops one — the same bug
in both services if solved differently. The event is published only after the transaction
commits, so no consumer can read a half-replaced period.

## Risks / Trade-offs

- **A wrong classification is invisible in the output** → the loss figure still looks
  plausible. Mitigation: the spec's mixed-reason scenario (9 units → 3 loss) is the
  regression test, and it must exist with fixtures drawn from real report text before any
  period is reconciled for the business.
- **The reason table can be edited to change history** → flipping `countsAsLoss` silently
  restates every past period, because loss is derived (D4). Mitigation: treat the flag as
  security-relevant configuration — changes require the same review as code, and the UI
  should show which classification produced a displayed figure. If retroactive restatement
  ever becomes a real problem, the flag needs its own effective-dating, mirroring
  `products-service`'s cost versions.
- **Event delivery is at-least-once** → `finance-service` may recompute the same period
  twice. Mitigation: recomputation must be idempotent, which is stated as a requirement in
  that service's own change rather than assumed here.
- **Ingestion rejects on unknown reasons** (D2) → an upload can be partially blocked.
  Mitigation: the failure must name the store, period, SKU and the unrecognised text, so
  resolving it is a one-minute task rather than a hunt through a spreadsheet.

## Migration Plan

New service, no data migration. Seed the six known reasons and their classifications in the
initial migration, since they are structural facts validated against production data rather
than configuration someone should invent per environment.

Deploy after `sales-service` (to follow its established idempotency contract) and before
`add-ingestion-flow`, which needs somewhere to write.

## Open Questions

- Whether `other reason` should eventually be split into finer categories, given it counts
  as loss and is the least informative label. Deferrable: it is a reporting refinement that
  needs the operators to look at real volumes first, and it changes no interface here.
