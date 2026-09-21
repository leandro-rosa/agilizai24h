## Context

`add-commercial-intelligence-page` built the measurement layer of "Inteligência Comercial" and left three things pending on purpose (its D16, D22, D23): the five **business rules** are build-time defaults shown read-only, because a value kept in a browser would give two viewers different advice; every recommendation type already carries a `logicVersion` and a parameter snapshot but nothing persists them; and the calibration report has a reserved, empty block. The typed parameter table tags each parameter `business`, `quality` or `analytic`; `APPROVED_PARAMETERS` is empty, so every value prints "provisório". See `proposal.md` for the motivation.

Constraints from the platform (`openspec/project.md`): a NestJS microservice with its own Postgres and Prisma via `PrismaRepository`; the gateway is the only entry and the trust boundary; permissions are named `<domain>:<verb>`, live in `@app/iam-contracts` and are seeded into IAM by migration; the gateway already injects the session's identity into a write body and overrides what the browser sent (`confirmed_by` in `drive-files.controller.ts`); artifacts in English, UI in Portuguese. The engine stays client-side and pure. The volume is tiny: five rules, tens of decisions a month, a handful of reports.

## Goals / Non-Goals

**Goals:**

- One durable source of truth for the five business rules, with one value per operation, a reason and an author for every change, and no way to overwrite a colleague's change unseen.
- Provenance for every recommendation the company acts on: which logic, which parameters, which rules, what evidence and what estimate, frozen at the moment of the decision.
- An audit trail that is append-only by guarantee, not by convention.
- Calibration as a human decision that is recorded, pinned to the exact parameter values approved, and that never moves a rule.

**Non-Goals (design level):**

- No queue, event or `hold-it`: the writes are tiny and synchronous, so the service does not register `HoldItModule` and needs no `WITH_KAFKA_BROKERS`.
- No push of a rule change to open pages; a page picks it up when it next mounts or regains focus.
- No caching layer, soft delete or edit-in-place of any history.
- No server-side recomputation of recommendations (D11).

## Decisions

### D1. A new `intelligence-service`, not an extension of an existing one

The register is its own bounded context with its own single writer, following the back-office pattern (own Postgres, host port 5446, `health`, Swagger, `CLAUDE.md`, registered in `agiliz-cli`).

Rejected: **`sales-service`**: it owns sales data, and governance data is about decisions, not sales. **`gateway-service`**: a thin BFF with no database of its own by design. **`accounting-service` or `capex-service`**: unrelated domains that would inherit a foreign schema and release rhythm. **`iam-service`**: it is not a configuration store, and coupling business rules to identity would make every rule change a deploy of the login service. The cost is a fifteenth service to run; it is the price the project's database-per-service rule already sets.

### D2. The rule key is the engine's parameter path; the service owns the definitions

A rule is addressed by the same path the typed table uses. The service holds the definitions (label, unit, bounds, default) and publishes them with each value, so the admin validates against what the API returns and not against a copy.

| Key | Unit | Bounds | Default |
|---|---|---|---|
| `simulator.minMarginPct` | share | 0 to 0.95 | 0.30 |
| `association.promoDiscountMax` | share | 0.01 to 0.9 | 0.15 |
| `impact.floorMonthlyCents` (below it an item is not listed) | cents | 0 to 100,000,000 | 1,000 |
| `impact.minMonthlyCents` (required for priority) | cents | 0 to 100,000,000 | 3,000 |
| `impact.mainScreenItems` | count (integer) | 1 to 20 | 5 |

A cross-rule invariant is enforced on write: `impact.floorMonthlyCents` ≤ `impact.minMonthlyCents`, the same ordering the engine's parameter loader already enforces. Values are stored as `Decimal`, so 0.35 never becomes 0.35000000000000003, and travel as JSON numbers.

The defaults exist in two places, the service and the engine's table. The engine keeps its defaults for tests and calibration scripts; on the page the register is the only source of the five (D12). A verification task compares the two definitions so they cannot drift silently.

**Seeding** happens at service start, from the definitions, idempotently and in one transaction per rule (insert the rule and one history entry attributed to `system`, only if missing). Not by migration: the defaults would then live in SQL as a third copy, and a rule added by a later change would need a data migration to appear.

### D3. Append-only by database guarantee

Tables: `business_rule` (current value and version counter), `business_rule_change` (history), `model_parameter_set`, `recommendation_record`, `decision`, `outcome`, `calibration_report`. Every table except `business_rule` and `calibration_report` is insert-only. A migration installs triggers that reject `UPDATE` and `DELETE` on the insert-only tables; `calibration_report` accepts one `UPDATE`, from `draft` to `approved` or `rejected` and touching only the review columns; `business_rule` is updated only by the change transaction of D4.

Rejected: **convention only** (a repository that exposes no update method) — an audit trail that a future query can silently break is not one; the trigger costs a few lines of SQL and a test that tries the forbidden statements. **Event sourcing** — the volume does not justify a projection layer. Prisma does not model triggers, so they live in the migration's SQL and are noted in the service's `CLAUDE.md`.

### D4. A rule changes under optimistic concurrency, in one transaction

