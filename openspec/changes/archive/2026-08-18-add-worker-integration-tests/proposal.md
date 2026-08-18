## Why

Three archived changes each closed with the same task left open: no automated
integration suite for the path that actually carries the work.

- `add-gateway-service` (9.2) — 401/403/503/502, cookie handling and partial
  failure were exercised by hand against a running stack.
- `add-sales-service` (6.5) — the queue path was driven manually with a script.
- `add-supply-service` (8.9) — likewise, including the event suppression.

Once is a gap; three times is a pattern, and the next change is
`add-ingestion-flow`, which depends on exactly these paths — it produces the
jobs `sales` and `supply` consume, and its upload routes live on the gateway.
Building on three unverified seams is how a failure in one gets attributed to
another for a day.

The behaviour is already specified and already implemented. What is missing is
the automated proof, and the manual runs that stood in for it leave nothing
behind that CI can re-run.

## What Changes

- **Gateway integration suite** — boots the real Nest application and drives it
  over HTTP with supertest, against a stub upstream it controls, so the guard,
  the exception filter, the cookie and the error mapping are exercised as a
  whole rather than as units.
- **Sales worker integration suite** — enqueues on a real Redis, lets the real
  worker consume, and asserts what landed in Postgres, including that a
  re-delivered job does not double figures.
- **Supply worker integration suite** — the same, plus that the
  period-data-updated event is published on a real change and suppressed on a
  no-op.
- **A documented way to run them**, since they need infrastructure that unit
  tests do not.

Not in scope: new behaviour of any kind, and any change to the three services'
production code beyond what the tests reveal.

## Capabilities

### New Capabilities

None. This adds test coverage for behaviour three archived specs already
define; no requirement changes. Sets `skip_specs: true` accordingly.

### Modified Capabilities

None.

## Impact

- **New**: `test/*.integration-spec.ts` in `gateway-service`, `sales-service`
  and `supply-service`, plus whatever test-only dependencies they need.
- **Modified**: those services' `CLAUDE.md`, to drop the gap each records, and
  possibly their production code if a test exposes a real defect — which is
  the point of writing them.
- **Requires**: a running Redis and the two Postgres containers. The gateway
  suite deliberately needs neither.
