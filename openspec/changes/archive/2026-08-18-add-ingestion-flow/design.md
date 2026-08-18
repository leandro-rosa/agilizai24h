## Context

See `proposal.md` — Why. This change connects the pieces the previous ones built, and it is
the first place where `@app/sheeter`, `@app/aws` and `@app/hold-it` are all used together —
which is what they were vendored for.

What already exists and constrains the design: `sheeter`'s `smartChunk` reads a workbook,
maps rows against a header row, batches 1200 rows at a time, and enqueues them through
`HoldItBullMQBroker`; `sales-service` and `supply-service` both replace a store's period
wholesale in one transaction; `supply-service` accepts only already-split per-reason
quantities and rejects unrecognised reasons; `products-service` resolves names by
normalisation then curated overrides, and reports what it cannot resolve.

## Goals / Non-Goals

**Goals:**

- An upload that returns immediately and a parse that can fail loudly without losing the file.
- One parser per file type, each with its own contract.
- An operator-visible answer to "what did my upload actually do".

**Non-Goals:**

- No automated pull from the POS platform. A person uploads a file; that is the workflow
  being replaced, and automating the fetch is a separate problem.
- No reconciliation. This change produces normalised records; `finance-service` values them.
- No editing of parsed rows in the UI. A wrong file is corrected and re-uploaded, which the
  idempotency contract already supports.
- No streaming progress. Status is polled, not pushed.

## Decisions

### D1 — One queue per file type, not a generic parse queue

Three `queueCallbackName`s, three `HoldItWorkerHost` consumers.

*Why:* the three files share no schema — a sales row, a restock/removal row and a cost row
have different columns, different targets and different failure modes. A single generic
queue would carry a discriminated union that every consumer must re-check, and a malformed
sales file would sit in the same retry queue as a cost sheet. Separate queues give each
parser its own contract, its own retry behaviour, and its own dead-letter visibility.

### D2 — The raw file goes to object storage before anything is queued

*Why:* the file is the evidence. If parsing fails, or a figure is later disputed, the
original workbook must still be retrievable exactly as uploaded. Storing it first also
means the queue message carries a reference rather than a payload, keeping jobs small.

Postgres holds the parsed rows; it never holds the file. This is the split
`openspec/project.md` mandates.

### D3 — Reason parsing lives here, not in `supply-service`

`supply-service`'s contract is quantities-per-reason in, never a string to interpret.

*Why:* text interpretation is a property of the file format, which is the POS platform's and
may change; the loss classification is a property of the business, which is stable. Keeping
them in separate services means a new export format changes one parser, not the service that
owns the loss rule. It also keeps the classification rule testable without a spreadsheet.

*Consequence:* the mixed-reason rule is specified in **both** changes, deliberately — here as
"produce two quantities from one field", there as "9 units in yields 3 units of loss". They
are different failures and both need their own tests.

### D4 — A row that cannot be parsed is rejected and reported, never skipped

*Why:* this is the same principle as `products-service`'s partitioned cost result. A skipped
row produces a total that is quietly too low, with nothing to indicate it. A rejected row
produces a visible count and a reason. The spec's requirement that full success be
distinguishable from partial success is what stops "it imported" from meaning "some of it
imported".

### D5 — Idempotency is enforced by the sinks, not by the parser

The parser re-parses freely; `sales-service` and `supply-service` replace the period.

*Why:* they already own the transaction that makes replacement atomic, and BullMQ delivers
at-least-once, so a retried job must be harmless regardless. Putting a dedupe check in the
parser would be a second, weaker mechanism guarding the same invariant — and the weaker one
would be the one that fails.

*Consequence:* a partially-failed parse must not leave a partially-replaced period. The
sinks receive a period's rows as one batch to replace, rather than streaming rows that each
trigger a replacement.

### D6 — Store and period come from the request, not only from the file

The uploader states which store and period a file is for; the parser cross-checks against the
external code in the file where one is present.

*Why:* the restocking workbook has one sheet per site visit and no reliable machine-readable
period; guessing it from a filename or a cell is exactly the kind of inference that silently
attributes March's data to April. Making the operator state it turns an invisible failure
into an obvious one, and the cross-check catches a mismatched pairing.

### D7 — Cost rows from the price sheet are written as dated versions

The price sheet's parsed rows become cost versions in `products-service`, effective from the
period stated at upload.

*Why:* it is the only way the "value a month with that month's cost" rule can hold. A price
sheet uploaded without an effective date would either overwrite history or need a guess.

## Risks / Trade-offs

- **`sheeter`'s `smartChunk` batches into the queue, so one file becomes many jobs** → a
  file's rows can be in flight while an earlier batch already wrote. Mitigation: accumulate a
  period's parsed rows and hand the sinks one replacement batch (D5), rather than letting
  each chunk replace the period and clobber the previous chunk. This is the subtlest failure
  mode in the change and needs an explicit test with a file larger than one batch.
- **At-least-once delivery means a job can run twice** → duplicate writes. Mitigated by the
  sinks' replacement semantics, which are idempotent by construction.
- **A malformed file could enqueue thousands of failing jobs** → retry storms. Mitigation:
  validate the header row and the declared type before chunking, so structural failures are
  caught once rather than per row; bound retries and route exhausted jobs to the failed-job
  visibility `@app/hold-it` already exposes.
- **Reason text may vary in ways the parser does not anticipate** (casing, punctuation,
  abbreviations) → rejected rows for what is really the same reason. Mitigation: normalise
  reason text the same way product names are normalised, and treat the rejection report as
  the queue of new variants to add. Accept the rejections rather than guessing — D4 and
  `supply-service`'s D2 both depend on it.
- **`sheeter` guards against Excel lock files (`~$file.xlsx`)** → uploads coming from a
  shared drive may include them. Cheap to reject at the edge by filename.

## Migration Plan

New capability; no existing data. Deploy order: object storage and Redis (already running as
`infra`), then the domain sinks, then the worker, then the gateway routes — so no upload can
be accepted before something can process it.

Backfill of historical months is the same operation as a normal upload: the operators
re-upload past files, and the idempotency contract makes repeating that safe.

## Open Questions

- Retention policy for raw uploaded files in object storage. Deferrable: it does not change
  the approach or the task breakdown, and the operators will have an opinion once they see
  how often files are re-uploaded.
- Whether an ingestion should be cancellable mid-flight. Deferrable: files are small enough
  that a run completes quickly, and a wrong import is corrected by re-uploading.