`PUT` carries `value`, `reason` and `expected_version`. In one transaction the service validates the value and the invariant, then runs `UPDATE business_rule SET … version = version + 1 WHERE key = $1 AND version = $2` and inserts the history entry; zero rows updated is a conflict (409 with the current value, version and author). Validation failures are 422; an unknown key is 404; the same value as the current one is 422 "no change".

Rejected: **last write wins** — two managers editing from the same screen would overwrite each other unseen, which is the failure this whole change exists to prevent. **Pessimistic lock** — a lock held across a human's edit is a worse failure than a conflict message.

### D5. The actor is the session's user, set by the gateway in the body

The gateway controller spreads the browser's body and then sets `actor_id` and `actor_name` from `@Caller()`, overriding anything sent, exactly as `drive-files` does for `confirmed_by`. The service stores the id and a name snapshot (the sheet must say who changed a rule without a call to IAM, and the reader may not hold `users:read`), and refuses a write without them. The service is reachable only from the gateway's network, the same trust model as every domain service.

Rejected: an `X-Actor-*` header — `UpstreamCall` carries no headers, and adding them to the shared client for one upstream is more surface than the precedent needs.

### D6. A model parameter set is identified by its content

The set is the data-quality and analytic parameters plus the logic version, canonicalized (keys sorted at every level, `JSON.stringify` of finite numbers) and hashed with SHA-256. Business-rule values are not part of it: they change through the register and are snapshotted separately (D7). Client and server are both TypeScript and canonicalize identically; a shared test vector (a fixed input and its expected hash) runs on both sides so they cannot diverge. The server computes the hash from the content it receives and never trusts a hash from the client.

The set is never edited and has no status column. **Approved is derived**: a set is approved when an approved calibration report references it (D10). The approval is therefore pinned to exact values: any new build that changes one parameter produces a new hash, provisional again until a new report is approved. That is what keeps "parameter changes must not silently alter what was approved".

### D7. A recommendation record is created by the first decision, and identified by what produced it

`POST /intelligence/decisions` takes the snapshot and the decision and, in one transaction, registers the parameter set if missing, creates the record or reuses the one with the same key, and appends the decision. The record key is the SHA-256 of the canonical `{cause, scope, period, logic_version, parameter_set_hash, business_rules}`, computed by the server. `cause` is the stable cause key the page already uses to consolidate detectors. Including the logic version, the parameter set and the rule values means the same cause produced by different logic is a different record, so an old snapshot is never made to describe a newer computation.

Only decided recommendations are persisted, not every one shown. Persisting everything would fill the register with records nobody acted on and blur what a record means: what the company chose. The cost is that acceptance rates have no denominator; see Open Questions.

### D8. Outcomes are entered by a person; the comparison never tunes anything

An outcome attaches to an accepted or experiment decision: window, realized impact per month, `method` (a closed vocabulary that starts with `manual`), author and note. A correction is a newer outcome pointing at the one it supersedes. The comparison read model returns, per record, the three estimates beside the realized value and, per origin, the count of outcomes and the ratio of realized to expected impact. It states its base and proposes nothing: raising or lowering a premise remains a reviewed change of the parameters (D10). Automatic measurement is `add-commercial-experiments`, which will add a `measured` method.

### D9. Calibration report lifecycle

`draft` → `approved` or `rejected`, once, by a reviewer with a note (D3 enforces the single transition). The payload is validated against a schema with the fields the spec lists (months covered, distributions, and the five counts) and a size limit. Saving registers the parameter set it evaluated. Approving is a statement about that set only; the register has no operation that links a report to a business rule.

### D10. Three permissions, separation of duties

`intelligence:read` (also given to the read-only operator role), `intelligence:write` (decisions, outcomes, saving reports) and `intelligence:rules` (change a rule, review a calibration). Recording what the company did about a recommendation is a different power from redefining the rules the recommendations obey, and from approving the values the model runs on. Today only the administrator role holds the last two; splitting them lets the company grant one without the other later. They are seeded by an IAM migration from `@app/iam-contracts`, as the earlier permissions were.

Rejected: **one `intelligence:write`** — anyone allowed to accept a recommendation could also change the margin that made it. **Checking role names** — the platform decides on named permissions, never on roles.

### D11. Snapshots are client-reported, and say so

The engine runs in the browser, so the service can validate the shape, the required fields and the identity, but cannot re-derive the numbers. Every record stores who submitted it and `source = client`. This is stated in the read model and in the UI. Because the engine is pure and TypeScript it could run in Node later; a server-side engine would set `source = server` without changing the record's shape, and is a follow-up, not part of this change.

### D12. How the admin uses the register

A new RTK Query slice (`lib/api/intelligence.ts`) reads the rules on mount and on window focus and invalidates after a change. The page builds the parameters it passes to the engine as the model parameters (deployment build, as today) plus the five rules from the register. The `NEXT_PUBLIC_CI_*` variables for the five business rules stop being read on the page and are dropped from `env.ts`; the engine's own defaults remain for tests.

