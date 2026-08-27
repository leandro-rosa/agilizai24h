## Context

See `proposal.md` — Why. `treasury-service` (`backend/apps/treasury-service`) today owns
`BankAccount`, `BankTransaction`, `CounterpartyMapping`, `AcquirerFee`, `SettlementReceipt` in its
own Postgres, exposed through `gateway-service`'s `TreasuryController`. `BankTransaction.nature`
is closed to the four DRE buckets; `CounterpartyMapping` resolves a favorecido to exactly that
plus `entry_type`/`category` (free text) and an optional `supplier_id`. `applyMappings(period)`
already does exact-match resolution against unclassified rows, touching only rows with
`supplier_id: null` (never re-classifying something a human already fixed). No queue is
registered in this service — every operation is synchronous CRUD.

Finance's business rules (full text in the plan handed off from the requirements conversation)
describe five buckets per lançamento — entrada consolidada, saída por fornecedor, movimentação,
financeiro/tributos, pendente — and two behaviors no current field supports: excluding a matched
pair of transactions from both totals, and summing one fornecedor's spend across every account
it was paid from.

## Goals / Non-Goals

**Goals:**

- Model `kind` so "not revenue, not expense" is a first-class, queryable state, not a
  category name that a summary query has to know to exclude.
- Make every new classification rule (own-entity, keyword-based fuel/food/parking) expressible
  through the existing `CounterpartyMapping` mechanism finance already uses and edits today,
  rather than inventing a second rules table finance has to learn.
- Make neutralization auditable: a linked pair is still two rows, traceable back to the original
  lançamentos, not a silent delete or a merged row.

**Non-Goals:**

- No file parsing, no staging/review workflow — that is `add-treasury-statement-ingestion`.
- No dashboard UI — that is `add-treasury-dashboard`.
- No automatic neutralization — every pair is a suggestion until a human confirms it
  (finance's explicit "conferir antes de confirmar" requirement applies here too, even though
  the confirm *screen* ships in a later change; this change must not silently link pairs).
- No queue. Classification stays synchronous CRUD in this change; the next change is where
  queued processing is introduced for parsing, per `openspec/project.md`'s processing-model rule.

## Decisions

### D1 — `kind` as a new column, `nature` untouched in meaning

Add `kind: revenue | expense | movement | pending` as its own column rather than repurposing or
widening `nature`.

