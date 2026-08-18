## Context

See `proposal.md` — Why. This change establishes the platform's trust boundary, so its
decisions constrain every service built after it.

Relevant existing state: `iam-service` issues opaque session tokens and exposes
introspection; `stores-service` and `products-service` expose plain HTTP APIs that trust
their caller; `@app/http-client` is the mandated sync inter-service client;
`frontend/apps/admin` currently talks to nothing.

## Goals / Non-Goals

**Goals:**

- One place where authentication and authorization are decided.
- Domain services that can stay simple because they are never publicly reachable.
- Failure semantics precise enough that the panel can tell "log in again" from "try later".

**Non-Goals:**

- No business logic. If a rule can be stated about stores, it belongs in `stores-service`.
- No database (D2).
- No response caching. Traffic is a handful of operators; caching would add invalidation
  bugs to buy nothing.
- No public API for third parties — the panel is the only client.

## Decisions

### D1 — Thin BFF, not a generic reverse proxy

The gateway exposes routes shaped for the panel and calls domain services explicitly,
rather than transparently proxying `/{service}/**` through to whatever is behind it.

*Why:* a transparent proxy means every domain endpoint is implicitly public the moment it
is written, and the permission required for a route lives nowhere. Explicit routes make the
exposed surface a deliberate list, and let one panel screen be served by one call even when
it needs two services.

*Cost:* adding a domain endpoint means touching the gateway too. That is the point — it
forces a decision about who may call it.

### D2 — No database

*Why:* the gateway holds no state worth persisting. Sessions live in `iam-service`
precisely so that revocation is authoritative in one place; duplicating them here would
create a second source of truth that can disagree with the first.

*Consequence:* it is the only backend service without its own Postgres, which is a
deliberate exception to the database-per-service rule and must be stated in its `CLAUDE.md`
so it does not read as an oversight.

### D3 — Introspect the session on every request; no session caching

*Why:* `iam`'s spec promises that logout revokes immediately and that a permission change
takes effect on the next request. Any cache — even a few seconds — breaks both promises,
and does so intermittently, which is the worst way for a security control to fail.

*Cost:* one extra in-network call per request. At this traffic level it is irrelevant, and
`iam` keeps introspection to a single indexed read for exactly this reason. If it ever does
become a bottleneck, that is a spec conversation about acceptable revocation lag, not a
silent optimisation.

### D4 — HTTP-only same-site cookie, set by the gateway

The browser never sees the session token in JavaScript; the frontend simply sends
credentialed requests.

*Why:* the alternative is the panel storing a token in `localStorage` and attaching it,
which makes any XSS a full account takeover. It also keeps the frontend free of auth
plumbing entirely — `add-web-real-data` configures RTK Query with credentials included and
is done.

*Consequence:* the gateway and the panel must be same-site, or CORS with credentials must
be configured deliberately. Worth stating in that change rather than discovering it.

### D5 — 401 for unauthenticated, 403 for unauthorized, 503 for identity unavailable

*Why:* the spec requires an IAM outage never to read as a rejected session. Collapsing
these into one status is what causes the classic failure where a dependency blip logs the
whole company out and destroys their in-progress work. Separating them lets the panel react
correctly: 401 → redirect to login; 403 → show "not permitted"; 503 → retry, keep the
session.

### D6 — Fail closed on identity failure

If the session cannot be validated for any reason, the request does not reach a domain
service.

*Why:* the only alternative is serving data to an unvalidated caller. A 503 that blocks
legitimate work during an outage is strictly better than a data leak. Note this is
compatible with D5: fail closed on *access*, but report the reason honestly.

### D7 — Permission-to-route mapping is declarative and shared

Routes declare the named permission they require, drawn from the constants `iam-service`
publishes in the shared contracts location.

*Why:* string literals duplicated across services drift, and a typo in a permission name
silently grants access to nobody or — worse, if the check is inverted anywhere — everybody.
Importing the constants makes a typo a compile error.

### D8 — Aggregated routes surface partial failure explicitly

When a route fans out to several services and one fails, the response says so rather than
returning the subset.

*Why:* the same principle as `products-service`'s partitioned cost lookup — a partial
result that looks complete produces a confidently wrong dashboard. The panel must be able
to render "this figure is unavailable" instead of a smaller number.

## Risks / Trade-offs

- **Single point of failure for the whole panel** → nothing works if the gateway is down.
  Accepted: it is stateless, so it can be run as multiple replicas, and the alternative
  (each service exposed publicly) trades one failure point for nine security boundaries.
- **Every request costs an extra hop** (D3) → added latency on every call. Accepted
  deliberately for correct revocation; revisit only with measurements and a spec change.
- **The gateway becomes a dumping ground** → BFF layers accumulate business logic that
  belongs in domain services. Mitigation: its `CLAUDE.md` states the rule (routing, auth,
  aggregation only), and any computation it performs is a review flag.
- **Fail-closed makes IAM a hard dependency of every screen** → an IAM outage is a total
  outage. Mitigation: liveness/readiness via `@app/health`, and IAM deliberately kept
  minimal and dependency-free so it is the least likely thing to be down.

## Migration Plan

Deploy order: `iam-service` must be running first, then the gateway. Once the gateway
exists, remove the published host ports from `stores-service` and `products-service` so the
topology matches the single-entrypoint requirement — this is the breaking topology change
named in the proposal, and it must land in the same change so there is no window where
domain services are both public and unprotected.

Rollback: revert the gateway and restore the domain services' published ports. Nothing
depends on the gateway until `add-web-real-data`.

## Open Questions

- Whether the panel and gateway will be served same-site in production or need explicit
  CORS-with-credentials. Deferrable: it affects deployment configuration, not the routes or
  the task breakdown, and `add-web-real-data` must settle it before the panel ships.
