## Context

See `proposal.md` — Why. This is the first service under `backend/apps/`, so it lands on
foundations that exist but have never been exercised by a real app:

- `@app/*` resolves at compile time via `backend/tsconfig.json` and at runtime via
  `register-paths.js`. No app has yet proven the runtime half.
- `@app/prisma-db-client` provides only `PrismaRepository<T, Model>` and criteria types.
  Contrary to some earlier notes, it has **no** `PrismaDbClientModule.forRoot` and no
  `PrismaPg` adapter — the service wires its own `PrismaClient`.
- `@app/health` supplies the terminus-based health module; `@app/hold-it` supplies BullMQ.
- Shared Redis and MinIO already run as the `infra` project on `agiliz_network`; there is
  deliberately no Postgres container yet, because databases are per-service.
- `.env.example` documents `WITH_KAFKA_BROKERS=false`, required by any service that
  registers `HoldItModule`.

## Goals / Non-Goals

**Goals:**

- A revocable, server-side session model the gateway can introspect on every request.
- A per-service Postgres database and migration history, establishing the pattern.
- A service skeleton the next eight services can be cloned from with confidence.

**Non-Goals:**

- No gateway, no UI, no HTTP session cookie handling — this service speaks to the gateway,
  and the gateway owns the browser relationship.
- No password reset, email verification, SSO, or MFA.
- No multi-tenancy: every operator belongs to Agiliz.AI, and stores are data, not tenants.
- No per-store row-level authorization yet. The permission model must not *preclude* it,
  but scoping finance reads to a subset of stores is deferred until a real second role
  exists.

## Decisions

### D1 — Opaque server-side sessions, not JWTs

A login returns a random high-entropy token; the service stores the session and resolves
it on introspection.

*Why:* the brief fixes this as session-based, and the requirement that logout and
deactivation revoke *immediately* is the deciding constraint. A stateless JWT stays valid
until it expires, so immediate revocation needs a denylist — which reintroduces the very
lookup JWTs were meant to avoid, with worse failure modes.

*Cost:* every gateway request costs one introspection call. Acceptable: the gateway is
the only client, the call is in-datacentre, and the panel's traffic is a handful of
operators, not public scale.

### D2 — Sessions live in Postgres, not Redis

*Why:* correctness before speed. Postgres gives the session the same transactional
lifetime as the account it belongs to, so "deactivating an account revokes its sessions"
is a query, not a fan-out. Session volume here is trivially small. Redis is already
available if introspection ever shows up in a profile, and moving them later changes no
externally visible behaviour in the spec.

*Alternative considered — Redis with TTL:* natural expiry and faster reads, but sessions
would be in a store that no other service's transactions can see, making cascade
revocation eventually-consistent for no present benefit.

### D3 — Argon2id for password hashing

*Why:* memory-hard, and the current consensus default. The spec requires a memory-hard
algorithm rather than naming one, so the choice can move without a spec change.

*Cost:* a native dependency. If it proves painful in the Alpine image, bcrypt is the
fallback and still satisfies the spec, though with weaker GPU resistance — record the swap
if it happens rather than doing it quietly.

### D4 — Permissions are named strings, roles are collections of them

Authorization elsewhere is expressed as `finance:read`, `stores:write`, and so on; never
as `if (user.role === 'admin')`.

*Why:* role names are organisational and churn; permission names are contractual and
belong in the shared contracts the gateway checks against. It also keeps the door open for
D-nongoal per-store scoping later, by letting a permission carry a scope without every
call site changing.

*Seeded roles:* `administrator` (all permissions) and `operator` (read-only across the six
domains). Two is enough to prove the model without inventing an org chart nobody asked for.

### D5 — Bootstrap via an idempotent CLI command, not a migration seed

*Why:* a seeded password inside a migration ends up committed, reused across
environments, and impossible to rotate cleanly. A command that takes the password as input
and refuses to run when accounts already exist satisfies both bootstrap scenarios and
leaves no default credential behind.

### D6 — Throttling counted in Postgres against the account

*Why:* the spec's threat is credential brute force against a known account, which is
per-account, not per-IP — and the gateway is the only caller, so every request arrives
from one source IP anyway, making IP-based limiting useless here. Counting failures on the
account row keeps it in the same transaction as the credential check.

*Trade-off:* this makes it possible to deliberately throttle a known account (a nuisance
lockout). Mitigated by the spec's requirement that throttling always clears on its own.

### D7 — No `HoldItModule` in this service

*Why:* nothing in the spec is asynchronous. Registering it would mean carrying the
`WITH_KAFKA_BROKERS=false` startup hazard for no benefit.

*Consequence:* this service's `.env.example` deliberately omits `WITH_KAFKA_BROKERS`, and
its `CLAUDE.md` must say why, so the omission is not read as an oversight by the next
service that copies this one.

## Risks / Trade-offs

- **Every request depends on this service being up** → It becomes the platform's first
  hard dependency. Mitigation: keep introspection a single indexed primary-key read, expose
  liveness/readiness via `@app/health`, and let the gateway distinguish "session invalid"
  (401) from "IAM unreachable" (503) so an outage never reads as a mass logout.
- **First service to exercise `@app/*` at runtime** → `register-paths.js` is unproven
  against a real compiled `dist/`. Mitigation: the acceptance bar is the built image
  starting and serving, not merely `tsc` passing.
- **`PrismaRepository` discards Prisma error codes** (documented gap): the unique-email
  conflict scenario cannot be implemented by catching a unique-constraint violation and
  reading `error.code`. Mitigation: check for an existing email explicitly before insert,
  and keep the database's unique constraint as the backstop; accept the small race, since
  the constraint still prevents duplicates even when the friendly error is missed.
- **Credential storage raises the stakes on this repo's secret hygiene** → session signing
  and hashing parameters are config, never committed; `.env.example` carries names only.

## Migration Plan

No data migration: this is new. Deployment order is Postgres, then migrations, then the
service. Rollback is dropping the service and its database — nothing else reads it yet,
which is precisely why this service goes first, before anything depends on it.

## Open Questions

- Session lifetime and idle-timeout values. Deferrable: they are configuration, and the
  spec deliberately fixes only that an expiry exists, not its length.
- Whether `operator` should eventually be scoped to a subset of stores. Deferrable by
  design (D4) — it needs a real second role in the business before it can be specified.