*Why:* `nature`'s four values are meaningful only for money that is genuinely an expense line the
DRE will one day consume (there is no live code path from `treasury-service` into
`accounting-service` yet — verified: `origin` on `accounting-service`'s `LedgerEntry` is set
manually today, nothing syncs from `treasury` automatically). Widening `nature` to include
`movement`/`pending` would make every existing DRE-facing consumer of that field (today: none in
code, but the field's whole reason to exist) have to filter it out again. A second, orthogonal
column keeps "which DRE line" and "does this count at all" as two separate questions, which is
how finance actually described them.

*Alternative considered:* fold `kind` into `nature` as a fifth-and-sixth value. Rejected — it
would make `nature` mean two different things depending on which values are present, and any
future accounting-service sync would need to special-case two of six values as "skip this row"
instead of filtering on a boolean-shaped column.

### D2 — `category` stays free text, seeded and suggested, not made into an enum

*Why:* `treasury-service`'s own docs already state why `category` is free text — "a operação
inventa categoria nova toda semana". Finance's confirmed list (Estoque, Frete, Contador, ...) is
real but not closed; a new fornecedor category has shown up in most months finance has reviewed so
far. A `GET /treasury/categories` endpoint returning the distinct categories in use (seeded ones
plus anything a mapping rule has introduced) gives the UI an autocomplete without a migration
every time finance adds one.

### D3 — Own-entity detection reuses `CounterpartyMapping`, no new table

The three razões sociais (Barbara Oliveira Fernandes Ltda, F&R Soluções Experience, Agiliz.Ai
Ltda) are seeded as ordinary `CounterpartyMapping` rows with `kind: movement`, `match_type: exact`.

*Why:* finance confirmed these rarely change and does not need a self-service screen for them —
but "rarely changes" still means "changes eventually", and when it does, it should be a data edit
through the screen finance already uses (`/treasury/mappings`), not a code change and a deploy. A
dedicated `OwnEntity` table would duplicate exactly the match/kind/category shape
`CounterpartyMapping` already has, for no behavior a mapping row can't already express.

*Alternative considered:* a small hardcoded list in `treasury-vocabulary.ts`. Rejected for the
same reason a supplier list isn't hardcoded — it silently drifts from what finance believes is
configured, since nothing in the UI would show it.

### D4 — Keyword rules use `match_type: contains` on the same table, not a second mechanism

The combustível/alimentação/estacionamento keyword rules (`POSTO`, `SHELL`, `RESTAURAN`, `KFC`,
`PARKING`, ...) are `CounterpartyMapping` rows with `match_type: contains`.

*Why:* every other classification decision in this design already routes through
`CounterpartyMapping` resolution; a parallel "keyword rule" table would mean the classifier has
to run two different resolution passes and finance has to look in two different screens to
understand why something was classified a certain way. `match_type` is the smallest change that
lets one mechanism serve both exact favorecido matching (today's behavior, unchanged, still the
default) and substring matching.

*Alternative considered:* a separate `KeywordRule` table, reasoned as "these are stable, technical
patterns finance won't edit weekly, unlike supplier rules." Rejected — the cost of one mechanism
serving both cases (one extra enum column) is lower than the cost of finance and any future
engineer needing to know two mechanisms exist and which one a given transaction went through.

### D5 — Neutralization is a self-referential link, not a third transaction or a delete

`BankTransaction.neutralized_with_id` (nullable, self-FK). Confirming a suggested pair sets both
rows' `neutralized_with_id` to point at each other. Totals exclude any row where
`neutralized_with_id IS NOT NULL`.

*Why:* finance's rule is explicit — "as duas se cancelam, não é despesa nem receita" — both
transactions are real bank events (a Pix recusado really did leave the account; the estorno really
did arrive) that must stay visible and auditable, individually reversible if the pairing turns out
wrong. Deleting either row would destroy evidence, which is the same reasoning
`treasury-service`'s own docs give for why `counterparty_raw` is preserved after resolution.

*Alternative considered:* a `kind: neutralized` value. Rejected — it collapses two different rows
(possibly different accounts, different original kinds before pairing) into one bucket and loses
which specific transaction each one was paired against, which finance needs when re-checking a
suspicious match.

### D6 — Candidate pairing is a read-only suggestion endpoint, confirmation is explicit

The system computes candidates (same value + same day + opposite direction; or a same-month
devolução matching a recent saída to the same resolved fornecedor) on demand and returns them;
linking happens through a separate, explicit confirm call naming both transaction IDs.

*Why:* mirrors the "conferir antes de confirmar" principle finance set for the whole reconciliation
process. A same-value-same-day coincidence is not proof — the design must not let two unrelated
transactions get silently excluded from a total because their amounts happened to match.

## Risks / Trade-offs

- **A `contains` rule can over-match** (e.g. a keyword rule for "GRILL" catching an unrelated
  fornecedor name that happens to contain it) → mitigated by `contains` rules being reviewable
  and editable in the same screen as `exact` rules, and by classification always being visible on
  the transaction it produced (never a black box); a wrong keyword match is a data fix, not a
  code fix.
- **Two `contains` rules could both match the same transaction** → resolution order needs a
  deterministic tie-break (longest `match_text` wins, since a more specific keyword should beat a
  more general one); specified in `tasks.md`, not left to insertion order.
- **Relaxing `nature` to be conditionally required** changes the existing `CreateTransactionDto`
  contract → mitigated by keeping `nature` required whenever `kind: expense` is sent (the common
  case today, since every existing row is effectively `kind: expense`), so today's write pattern
  keeps working unchanged; only the new `kind` values (`movement`/`pending`) newly permit omitting
  it.
- **Backfilling `kind` on existing rows**: every `BankTransaction` created before this change has
  no `kind`. Migration Plan below.

## Migration Plan

1. Add `kind` as nullable, add `neutralized_with_id`, add `CounterpartyMapping.kind` and
   `match_type` (default `'exact'`) in one migration — additive, no existing column dropped or
   narrowed.
2. Backfill: every existing `BankTransaction` row gets `kind: 'expense'` (every row created so far
   was, in fact, entered as a fornecedor expense — there is no existing `movement`/`revenue`/
   `pending` data to reconcile). Then make `kind` `NOT NULL`.
3. Seed the ~30 fornecedor rules, the 3 own-entity rules, and the keyword rules as
   `CounterpartyMapping` inserts, guarded by the existing unique constraint on `match_text` (an
   environment where finance has already hand-entered one of these gets a conflict, not a
   duplicate — the seed script reports and skips rather than failing the whole batch).
4. Deploy order: this change only touches `treasury-service` and the gateway's pass-through routes
   — no dependency on `ingestion-worker-service` or the admin UI. Safe to deploy standalone.

No rollback concern beyond a standard migration revert — nothing downstream reads `kind` yet
(the next two changes are what start depending on it).

## Open Questions

- Exact wording and full contents of the seeded category list beyond what finance already
  confirmed (Anexo A) — deferrable, adding a category later is a data edit through
  `/treasury/mappings`, not a schema change.
