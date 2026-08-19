## 1. Transport and session plumbing

- [x] 1.1 Settle the same-site vs CORS-with-credentials question left open by `add-gateway-service`, and configure whichever the deployment requires — **CORS with credentials**: panel and gateway are different origins even in dev (different ports on localhost); `ADMIN_ORIGIN` is now a required gateway env var, `app.enableCors({ origin, credentials: true })` in `main.ts`. Wildcard origin is impossible here regardless — CORS forbids `*` together with `Access-Control-Allow-Credentials`
- [x] 1.2 Replace `src/lib/api/base-query.ts`'s `mockBaseQuery` with a shared `fetchBaseQuery` pointed at the gateway, sending credentials so the HTTP-only session cookie is included — `credentials: "include"`
- [x] 1.3 Read the gateway's base URL from environment configuration rather than hardcoding it — `NEXT_PUBLIC_GATEWAY_URL`; build-time ARG for `admin-prod` (Next inlines client env at build), runtime var for `admin-dev` (recompiled per request)
- [x] 1.4 Handle a 401 globally by returning the operator to login; handle a 403 as a permission message, never as a logout — `gatewayBaseQuery` redirects (full navigation) on 401 only; 403 passes through untouched as an ordinary query error
- [x] 1.5 Handle 503 from the gateway as a temporary failure with retry, and do not treat it as a session problem — wrapped with RTK Query's `retry()`, bailing immediately (`retry.fail`) on every status except 503

## 2. Authentication

- [x] 2.1 Add a login route and screen with email and password fields, in Portuguese — `src/app/login/page.tsx`
- [x] 2.2 Show a generic failure message that does not reveal whether the email or the password was wrong — `GENERIC_LOGIN_ERROR`, identical text for every failure cause
- [x] 2.3 Guard every operational route behind an authenticated session, redirecting to login when absent — `AuthGate` wraps the `(app)` route group; login/redirect verified live via browser automation
- [x] 2.4 Add logout, clearing the session through the gateway — sidebar footer menu, verified live (real session cleared, cookie flow confirmed)
- [ ] 2.5 Load the operator's identity and permissions after login (done — `useGetMeQuery`/`useHasPermission`), but **hiding an action** has nothing to attach to yet: no screen has a write action in its UI (the `PUT /inventory/:sku/minimum` mutation exists but no button calls it). The hook is built and correct; left unchecked because there is no concrete action to verify it against
- [x] 2.6 Install the shadcn `form` component, which the panel has not needed until now — the CLI's `radix-nova` style registry has an empty stub for `form` (confirmed via its raw JSON response), so hand-authored `src/components/ui/form.tsx` matching this project's existing component conventions, plus `react-hook-form`/`zod`/`@hookform/resolvers`

## 3. Domain slices, one at a time

- [x] 3.1 Move `stores` to `fetchBaseQuery` and verify the screen against real data — verified live (27 active, real names)
- [x] 3.2 Move `products` to `fetchBaseQuery`, including the dated cost reference the mock never had — added `GET /products/:id/costs` and `POST /products/costs/bulk` to the gateway (not previously routed); "Sem custo" shown rather than R$ 0,00 for an unresolved SKU
- [x] 3.3 Move `sales` to `fetchBaseQuery`, adapting the screen from the mock's per-transaction shape to the real per-SKU-per-period grain — added `GET /sales/:storeId`, `.../totals` to the gateway (not previously routed); verified live with real March/2026 data (152 units, R$1.440,87, 53 SKUs for one store)
- [x] 3.4 Move `inventory` to `fetchBaseQuery`, replacing the mock's hardcoded minimum rule with the configured per-store, per-SKU minimums — added `GET /inventory/:storeId`, `.../below-minimum`, `.../minimums`, `PUT .../:sku/minimum` to the gateway; reading verified live, no UI yet calls the write endpoint (see 2.5)
- [x] 3.5 **Rebuild the `supply` screen** — restocks/removals(with loss flag)/adjustments as three tabs, not a purchasing workflow
- [x] 3.6 **Rebuild the `finance` screen** — the five real figures (restocked, COGS, remaining, loss, unclassified adjustment), verified live against real March data including a genuine incomplete-reconciliation case
- [x] 3.7 Keep each domain shippable on its own — six independent `createApi` slices/reducers, no cross-slice coupling

## 4. Presentation of real-data states