The page has a `rulesState`: `ready`, `loading`, `unavailable` or `forbidden`. Only `ready` lets recommendations, rankings, the impact estimate and decision actions render. In every other state the descriptive numbers and the "Qualidade dos dados" tab stay, and the opportunity areas say why they are withheld and offer a retry. There is deliberately no fallback to the deployment default, because it could differ from what the register holds and would recreate the two-viewers problem in an outage. The sheet's edit form is shown only with `intelligence:rules`, validates against the bounds the API returned, requires a reason, sends `expected_version` and, on a conflict, shows the current value and its author.

### D13. Routes

Explicit gateway routes, one permission each, as for every other domain:

| Route | Permission | Notes |
|---|---|---|
| `GET /intelligence/rules` | `intelligence:read` | five rules with unit, bounds, version, last change |
| `PUT /intelligence/rules/:key` | `intelligence:rules` | `{ value, reason, expected_version }`; 200, 409 with the current value, 422 |
| `GET /intelligence/rules/:key/history` | `intelligence:read` | newest first |
| `GET /intelligence/parameter-sets/:hash` | `intelligence:read` | derived status and approving report; 404 if never registered |
| `POST /intelligence/decisions` | `intelligence:write` | snapshot plus decision; creates or reuses the record |
| `GET /intelligence/recommendations`, `/:id` | `intelligence:read` | snapshot, decision trail, outcomes |
| `POST /intelligence/decisions/:id/outcomes` | `intelligence:write` | |
| `GET /intelligence/comparison` | `intelligence:read` | estimate versus outcome by origin, with counts |
| `POST /intelligence/calibration-reports` | `intelligence:write` | |
| `GET /intelligence/calibration-reports`, `/:id` | `intelligence:read` | |
| `POST /intelligence/calibration-reports/:id/review` | `intelligence:rules` | approve or reject with a note |

### D14. What is delivered now and what waits

The service, its tests, the IAM migration, the gateway routes, the admin slice, the editable rules sheet with history, the withheld-when-unavailable behavior, the register-driven provisional or approved state and the review of saved reports do not depend on the analytic groups and are built now. The decision, outcome and report-saving actions need recommendations and a calibration report that the analytic groups (6 to 11, 5) of `add-commercial-intelligence-page` will produce; their components are built and verified against a mock gateway now and wired to real opportunities when those groups land. This change is not complete until they are.

### D15. Verification without synthetic data in real databases

Service tests run against a disposable Postgres container, never a database an operator uses. Verification of the admin runs against a mock gateway whose entities are all marked "[SINTÉTICO]", as for the page. The tests cover the forbidden statements against the triggers, the concurrency conflict, the invariant, the canonical hash vector, the idempotent seed, and the gateway's actor override.

## Risks / Trade-offs

- **A forged snapshot from an authorized user** (D11) → the record names its submitter and its `client` source, writing needs `intelligence:write`, and the follow-up server-side engine would remove the gap.
- **The register is a new dependency of the page** → only recommendations depend on it; descriptive numbers and quality indicators do not, and the RTK client already retries a 503. The failure is explicit, never a silent default (D12).
- **Bounds and defaults exist in the service and in the engine table** → the verification task in tasks group 7 compares them; the page always validates against the API's bounds.
- **Canonicalization differing between client and server** → one shared test vector on both sides; the server hashes what it receives.
- **Triggers are invisible to Prisma** (D3) → documented in the service `CLAUDE.md`, and a test tries `UPDATE` and `DELETE` on each insert-only table.
- **A custom role without `intelligence:read`** would leave the page without recommendations → the operator role receives it in the migration, and the page says the permission is missing; check for custom roles before deploying.
- **An open page shows an old rule until it regains focus** → every record snapshots the values it actually used, so nothing is inconsistent, only briefly stale on screen.
- **The decision, outcome and report-saving flows cannot be exercised end to end until the analytic groups exist** → built against a mock now; the change stays open until they are wired (D14).
- **A fifteenth service** → follows the existing back-office template, so its operational cost is the known one.

## Migration Plan

1. `iam-contracts` gains the three permissions and the operator set; the IAM migration seeds them (idempotent) and assigns them to the administrator and operator roles.
2. `intelligence-service` is created with its schema, migration (tables and triggers), seed-on-start and health; registered in `agiliz-cli`, `.env.example` and the backend index.
3. The gateway gains `INTELLIGENCE_SERVICE_URL`, the upstream method and the controller.
4. The admin ships the slice and the screens. A new admin against a gateway that does not yet know the routes reads the register as unavailable and withholds recommendations, so the order above is safe and any single step can be deployed alone.

Rollback: revert the admin to return to the read-only deployment defaults (rules changed in the register meanwhile would not apply until the admin is redeployed, which is stated in the runbook). The service and its data are left in place; no migration is reverted, because dropping the history would erase the very audit trail this change adds.

## Open Questions

- Whether to also record recommendations that were shown and not decided, so acceptance rates have a denominator. It would add records without changing any existing requirement.
- Whether the rules sheet should preview what a change would do (for example, how many opportunities would enter or leave the main screen) before saving.
- Whether the history should be exportable for audit (CSV), and how long it is kept.
