## 1. Permissions and the new service's skeleton

- [ ] 1.1 `@app/iam-contracts`: add `INTELLIGENCE_READ` (`intelligence:read`), `INTELLIGENCE_WRITE` (`intelligence:write`) and `INTELLIGENCE_RULES` (`intelligence:rules`) to `PERMISSIONS`, add the first to `OPERATOR_PERMISSIONS`, and update the lib's `CLAUDE.md`
- [ ] 1.2 IAM migration that creates the three permissions and assigns them to the administrator role, and `intelligence:read` to the operator role, idempotently. Verify on a disposable Postgres: applied to a database created before this change, applied twice with nothing duplicated, an administrator's introspection lists all three and an operator's lists only `intelligence:read`
- [ ] 1.3 List the roles that exist in the environments in use and report any custom role that holds `sales:read` but would lack `intelligence:read`; change nothing without the operator's decision
- [ ] 1.4 Scaffold `backend/apps/intelligence-service` from the back-office template: NestJS app, Prisma config, Dockerfile whose `CMD` runs `prisma:deploy` first, compose with its own Postgres on host port `INTELLIGENCE_POSTGRES_HOST_PORT` (default 5446), `@app/health`, Swagger, environment validation, no `HoldItModule`. Register it in `agiliz-cli`, `.env.example` and the service index of `backend/CLAUDE.md` (14 to 15 services), and add a first `CLAUDE.md`

## 2. Schema, immutability and the rule definitions

- [ ] 2.1 Prisma schema and migration for `business_rule`, `business_rule_change`, `model_parameter_set`, `recommendation_record`, `decision`, `outcome` and `calibration_report`: `Decimal` for rule values, JSON for snapshots and payloads, foreign keys where a table points to another, a unique key on the record identity
- [ ] 2.2 Migration SQL with the triggers of D3: reject `UPDATE` and `DELETE` on the insert-only tables; allow on `calibration_report` only the single move from `draft` to `approved` or `rejected` changing the review columns. Verify on a disposable Postgres that each forbidden statement fails and that the allowed transition works once
- [ ] 2.3 The rule definitions (key, label, unit, lower and upper bound, default, integer flag) for the five rules of D2, and the idempotent seed at service start (rule plus one history entry by `system` with the reason "initial default", in one transaction per rule). Verify: starting twice leaves five rules and five history entries

## 3. Business rules

- [ ] 3.1 Read the rules: `GET /rules` returning, for each, its value, unit, bounds, version counter and the user and time of the last change
- [ ] 3.2 Change a rule: `PUT /rules/:key` with `value`, `reason` and `expected_version`, validating type, bounds and integer-ness, the order between the two impact rules, a non-blank reason and that the value differs; one transaction with a conditional update on the version and the history insert; 409 with the current value and author, 422 with the reason, 404 for an unknown key. Verify each scenario of the spec: applied, out of bounds, blank reason, stale version, same value, unknown rule, impact order
- [ ] 3.3 History: `GET /rules/:key/history` newest first with previous value, new value, user, time and reason; verify that no route edits or deletes an entry
- [ ] 3.4 Actor: every write requires `actor_id` and `actor_name` and refuses one without them; a body that names another author is ignored. Verify both scenarios

## 4. Parameter sets, recommendation records and decisions

- [ ] 4.1 Canonical JSON and SHA-256 helper (keys sorted at every level), with a shared test-vector file (a fixed input and its expected hash) that the admin will check too
- [ ] 4.2 `GET /parameter-sets/:hash`: status derived from an approved calibration report that references the set, and that report; 404 when never registered. Registration is implicit in 4.3 and 5.1
- [ ] 4.3 `POST /decisions`: validate the snapshot (logic version, parameter-set content, business-rule values, evidence summary, three impact scenarios or an explicit not-estimable statement, confidence with factors, effort, risk, scope, period, cause, origin); compute the record key on the server; in one transaction register the set if missing, create or reuse the record, append the decision; a rejection needs a note, an experiment a window with end not before start. Verify: first decision creates, second reuses, a later rule change leaves the record untouched, different logic gives a new record, not-estimable is accepted, an incomplete snapshot stores nothing
- [ ] 4.4 `GET /recommendations` and `/:id` with the snapshot, the submitter, `source = client`, the decision trail (latest is current) and the outcomes
- [ ] 4.5 Outcomes: `POST /decisions/:id/outcomes` for an accepted or experiment decision (window, realized impact per month, method `manual`, note), a correction as a newer outcome that supersedes; `GET /comparison` with the three estimates beside the realized value per record and, per origin, the count and the ratio, proposing no value. Verify: outcome next to estimate, correction keeps the first visible, the aggregate states its base

## 5. Calibration reports

