# Network Finance Drill-Down + Ingestion UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `reason×SKU` loss cross-tab to `finance-service`, redesign the admin panel's network finance view into a sortable stores table with a click-to-drill-down loss panel (mirroring a hand-built reference dashboard's UX, minus its deferred day-of-visit panel), extend the "Rede (todas as lojas)" option to sales/supply/inventory, and ship the ingestion upload + history UI that has had a backend for a while but no screen.

**Architecture:** Four independent, sequentially-verified change sets, each its own commit: (1) a backend aggregate addition with no schema migration (the `ReconciliationLoss` table already has nullable `reason`/`sku` columns designed for exactly this), plus an ops-only recompute pass over live data; (2) frontend type/aggregate extensions feeding a redesigned `NetworkFinanceView` (sortable table + nested bar-in-bar drill-down, reusing `Figure`/`KpiCard`/`ChartContainer`/`RequestState`); (3) mechanical replication of the existing `Store*View`/`Network*View` split (already used by `finance/page.tsx`) onto `sales`/`supply`/`inventory`; (4) a new `/ingestion` page (RTK Query slice + upload form + history table + rejection-detail dialog) using patterns already established by `login/page.tsx` and `finance/page.tsx`.

**Tech Stack:** NestJS 11 + Prisma (`finance-service`), Next.js 16 App Router + RTK Query + Tailwind v4 + shadcn/ui (`radix-nova`) + Recharts (`frontend/apps/admin`). Jest for backend unit tests; the frontend has no test suite (confirmed gap in `frontend/apps/admin/CLAUDE.md`) — frontend tasks substitute `pnpm typecheck`/`pnpm build` + live browser verification for the automated red/green loop the backend task uses.

**Spec:** the user's task message in this conversation (2026-08-19) — six numbered items grouped into four commits per its own verification section, plus the attached reference file at `/home/leandroaar/Downloads/agiliz_dashboard_abastecimento.html` (UX pattern only — **do not** copy its color tokens, fonts, or its "Por dia de visita" panel; the visit-date field is confirmed dropped before reaching `supply-service`, see Group A's deferred-work note in Task D5).

## Global Constraints

- **Verify after every group, before starting the next**: `pnpm turbo run lint typecheck build --filter=@agiliz/admin` for every frontend group (B, C, D). Group A additionally needs `finance-service`'s own `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (run from `backend/apps/finance-service`).
- **Live verification** happens through the already-running prod stack (`docker ps` confirmed all containers up) via the `chrome-devtools` MCP tools — login `barbara@agiliz.ai` / `Pedro160911*` at `http://localhost:8080`. Prod containers don't hot-reload: after any backend or frontend code change, rebuild+redeploy with `cli/agiliz-cli up -i <project> --production` (`finance` for Group A, `admin` for Groups B/C/D) before live-checking.
- **No new colors.** Every visual element reuses `--chart-1/2/3`, `--destructive`, `--warning`, or shadcn's neutral tokens (`muted`, `secondary`, `outline`) — confirmed via `globals.css`'s `@theme inline` block that `--color-chart-1/2/3`, `--color-destructive`, `--color-warning` are all registered Tailwind utilities (`text-chart-1`, `bg-destructive/10`, etc. all resolve).
- **UI copy in Portuguese, identifiers in English** — existing convention, unchanged.
- **Reuse `Figure`/`KpiCard`/`ChartContainer`/`RequestState`/`StorePeriodPicker`/`fetchOr404`/`firstError`** rather than reinventing; new local components only where the existing ones don't fit (the nested bar-in-bar drill-down has no precedent in this codebase, so it's a new component, not a table).
- **`Store*View` / `Network*View` split**: every page that gains `allowNetwork` (sales, supply, inventory) must factor its existing single-store body into `Store<Domain>View({ storeId, range })`, matching `finance/page.tsx`'s established `StoreFinanceView`/`NetworkFinanceView` pattern — not an ad hoc `if`/`skip` branch inside one component.
- **Don't build the deferred items**: no upload rollback/cancel endpoint, no loss-by-day-of-visit panel. Both get one line each in `frontend/apps/admin/CLAUDE.md` (Task D5) noting they need their own OpenSpec proposal — never implemented here.
- **DB**: no Prisma migration in this plan. `ReconciliationLoss` (`backend/apps/finance-service/prisma/schema.prisma:77-91`) already has nullable `reason`/`sku` columns; a third row-kind (both populated) fits the existing table.

---

## Group A — Backend: `loss_by_reason_sku` cross-tab + recompute pass

*(the user's "step 1" — one commit, verified via `finance-service`'s own build/test plus a live check that recomputed data actually carries the new field)*

### Task A1: `reconcile.ts` — add the third loss breakdown

**Files:**
- Modify: `backend/apps/finance-service/src/modules/finance/utils/reconcile.ts`
- Test: `backend/apps/finance-service/src/modules/finance/utils/reconcile.spec.ts`

