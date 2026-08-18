## Why

`iam-service`, `stores-service` and `products-service` each expose an HTTP API, but nothing
is allowed to reach them from a browser: they trust their caller, have no session handling,
and are not on a public network. The admin panel needs exactly one address to talk to, and
the platform needs exactly one place where "is this request allowed" is decided.

Without a gateway, every domain service would have to implement session validation and
permission checks independently — nine copies of the security-critical code, drifting apart.

## What Changes

- **New `backend/apps/gateway-service`** — the single HTTP entrypoint for
  `frontend/apps/admin`, and the only service exposed beyond `agiliz_network`.
- **Session validation on every request**, delegated synchronously to `iam-service`, with a
  clear distinction between "your session is invalid" and "the identity service is down".
- **Permission enforcement** at the edge, expressed in the named permissions defined by
  `iam`, so domain services never re-implement authorization.
- **Browser session handling** — the gateway owns the cookie relationship with the browser;
  the opaque session token never becomes the frontend's responsibility to store.
- **Routing and aggregation** to the domain services over HTTP via `@app/http-client`.
- **Correlation ID propagation** — the gateway mints a request ID and passes it downstream,
  so one operator action is traceable across services.
- **A published OpenAPI surface**, which becomes the contract `add-web-real-data` codes the
  panel's RTK Query slices against.

Not in scope: upload endpoints (`add-ingestion-flow` adds them here), the login UI
(`add-web-real-data`), rate limiting beyond IAM's own auth throttling, and caching.

## Capabilities

### New Capabilities

- `api-gateway`: the platform's single HTTP entrypoint — session and permission
  enforcement, request routing and aggregation, and the failure semantics the panel sees.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/gateway-service/`. It has **no database of its own** — see
  `design.md`.
- **Modified**: `cli/agiliz-cli` (new `gateway` project, ordered after the services it
  calls), `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Depends on**: `iam-service` (hard dependency, every request), `stores-service` and
  `products-service` (per-route).
- **Consumed by**: `frontend/apps/admin`, which stops using `mockBaseQuery` in
  `add-web-real-data`.
- **Security**: this is the platform's trust boundary. Everything behind it assumes its
  caller has already been authenticated and authorized.
- **BREAKING for network topology**: domain services stop being reachable from outside
  `agiliz_network`; only the gateway publishes a host port.
