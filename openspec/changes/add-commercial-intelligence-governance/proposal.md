## Why

The "Inteligência Comercial" page (`add-commercial-intelligence-page`) settled that no rule that shapes a recommendation may live in a browser: two viewers would receive different advice. Today its five business rules (minimum combo margin, largest discount worth testing, the two impact floors, how many opportunities the main screen shows) are deployment defaults, read-only, with the page saying the official register does not exist. Nothing yet records which rules and which version of the logic produced a recommendation, what the company decided about it, or whether the estimated impact came true, so a rule cannot change without a redeploy, nothing can be audited, and the impact premise and the confidence cannot be calibrated against reality.

## What Changes

- A new backend service, `intelligence-service` (NestJS, its own Postgres), that owns the governance data:
  - a **register of business rules**: one value per rule for the whole operation, validated against the bounds documented with the rule, changed with the value the caller last saw (optimistic concurrency) and a mandatory reason, every change kept in an append-only history;
  - **model parameter sets** (the data-quality and analytic parameters, with the logic version) registered by content hash and marked provisional or approved;
  - **recommendation records**: a snapshot (logic version, model parameter set, business-rule values, evidence summary, the three impact scenarios, confidence, scope, period) written when someone decides on a recommendation, never rewritten afterwards;
  - an append-only **decision log** (accepted, rejected, turned into an experiment) and **outcome records** (what was measured, over which window, by whom, next to what was estimated), with a read model that compares estimate and outcome;
  - **calibration reports**: persisted, reviewed and approved or rejected, and the only thing that moves a parameter set from provisional to approved.
- Three permissions in IAM and the gateway: `intelligence:read`, `intelligence:write` (register decisions, outcomes and calibration reports) and `intelligence:rules` (change business rules, review calibrations), plus `/intelligence/*` routes that stamp the actor from the session.
- The admin reads the effective business rules from the register instead of the deployment default. The "Regras de negócio" sheet becomes editable, with reason and history, for holders of `intelligence:rules`, and stays read-only for everyone else. If the register cannot be read, descriptive numbers stay and recommendations are withheld, so two viewers can never be shown different advice.
- The admin gains the decision, outcome and calibration-report screens that the analytic groups of `add-commercial-intelligence-page` will feed; those groups are still on hold, so this change builds the register, its routes and the rules screen now and wires the decision actions when the recommendations exist.

Non-goals: computing recommendations on the server (the engine stays client-side, so a snapshot is what an authenticated user's browser reported, not something the server re-derived); changing any threshold automatically from outcomes (calibration is a human decision recorded here); measuring experiments automatically (`add-commercial-experiments`); editing data-quality or analytic parameters from the UI (they change through a reviewed deployment and are approved here); per-store or per-user rule overrides; notifications.

## Capabilities

### New Capabilities

- `intelligence-governance`: the backend register: business rules with single value and change history, model parameter sets and logic versions, recommendation records with their snapshot, the decision log, outcome records with the estimate-versus-outcome comparison, and calibration reports with their approval.
- `intelligence-governance-ui`: how the admin reads the effective rules, edits them with permission, shows history and the provisional or approved state, registers decisions, outcomes and calibration reports, and behaves when the register is unavailable.

### Modified Capabilities

- `iam`: the permission model gains `intelligence:read`, `intelligence:write` and `intelligence:rules`, seeded by migration; the read-only operator role receives only the first.
- `api-gateway`: routes under `/intelligence` that require those permissions and forward to `intelligence-service`, injecting the acting user from the session and ignoring any actor the browser sends.

## Impact

- **New**: `backend/apps/intelligence-service` (Prisma schema and migration, REST API, health, Swagger, `CLAUDE.md`, Dockerfile and compose with Postgres on host port 5446), registered in `agiliz-cli`, `.env.example` and the backend index.
- **Changed**: `backend/common/nest-libs/iam-contracts` (permission names, operator set), `iam-service` (migration seeding the permissions), `gateway-service` (controller, upstream client, `CLAUDE.md`), `frontend/apps/admin` (`lib/api/intelligence.ts`, store reducer count, the rules sheet, the decision, outcome and calibration screens, `CLAUDE.md`, `DESIGN.md`).
- **Depends on** `add-commercial-intelligence-page` (the page, the typed parameter table with kinds, the logic version and the recommendation type that already carries a snapshot). The decision actions wait for its analytic groups 6 to 11, which wait for the real months imported through `add-drive-ingestion-source`.
- **Data**: the register starts with the five business rules at the deployment defaults, recorded as changes by `system`; no existing data is migrated.
