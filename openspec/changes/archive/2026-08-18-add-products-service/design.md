## Context

See `proposal.md` — Why. Two constraints shape everything here, and both come from the
business rules in `openspec/project.md` rather than from any technical preference: costs
are dated, and unmatched SKUs must surface rather than vanish.

The service is also the first one other services depend on for a *computed* answer.
`stores-service` hands back rows; this one performs a temporal resolution whose correctness
determines whether every monetary figure downstream is right.

## Goals / Non-Goals

**Goals:**

- Make it structurally impossible to value a historical month with today's cost.
- Make an unpriceable SKU loud — visible in the response, not absent from a sum.
- Give `finance-service` and `supply-service` one bulk operation that answers "what did
  these SKUs cost in this month", so valuation logic is not reimplemented per caller.

**Non-Goals:**

- No price sheet parsing — `add-ingestion-flow` owns reading the spreadsheet and calls here
  to write the results.
- No per-store pricing. Cost is network-wide; if that ever stops being true it is a spec
  change, not an implementation detail.
- No sale price modelling. The panel's mock carries a `price`; the reconciliation domain
  needs *cost*. Revenue comes from the sales reports, which state it directly.
- No fuzzy or similarity-based matching (see D3).

## Decisions

### D1 — Cost as an append-only series of effective-dated versions

Each cost row carries `effectiveFrom`; a lookup selects the latest row with
`effectiveFrom <= asOf`. There is no `currentCost` column anywhere.

*Why:* the alternative — a mutable cost on the product plus a history table written on
update — makes the wrong thing the easy thing. Every naive read hits the mutable field, so
historical repricing is one forgotten join away, and the bug is invisible: totals just
quietly change. Modelling cost only as a series means there is no "current cost" to
accidentally read.

*Consequence:* callers must pass a date. This is deliberate friction — see D2.

### D2 — No implicit "current cost" operation

The API offers cost-as-of-date and nothing else. A caller wanting today's cost passes
today's date explicitly.

*Why:* an implicit `getCost(sku)` would be correct for the dashboard and wrong for every
historical read, and nothing in its signature would warn the caller. Forcing the date into
the call site makes the temporal question visible where the decision is actually made.

*Cost:* slightly noisier call sites. Worth it.

### D3 — Normalisation, then a curated override table, and nothing else

Matching is: normalise (case, accents, whitespace) → exact compare; on failure, consult a
manually curated override table. No edit distance, no fuzzy scoring, no similarity
threshold.

*Why:* the brief specifies exactly this pair, and fuzzy matching is actively dangerous
here. A near-match that silently binds "Guaraná 350ml" to "Guaraná 600ml" produces a
plausible, wrong cost that no one will notice — worse than an unmatched SKU, which is loud
and gets fixed. Ambiguity resolves to "unmatched" by design.

*Consequence:* the override table is operational data that grows as real mismatches appear.
It needs to be manageable without a deploy, which makes it a first-class table rather than
a constant in code.

### D4 — Overrides take precedence over normalisation

*Why:* an override exists precisely because someone looked at a real mismatch and decided
the answer. That human decision must beat a heuristic, including when normalisation would
also produce a match — otherwise the override is unreliable exactly when it matters, and
cannot be used to *correct* a wrong normalised match.

### D5 — Bulk cost lookup returns a partitioned result, not a map

The response separates resolved costs from unresolved SKUs, each unresolved one carrying a
reason (unknown SKU, no cost version for that date, ambiguous name).

*Why:* a plain map invites `map[sku] ?? 0`, which is how an unpriced SKU becomes a silent
zero and understates COGS and loss. A partitioned shape has no natural way to express
"treat missing as zero" without the caller writing something that obviously looks wrong.

*This is the single most important interface decision in the change* — the spec's
"a partial result is never presented as complete" requirement depends on it.

### D6 — Money as integer minor units, never floating point

Costs are stored and transported as integer centavos.

*Why:* these values are summed across thousands of rows and multiplied by quantities.
Binary floating point accumulates error in exactly that pattern, and the resulting
discrepancy against the operator's spreadsheet would be small, real, and very expensive to
diagnose. Prisma `Decimal` is the alternative; integers are chosen because they survive
JSON serialisation to the frontend without a decimal library on either end.

*Consequence:* the API contract must state the unit explicitly, and the frontend formats
for display. Recorded in the shared contracts so no caller reinvents the convention.

### D7 — No `HoldItModule`

Ingestion pushes data *to* this service; this service publishes nothing and consumes no
queue. Registering `hold-it` would import the `WITH_KAFKA_BROKERS` startup hazard for
nothing.

## Risks / Trade-offs

- **A wrong as-of implementation is invisible** → totals still look plausible. Mitigation:
  the spec's historical-stability scenario ("record a later cost, re-value the old period,
  expect no change") is the regression test that catches it, and it must exist before the
  first period is ever valued in anger.
- **The override table is unbounded manual work** → every new mismatch needs a human.
  Mitigation: the unmatched report is the work queue, so the cost is visible rather than
  hidden; if the volume proves unmanageable, that is evidence for revisiting D3 with real
  data instead of speculation.
- **Effective dates are ambiguous around period boundaries** → a cost effective from the
  1st of a month versus mid-month changes which cost a month's reconciliation uses.
  Mitigation: the spec fixes the rule (latest `effectiveFrom <= asOf`); the *choice of what
  date to pass* belongs to `finance-service`, and its spec must state it explicitly rather
  than leaving each caller to decide.
- **Integer centavos push rounding to the caller** → dividing for averages or percentages
  needs a stated rounding rule. Mitigation: this service only stores and multiplies;
  presentation rounding is stated where the figures are computed, in `finance`.

## Open Questions

- Whether cost versions ever need to be corrected retroactively (a price sheet uploaded
  with an error). Deferrable: today's answer is to record a correcting version for the same
  effective date, which the spec already covers; a true audit trail of corrections is a
  later change if the operators ask for one.