**Interfaces:**
- Produces: `Reconciliation.loss_by_reason_sku: { reason: string; sku: string; quantity: number; value_cents: number }[]` — consumed by Task A2 (`finance.service.ts`'s `recompute()`/`findOne()`) and, on the frontend side, by Task B1.

- [ ] **Step 1: Write the failing tests**

Add these three `it` blocks inside the existing `describe('loss breakdowns', ...)` block (after the `'leaves an unpriced SKU out of the loss breakdowns entirely'` test, i.e. after line 234 of the current file):

```typescript
    it('breaks loss down by reason and SKU together', () => {
      const result = reconcile(
        [
          quantities({
            sku: 'A',
            lossByReason: [
              { reason: 'expired', quantity: 3 },
              { reason: 'damaged_product', quantity: 2 },
            ],
          }),
          quantities({ sku: 'B', lossByReason: [{ reason: 'expired', quantity: 1 }] }),
        ],
        [cost('A', 250), cost('B', 300)],
        [],
      )

      expect(result.loss_by_reason_sku).toEqual([
        { reason: 'damaged_product', sku: 'A', quantity: 2, value_cents: 500 },
        { reason: 'expired', sku: 'A', quantity: 3, value_cents: 750 },
        { reason: 'expired', sku: 'B', quantity: 1, value_cents: 300 },
      ])
    })

    it('makes the reason×SKU breakdown sum to the total too', () => {
      const result = reconcile(
        [
          quantities({
            sku: 'A',
            lossByReason: [
              { reason: 'expired', quantity: 3 },
              { reason: 'other_reason', quantity: 1 },
            ],
          }),
          quantities({ sku: 'B', lossByReason: [{ reason: 'damaged_product', quantity: 2 }] }),
        ],
        [cost('A', 250), cost('B', 700)],
        [],
      )

      const byReasonSku = result.loss_by_reason_sku.reduce((sum, entry) => sum + entry.value_cents, 0)
      expect(byReasonSku).toBe(result.loss_value_cents)
    })

    it('leaves an unpriced SKU out of the reason×SKU breakdown too', () => {
      const result = reconcile(
        [quantities({ sku: 'GHOST', lossByReason: [{ reason: 'expired', quantity: 99 }] })],
        [],
        [{ sku: 'GHOST', reason: 'unknown_sku' }],
      )

      expect(result.loss_by_reason_sku).toEqual([])
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend/apps/finance-service && pnpm test -- reconcile.spec.ts`
Expected: FAIL — `result.loss_by_reason_sku` is `undefined` (property doesn't exist yet), so `toEqual`/`.reduce` throw or fail the assertion.

- [ ] **Step 3: Add the field to the `Reconciliation` interface**

In `reconcile.ts`, right after `loss_by_sku: { sku: string; quantity: number; value_cents: number }[]` (line 68):

```typescript
  loss_by_reason_sku: { reason: string; sku: string; quantity: number; value_cents: number }[]
```

- [ ] **Step 4: Populate a third Map in the same loop that already builds `lossByReason`**

Add the Map declaration next to the two existing ones (after line 128, `const lossBySku = new Map<string, { quantity: number; value_cents: number }>()`):

```typescript
  const lossByReasonSku = new Map<string, { reason: string; sku: string; quantity: number; value_cents: number }>()
```

Inside the existing `for (const entry of item.lossByReason)` loop (the one that currently only updates `lossByReason`, around lines 188-194), add a `.set()` call right after the existing `lossByReason.set(...)` call:

```typescript
    for (const entry of item.lossByReason) {
      const current = lossByReason.get(entry.reason) ?? { quantity: 0, value_cents: 0 }
      lossByReason.set(entry.reason, {
        quantity: current.quantity + entry.quantity,
        value_cents: current.value_cents + entry.quantity * cost,
      })

      // Unlike lossByReason (a reason can span many SKUs) or lossBySku (each
      // SKU appears once per reconcile() call), the (reason, sku) pair is
      // unique within one call — mergeQuantities already dedupes by reason
      // within a SKU — so a plain set, not an accumulate, is correct here.
      lossByReasonSku.set(`${entry.reason}|${item.sku}`, {
        reason: entry.reason,
        sku: item.sku,
        quantity: entry.quantity,
        value_cents: entry.quantity * cost,
      })
    }
```

- [ ] **Step 5: Return the sorted array**

In the `return` statement, right after `loss_by_sku: [...lossBySku.entries()]...` (lines 207-209):

```typescript
    loss_by_reason_sku: [...lossByReasonSku.values()]
      .sort((a, b) => a.reason.localeCompare(b.reason) || a.sku.localeCompare(b.sku)),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend/apps/finance-service && pnpm test -- reconcile.spec.ts`
Expected: PASS — all tests including the three new ones.

- [ ] **Step 7: Commit is deferred to the end of Group A** (Task A7) — this task's code lands in one commit with A2/A3.

### Task A2: `finance.service.ts` — thread the third breakdown through persistence and reads

**Files:**
- Modify: `backend/apps/finance-service/src/modules/finance/services/finance.service.ts:8-33` (interface), `:113-128` (write), `:199-204` (read)

**Interfaces:**
- Consumes: `Reconciliation.loss_by_reason_sku` from Task A1.
- Produces: `ReconciliationView.loss_by_reason_sku` — consumed by the DTO (Task A3) and, over HTTP, by the frontend (Task B1).

- [ ] **Step 1: Add the field to `ReconciliationView`**

Right after `loss_by_sku: { sku: string; quantity: number; value_cents: number }[]` (line 27):

```typescript
  loss_by_reason_sku: { reason: string; sku: string; quantity: number; value_cents: number }[]
```

- [ ] **Step 2: Write the third row-kind in `recompute()`**

The `lossRows` array (lines 113-128) currently has two spreads. Add a third, using `entry.reason` **and** `entry.sku` together (the row-kind the table's nullable columns were designed to support):

```typescript
      const lossRows = [
        ...result.loss_by_reason.map(entry => ({
          reconciliation_id: created.id,
          reason: entry.reason,
          sku: null,
          quantity: entry.quantity,
          value_cents: entry.value_cents,
        })),
        ...result.loss_by_sku.map(entry => ({
          reconciliation_id: created.id,
          reason: null,
          sku: entry.sku,
          quantity: entry.quantity,
          value_cents: entry.value_cents,
        })),
        ...result.loss_by_reason_sku.map(entry => ({
          reconciliation_id: created.id,
          reason: entry.reason,
          sku: entry.sku,
          quantity: entry.quantity,
          value_cents: entry.value_cents,
        })),
      ]
```

- [ ] **Step 3: Fix `findOne()`'s read filters — this is not purely additive**

The current filters (lines 199-204) are:

```typescript
      loss_by_reason: found.by_reason
        .filter(row => row.reason !== null)
        .map(row => ({ reason: row.reason!, quantity: row.quantity, value_cents: row.value_cents })),
      loss_by_sku: found.by_reason
        .filter(row => row.sku !== null)
        .map(row => ({ sku: row.sku!, quantity: row.quantity, value_cents: row.value_cents })),
```

Once Step 2 starts writing rows where **both** `reason` and `sku` are non-null, `row.reason !== null` also matches those new rows (leaking them into `loss_by_reason`), and `row.sku !== null` also matches them (leaking them into `loss_by_sku`). Both filters need a second condition, plus the new third block:

```typescript
      loss_by_reason: found.by_reason
        .filter(row => row.reason !== null && row.sku === null)
        .map(row => ({ reason: row.reason!, quantity: row.quantity, value_cents: row.value_cents })),
      loss_by_sku: found.by_reason
        .filter(row => row.sku !== null && row.reason === null)
        .map(row => ({ sku: row.sku!, quantity: row.quantity, value_cents: row.value_cents })),
      loss_by_reason_sku: found.by_reason
        .filter(row => row.reason !== null && row.sku !== null)
        .map(row => ({ reason: row.reason!, sku: row.sku!, quantity: row.quantity, value_cents: row.value_cents })),
```

- [ ] **Step 4: No changes needed to `series()` or `rollup()`** — `series()` calls `findOne()` per month (inherits the fix automatically); `rollup()` only sums the five top-level cents figures, never touches `by_reason`.

### Task A3: `reconciliation.response.dto.ts` — document the new field (Swagger only)

**Files:**
- Modify: `backend/apps/finance-service/src/modules/finance/dto/reconciliation.response.dto.ts:28-37` (add class after `LossBySkuDto`), `:152-156` (add field)

- [ ] **Step 1: Add `LossByReasonSkuDto`**

Right after the `LossBySkuDto` class (after line 37):

```typescript
export class LossByReasonSkuDto {
  @ApiProperty({ description: 'Reason key, as classified by supply-service', example: 'expired' })
  reason: string

  @ApiProperty({ example: 'FIN-A' })
  sku: string

  @ApiProperty({ description: 'Units removed for this reason and SKU', example: 2 })
  quantity: number

  @ApiProperty({ description: 'Real loss for this reason and SKU, in centavos (integer minor units)', example: 500 })
  value_cents: number
}
```

- [ ] **Step 2: Add the field to `ReconciliationResponseDto`**

Right after `loss_by_sku: LossBySkuDto[]` (after line 156):

```typescript
  @ApiProperty({
    type: [LossByReasonSkuDto],
    description:
      'Real loss broken down by reason and product together; sums to loss_value_cents the same way ' +
      'loss_by_reason and loss_by_sku do',
  })
  loss_by_reason_sku: LossByReasonSkuDto[]
```

### Task A4: Verify the backend build and redeploy

- [ ] **Step 1: Run the service's own checks**

```bash
cd backend/apps/finance-service
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all four pass. `pnpm test` should show the three new `reconcile.spec.ts` cases passing alongside the pre-existing ones.

- [ ] **Step 2: Rebuild and redeploy the prod container**

```bash
cli/agiliz-cli up -i finance --production
```

Expected: `agiliz-finance-prod` restarts healthy (`docker ps` shows `Up ... (healthy)`).

### Task A5: Recompute pass — every store × every already-ingested period

**Files:**
- Create (scratch, not committed): a Node script, e.g. `/tmp/claude-1000/-home-leandroaar-Projects-agilizai24h/c3d4f164-c3cd-494b-a861-9fa8816344c9/scratchpad/recompute-loss-by-reason-sku.js`

Existing reconciliations were written before this field existed, so their `ReconciliationLoss` rows have no `(reason, sku)` pairs — they need a `POST .../recompute` to backfill. `finance-service` has no authorization of its own (per its `CLAUDE.md`: "Sem autorização própria — enforcement é do gateway"), and only the gateway container publishes a host port — so the simplest driver execs directly into `agiliz-finance-prod` and `agiliz-stores-prod`, both on the shared `agiliz_network`, bypassing the gateway/session-cookie layer entirely (no auth needed store→store on that internal network).

- [ ] **Step 1: Write the script**

```javascript
async function main() {
  const storesRes = await fetch('http://agiliz-stores-prod:3000/stores?status=active,maintenance,inactive');
  if (!storesRes.ok) throw new Error(`GET /stores failed: ${storesRes.status}`);
  const stores = await storesRes.json();

  let recomputed = 0;
  const failed = [];

  for (const store of stores) {
    const seriesRes = await fetch(`http://127.0.0.1:3000/finance/${store.id}`);
    if (!seriesRes.ok) {
      console.error(`GET /finance/${store.id} failed: ${seriesRes.status}`);
      continue;
    }
    const series = await seriesRes.json();
    const periods = series.map((r) => r.period);

    for (const period of periods) {
      const res = await fetch(`http://127.0.0.1:3000/finance/${store.id}/${period}/recompute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        recomputed++;
      } else {
        failed.push(`${store.id}/${period}: ${res.status}`);
      }
    }
  }

  console.log(`Recomputed ${recomputed} store-months.`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the live stack**

```bash
docker exec -i agiliz-finance-prod node < /tmp/claude-1000/-home-leandroaar-Projects-agilizai24h/c3d4f164-c3cd-494b-a861-9fa8816344c9/scratchpad/recompute-loss-by-reason-sku.js
```

Expected: `Recomputed N store-months.` with `N` roughly `24 stores × ~7 months`; an empty or short `Failed` list is fine (a store with zero reconciled months contributes zero, not a failure).

### Task A6: Live verify — confirm the new field is non-empty on real data

- [ ] **Step 1: Pick a store/month known to have loss** — e.g. store 46 (`Ascenty - JDI01`), period `2026-03` (the store/month the finance-service `CLAUDE.md`'s acceptance section already validated by hand).

- [ ] **Step 2: Check through the gateway** (this exercises the real path the frontend will use — session cookie + `finance:read`, not the bypass from A5)

Use the `chrome-devtools` MCP tools: navigate to `http://localhost:8080`, log in as `barbara@agiliz.ai` / `Pedro160911*`, then use `evaluate_script` (or open the network panel) to hit `GET http://localhost:3080/finance/46/2026-03` with `credentials: "include"` from the authenticated page context, or simply navigate the finance page for that store/month and inspect the network request/response.

Expected: the JSON response's `loss_by_reason_sku` array is non-empty and each entry sums correctly against `loss_by_reason`/`loss_by_sku` for the same reason/sku.

### Task A7: Commit

```bash
git add backend/apps/finance-service/src/modules/finance/utils/reconcile.ts \
        backend/apps/finance-service/src/modules/finance/utils/reconcile.spec.ts \
        backend/apps/finance-service/src/modules/finance/services/finance.service.ts \
        backend/apps/finance-service/src/modules/finance/dto/reconciliation.response.dto.ts
git commit -m "$(cat <<'EOF'
feat(finance): add loss_by_reason x SKU cross-tab

Adds a third loss breakdown alongside the existing by-reason and
by-SKU ones, reusing ReconciliationLoss's already-nullable reason/sku
columns (no migration). Existing reconciliations backfilled via a
one-off recompute pass over every store x already-ingested month.
EOF
)"
```

---

## Group B — Frontend: network finance types + `NetworkFinanceView` redesign

*(the user's steps 2+3+4, one commit — the biggest group: types, the monthly trend chart, the sortable stores table, the click-to-drill-down detail panel, the nested reason→SKU bars, and the unvalued-reason labels)*

### Task B1: `finance.ts` — mirror the backend's new field

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/finance.ts:17-55`

- [ ] **Step 1: Add the `LossByReasonSku` interface**

Right after the existing `LossBySku` interface (after line 27):

```typescript
export interface LossByReasonSku {
  reason: string;
  sku: string;
  quantity: number;
  value_cents: number;
}
```

- [ ] **Step 2: Add the field to `Reconciliation`**

Right after `loss_by_sku: LossBySku[];` (after line 52):

```typescript
  loss_by_reason_sku: LossByReasonSku[];
```

### Task B2: `reconciliation-aggregate.ts` — sum the third breakdown across a range

**Files:**
- Modify: `frontend/apps/admin/src/lib/reconciliation-aggregate.ts`

**Interfaces:**
- Consumes: `LossByReasonSku` from Task B1.
- Produces: `ReconciliationTotals.loss_by_reason_sku: LossByReasonSku[]` — consumed by Task B7 (`ReasonSkuBreakdown`).

- [ ] **Step 1: Import the new type**

Change line 1 from:

```typescript
import type { AdjustmentFlag, LossByReason, LossBySku, Reconciliation, UnvaluedSku } from "@/lib/api/finance";
```

to:

```typescript
import type { AdjustmentFlag, LossByReason, LossByReasonSku, LossBySku, Reconciliation, UnvaluedSku } from "@/lib/api/finance";
```

- [ ] **Step 2: Add the field to `ReconciliationTotals`**

Right after `loss_by_sku: LossBySku[];` (after line 22):

```typescript
  loss_by_reason_sku: LossByReasonSku[];
```

- [ ] **Step 3: Add a Map and accumulate it in the loop**

Add alongside the existing `lossBySku` Map declaration (after line 41):

```typescript
  const lossByReasonSku = new Map<string, LossByReasonSku>();
```

Inside the `for (const r of inRange)` loop, right after the existing `for (const entry of r.loss_by_sku) { ... }` block (after line 83):

```typescript
    for (const entry of r.loss_by_reason_sku) {
      const key = `${entry.reason}|${entry.sku}`;
      const existing = lossByReasonSku.get(key);
      if (existing) {
        existing.quantity += entry.quantity;
        existing.value_cents += entry.value_cents;
      } else {
        lossByReasonSku.set(key, { ...entry });
      }
    }
```

- [ ] **Step 4: Return it, sorted**

In the `return` statement, right after `loss_by_sku: [...lossBySku.values()]...` (after line 106):

```typescript
    loss_by_reason_sku: [...lossByReasonSku.values()].sort((a, b) => b.value_cents - a.value_cents),
```

### Task B3: `finance.ts` — network monthly trend from data already fetched

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/finance.ts`

**Interfaces:**
- Produces: `NetworkMonthlyTotal` type and `getNetworkReconciliationRange`'s new return shape `{ rows: NetworkReconciliationRangeRow[]; monthlyTotals: NetworkMonthlyTotal[] }` — consumed by Task B8 (`NetworkFinanceView`'s one caller) and B6 (`NetworkMonthlyTrendChart`).

- [ ] **Step 1: Import `monthsInRange`**

Change line 5 from:

```typescript
import type { PeriodRange } from "@/lib/period-range";
```

to:

```typescript
import { monthsInRange, type PeriodRange } from "@/lib/period-range";
```

- [ ] **Step 2: Add the `NetworkMonthlyTotal` type**

Right after `NetworkReconciliationRangeRow` (after line 61):

```typescript
/** One month's network-wide totals — from `getNetworkReconciliationRange`'s already-fetched per-store series, no extra request. */
export interface NetworkMonthlyTotal {
  period: string;
  restocked_value_cents: number;
  cogs_cents: number;
  loss_value_cents: number;
}
```

- [ ] **Step 3: Rewrite `getNetworkReconciliationRange`**

Replace the whole endpoint (current lines 80-92) with:

```typescript
    /**
     * The range version of `getNetworkReconciliations`: fetches each
     * store's *entire* series once (finance-service's series endpoint has
     * no period filter) and sums it down to the range client-side —
     * one request per store regardless of how many months the range
     * spans, rather than one request per store per month. `monthlyTotals`
     * is a second reduction over the same already-fetched data — no extra
     * network calls — for the network-wide monthly trend chart.
     */
    getNetworkReconciliationRange: builder.query<
      { rows: NetworkReconciliationRangeRow[]; monthlyTotals: NetworkMonthlyTotal[] },
      { stores: Store[]; range: PeriodRange }
    >({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const seriesByStore = await Promise.all(
          stores.map(async (store) => {
            const result = await fetchWithBQ(`/finance/${store.id}`);
            const series = (result.data as Reconciliation[] | undefined) ?? [];
            return { store, series };
          }),
        );

        const rows: NetworkReconciliationRangeRow[] = seriesByStore.map(({ store, series }) => ({
          store,
          totals: sumReconciliations(series, range),
        }));

        const months = monthsInRange(range);
        const monthlyTotals: NetworkMonthlyTotal[] = months.map((period) => {
          let restocked = 0;
          let cogs = 0;
          let loss = 0;
          for (const { series } of seriesByStore) {
            const match = series.find((r) => r.period === period);
            if (!match) continue;
            restocked += match.restocked_value_cents;
            cogs += match.cogs_cents;
            loss += match.loss_value_cents;
          }
          return { period, restocked_value_cents: restocked, cogs_cents: cogs, loss_value_cents: loss };
        });

        return { data: { rows, monthlyTotals } };
      },
      providesTags: ["Reconciliation"],
    }),
```

### Task B4: `unvalued-reasons.ts` — new label map

**Files:**
- Create: `frontend/apps/admin/src/lib/unvalued-reasons.ts`

Mirrors `removal-reasons.ts`'s shape exactly. The four codes (`unknown_sku`, `no_cost_for_date`, `ambiguous_name`, `unknown_name`) are confirmed against `products-contracts`'s `UNRESOLVED_COST_REASONS` — the frontend admin app has no dependency on backend nest-libs (it only talks HTTP to the gateway), so, like `removal-reasons.ts` does for `supply-service`'s reasons, this hand-restates the codes rather than importing cross-workspace.

- [ ] **Step 1: Write the file**

```typescript
/**
 * Display labels for the four unvalued-SKU reasons, matching
 * `products-contracts`'s `UNRESOLVED_COST_REASONS` (that table stays
 * authoritative for the classification itself — this is presentation only).
 */
export const UNVALUED_REASON_LABELS: Record<string, string> = {
  unknown_sku: "SKU desconhecido",
  no_cost_for_date: "Sem custo para a data",
  ambiguous_name: "Nome ambíguo",
  unknown_name: "Nome desconhecido",
};

export function unvaluedReasonLabel(key: string): string {
  return UNVALUED_REASON_LABELS[key] ?? key;
}
```

(Named `unvaluedReasonLabel`, not `reasonLabel`, to avoid colliding with `removal-reasons.ts`'s `reasonLabel` export when both are imported into the same file — Task B5 imports both.)

### Task B5: `finance/page.tsx` — `IncompleteBanner` renders the reason per SKU

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/finance/page.tsx:21` (import), `:106-108` (banner body)

- [ ] **Step 1: Import the new helper**

Change line 21 from:

```typescript
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";
```

to:

```typescript
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";
import { unvaluedReasonLabel } from "@/lib/unvalued-reasons";
```

- [ ] **Step 2: Replace the flat SKU list**

Change (current lines 106-108):

```tsx
        {totals.unvalued.length > 0 && (
          <p>{totals.unvalued.length} SKU(s) sem custo: {totals.unvalued.map((u) => u.sku).join(", ")}</p>
        )}
```

to:

```tsx
        {totals.unvalued.length > 0 && (
          <div>
            <p>{totals.unvalued.length} SKU(s) sem custo:</p>
            <ul className="ml-4 list-disc">
              {totals.unvalued.map((u, index) => (
                <li key={`${u.sku}-${index}`}>{`${u.sku} — ${unvaluedReasonLabel(u.reason)}`}</li>
              ))}
            </ul>
          </div>
        )}
```

(`key` includes `index` because `ReconciliationTotals.unvalued` is a plain concatenation across months in a range, per `reconciliation-aggregate.ts`'s `unvalued.push(...r.unvalued)` — the same SKU can legitimately appear more than once.)

### Task B6: `finance/page.tsx` — `NetworkMonthlyTrendChart` component (new)

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/finance/page.tsx` (imports at top, new component after `FinanceTrendChart`)

**Interfaces:**
- Consumes: `NetworkMonthlyTotal[]` from Task B3, `shrinkagePctOfCost`/`formatPct` (already imported in this file).
- Produces: `<NetworkMonthlyTrendChart monthlyTotals={...} />` — consumed by Task B8.

- [ ] **Step 1: Add `ComposedChart` to the recharts import**

Change line 5 from:

```typescript
import { CartesianGrid, Line, LineChart, Bar, BarChart, XAxis, YAxis } from "recharts";
```

to:

```typescript
import { CartesianGrid, ComposedChart, Line, LineChart, Bar, BarChart, XAxis, YAxis } from "recharts";
```

- [ ] **Step 2: Add the component**

Insert right after the existing `FinanceTrendChart` function (after line 95):

```tsx
const networkMonthlyTrendConfig: ChartConfig = {
  restocked_value_cents: { label: "Abastecido", color: "var(--chart-1)" },
  cogs_cents: { label: "CMV", color: "var(--chart-2)" },
  loss_pct: { label: "Perda %", color: "var(--destructive)" },
};

function NetworkMonthlyTrendChart({ monthlyTotals }: { monthlyTotals: NetworkMonthlyTotal[] }) {
  const data = monthlyTotals.map((m) => ({
    period: m.period,
    restocked_value_cents: m.restocked_value_cents / 100,
    cogs_cents: m.cogs_cents / 100,
    loss_pct: (shrinkagePctOfCost(m.loss_value_cents, m.restocked_value_cents) ?? 0) * 100,
  }));

  return (
    <ChartContainer config={networkMonthlyTrendConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          yAxisId="value"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => compactCurrency.format(value)}
        />
        <YAxis
          yAxisId="pct"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => `${value.toFixed(0)}%`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) =>
                name === "loss_pct" ? `${Number(value).toFixed(1)}%` : currency.format(Number(value))
              }
            />
          }
        />
        <Bar yAxisId="value" dataKey="restocked_value_cents" fill="var(--color-restocked_value_cents)" radius={4} />
        <Bar yAxisId="value" dataKey="cogs_cents" fill="var(--color-cogs_cents)" radius={4} />
        <Line yAxisId="pct" type="monotone" dataKey="loss_pct" stroke="var(--color-loss_pct)" strokeWidth={2} dot />
      </ComposedChart>
    </ChartContainer>
  );
}
```

Also add the `NetworkMonthlyTotal` type to the existing `finance.ts` import (line 14): change

```typescript
import { useGetNetworkReconciliationRangeQuery, useGetReconciliationSeriesQuery, type Reconciliation } from "@/lib/api/finance";
```

to:

```typescript
import {
  useGetNetworkReconciliationRangeQuery,
  useGetReconciliationSeriesQuery,
  type NetworkMonthlyTotal,
  type Reconciliation,
} from "@/lib/api/finance";
```

### Task B7: `finance/page.tsx` — `ReasonSkuBreakdown` component (new, the nested drill-down)

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/finance/page.tsx` (new component after `LossTables`)

**Interfaces:**
- Consumes: `ReconciliationTotals.loss_by_reason` / `.loss_by_reason_sku` (Task B2), `LOSS_COUNTING_REASONS`/`reasonLabel` (already imported), `currency` (already declared module-level).
- Produces: `<ReasonSkuBreakdown totals={...} nameBySku={...} />` — consumed by Task B8's detail panel.

This is the component the user specifically called out as needing to be new rather than table-based — the reference HTML's `motivosHtml`/`produtosSubHtml` pattern (bar sized by value relative to the largest in its group, nested sub-bars relative to the largest SKU within that reason), rebuilt with Tailwind divs and this app's tokens instead of the reference's hand-rolled CSS.

- [ ] **Step 1: Add the component**

Insert right after the existing `LossTables` function (after line 199):

```tsx
function ReasonSkuBreakdown({ totals, nameBySku }: { totals: ReconciliationTotals; nameBySku: Map<string, string> }) {
  const reasons = totals.loss_by_reason
    .filter((entry) => LOSS_COUNTING_REASONS.has(entry.reason))
    .sort((a, b) => b.value_cents - a.value_cents);

  if (reasons.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem perda registrada no período.</p>;
  }

  const maxReasonValue = Math.max(...reasons.map((r) => r.value_cents), 1);

  return (
    <div className="flex flex-col gap-4">
      {reasons.map((reason) => {
        const skus = totals.loss_by_reason_sku
          .filter((entry) => entry.reason === reason.reason)
          .sort((a, b) => b.value_cents - a.value_cents)
          .slice(0, 5);
        const maxSkuValue = Math.max(...skus.map((s) => s.value_cents), 1);
        const widthPct = Math.max(4, (reason.value_cents / maxReasonValue) * 100);

        return (
          <div key={reason.reason}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{reasonLabel(reason.reason)}</span>
              <span className="text-muted-foreground">
                {currency.format(reason.value_cents / 100)} · {reason.quantity} un.
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-destructive" style={{ width: `${widthPct}%` }} />
            </div>

            <div className="mt-2 ml-4 flex flex-col gap-1.5 border-l pl-3">
              {skus.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem produto identificado.</p>
              ) : (
                skus.map((sku) => {
                  const skuWidthPct = Math.max(4, (sku.value_cents / maxSkuValue) * 100);
                  return (
                    <div key={sku.sku}>
                      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                        <span className="max-w-[70%] truncate">{nameBySku.get(sku.sku) ?? sku.sku}</span>
                        <span>
                          {currency.format(sku.value_cents / 100)} · {sku.quantity} un.
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-muted-foreground/50" style={{ width: `${skuWidthPct}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### Task B8: `finance/page.tsx` — redesign `NetworkFinanceView`

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/finance/page.tsx:286-443` (the whole `NetworkFinanceView` function and its `comparisonConfig`/`comparisonData` support code)

**Interfaces:**
- Consumes: everything from B1-B7, plus `useGetStoresQuery`, `useGetNetworkSalesRangeQuery`, `useGetProductsQuery`, `IncompleteBanner`, `Figure`, `KpiCard` (all already imported/defined in this file).

This is the main deliverable: replaces the old "Receita e perda por loja" bar chart (which duplicated the new table's two series with no added precision) and the flat "Lojas com pendência" badge list with a monthly trend chart, a sortable stores table with an inline proportional Perda% bar, and a click-to-select detail panel below it.

- [ ] **Step 1: Add a module-level sort helper and type, right before `NetworkFinanceView`** (replacing the old `comparisonConfig`/`comparisonData`-only setup at lines 281-284):

```tsx
type NetworkSortKey = "store" | "revenue" | "restocked" | "cogs" | "remaining" | "loss" | "lossPct";

function sortValueFor(
  row: NetworkReconciliationRangeRow,
  revenueByStore: Map<number, number>,
  key: NetworkSortKey,
): number | string {
  switch (key) {
    case "store":
      return row.store.name;
    case "revenue":
      return revenueByStore.get(row.store.id) ?? 0;
    case "restocked":
      return row.totals.restocked_value_cents;
    case "cogs":
      return row.totals.cogs_cents;
    case "remaining":
      return row.totals.remaining_value_cents;
    case "loss":
      return row.totals.loss_value_cents;
    case "lossPct":
      return shrinkagePctOfCost(row.totals.loss_value_cents, row.totals.restocked_value_cents) ?? -1;
  }
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: NetworkSortKey;
  activeKey: NetworkSortKey;
  dir: "asc" | "desc";
  onSort: (key: NetworkSortKey) => void;
  className?: string;
}) {
  const isActive = sortKey === activeKey;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {isActive && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </TableHead>
  );
}
```

Note: `Reconciliation` needs `NetworkReconciliationRangeRow` in scope — it's already defined and exported from `finance.ts` and already imported nowhere in this file by name (it's only used as part of `NetworkFinanceView`'s internal types today). Add it to the existing `finance.ts` import (from Task B6's edit, extend further):

```typescript
import {
  useGetNetworkReconciliationRangeQuery,
  useGetReconciliationSeriesQuery,
  type NetworkMonthlyTotal,
  type NetworkReconciliationRangeRow,
  type Reconciliation,
} from "@/lib/api/finance";
```

- [ ] **Step 2: Add `NetworkStoreDetail`, right before `NetworkFinanceView`**:

```tsx
function NetworkStoreDetail({
  store,
  totals,
  nameBySku,
}: {
  store: Store;
  totals: ReconciliationTotals;
  nameBySku: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-medium">Detalhe da perda — {store.name}</h2>

      {!totals.complete && <IncompleteBanner totals={totals} subject="Reconciliação desta loja" />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label="Valor abastecido" cents={totals.restocked_value_cents} incomplete={!totals.complete} />
        <Figure label="CMV" cents={totals.cogs_cents} incomplete={!totals.complete} />
        <Figure label="Valor da sobra" cents={totals.remaining_value_cents} incomplete={!totals.complete} />
        <Figure label="Perda real" cents={totals.loss_value_cents} incomplete={!totals.complete} />
        <Figure
          label="Ajuste de inventário"
          cents={totals.unclassified_stock_adjustment_value_cents}
          incomplete={!totals.complete}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Perda por motivo — top produtos</h3>
        <ReasonSkuBreakdown totals={totals} nameBySku={nameBySku} />
      </div>
    </div>
  );
}
```

`Store` needs importing — add `import type { Store } from "@/lib/api/stores";` near the top imports (this file currently imports `useGetStoresQuery` from `"@/lib/api/stores"` at line 17 but not the `Store` type; change that line to `import { useGetStoresQuery, type Store } from "@/lib/api/stores";`).

- [ ] **Step 3: Replace the whole `NetworkFinanceView` function** (current lines 286-443, which includes the now-removed `comparisonConfig` at 281-284) with:

```tsx
function NetworkFinanceView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data, isLoading: loadingRows, error, refetch } = useGetNetworkReconciliationRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );
  const rows = data?.rows;
  const monthlyTotals = data?.monthlyTotals;
  const { data: salesRows } = useGetNetworkSalesRangeQuery({ stores: stores ?? [], range }, { skip: !stores });
  const { data: products } = useGetProductsQuery();

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<NetworkSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const revenueByStore = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of salesRows ?? []) map.set(row.storeId, row.totalRevenueCents);
    return map;
  }, [salesRows]);

  const rowsWithData = useMemo(() => (rows ?? []).filter((row) => row.totals.monthsWithData > 0), [rows]);

  const sortedRows = useMemo(() => {
    const withValue = rowsWithData.map((row) => ({ row, value: sortValueFor(row, revenueByStore, sortKey) }));
    withValue.sort((a, b) =>
      typeof a.value === "string" || typeof b.value === "string"
        ? String(a.value).localeCompare(String(b.value))
        : (a.value as number) - (b.value as number),
    );
    if (sortDir === "desc") withValue.reverse();
    return withValue.map((entry) => entry.row);
  }, [rowsWithData, revenueByStore, sortKey, sortDir]);

  // Default selection: the store with the highest loss% of restocked value
  // among stores with data — surfaces the worst automatically, the same
  // "clique numa loja ou eu escolho a pior" behavior as the reference.
  const defaultStoreId = useMemo(() => {
    if (rowsWithData.length === 0) return null;
    const worst = [...rowsWithData].sort((a, b) => {
      const pctA = shrinkagePctOfCost(a.totals.loss_value_cents, a.totals.restocked_value_cents) ?? -1;
      const pctB = shrinkagePctOfCost(b.totals.loss_value_cents, b.totals.restocked_value_cents) ?? -1;
      return pctB - pctA;
    })[0];
    return worst.store.id;
  }, [rowsWithData]);

  const activeStoreId =
    selectedStoreId !== null && rowsWithData.some((row) => row.store.id === selectedStoreId)
      ? selectedStoreId
      : defaultStoreId;
  const activeRow = rowsWithData.find((row) => row.store.id === activeStoreId) ?? null;

  function toggleSort(key: NetworkSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "store" ? "asc" : "desc");
    }
  }

  const networkTotals = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    return rows.reduce<{
      restocked_value_cents: number;
      cogs_cents: number;
      remaining_value_cents: number;
      loss_value_cents: number;
      unclassified_stock_adjustment_value_cents: number;
      complete: boolean;
      incompleteStores: { id: number; name: string }[];
      reconciledStores: number;
    }>(
      (acc, row) => {
        const hasData = row.totals.monthsWithData > 0;
        return {
          restocked_value_cents: acc.restocked_value_cents + row.totals.restocked_value_cents,
          cogs_cents: acc.cogs_cents + row.totals.cogs_cents,
          remaining_value_cents: acc.remaining_value_cents + row.totals.remaining_value_cents,
          loss_value_cents: acc.loss_value_cents + row.totals.loss_value_cents,
          unclassified_stock_adjustment_value_cents:
            acc.unclassified_stock_adjustment_value_cents + row.totals.unclassified_stock_adjustment_value_cents,
          complete: acc.complete && (!hasData || row.totals.complete),
          incompleteStores:
            hasData && !row.totals.complete ? [...acc.incompleteStores, { id: row.store.id, name: row.store.name }] : acc.incompleteStores,
          reconciledStores: acc.reconciledStores + (hasData ? 1 : 0),
        };
      },
      {
        restocked_value_cents: 0,
        cogs_cents: 0,
        remaining_value_cents: 0,
        loss_value_cents: 0,
        unclassified_stock_adjustment_value_cents: 0,
        complete: true,
        incompleteStores: [],
        reconciledStores: 0,
      },
    );
  }, [rows]);

  const networkRevenueCents = useMemo(
    () => (salesRows ?? []).reduce((sum, row) => sum + row.totalRevenueCents, 0),
    [salesRows],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && (networkTotals?.reconciledStores ?? 0) === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhuma loja foi reconciliada em nenhum mês do intervalo selecionado."
      onRetry={refetch}
    >
      {networkTotals && !isEmpty && (
        <div className="flex flex-col gap-6">
          {!networkTotals.complete && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Total da rede incompleto — {networkTotals.incompleteStores.length} loja(s) com pendência.
                </p>
                <p>Uma cifra que soma uma loja sem preço ou com saldo inconsistente não é uma cifra final.</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Figure label="Valor abastecido" cents={networkTotals.restocked_value_cents} incomplete={!networkTotals.complete} />
            <Figure label="CMV" cents={networkTotals.cogs_cents} incomplete={!networkTotals.complete} />
            <Figure label="Valor da sobra" cents={networkTotals.remaining_value_cents} incomplete={!networkTotals.complete} />
            <Figure label="Perda real" cents={networkTotals.loss_value_cents} incomplete={!networkTotals.complete} />
            <Figure
              label="Ajuste de inventário"
              cents={networkTotals.unclassified_stock_adjustment_value_cents}
              incomplete={!networkTotals.complete}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Indicadores da rede</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Receita líquida"
                value={currency.format(networkRevenueCents / 100)}
                hint={`${networkTotals.reconciledStores} loja(s) reconciliada(s)`}
              />
              <KpiCard label="Margem bruta" value={formatPct(grossMarginPct(networkRevenueCents, networkTotals.cogs_cents))} />
              <KpiCard
                label="Perda sobre receita"
                value={formatPct(shrinkagePctOfRevenue(networkTotals.loss_value_cents, networkRevenueCents))}
              />
              <KpiCard
                label="Perda sobre custo abastecido"
                value={formatPct(shrinkagePctOfCost(networkTotals.loss_value_cents, networkTotals.restocked_value_cents))}
              />
            </div>
          </div>

          {monthlyTotals && monthlyTotals.length > 1 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Evolução mensal da rede</h2>
              <NetworkMonthlyTrendChart monthlyTotals={monthlyTotals} />
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-medium">Lojas</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Loja" sortKey="store" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Receita" sortKey="revenue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                    <SortableHead label="Abastecido" sortKey="restocked" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                    <SortableHead label="CMV" sortKey="cogs" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                    <SortableHead label="Sobra" sortKey="remaining" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                    <SortableHead label="Perda" sortKey="loss" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                    <SortableHead label="Perda %" sortKey="lossPct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map(({ store, totals }) => {
                    const lossPct = shrinkagePctOfCost(totals.loss_value_cents, totals.restocked_value_cents);
                    const barPct = Math.min((lossPct ?? 0) / 0.2, 1) * 100;
                    return (
                      <TableRow
                        key={store.id}
                        data-state={store.id === activeStoreId ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => setSelectedStoreId(store.id)}
                      >
                        <TableCell className="font-medium">{store.name}</TableCell>
                        <TableCell className="text-right">{currency.format((revenueByStore.get(store.id) ?? 0) / 100)}</TableCell>
                        <TableCell className="text-right">{currency.format(totals.restocked_value_cents / 100)}</TableCell>
                        <TableCell className="text-right">{currency.format(totals.cogs_cents / 100)}</TableCell>
                        <TableCell className="text-right">{currency.format(totals.remaining_value_cents / 100)}</TableCell>
                        <TableCell className="text-right">{currency.format(totals.loss_value_cents / 100)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-destructive"
                                style={{ width: `${barPct}%`, opacity: 0.3 + 0.7 * (barPct / 100) }}
                              />
                            </div>
                            {formatPct(lossPct)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {totals.complete ? (
                            <Badge variant="secondary">Completo</Badge>
                          ) : (
                            <Badge className="border border-warning/30 bg-warning/15 text-warning">Pendente</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {activeRow && <NetworkStoreDetail store={activeRow.store} totals={activeRow.totals} nameBySku={nameBySku} />}
        </div>
      )}
    </RequestState>
  );
}
```

This removes the old `comparisonConfig`/`comparisonData` bar chart and the "Lojas com pendência" badge block entirely — both are superseded by the table (situação column) and detail panel (pendências via `IncompleteBanner`).

- [ ] **Step 4: Sanity-check the diff removed, not duplicated, the old chart code** — `grep -n "comparisonConfig\|comparisonData" frontend/apps/admin/src/app/\(app\)/finance/page.tsx` should return nothing.

### Task B9: Verify build

```bash
pnpm turbo run lint typecheck build --filter=@agiliz/admin
```

Expected: all pass. Pay attention to unused-import lint errors if any of the old chart-only imports (none currently exclusive to the removed code — `BarChart`/`Bar`/`XAxis`/`YAxis`/`CartesianGrid` are still used by `FinanceTrendChart` and the new `NetworkMonthlyTrendChart`) become orphaned.

### Task B10: Rebuild, redeploy, live-verify

- [ ] **Step 1:** `cli/agiliz-cli up -i admin --production`
- [ ] **Step 2:** Using the `chrome-devtools` MCP tools: navigate to `http://localhost:8080`, log in (`barbara@agiliz.ai` / `Pedro160911*`), go to **Financeiro**, select **Rede (todas as lojas)**.
- [ ] **Step 3:** Confirm: the monthly trend chart renders with a visible Perda% line (right axis) alongside the Abastecido/CMV bars; the stores table renders sorted by Receita desc by default; clicking a column header re-sorts; clicking a table row updates the detail panel below (KPI figures for that store + "Perda por motivo — top produtos" with proportional nested bars); the default-selected store on first load is the one with the worst loss % (cross-check against the table's own Perda % column).
- [ ] **Step 4:** Take a screenshot (`take_screenshot`) of the redesigned view for the record.

### Task B11: Commit

```bash
git add frontend/apps/admin/src/lib/api/finance.ts \
        frontend/apps/admin/src/lib/reconciliation-aggregate.ts \
        frontend/apps/admin/src/lib/unvalued-reasons.ts \
        frontend/apps/admin/src/app/\(app\)/finance/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): sortable network stores table with loss drill-down

Redesigns NetworkFinanceView: a network-wide monthly trend chart
(bars + loss% line), a sortable per-store table with an inline
proportional loss% bar, and a click-to-drill-down detail panel with
a nested reason -> top-SKU bar breakdown. Replaces the old bar chart
and flat pending-stores badge list, which the table now supersedes.
EOF
)"
```

---

## Group C — Frontend: network filter on sales/supply/inventory

*(the user's step 5, one commit — mechanically extends the `Store*View`/`Network*View` split already established by `finance/page.tsx` onto the other three domains)*

### Task C1: `store-period-picker.tsx` — fix the stale doc comment

**Files:**
- Modify: `frontend/apps/admin/src/components/store-period-picker.tsx:11-18`

`GET /finance/rollup?period=` does still exist (confirmed live in both `finance.controller.ts` and the gateway's `finance.controller.ts`) — but it only totals a single period, never a range, and the frontend doesn't call it at all; the real network mechanism is the per-store fan-out this group is about to replicate three more times. The comment needs to describe that, not a "removed endpoint."

- [ ] **Step 1: Replace the doc comment**

```typescript
/**
 * Every real per-store screen (sales, supply, inventory, finance) reads one
 * store's data for a *range* of months — none of the four has a real
 * "every store at once, over a range" endpoint. finance-service's
 * `GET /finance/rollup?period=` totals the network for a single month, not
 * a range, so it isn't used here either: every `allowNetwork` screen fans
 * out one request per store (finance: one call per store, its full series;
 * sales/supply/inventory: one call per store per month) and sums
 * client-side (`getNetworkReconciliationRange`, `getNetworkSalesRange`,
 * `getNetworkSupplyRange`, `getNetworkStockRange`). `allowNetwork` surfaces
 * the "Rede (todas as lojas)" choice that resolves to `NETWORK` rather than
 * a store id.
 */
```

### Task C2: `supply.ts` — extract `sumSupply` + add `getNetworkSupplyRange`

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/supply.ts`

**Interfaces:**
- Produces: `useGetNetworkSupplyRangeQuery({ stores, range }) => SupplyRangeResult[]` — consumed by Task C5.

- [ ] **Step 1: Import `Store`**

Change line 5 from:

```typescript
import type { PeriodRange } from "@/lib/period-range";
```

to:

```typescript
import type { PeriodRange } from "@/lib/period-range";
import type { Store } from "./stores";
```

- [ ] **Step 2: Extract the summing logic (current lines 66-92, inlined in `getSupplyRange`'s `queryFn`) into a standalone function**, placed right before `export const supplyApi = ...`:

```typescript
function sumSupply(storeId: number, range: PeriodRange, perMonth: (SupplyPeriod | undefined)[], months: string[]): SupplyRangeResult {
  const restocksBySku = new Map<string, RestockRow>();
  const removalsByKey = new Map<string, RemovalRow>();
  const adjustmentsBySku = new Map<string, AdjustmentRow>();
  const monthsWithNoData: string[] = [];

  perMonth.forEach((period, index) => {
    if (!period) {
      monthsWithNoData.push(months[index]);
      return;
    }
    for (const row of period.restocks) {
      const existing = restocksBySku.get(row.sku);
      if (existing) existing.quantity_restocked += row.quantity_restocked;
      else restocksBySku.set(row.sku, { ...row });
    }
    for (const row of period.removals) {
      const key = `${row.sku}:${row.reason}`;
      const existing = removalsByKey.get(key);
      if (existing) existing.quantity_removed += row.quantity_removed;
      else removalsByKey.set(key, { ...row });
    }
    for (const row of period.adjustments) {
      const existing = adjustmentsBySku.get(row.sku);
      if (existing) existing.quantity += row.quantity;
      else adjustmentsBySku.set(row.sku, { ...row });
    }
  });

  return {
    storeId,
    range,
    restocks: [...restocksBySku.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    removals: [...removalsByKey.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    adjustments: [...adjustmentsBySku.values()].filter((row) => row.quantity !== 0).sort((a, b) => a.sku.localeCompare(b.sku)),
    monthsWithNoData,
  };
}
```

- [ ] **Step 3: Rewrite `getSupplyRange` to call it, and add `getNetworkSupplyRange`**

Replace the whole `endpoints: (builder) => ({ ... })` body with:

```typescript
  endpoints: (builder) => ({
    /**
     * Sums a store's restocks/removals/adjustments across every month in
     * the range. Each month is its own request (supply-service has no
     * range query) — a month with no ingested data 404s and is recorded in
     * `monthsWithNoData` rather than silently contributing a zero. Any
     * *other* failure (403, 500, unreachable) fails the whole query.
     */
    getSupplyRange: builder.query<SupplyRangeResult, { storeId: number; range: PeriodRange }>({
      async queryFn({ storeId, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perMonth = await Promise.all(
          months.map((period) => fetchOr404<SupplyPeriod>(fetchWithBQ, `/supply/${storeId}?period=${encodeURIComponent(period)}`)),
        );
        const error = firstError(perMonth);
        if (error) return { error };
        return { data: sumSupply(storeId, range, perMonth.map((r) => r.data), months) };
      },
    }),
    /** No network-wide supply endpoint exists — sums each store's range client-side, same fan-out shape as sales/finance. */
    getNetworkSupplyRange: builder.query<SupplyRangeResult[], { stores: Store[]; range: PeriodRange }>({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perStorePerMonth = await Promise.all(
          stores.map((store) =>
            Promise.all(months.map((period) => fetchOr404<SupplyPeriod>(fetchWithBQ, `/supply/${store.id}?period=${encodeURIComponent(period)}`))),
          ),
        );
        const error = firstError(perStorePerMonth.flat());
        if (error) return { error };
        const rows = stores.map((store, index) => sumSupply(store.id, range, perStorePerMonth[index].map((r) => r.data), months));
        return { data: rows };
      },
    }),
  }),
});

export const { useGetSupplyRangeQuery, useGetNetworkSupplyRangeQuery } = supplyApi;
```

(Note the final `export const` line replaces the file's old one — don't duplicate it.)

### Task C3: `inventory.ts` — extract `sumStock` + add `getNetworkStockRange`

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/inventory.ts`

**Interfaces:**
- Produces: `useGetNetworkStockRangeQuery({ stores, range }) => StockRangeResult[]` — consumed by Task C6.

- [ ] **Step 1: Import `Store`**

Change line 5 (`import type { PeriodRange } from "@/lib/period-range";`) to add a second import line right after it: `import type { Store } from "./stores";`.

- [ ] **Step 2: Extract the summing/snapshot logic (current lines 68-94) into a standalone function**, placed right before `export const inventoryApi = ...`:

```typescript
function sumStock(storeId: number, range: PeriodRange, perMonth: (StoreStock | undefined)[]): StockRangeResult {
  const movementBySku = new Map<string, { restocked: number; sold: number; removed: number; adjustment: number }>();
  for (const month of perMonth) {
    if (!month) continue;
    for (const item of month.items) {
      const existing = movementBySku.get(item.sku) ?? { restocked: 0, sold: 0, removed: 0, adjustment: 0 };
      existing.restocked += item.restocked;
      existing.sold += item.sold;
      existing.removed += item.removed;
      existing.adjustment += item.adjustment;
      movementBySku.set(item.sku, existing);
    }
  }

  // The snapshot (closing balance, inconsistency, minimums) as of the end
  // of the range — the last month that actually returned data, since a
  // trailing month with nothing ingested yet is undefined here.
  const lastKnown = [...perMonth].reverse().find((month) => month !== undefined);
  const items: StockItem[] = (lastKnown?.items ?? []).map((item) => {
    const movement = movementBySku.get(item.sku);
    return {
      ...item,
      restocked: movement?.restocked ?? 0,
      sold: movement?.sold ?? 0,
      removed: movement?.removed ?? 0,
      adjustment: movement?.adjustment ?? 0,
    };
  });

  return { storeId, range, items, has_inconsistencies: items.some((item) => item.inconsistent) };
}
```

- [ ] **Step 3: Rewrite `getStockRange` to call it, and add `getNetworkStockRange`**

Replace the `endpoints: (builder) => ({ ... })` body with:

```typescript
  endpoints: (builder) => ({
    /**
     * `/inventory/:storeId?period=` already collapses to "the latest
     * snapshot at or before that period" server-side, so it only ever
     * reports one month's own movements — not summed across a range. This
     * queries every month in the range to sum restocked/sold/removed/
     * adjustment, while taking closing_stock/inconsistent/
     * recorded_closing_balance from the range's last month only. A month
     * with nothing ingested 404s and contributes nothing; any *other*
     * failure fails the whole query.
     */
    getStockRange: builder.query<StockRangeResult, { storeId: number; range: PeriodRange }>({
      async queryFn({ storeId, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perMonth = await Promise.all(
          months.map((period) => fetchOr404<StoreStock>(fetchWithBQ, `/inventory/${storeId}?period=${encodeURIComponent(period)}`)),
        );
        const error = firstError(perMonth);
        if (error) return { error };
        return { data: sumStock(storeId, range, perMonth.map((r) => r.data)) };
      },
      providesTags: ["Minimum"],
    }),
    /** No network-wide inventory endpoint exists — sums+snapshots each store's range client-side, same shape as sales/supply/finance. */
    getNetworkStockRange: builder.query<StockRangeResult[], { stores: Store[]; range: PeriodRange }>({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perStorePerMonth = await Promise.all(
          stores.map((store) =>
            Promise.all(months.map((period) => fetchOr404<StoreStock>(fetchWithBQ, `/inventory/${store.id}?period=${encodeURIComponent(period)}`))),
          ),
        );
        const error = firstError(perStorePerMonth.flat());
        if (error) return { error };
        const rows = stores.map((store, index) => sumStock(store.id, range, perStorePerMonth[index].map((r) => r.data)));
        return { data: rows };
      },
      providesTags: ["Minimum"],
    }),
    setMinimum: builder.mutation<unknown, { storeId: number; sku: string; minimum: number }>({
      query: ({ storeId, sku, minimum }) => ({
        url: `/inventory/${storeId}/${encodeURIComponent(sku)}/minimum`,
        method: "PUT",
        body: { minimum },
      }),
      invalidatesTags: ["Minimum"],
    }),
  }),
});

export const { useGetStockRangeQuery, useGetNetworkStockRangeQuery, useSetMinimumMutation } = inventoryApi;
```

### Task C4: `sales/page.tsx` — `StoreSalesView` extraction + `NetworkSalesView` + wiring

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/sales/page.tsx` (full rewrite of the file's structure, same content reorganized)

**Interfaces:**
- Consumes: `useGetNetworkSalesRangeQuery` (already exists in `sales.ts`, unused until now), `NETWORK`/`StoreSelection` from `store-period-picker.tsx`.

- [ ] **Step 1: Replace the whole file** with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Bar, BarChart, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesRangeQuery, useGetSalesRangeQuery } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import { defaultRange, type PeriodRange } from "@/lib/period-range";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function useNameBySku() {
  const { data: products } = useGetProductsQuery();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);
}

function StoreSalesView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const [search, setSearch] = useState("");
  const nameBySku = useNameBySku();
  const { data: result, isLoading, error, refetch } = useGetSalesRangeQuery({ storeId, range });

  const noDataAtAll = result && result.bySku.length === 0;

  const filtered = useMemo(() => {
    if (!result) return [];
    const term = search.toLowerCase();
    return result.bySku.filter(
      (row) => row.sku.toLowerCase().includes(term) || (nameBySku.get(row.sku) ?? "").toLowerCase().includes(term),
    );
  }, [result, search, nameBySku]);

  return (
    <>
      {result && result.monthsWithNoData.length > 0 && (
        <p className="text-xs text-muted-foreground">Sem venda importada para: {result.monthsWithNoData.join(", ")}.</p>
      )}

      {result && !noDataAtAll && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Unidades vendidas</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{result.totalQuantitySold}</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Receita</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{currency.format(result.totalRevenueCents / 100)}</CardContent>
          </Card>
        </div>
      )}

      <Input
        placeholder="Buscar por nome ou SKU..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="sm:max-w-xs"
      />

      <div className="rounded-lg border">
        <RequestState
          isLoading={isLoading}
          error={error}
          isEmpty={noDataAtAll || filtered.length === 0}
          emptyMessage={noDataAtAll ? "Nenhuma venda foi importada para esta loja no período selecionado." : "Nenhuma venda encontrada."}
          onRetry={refetch}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd. vendida</TableHead>
                <TableHead className="text-right">Receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.sku}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                  <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                  <TableCell className="text-right">{row.quantity_sold}</TableCell>
                  <TableCell className="text-right">{currency.format(row.revenue_cents / 100)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </div>
    </>
  );
}

const salesComparisonConfig: ChartConfig = { revenue: { label: "Receita", color: "var(--chart-1)" } };

function NetworkSalesView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rows, isLoading: loadingRows, error, refetch } = useGetNetworkSalesRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );
  const nameBySku = useNameBySku();

  const rowsWithData = useMemo(() => (rows ?? []).filter((row) => row.bySku.length > 0), [rows]);

  const totals = useMemo(
    () =>
      rowsWithData.reduce(
        (acc, row) => ({
          totalQuantitySold: acc.totalQuantitySold + row.totalQuantitySold,
          totalRevenueCents: acc.totalRevenueCents + row.totalRevenueCents,
        }),
        { totalQuantitySold: 0, totalRevenueCents: 0 },
      ),
    [rowsWithData],
  );

  const bySkuNetwork = useMemo(() => {
    const map = new Map<string, { sku: string; quantity_sold: number; revenue_cents: number }>();
    for (const row of rowsWithData) {
      for (const item of row.bySku) {
        const existing = map.get(item.sku);
        if (existing) {
          existing.quantity_sold += item.quantity_sold;
          existing.revenue_cents += item.revenue_cents;
        } else {
          map.set(item.sku, { sku: item.sku, quantity_sold: item.quantity_sold, revenue_cents: item.revenue_cents });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.revenue_cents - a.revenue_cents);
  }, [rowsWithData]);

  const chartData = useMemo(
    () =>
      rowsWithData
        .map((row) => {
          const store = (stores ?? []).find((s) => s.id === row.storeId);
          return { store: store?.name ?? String(row.storeId), revenue: row.totalRevenueCents / 100 };
        })
        .sort((a, b) => b.revenue - a.revenue),
    [rowsWithData, stores],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && rowsWithData.length === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhuma venda foi importada em nenhuma loja no período selecionado."
      onRetry={refetch}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Unidades vendidas</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{totals.totalQuantitySold}</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Receita</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{currency.format(totals.totalRevenueCents / 100)}</CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Receita por loja</h2>
          <ChartContainer config={salesComparisonConfig} className="h-80 w-full">
            <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={80} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value: number) => currency.format(value)} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
            </BarChart>
          </ChartContainer>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Top produtos na rede</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd. vendida</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySkuNetwork.slice(0, 20).map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell className="text-right">{row.quantity_sold}</TableCell>
                    <TableCell className="text-right">{currency.format(row.revenue_cents / 100)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </RequestState>
  );
}

export default function SalesPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Vendas" description="Quantidade vendida e receita por SKU, por loja e período." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver as vendas do período.
        </p>
      ) : storeId === NETWORK ? (
        <NetworkSalesView range={range} />
      ) : (
        <StoreSalesView storeId={storeId} range={range} />
      )}
    </div>
  );
}
```

(`useNameBySku` is a tiny local hook factored out because both `StoreSalesView` and `NetworkSalesView` need the identical products→name map — a two-line extraction, not a new abstraction layer.)

### Task C5: `supply/page.tsx` — `StoreSupplyView` extraction + `NetworkSupplyView` + wiring

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/supply/page.tsx` (full rewrite, same reorganization pattern as C4)

- [ ] **Step 1: Replace the whole file** with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Bar, BarChart, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSupplyRangeQuery, useGetSupplyRangeQuery } from "@/lib/api/supply";
import { useGetStoresQuery } from "@/lib/api/stores";
import { defaultRange, type PeriodRange } from "@/lib/period-range";
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";

function StoreSupplyView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const { data, isLoading, error, refetch } = useGetSupplyRangeQuery({ storeId, range });

  const isEmpty = !data || (data.restocks.length === 0 && data.removals.length === 0 && data.adjustments.length === 0);

  return (
    <RequestState
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Sem movimentos de abastecimento no período selecionado."
      onRetry={refetch}
    >
      {data && data.monthsWithNoData.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">Sem abastecimento importado para: {data.monthsWithNoData.join(", ")}.</p>
      )}
      <Tabs defaultValue="restocks">
        <TabsList>
          <TabsTrigger value="restocks">Abastecido ({data?.restocks.length ?? 0})</TabsTrigger>
          <TabsTrigger value="removals">Remoções ({data?.removals.length ?? 0})</TabsTrigger>
          <TabsTrigger value="adjustments">Ajustes ({data?.adjustments.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="restocks">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd. abastecida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.restocks.map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell className="text-right">{row.quantity_restocked}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="removals">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Conta como perda?</TableHead>
                  <TableHead className="text-right">Qtd. removida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.removals.map((row, index) => (
                  <TableRow key={`${row.sku}-${row.reason}-${index}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell>{row.reason_label}</TableCell>
                    <TableCell>
                      {row.counts_as_loss ? (
                        <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Sim</Badge>
                      ) : (
                        <Badge variant="secondary">Não</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{row.quantity_removed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="adjustments">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Ajuste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.adjustments.map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell className={`text-right ${row.quantity < 0 ? "text-destructive" : ""}`}>
                      {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </RequestState>
  );
}

const supplyComparisonConfig: ChartConfig = { restocked: { label: "Abastecido (qtd.)", color: "var(--chart-1)" } };

function NetworkSupplyView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rows, isLoading: loadingRows, error, refetch } = useGetNetworkSupplyRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );

  const rowsWithData = useMemo(
    () => (rows ?? []).filter((row) => row.restocks.length > 0 || row.removals.length > 0 || row.adjustments.length > 0),
    [rows],
  );

  const totals = useMemo(() => {
    let restocked = 0;
    let removedLoss = 0;
    for (const row of rowsWithData) {
      restocked += row.restocks.reduce((sum, r) => sum + r.quantity_restocked, 0);
      removedLoss += row.removals
        .filter((r) => LOSS_COUNTING_REASONS.has(r.reason))
        .reduce((sum, r) => sum + r.quantity_removed, 0);
    }
    return { restocked, removedLoss };
  }, [rowsWithData]);

  const byReasonNetwork = useMemo(() => {
    const map = new Map<string, { reason: string; quantity: number }>();
    for (const row of rowsWithData) {
      for (const removal of row.removals) {
        const existing = map.get(removal.reason);
        if (existing) existing.quantity += removal.quantity_removed;
        else map.set(removal.reason, { reason: removal.reason, quantity: removal.quantity_removed });
      }
    }
    return [...map.values()].sort((a, b) => b.quantity - a.quantity);
  }, [rowsWithData]);

  const chartData = useMemo(
    () =>
      rowsWithData
        .map((row) => {
          const store = (stores ?? []).find((s) => s.id === row.storeId);
          return { store: store?.name ?? String(row.storeId), restocked: row.restocks.reduce((sum, r) => sum + r.quantity_restocked, 0) };
        })
        .sort((a, b) => b.restocked - a.restocked),
    [rowsWithData, stores],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && rowsWithData.length === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhum movimento de abastecimento foi importado em nenhuma loja no período selecionado."
      onRetry={refetch}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Total abastecido (rede)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{totals.restocked} un.</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Total removido por perda (rede)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{totals.removedLoss} un.</CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Abastecido por loja</h2>
          <ChartContainer config={supplyComparisonConfig} className="h-80 w-full">
            <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={80} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="restocked" fill="var(--color-restocked)" radius={4} />
            </BarChart>
          </ChartContainer>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Remoções por motivo — rede</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Qtd. removida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byReasonNetwork.map((entry) => (
                  <TableRow key={entry.reason}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {reasonLabel(entry.reason)}
                        {LOSS_COUNTING_REASONS.has(entry.reason) && (
                          <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Perda</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{entry.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </RequestState>
  );
}

export default function SupplyPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Abastecimento" description="Reposição, remoções e ajustes de estoque, por loja e período." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver o abastecimento do período.
        </p>
      ) : storeId === NETWORK ? (
        <NetworkSupplyView range={range} />
      ) : (
        <StoreSupplyView storeId={storeId} range={range} />
      )}
    </div>
  );
}
```

### Task C6: `inventory/page.tsx` — `StoreInventoryView` extraction + `NetworkInventoryView` (table only) + wiring

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/inventory/page.tsx` (full rewrite, same reorganization pattern)

- [ ] **Step 1: Replace the whole file** with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkStockRangeQuery, useGetStockRangeQuery } from "@/lib/api/inventory";
import { useGetStoresQuery } from "@/lib/api/stores";
import { defaultRange, type PeriodRange } from "@/lib/period-range";

function StoreInventoryView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const [search, setSearch] = useState("");
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const { data: stock, isLoading, error, refetch } = useGetStockRangeQuery({ storeId, range });

  const filtered = useMemo(() => {
    if (!stock) return [];
    const term = search.toLowerCase();
    return stock.items.filter(
      (item) => item.sku.toLowerCase().includes(term) || (nameBySku.get(item.sku) ?? "").toLowerCase().includes(term),
    );
  }, [stock, search, nameBySku]);

  return (
    <>
      {stock?.has_inconsistencies && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          Um ou mais SKUs têm saldo negativo — dado de movimento inconsistente. Veja os itens marcados abaixo.
        </div>
      )}

      <Input
        placeholder="Buscar por nome ou SKU..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="sm:max-w-xs"
      />

      <div className="rounded-lg border">
        <RequestState
          isLoading={isLoading}
          error={error}
          isEmpty={filtered.length === 0}
          emptyMessage="Nenhum item encontrado no período selecionado."
          onRetry={refetch}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Abastecido</TableHead>
                <TableHead className="text-right">Vendido</TableHead>
                <TableHead className="text-right">Removido</TableHead>
                <TableHead className="text-right">Ajuste</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.sku}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                  <TableCell className="font-medium">{nameBySku.get(item.sku) ?? item.sku}</TableCell>
                  <TableCell className="text-right">{item.restocked}</TableCell>
                  <TableCell className="text-right">{item.sold}</TableCell>
                  <TableCell className="text-right">{item.removed}</TableCell>
                  <TableCell className="text-right">{item.adjustment}</TableCell>
                  <TableCell className={`text-right font-medium ${item.inconsistent ? "text-destructive" : ""}`}>
                    {item.closing_stock}
                  </TableCell>
                  <TableCell>
                    {item.inconsistent ? (
                      <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Inconsistente</Badge>
                    ) : item.below_minimum ? (
                      <Badge className="border border-warning/30 bg-warning/15 text-warning">Abaixo do mínimo</Badge>
                    ) : (
                      <Badge variant="secondary">Normal</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </div>
    </>
  );
}

function NetworkInventoryView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rows, isLoading: loadingRows, error, refetch } = useGetNetworkStockRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );

  const rowsWithData = useMemo(() => (rows ?? []).filter((row) => row.items.length > 0), [rows]);

  const tableRows = useMemo(
    () =>
      rowsWithData
        .map((row) => {
          const store = (stores ?? []).find((s) => s.id === row.storeId);
          return {
            storeId: row.storeId,
            storeName: store?.name ?? String(row.storeId),
            itemCount: row.items.length,
            inconsistentCount: row.items.filter((item) => item.inconsistent).length,
            belowMinimumCount: row.items.filter((item) => item.below_minimum).length,
          };
        })
        .sort((a, b) => b.inconsistentCount - a.inconsistentCount || b.belowMinimumCount - a.belowMinimumCount),
    [rowsWithData, stores],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && rowsWithData.length === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhum estoque foi calculado em nenhuma loja no período selecionado."
      onRetry={refetch}
    >
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead className="text-right">SKUs</TableHead>
              <TableHead className="text-right">Inconsistentes</TableHead>
              <TableHead className="text-right">Abaixo do mínimo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableRows.map((row) => (
              <TableRow key={row.storeId}>
                <TableCell className="font-medium">{row.storeName}</TableCell>
                <TableCell className="text-right">{row.itemCount}</TableCell>
                <TableCell className="text-right">
                  {row.inconsistentCount > 0 ? (
                    <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">{row.inconsistentCount}</Badge>
                  ) : (
                    row.inconsistentCount
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.belowMinimumCount > 0 ? (
                    <Badge className="border border-warning/30 bg-warning/15 text-warning">{row.belowMinimumCount}</Badge>
                  ) : (
                    row.belowMinimumCount
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </RequestState>
  );
}

export default function InventoryPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Estoque"
        description="Saldo derivado dos movimentos registrados, por loja e SKU — saldo ao final do período."
      />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver o estoque.</p>
      ) : storeId === NETWORK ? (
        <NetworkInventoryView range={range} />
      ) : (
        <StoreInventoryView storeId={storeId} range={range} />
      )}
    </div>
  );
}
```

### Task C7: Verify build

```bash
pnpm turbo run lint typecheck build --filter=@agiliz/admin
```

### Task C8: Rebuild, redeploy, live-verify

- [ ] **Step 1:** `cli/agiliz-cli up -i admin --production`
- [ ] **Step 2:** Via `chrome-devtools` MCP tools, for each of **Vendas**, **Abastecimento**, **Estoque**: select a single store first (confirm unchanged single-store behavior still works), then switch to **Rede (todas as lojas)** and confirm real aggregated numbers render (KPI cards non-zero, bar chart renders per-store bars, table renders — removals-by-reason for supply, top-SKU for sales, inconsistent/below-minimum counts for inventory).
- [ ] **Step 3:** Screenshot each of the three network views for the record.

### Task C9: Commit

```bash
git add frontend/apps/admin/src/components/store-period-picker.tsx \
        frontend/apps/admin/src/lib/api/supply.ts \
        frontend/apps/admin/src/lib/api/inventory.ts \
        frontend/apps/admin/src/app/\(app\)/sales/page.tsx \
        frontend/apps/admin/src/app/\(app\)/supply/page.tsx \
        frontend/apps/admin/src/app/\(app\)/inventory/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): network option for sales/supply/inventory

Extends the "Rede (todas as lojas)" pattern already used by finance
to the other three per-store screens, splitting each into Store*View/
Network*View like finance/page.tsx already does. supply.ts/
inventory.ts gain sumSupply/sumStock helpers (extracted from their
single-store queryFn) and getNetworkSupplyRange/getNetworkStockRange
fan-outs, mirroring sales.ts's existing getNetworkSalesRange.
EOF
)"
```

---

## Group D — Ingestion upload UI + history

*(the user's step 6, one commit — pure frontend, the backend already exists and is proxied)*

### Task D1: `ingestion.ts` — new RTK Query API slice

**Files:**
- Create: `frontend/apps/admin/src/lib/api/ingestion.ts`

**Interfaces:**
- Produces: `useListIngestionsQuery`, `useGetIngestionQuery`, `useUploadIngestionMutation` — consumed by Task D3.

The critical, non-obvious detail here (confirmed by research against `@fastify/multipart`'s own docs and the gateway controller's code): the gateway reads `request.file()`'s `.fields` **synchronously before** consuming the file stream, so `file_type`/`store_id`/`period` must be appended to the `FormData` **before** the file part, or they read as `undefined` server-side and the upload 400s even though the same `FormData` eventually contains the right values.

- [ ] **Step 1: Write the file**

```typescript
import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const INGESTION_FILE_TYPES = ["sales", "supply", "cost"] as const;
export type IngestionFileType = (typeof INGESTION_FILE_TYPES)[number];

export const INGESTION_STATUSES = ["accepted", "processing", "completed", "partially_completed", "failed"] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export interface Ingestion {
  id: string;
  file_type: IngestionFileType;
  object_key: string;
  original_name: string;
  store_id: number | null;
  period: string;
  status: IngestionStatus;
  error: string | null;
  expected_chunks: number;
  processed_chunks: number;
  accepted_rows: number;
  rejected_rows: number;
  correlation_id: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface IngestionRejection {
  id: number;
  ingestion_id: string;
  row_reference: string;
  reason: string;
  detail: string;
  created_at: string;
}

export interface IngestionDetail extends Ingestion {
  rejections: IngestionRejection[];
}

export interface UploadIngestionArgs {
  file: File;
  file_type: IngestionFileType;
  /** Omit entirely for file_type "supply" — one restocking workbook covers the whole network. */
  store_id?: number;
  period: string;
}

export const ingestionApi = createApi({
  reducerPath: "ingestionApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Ingestion"],
  endpoints: (builder) => ({
    listIngestions: builder.query<Ingestion[], { limit?: number } | void>({
      query: (args) => `/ingestions${args?.limit ? `?limit=${args.limit}` : ""}`,
      providesTags: ["Ingestion"],
    }),
    getIngestion: builder.query<IngestionDetail, string>({
      query: (id) => `/ingestions/${encodeURIComponent(id)}`,
      providesTags: ["Ingestion"],
    }),
    uploadIngestion: builder.mutation<Ingestion, UploadIngestionArgs>({
      query: ({ file, file_type, store_id, period }) => {
        // Field order matters: the gateway reads request.file()'s fields
        // synchronously before consuming the file stream (@fastify/
        // multipart parses serially off the wire), so value fields must be
        // appended before the file part or they read as undefined there.
        const body = new FormData();
        body.append("file_type", file_type);
        if (store_id != null) body.append("store_id", String(store_id));
        body.append("period", period);
        body.append("file", file);
        return { url: "/ingestions", method: "POST", body };
      },
      invalidatesTags: ["Ingestion"],
    }),
  }),
});

export const { useListIngestionsQuery, useGetIngestionQuery, useUploadIngestionMutation } = ingestionApi;
```

### Task D2: `store.ts` — register the new slice

**Files:**
- Modify: `frontend/apps/admin/src/lib/store.ts`

- [ ] **Step 1: Add the import** (alphabetically among the existing ones, after `authApi`'s import at line 3, before `financeApi`):

```typescript
import { ingestionApi } from "@/lib/api/ingestion";
```

- [ ] **Step 2: Add to `reducer`** (after `overviewApi`'s line):

```typescript
      [ingestionApi.reducerPath]: ingestionApi.reducer,
```

- [ ] **Step 3: Add to `middleware`** (after `overviewApi.middleware,`):

```typescript
        ingestionApi.middleware,
```

### Task D3: `ingestion/page.tsx` — the upload form + history table + rejection dialog

**Files:**
- Create: `frontend/apps/admin/src/app/(app)/ingestion/page.tsx`

**Interfaces:**
- Consumes: everything from D1, plus `useHasPermission` (its first real call site), `useGetStoresQuery`, `sonner`'s `toast` (its first real call site), `Form`/`FormField`/etc. from `components/ui/form.tsx`, `Dialog` from `components/ui/dialog.tsx`.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHasPermission } from "@/lib/auth/use-permission";
import {
  INGESTION_FILE_TYPES,
  useGetIngestionQuery,
  useListIngestionsQuery,
  useUploadIngestionMutation,
  type IngestionFileType,
  type IngestionStatus,
} from "@/lib/api/ingestion";
import { useGetStoresQuery } from "@/lib/api/stores";

const FILE_TYPE_LABELS: Record<IngestionFileType, string> = {
  sales: "Vendas",
  supply: "Abastecimento",
  cost: "Custos",
};

const STATUS_LABELS: Record<IngestionStatus, string> = {
  accepted: "Aceito",
  processing: "Processando",
  completed: "Concluído",
  partially_completed: "Parcialmente concluído",
  failed: "Falhou",
};

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const ingestionSchema = z
  .object({
    file_type: z.enum(["sales", "supply", "cost"], { required_error: "Selecione o tipo de arquivo" }),
    store_id: z.string().optional(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o período como AAAA-MM"),
    file: z.instanceof(File).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.file_type !== "supply" && !values.store_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["store_id"], message: "Selecione a loja" });
    }
    if (!values.file) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["file"], message: "Selecione um arquivo" });
    }
  });

type IngestionFormValues = z.infer<typeof ingestionSchema>;

function StatusBadge({ status }: { status: IngestionStatus }) {
  if (status === "completed") return <Badge variant="secondary">{STATUS_LABELS[status]}</Badge>;
  if (status === "failed") {
    return <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">{STATUS_LABELS[status]}</Badge>;
  }
  if (status === "partially_completed") {
    return <Badge className="border border-warning/30 bg-warning/15 text-warning">{STATUS_LABELS[status]}</Badge>;
  }
  return <Badge variant="outline">{STATUS_LABELS[status]}</Badge>;
}

function UploadCard() {
  const canUpload = useHasPermission("ingestion:upload");
  const { data: stores } = useGetStoresQuery();
  const [uploadIngestion, { isLoading }] = useUploadIngestionMutation();

  const form = useForm<IngestionFormValues>({
    resolver: zodResolver(ingestionSchema),
    defaultValues: { file_type: "sales", store_id: "", period: "", file: undefined },
  });

  const fileType = form.watch("file_type");

  async function onSubmit(values: IngestionFormValues) {
    if (!values.file) return;
    try {
      await uploadIngestion({
        file: values.file,
        file_type: values.file_type,
        store_id: values.file_type !== "supply" && values.store_id ? Number(values.store_id) : undefined,
        period: values.period,
      }).unwrap();
      toast.success("Arquivo enviado. Acompanhe o status na lista abaixo.");
      form.reset({ file_type: values.file_type, store_id: "", period: "", file: undefined });
    } catch {
      toast.error("Não foi possível enviar o arquivo. Tente novamente.");
    }
  }

  if (!canUpload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enviar planilha</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Sua conta não tem permissão para enviar planilhas.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviar planilha</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="file_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de arquivo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INGESTION_FILE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {FILE_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {fileType !== "supply" && (
                <FormField
                  control={form.control}
                  name="store_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loja</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a loja" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(stores ?? []).map((store) => (
                            <SelectItem key={store.id} value={String(store.id)}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="period"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Período</FormLabel>
                    <FormControl>
                      <Input type="month" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="file"
                render={({ field: { value, onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>Arquivo</FormLabel>
                    <FormControl>
                      <Input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => onChange(event.target.files?.[0])} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={isLoading} className="self-start">
              {isLoading ? "Enviando..." : "Enviar"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function IngestionHistory() {
  const canRead = useHasPermission("ingestion:read");
  const { data: ingestions, isLoading, error, refetch } = useListIngestionsQuery({ limit: 50 }, { skip: !canRead });
  const { data: stores } = useGetStoresQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading } = useGetIngestionQuery(selectedId ?? "", { skip: !selectedId });

  const nameByStoreId = new Map((stores ?? []).map((store) => [store.id, store.name]));

  return (
    <>
      <div className="rounded-lg border">
        <RequestState
          isLoading={isLoading}
          error={error}
          isEmpty={!isLoading && !error && (ingestions?.length ?? 0) === 0}
          emptyMessage="Nenhuma ingestão registrada ainda."
          onRetry={refetch}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aceitas</TableHead>
                <TableHead className="text-right">Rejeitadas</TableHead>
                <TableHead>Enviado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ingestions ?? []).map((ingestion) => (
                <TableRow key={ingestion.id} className="cursor-pointer" onClick={() => setSelectedId(ingestion.id)}>
                  <TableCell className="font-medium">{ingestion.original_name}</TableCell>
                  <TableCell>{FILE_TYPE_LABELS[ingestion.file_type]}</TableCell>
                  <TableCell>
                    {ingestion.store_id === null ? "Rede" : nameByStoreId.get(ingestion.store_id) ?? ingestion.store_id}
                  </TableCell>
                  <TableCell>{ingestion.period}</TableCell>
                  <TableCell>
                    <StatusBadge status={ingestion.status} />
                  </TableCell>
                  <TableCell className="text-right">{ingestion.accepted_rows}</TableCell>
                  <TableCell className="text-right">{ingestion.rejected_rows}</TableCell>
                  <TableCell>{dateTimeFormatter.format(new Date(ingestion.uploaded_at))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </div>

      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.original_name ?? "Detalhe da ingestão"}</DialogTitle>
            <DialogDescription>{detail ? `${detail.accepted_rows} aceitas, ${detail.rejected_rows} rejeitadas` : ""}</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : detail && detail.rejections.length > 0 ? (
            <>
              {detail.rejected_rows > 100 && <p className="text-xs text-muted-foreground">Mostrando as 100 primeiras rejeições.</p>}
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Detalhe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.rejections.map((rejection) => (
                      <TableRow key={rejection.id}>
                        <TableCell className="font-mono text-xs">{rejection.row_reference}</TableCell>
                        <TableCell>{rejection.reason}</TableCell>
                        <TableCell>{rejection.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma linha rejeitada.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function IngestionPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ingestão" description="Envio de planilhas de vendas, abastecimento e custos, e histórico de processamento." />
      <UploadCard />
      <div>
        <h2 className="mb-2 text-sm font-medium">Histórico</h2>
        <IngestionHistory />
      </div>
    </div>
  );
}
```

### Task D4: `app-sidebar.tsx` — add the nav entry

**Files:**
- Modify: `frontend/apps/admin/src/components/app-sidebar.tsx:1-15` (import), `:24-32` (nav array)

- [ ] **Step 1: Add `Upload` to the lucide-react import**

Change (lines 3-11):

```typescript
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  Wallet,
} from "lucide-react";
```

to:

```typescript
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  Upload,
  Wallet,
} from "lucide-react";
```

- [ ] **Step 2: Append to the `nav` array**

Change (lines 24-32):

```typescript
const nav = [
  { title: "Visão geral", href: "/", icon: LayoutDashboard },
  { title: "Vendas", href: "/sales", icon: ShoppingCart },
  { title: "Financeiro", href: "/finance", icon: Wallet },
  { title: "Abastecimento", href: "/supply", icon: Truck },
  { title: "Estoque", href: "/inventory", icon: Boxes },
  { title: "Produtos", href: "/products", icon: Package },
  { title: "Lojas", href: "/stores", icon: StoreIcon },
];
```

to:

```typescript
const nav = [
  { title: "Visão geral", href: "/", icon: LayoutDashboard },
  { title: "Vendas", href: "/sales", icon: ShoppingCart },
  { title: "Financeiro", href: "/finance", icon: Wallet },
  { title: "Abastecimento", href: "/supply", icon: Truck },
  { title: "Estoque", href: "/inventory", icon: Boxes },
  { title: "Produtos", href: "/products", icon: Package },
  { title: "Lojas", href: "/stores", icon: StoreIcon },
  { title: "Ingestão", href: "/ingestion", icon: Upload },
];
```

No other change needed in this file — active-state matching (`pathname.startsWith(item.href)`) and rendering are already generic over the array.

### Task D5: `frontend/apps/admin/CLAUDE.md` — clear the gap, note the two deferrals

**Files:**
- Modify: `frontend/apps/admin/CLAUDE.md:163-170`

- [ ] **Step 1: Replace the two relevant gap bullets**

Change (current lines 163-170):

```markdown
- **`useHasPermission` existe mas nada o usa ainda.** Nenhuma tela tem
  ação de escrita na UI (o `PUT /inventory/:sku/minimum` tem mutation
  pronta, `useSetMinimumMutation`, mas nenhum botão a chama). O
  mecanismo de esconder ação por permissão está pronto, mas sem ação
  real para testar contra.
- **Upload das três planilhas ainda não tem tela.** `POST /ingestions`
  do gateway já existe (`ingestion-worker-service`); falta a UI de
  upload, lista de ingestões e detalhe com linhas rejeitadas.
```

to:

```markdown
- **`useHasPermission` agora tem um uso real**: `/ingestion` gate o
  formulário de upload por `ingestion:upload`. `PUT
  /inventory/:sku/minimum` (`useSetMinimumMutation`) continua sem botão
  que o chame.
- **Upload das três planilhas tem tela própria em `/ingestion`**
  (`src/app/(app)/ingestion/page.tsx`): formulário de envio +
  histórico de ingestões com detalhe de linhas rejeitadas. Dois
  follow-ups documentados, não construídos — cada um pede sua própria
  proposta OpenSpec:
  - **Reversão real de upload** (delete-by-ingestion_id em
    `sales-service`/`supply-service` + recompute a jusante). Não existe
    endpoint de cancelamento/rollback hoje — a correção é reenviar e
    sobrescrever o período.
  - **Perda por dia de visita de abastecimento.** A data da visita
    (`IngestionOperation.finished_at`, parseada da célula "Finalizado
    em" de cada aba) é real e precisa no momento do parse, mas é
    descartada antes mesmo das linhas de remoção chegarem ao
    `supply-service` (`publishSupplyByStore` do
    `ingestion-worker-service` agrega remoções só por `${sku} ${reason}`,
    perdendo o vínculo com a aba/data; a tabela de staging que
    brevemente guardava isso é apagada no `finalize()`). `supply-service`
    não guarda nada mais fino que o mês. Não é "adicionar um endpoint" —
    precisa de mudança de schema/contrato (um campo de data em
    `SupplyRemovalRow`/`RemovalRecord`) mais uma decisão sobre
    reprocessar meses já ingeridos.
```

### Task D6: Verify build

```bash
pnpm turbo run lint typecheck build --filter=@agiliz/admin
```

### Task D7: Rebuild, redeploy, live-verify end-to-end

- [ ] **Step 1:** `cli/agiliz-cli up -i admin --production`
- [ ] **Step 2:** Via `chrome-devtools` MCP tools: log in, navigate to **Ingestão**, confirm the upload card renders (if `barbara@agiliz.ai` lacks `ingestion:upload`, the card shows the permission message instead — check `GET /auth/me`'s `permissions` array in the network panel to know which case to expect, and don't treat that as a bug).
- [ ] **Step 3:** Pick one real sample file from `var/exemplos-de-planilhas/agiliz.ai-20260818T230206Z-1-001/agiliz.ai/Vendas x abastecimento/` — e.g. a `venda <Cliente> - <loja> <mês>.xlsx` for `file_type: "sales"` (pick its matching store from the **Lojas** page and its month), or an `Abastecimentos <range>.xlsx` for `file_type: "supply"` (no store selection). Upload it via the form.
- [ ] **Step 4:** Confirm a success toast appears, and the ingestion shows up in the history table with a real `status` (poll/refresh if it's still `processing` — this is async).
- [ ] **Step 5:** Click the row, confirm the detail dialog opens; if `rejected_rows > 0`, confirm the rejection table renders with real `row_reference`/`reason`/`detail` values.
- [ ] **Step 6:** Screenshot the upload form, the history table, and the open detail dialog for the record.

### Task D8: Commit

```bash
git add frontend/apps/admin/src/lib/api/ingestion.ts \
        frontend/apps/admin/src/lib/store.ts \
        frontend/apps/admin/src/app/\(app\)/ingestion/page.tsx \
        frontend/apps/admin/src/components/app-sidebar.tsx \
        frontend/apps/admin/CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(admin): ingestion upload UI and history

New /ingestion page: an upload form (react-hook-form + zod, gated by
useHasPermission("ingestion:upload") — its first real caller) and a
history table with a rejection-detail dialog. Field order in the
FormData upload matters: the gateway reads request.file()'s value
fields synchronously before consuming the file stream.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (backend cross-tab + recompute) → Tasks A1-A7. ✓
- Item 2 (frontend types + monthlyTotals) → Tasks B1-B3. ✓
- Item 3 (NetworkFinanceView redesign: trend chart, table, detail panel, `ReasonSkuBreakdown`) → Tasks B6-B8. ✓
- Item 4 (`unvalued-reasons.ts` + `IncompleteBanner`) → Tasks B4-B5. ✓
- Item 5 (network filter on sales/supply/inventory + doc fix) → Tasks C1-C6. ✓
- Item 6 (ingestion UI) → Tasks D1-D5. ✓
- Verification section's per-item live checks → Tasks A6, B10, C8, D7. ✓
- "Explicitly deferred" section → Task D5 (documented, not built). ✓

**Placeholder scan:** every task has literal code, not a description of code; no "TBD"/"similar to Task N"/"add validation" language. The two spots with the most legitimate design latitude (the "top ~5 SKUs" cap in `ReasonSkuBreakdown`, the "top ~20" cap in `NetworkSalesView`'s product table) are both resolved to a concrete number rather than left open.

**Type consistency check:**
- `Reconciliation.loss_by_reason_sku` (B1) → `ReconciliationTotals.loss_by_reason_sku` (B2) → consumed by `ReasonSkuBreakdown` (B7) and `NetworkStoreDetail` (B8) — same shape (`{ reason, sku, quantity, value_cents }`) throughout, matching the backend's `Reconciliation.loss_by_reason_sku` (A1) → `ReconciliationView.loss_by_reason_sku` (A2) → `LossByReasonSkuDto` (A3).
- `getNetworkReconciliationRange`'s new `{ rows, monthlyTotals }` shape (B3) is consumed only by `NetworkFinanceView` (B8) — its one caller, per the spec's own framing — and no other file references the old bare-array return.
- `sumSupply`/`sumStock` (C2/C3) signatures match their call sites in the rewritten `getSupplyRange`/`getStockRange` and the new `getNetworkSupplyRange`/`getNetworkStockRange` exactly (same parameter order, same `PeriodRange`/`Store[]` types already used by `sales.ts`'s established pattern).
- `IngestionFileType`/`IngestionStatus`/`Ingestion`/`IngestionDetail` (D1) match every field the ingestion contracts research confirmed on the wire (snake_case, `store_id: number | null`, the five-value status enum) and are used identically in D3's page.