- [ ] 5.1 `POST /calibration-reports`: validate the payload (months, logic version, parameter-set content, distributions, and the counts of excluded stores, products without data, pairs passing, opportunities generated and recommendations blocked) with a size limit; store as a draft with author and time; register the set; `GET /calibration-reports` and `/:id`
- [ ] 5.2 `POST /calibration-reports/:id/review`: approve or reject with a mandatory note, once; a reviewed report cannot be changed or reviewed again; approval makes the set approved by derivation and touches no business rule. Verify: approve, reject, missing note, reviewed report closed, no operation approves a set without an approved report

## 6. Gateway

- [ ] 6.1 `INTELLIGENCE_SERVICE_URL` in the gateway's environment validation, compose and `.env.example`, and a `DomainClient.intelligence` method
- [ ] 6.2 `IntelligenceController` with the explicit routes of D13, each with its permission; on every write set `actor_id` and `actor_name` from the session, overriding the body; relay 409 and 422 unchanged. Verify: 403 for a read without `intelligence:read`, for a decision with only read, for a rule change with `intelligence:write` but not `intelligence:rules`; the actor override; an unreachable service reported as an upstream failure with the session kept
- [ ] 6.3 Update the route table and the failure semantics in `gateway-service/CLAUDE.md`

## 7. Admin: the rules and the state of the logic

- [ ] 7.1 `lib/api/intelligence.ts` (RTK Query, refetch on mount and on window focus, tags invalidated after a change) and its reducer in the store (14 to 15), with the response and request types
- [ ] 7.2 The page's `rulesState` (`ready`, `loading`, `unavailable`, `forbidden`) and the parameters passed to the engine (model parameters from the build plus the five rules from the register); recommendations, rankings, the impact estimate and decision actions render only when `ready`, otherwise the opportunity areas say why and offer a retry while the KPIs and the "Qualidade dos dados" tab remain; drop the five business-rule variables from `env.ts` and from the runtime parameters, and adjust the verification script's env check to the remaining parameters
- [ ] 7.3 The "Regras de negócio" sheet: value, unit, bounds and last change (who, when, why) from the register; for a user with `intelligence:rules`, an edit form validated against the API's bounds with a mandatory reason that sends the version seen, and a conflict panel showing the current value and its author; read-only for everyone else; remove the notice that the register is pending
- [ ] 7.4 History of a rule, opened from the sheet, for any user with `intelligence:read`
- [ ] 7.5 Advanced page: compute the parameter set's hash in the browser (canonical JSON and SHA-256, checked against the shared test vector), read its status from the register, mark every parameter "provisório" unless the set is approved, show the approving report, reviewer and time, and say the state could not be confirmed when the register is unreadable
- [ ] 7.6 A drift check that compares the service's five rule definitions (unit, bounds, default) with the engine's parameter table and fails on a difference
- [ ] 7.7 Verify in a browser against a mock gateway whose entities are all marked "[SINTÉTICO]", in light and dark: two viewers see the same rule; a change applies at once for its author and on the next load for the other; a conflict is explained and not overwritten; a user without the permission has no control; the register down withholds recommendations without a default; the browser storage holds no business-rule value

## 8. Admin: decisions, outcomes and calibration reports (built against a mock now)

- [ ] 8.1 Decision panel in the opportunity detail: accept, reject (note required) or turn into an experiment (window), sending the snapshot the page computed, with the trail of decisions; no action for a user without `intelligence:write`
- [ ] 8.2 Outcome form and the estimate-versus-outcome view: the three estimates beside the realized impact, the number of outcomes each aggregate rests on, and the statement that outcomes never change a threshold or a premise by themselves
- [ ] 8.3 Calibration reports on the advanced page: list and detail with status, months, author, reviewer and note; save a generated report; approve or reject with a note only for `intelligence:rules`, presented as a decision about the parameter set and never about a business rule
- [ ] 8.4 Wire the decision, outcome and report actions to real opportunities and to the report generator once the analytic groups 6 to 11 and the calibration group 5 of `add-commercial-intelligence-page` exist (blocked until then)
- [ ] 8.5 Verify end to end on the real imported months once 8.4 is possible; until then this change is not complete

## 9. Documentation and verification

- [ ] 9.1 `backend/apps/intelligence-service/CLAUDE.md`: purpose, routes, the triggers and why, the seed, that snapshots are client-reported, known gaps
- [ ] 9.2 Update `frontend/apps/admin/CLAUDE.md` (business rules now come from the register, the pending note removed, the new slice) and `DESIGN.md` (the editable-rule pattern with reason, the conflict panel, the withheld state), and the root `CLAUDE.md` map (14 to 15 services)
- [ ] 9.3 In `add-commercial-intelligence-page`, revise its notes that say the official register is pending (task 3.9, the sheet's copy) once this change is applied
- [ ] 9.4 `pnpm turbo run lint typecheck build` for the touched packages and `openspec validate add-commercial-intelligence-governance --strict`