- [x] 4.1 Add distinct loading, empty, error-with-retry and forbidden states to every data-backed screen — `src/components/request-state.tsx`, used on every rebuilt screen
- [x] 4.2 Never render an empty state for a failed request, and never render placeholder data for an empty one — `RequestState` branches error before empty, and a 404 ("never ingested") is deliberately treated as its own empty variant, not as a generic error
- [x] 4.3 Show reconciliation incompleteness next to the figures themselves, with access to the SKUs that could not be valued — verified live (banner names unpriced/inconsistent SKUs directly above the figures)
- [x] 4.4 Never present an incomplete total as authoritative — warning icon on every figure card when `!complete`, verified live
- [x] 4.5 Show negative derived stock as a flagged inconsistency, never as zero — verified live (real negative SKUs rendered in red with an "Inconsistente" badge)
- [x] 4.6 Format money from the backend's integer minor units, doing the only rounding at the point of display — one shared `currency.format(cents / 100)` pattern, no intermediate float storage

## 5. Loss presentation

- [x] 5.1 Show real loss for a store and month, broken down by reason and by product — verified live
- [x] 5.2 Use the glossary's Portuguese terms for the reasons — `src/lib/removal-reasons.ts`, verified live (Validade vencida, Produto danificado, Outro motivo rendered correctly)
- [x] 5.3 Make clear which reasons counted toward loss and which did not — a "Perda" badge only on the three loss-counting reasons, plus an explanatory caption, verified live

## 6. Upload UI

- [ ] 6.1 Add an upload screen supporting the three file types, requiring store and period before submission
- [ ] 6.2 Confirm acceptance immediately, without waiting for parsing
- [ ] 6.3 Show upload rejections (size, format, type mismatch) in actionable terms
- [ ] 6.4 Add an ingestion list and detail view showing status through to a terminal state
- [ ] 6.5 Present a partially completed import as partial, with accepted and rejected row counts
- [ ] 6.6 Make rejected rows readable, each identifying the row and what to fix in the file

## 7. Cleanup

- [ ] 7.1 Delete `src/mocks/` and `mockBaseQuery` once every domain is connected — not before, so the migration can proceed domain by domain
- [x] 7.2 Confirm no fixture or placeholder data source remains anywhere in the app — `grep -rl "@/mocks\|mockBaseQuery" src/` returns nothing
- [x] 7.3 Update `frontend/apps/admin/CLAUDE.md`: the mock seam, the no-auth note and the list-only note are all now obsolete
- [x] 7.4 Update `frontend/CLAUDE.md` where it describes the panel as mock-backed

## 8. Tests

- [ ] 8.1 Tests for the auth flow: redirect when unauthenticated, successful login, generic failure message, expiry returning to login, logout
- [ ] 8.2 Test that a 403 shows a permission message and does not log the operator out
- [ ] 8.3 Tests for each of loading, empty, error and forbidden states on a representative screen
- [ ] 8.4 Test that an incomplete reconciliation is visibly marked where its figures are shown
- [ ] 8.5 Test that negative stock renders as negative and flagged, not zero
- [ ] 8.6 Test the upload flow including a partially completed import with readable rejected rows
- [ ] 8.7 End-to-end test against the running stack: log in, upload the three files, and read the resulting reconciliation

## 9. Verification

- [x] 9.1 `pnpm turbo run lint typecheck build` green across the workspace — 56/56 tasks
- [x] 9.2 `agiliz-cli up` brings the full stack up, and the panel works against it end to end — verified live via browser automation against the real production stack: login, dashboard (27 stores, 238 products), sales (real per-store totals and rows), finance (all five figures, real incomplete-reconciliation case), inventory (real negative-stock flagging), logout
- [x] 9.3 Confirm no request from the panel reaches any service other than the gateway — every `src/lib/api/*.ts` slice uses `gatewayBaseQuery`, which has one `baseUrl` (`NEXT_PUBLIC_GATEWAY_URL`); no other service URL appears anywhere in `frontend/apps/admin/src`
- [x] 9.4 Confirm the session cookie is not readable by page scripts — `httpOnly: true` in `AuthController.login` (unchanged, pre-existing), and no panel code reads `document.cookie`
- [ ] 9.5 `openspec validate add-web-real-data --strict` passes — pending, run once tasks 6 and 8 land or are explicitly deferred
