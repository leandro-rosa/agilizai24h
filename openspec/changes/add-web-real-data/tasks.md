## 1. Transport and session plumbing

- [ ] 1.1 Settle the same-site vs CORS-with-credentials question left open by `add-gateway-service`, and configure whichever the deployment requires
- [ ] 1.2 Replace `src/lib/api/base-query.ts`'s `mockBaseQuery` with a shared `fetchBaseQuery` pointed at the gateway, sending credentials so the HTTP-only session cookie is included
- [ ] 1.3 Read the gateway's base URL from environment configuration rather than hardcoding it
- [ ] 1.4 Handle a 401 globally by returning the operator to login; handle a 403 as a permission message, never as a logout
- [ ] 1.5 Handle 503 from the gateway as a temporary failure with retry, and do not treat it as a session problem

## 2. Authentication

- [ ] 2.1 Add a login route and screen with email and password fields, in Portuguese
- [ ] 2.2 Show a generic failure message that does not reveal whether the email or the password was wrong
- [ ] 2.3 Guard every operational route behind an authenticated session, redirecting to login when absent
- [ ] 2.4 Add logout, clearing the session through the gateway
- [ ] 2.5 Load the operator's identity and permissions after login, and hide actions they lack permission for — while still handling a 403 from the server, since a hidden control is not a security boundary
- [ ] 2.6 Install the shadcn `form` component, which the panel has not needed until now

## 3. Domain slices, one at a time

- [ ] 3.1 Move `stores` to `fetchBaseQuery` and verify the screen against real data
- [ ] 3.2 Move `products` to `fetchBaseQuery`, including the dated cost reference the mock never had
- [ ] 3.3 Move `sales` to `fetchBaseQuery`, adapting the screen from the mock's per-transaction shape to the real per-SKU-per-period grain
- [ ] 3.4 Move `inventory` to `fetchBaseQuery`, replacing the mock's hardcoded minimum rule with the configured per-store, per-SKU minimums
- [ ] 3.5 **Rebuild the `supply` screen** — the mock's purchasing workflow (requested quantity, scheduled date, status) is replaced by restocks and per-reason removals, not adapted
- [ ] 3.6 **Rebuild the `finance` screen** — the mock's generic revenue/expense ledger is replaced by the four reconciliation figures, not adapted
- [ ] 3.7 Keep each domain shippable on its own, so a problem in one does not block the others

## 4. Presentation of real-data states

- [ ] 4.1 Add distinct loading, empty, error-with-retry and forbidden states to every data-backed screen
- [ ] 4.2 Never render an empty state for a failed request, and never render placeholder data for an empty one
- [ ] 4.3 Show reconciliation incompleteness next to the figures themselves, with access to the SKUs that could not be valued
- [ ] 4.4 Never present an incomplete total as authoritative
- [ ] 4.5 Show negative derived stock as a flagged inconsistency, never as zero
- [ ] 4.6 Format money from the backend's integer minor units, doing the only rounding at the point of display

## 5. Loss presentation

- [ ] 5.1 Show real loss for a store and month, broken down by reason and by product
- [ ] 5.2 Use the glossary's Portuguese terms for the reasons (Validade vencida, Produto danificado, Outro motivo, Devolução, Transferência, Uso e consumo)
- [ ] 5.3 Make clear which reasons counted toward loss and which did not, so the figure is explainable to someone reading it

## 6. Upload UI

- [ ] 6.1 Add an upload screen supporting the three file types, requiring store and period before submission
- [ ] 6.2 Confirm acceptance immediately, without waiting for parsing
- [ ] 6.3 Show upload rejections (size, format, type mismatch) in actionable terms
- [ ] 6.4 Add an ingestion list and detail view showing status through to a terminal state
- [ ] 6.5 Present a partially completed import as partial, with accepted and rejected row counts
- [ ] 6.6 Make rejected rows readable, each identifying the row and what to fix in the file

## 7. Cleanup

- [ ] 7.1 Delete `src/mocks/` and `mockBaseQuery` once every domain is connected — not before, so the migration can proceed domain by domain
- [ ] 7.2 Confirm no fixture or placeholder data source remains anywhere in the app
- [ ] 7.3 Update `frontend/apps/admin/CLAUDE.md`: the mock seam, the no-auth note and the list-only note are all now obsolete
- [ ] 7.4 Update `frontend/CLAUDE.md` where it describes the panel as mock-backed

## 8. Tests

- [ ] 8.1 Tests for the auth flow: redirect when unauthenticated, successful login, generic failure message, expiry returning to login, logout
- [ ] 8.2 Test that a 403 shows a permission message and does not log the operator out
- [ ] 8.3 Tests for each of loading, empty, error and forbidden states on a representative screen
- [ ] 8.4 Test that an incomplete reconciliation is visibly marked where its figures are shown
- [ ] 8.5 Test that negative stock renders as negative and flagged, not zero
- [ ] 8.6 Test the upload flow including a partially completed import with readable rejected rows
- [ ] 8.7 End-to-end test against the running stack: log in, upload the three files, and read the resulting reconciliation

## 9. Verification

- [ ] 9.1 `pnpm turbo run lint typecheck build` green across the workspace
- [ ] 9.2 `agiliz-cli up` brings the full stack up, and the panel works against it end to end
- [ ] 9.3 Confirm no request from the panel reaches any service other than the gateway
- [ ] 9.4 Confirm the session cookie is not readable by page scripts
- [ ] 9.5 `openspec validate add-web-real-data --strict` passes
