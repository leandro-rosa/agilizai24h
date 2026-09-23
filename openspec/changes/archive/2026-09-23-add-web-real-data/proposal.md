## Why

The backend now holds real data and computes the reconciliation, but `frontend/apps/admin`
still serves 15–40 in-memory fixtures per domain through `mockBaseQuery`. The panel is a
demo of a system that already exists behind it.

`mockBaseQuery` was built as an explicit seam for exactly this moment — its own docstring
says so. Two of the six domains also need their mocked shape replaced rather than connected:
`finance` mocks a generic revenue/expense ledger, and `supply` mocks a purchasing workflow;
neither matches the reconciliation model the backend actually implements.

The panel also has no authentication, and no way to upload the spreadsheets that drive
everything.

## What Changes

- **Six RTK Query slices move from `mockBaseQuery` to `fetchBaseQuery`**, pointed at
  `gateway-service`, one domain at a time.
- **Login and session handling** — the panel's first auth. The session is an HTTP-only cookie
  the gateway owns, so the panel sends credentialed requests and never handles a token.
- **Upload UI** for the three spreadsheet types, with per-ingestion status and a readable
  report of rejected rows.
- **Replaced finance and supply screens** reflecting the real domain: restocked value, COGS,
  remaining stock and real loss by reason and product, rather than a generic ledger.
- **Completeness and inconsistency states surfaced in the UI** — an incomplete reconciliation
  or negative derived stock must be visible where the number is shown, not buried.
- **Loading, empty, error and forbidden states**, none of which a mock ever produced.
- **Removal of `mockBaseQuery` and `src/mocks/`** once every domain is connected.

Not in scope: new analytics or charts beyond what the current screens show, store/product
management forms beyond what the backend already exposes, and any redesign — `DESIGN.md`
stands.

## Capabilities

### New Capabilities

- `web-admin`: the operator-facing behaviour of the management panel — authentication,
  uploading operational files, and how real data, including its failure and incompleteness
  states, is presented.

### Modified Capabilities

None. The panel has no spec today; this change writes its first one.

## Impact

- **Modified**: `frontend/apps/admin` — `src/lib/api/*.ts` (six slices), the finance and
  supply screens, plus new login and upload routes. `src/lib/api/base-query.ts` and
  `src/mocks/` are deleted at the end.
- **Depends on**: `gateway-service` for every request, and its published OpenAPI document as
  the contract.
- **Deployment**: the panel and the gateway must be same-site, or CORS with credentials must
  be configured deliberately — the open question left by `add-gateway-service`, which this
  change has to settle.
- **User-visible**: operators must log in for the first time; there is no anonymous access
  after this change.
