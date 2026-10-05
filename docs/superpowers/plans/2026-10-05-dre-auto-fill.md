# DRE Auto-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking "Fechar o mês" on the DRE (`/finance/pnl`) pulls real data
already in the system (treasury categories, sales revenue, finance
CMV/loss) into `LedgerEntry` before freezing the snapshot, for every
account that has a confident source — while any account a person edited by
hand stays exactly as they left it, forever, until they touch it again.

**Architecture:** A new `UpstreamClient` in `accounting-service` (same
shape as `finance-service`'s own upstream client) reads `stores-service`,
`sales-service`, `finance-service` and `treasury-service`. A new
`AccountingService.syncFromUpstreams()` writes `LedgerEntry` rows for the
accounts a new `Account.auto_source` column marks as automatic, skipping
any row whose current `origin` is `'manual'`. `POST
/accounting/pnl/:period/compute` runs this sync (network account, and a
loop over every active store) before closing — closing from the network
view now closes every store's snapshot too, in one request. A new pencil
icon on each DRE account row opens a one-field dialog that writes manually
via the `PUT /accounting/entries` route that already exists and is already
called nothing today.

**Tech Stack:** NestJS (Fastify), Prisma + `@prisma/adapter-pg`,
`@app/http-client`'s `AxiosHttpClient` (the same lib `finance-service`
already uses to talk to `supply`/`sales`/`inventory`/`products`), Jest
(unit + integration tiers), Next.js/RTK Query admin frontend.

**Spec:**
`docs/superpowers/specs/2026-10-05-dre-auto-fill-design.md`

## Global Constraints

- `amount_cents` written to `LedgerEntry` is always a positive magnitude —
  `computePnl` applies the account's own `sign`; writing an already-signed
  number doubles the sign (documented footgun in this exact service).
- A `LedgerEntry` whose current `origin` is `'manual'` is never touched by
  the sync, at any level (network or per store) — approved by the operator
  2026-10-05, no exceptions, no "refresh" action built in this pass.
- A 404 from any upstream (`sales-service`, `finance-service`) means "no
  data for that store/period" — never write a zero for it, never treat it
  as a transport error.
- A transport failure (timeout, 5xx) for one store must not abort the
  other stores' sync — collect it, name the store, keep going.
- `4.2.03` (Deslocamento) and `4.2.01` (Repasse de vendas) are never
  written by the sync, at any level — see spec for why (roll-up parent;
  already-complete formula).
- No change to `allocateNetworkCostsToStore`'s own allocation math — the
  sync only ever changes its INPUT (the network-level `LedgerEntry`).

## Review Focus

- A period with zero active stores (`stores-service` returns `[]` or every
  store is `inactive`) — the sync must not crash; the network-level
  accounts still sync, the per-store loop is simply empty.
- A store active in `stores-service` but never ingested in `sales-service`
  OR `finance-service` for that period (both 404) — that store's three
  per-store accounts must stay exactly as they were before the sync ran
  (not zeroed), and the store must not appear in `stores_failed` (a 404 is
  not a failure).
- A treasury category with real transactions this period but whose SUM
  nets to exactly zero (e.g. a reversed charge) — must still write `0`,
  distinguishable in the response from "category never appeared" only by
  the fact that it DID write (acceptable per spec; this is the one
  documented gap of this pass).
- Re-running the sync for a period where a PREVIOUS auto-sync already
  wrote `origin: 'treasury'`/`'sales'`/`'finance'` to an account — must
  overwrite with the newer total (only `'manual'` is protected), so
  "Reapurar e fechar" stays meaningful.
- The gateway's `POST /accounting/pnl/:period/compute` proxy route today
  drops every query string parameter (`store_id`, `store_count`, `close`)
  before forwarding — found during this plan's own research, not
  hypothetical. Without the fix in Task 5, `close=true` and
  `store_count` never reach `accounting-service` through the real UI,
  and this feature's own close flow would silently never actually close
  anything.

---

### Task 1: `Account.auto_source`/`treasury_category` columns + seed

**Files:**
- Modify: `backend/apps/accounting-service/prisma/schema.prisma` (the
  `Account` model, after `per_store`)
- Create:
  `backend/apps/accounting-service/prisma/migrations/20261005120000_add_account_auto_source/migration.sql`
- Test: `backend/apps/accounting-service/test/account-auto-source.integration-spec.ts`

**Interfaces:**
- Produces: `Account.auto_source: 'treasury_category' | 'sales_revenue' |
  'finance_cogs' | 'finance_loss' | null` and `Account.treasury_category:
  string | null` — Task 3 reads both to decide what to sync and how.

- [ ] **Step 1: Add the two columns to the Prisma schema**

In `backend/apps/accounting-service/prisma/schema.prisma`, inside `model
Account`, right after the `per_store` line:

```prisma
  /// "treasury_category" | "sales_revenue" | "finance_cogs" | "finance_loss" | null.
  /// Null = no automatic source; the account stays manual-only.
  auto_source       String?
  /// Only meaningful when auto_source = "treasury_category" — the exact
  /// `bank_transaction.category` text whose period total feeds this account.
  treasury_category String?
```

- [ ] **Step 2: Write the migration (raw SQL, matching this service's own convention)**

Create
`backend/apps/accounting-service/prisma/migrations/20261005120000_add_account_auto_source/migration.sql`:

```sql
-- Marks which DRE accounts have an automatic data source, and from where.
-- Structure of the business (which account maps to which source), not
-- company data — same reasoning as the chart-of-accounts seed migration.
-- Accounts not listed here keep auto_source NULL and stay manual-only.
-- See docs/superpowers/specs/2026-10-05-dre-auto-fill-design.md for why
-- each one was or was not mapped.

ALTER TABLE "account" ADD COLUMN "auto_source" TEXT;
ALTER TABLE "account" ADD COLUMN "treasury_category" TEXT;

UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Receita - Mensalidade' WHERE code = '3.1.03';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Impostos sobre a venda' WHERE code = '3.2.01';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Coffee break' WHERE code = '4.1.02';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Frutas' WHERE code = '4.1.03';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Combustível' WHERE code = '4.2.04';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Pedágio' WHERE code = '4.2.05';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Alimentação' WHERE code = '4.2.08';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Sistema Touchpay' WHERE code = '4.3.01';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Contador' WHERE code = '4.3.02';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Pró-labore' WHERE code = '4.3.03';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Luz' WHERE code = '4.3.04';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Juros - Limite Garantido' WHERE code = '4.4.01';

UPDATE "account" SET auto_source = 'sales_revenue' WHERE code = '3.1.01';
UPDATE "account" SET auto_source = 'finance_cogs' WHERE code = '4.1.01';
UPDATE "account" SET auto_source = 'finance_loss' WHERE code = '4.2.02';
```

- [ ] **Step 2b: Regenerate the Prisma client**

Run: `cd backend/apps/accounting-service && pnpm prisma:generate`
Expected: regenerates `generated/prisma/*` with the two new fields on
`Account`, no errors.

- [ ] **Step 3: Write the integration test**

Create `backend/apps/accounting-service/test/account-auto-source.integration-spec.ts`:

```typescript
import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/** Pins the 15 real accounts this migration maps, and that nothing else got mapped by accident. */
describe('account auto_source seed', () => {
  let app: TestingModule
  let prisma: PrismaClientService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  it('maps exactly the 12 treasury_category accounts the spec names', async () => {
    const rows = await prisma.account.findMany({
      where: { auto_source: 'treasury_category' },
      select: { code: true, treasury_category: true },
      orderBy: { code: 'asc' },
    })

    expect(rows.map(r => r.code)).toEqual([
      '3.1.03', '3.2.01', '4.1.02', '4.1.03', '4.2.04', '4.2.05',
      '4.2.08', '4.3.01', '4.3.02', '4.3.03', '4.3.04', '4.4.01',
    ])
    expect(rows.find(r => r.code === '4.3.04')?.treasury_category).toBe('Luz')
  })

  it('maps the 3 per-store accounts to their own source, and never 4.2.01/4.2.03', async () => {
    const rows = await prisma.account.findMany({
      where: { code: { in: ['3.1.01', '4.1.01', '4.2.02', '4.2.01', '4.2.03'] } },
      select: { code: true, auto_source: true },
    })
    const byCode = new Map(rows.map(r => [r.code, r.auto_source]))

    expect(byCode.get('3.1.01')).toBe('sales_revenue')
    expect(byCode.get('4.1.01')).toBe('finance_cogs')
    expect(byCode.get('4.2.02')).toBe('finance_loss')
    expect(byCode.get('4.2.01')).toBeNull()
    expect(byCode.get('4.2.03')).toBeNull()
  })
})
```

- [ ] **Step 4: Apply the migration and run the test**

Run:
```bash
cd backend/apps/accounting-service
pnpm prisma:migrate   # dev: applies against the local Postgres, prompts for a name — accept the folder name already on disk
pnpm test:integration -- account-auto-source
```
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounting-service/prisma backend/apps/accounting-service/test/account-auto-source.integration-spec.ts
git commit -m "feat(accounting): map DRE accounts to an automatic data source"
```

---

### Task 2: `UpstreamClient` (stores/sales/finance/treasury reads)

**Files:**
- Modify: `backend/apps/accounting-service/package.json` (add
  `@nestjs/axios`, `axios` to `dependencies`)
- Modify: `backend/apps/accounting-service/src/config/env.validation.ts`
- Modify: `backend/apps/accounting-service/src/modules/accounting/accounting.module.ts`
- Modify: `backend/apps/accounting-service/docker-compose.yml` (both
  `accounting-dev` and `accounting-prod` `environment:` blocks)
- Create: `backend/apps/accounting-service/src/modules/accounting/services/upstream.client.ts`
- Test: `backend/apps/accounting-service/src/modules/accounting/services/upstream.client.spec.ts`

**Interfaces:**
- Consumes: `AxiosHttpClient.send<T>()` from `@app/http-client` (exact
  signature: `send<T>({ http_method, url, payload?, headers?, timeout?
  }): Promise<{ response: { data: T, status: number } }>`).
- Produces (read by Task 3):
  - `activeStores(correlationId?): Promise<{ id: number; name: string }[]>`
  - `salesRevenueCents(storeId: number, period: string, correlationId?): Promise<number>`
  - `financeFor(storeId: number, period: string, correlationId?): Promise<{ cogs_cents: number; loss_value_cents: number } | null>`
  - `treasuryCategoryTotals(period: string, correlationId?): Promise<Map<string, number>>`
    — key is the raw `category` string, value is `Math.abs(inflow − outflow)` cents for that category, summed over every `bank_transaction` of that period whose `kind` is `'revenue'` or `'expense'` and whose `neutralized_with_id` is `null`.

- [ ] **Step 1: Add the two dependencies**

In `backend/apps/accounting-service/package.json`, inside
`"dependencies"`, add (alphabetical, matching the rest of the block):

```json
    "@nestjs/axios": "^4.0.1",
    "axios": "^1.19.0",
```

Run: `pnpm install` (from the repo root, so the workspace lockfile picks it up)
Expected: installs cleanly, `pnpm-lock.yaml` updates.

- [ ] **Step 2: Add the four env vars to validation**

In `backend/apps/accounting-service/src/config/env.validation.ts`, add
(same `@IsString() @IsNotEmpty()` pattern already used for `DATABASE_URL`,
right before the `PORT` field):

```typescript
  /** Upstreams this service reads to auto-fill the DRE. A 404 is "no data", never a failure. */
  @IsString()
  @IsNotEmpty()
  STORES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  SALES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  FINANCE_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  TREASURY_SERVICE_URL: string
```

- [ ] **Step 3: Add the four env vars to docker-compose, both dev and prod**

In `backend/apps/accounting-service/docker-compose.yml`, in BOTH the
`accounting-dev` and `accounting-prod` services' `environment:` block,
right after `PORT: 3000`:

For `accounting-dev`:
```yaml
      STORES_SERVICE_URL: http://agiliz-stores-dev:3000
      SALES_SERVICE_URL: http://agiliz-sales-dev:3000
      FINANCE_SERVICE_URL: http://agiliz-finance-dev:3000
      TREASURY_SERVICE_URL: http://agiliz-treasury-dev:3000
```

For `accounting-prod`:
```yaml
      STORES_SERVICE_URL: http://agiliz-stores-prod:3000
      SALES_SERVICE_URL: http://agiliz-sales-prod:3000
      FINANCE_SERVICE_URL: http://agiliz-finance-prod:3000
      TREASURY_SERVICE_URL: http://agiliz-treasury-prod:3000
```

- [ ] **Step 4: Write the failing test for `UpstreamClient`**

Create
`backend/apps/accounting-service/src/modules/accounting/services/upstream.client.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { UpstreamClient } from './upstream.client'

describe('UpstreamClient', () => {
  function buildClient(send: jest.Mock) {
    const http = { send } as unknown as AxiosHttpClient
    const config = {
      getOrThrow: (key: string) =>
        ({
          STORES_SERVICE_URL: 'http://stores',
          SALES_SERVICE_URL: 'http://sales',
          FINANCE_SERVICE_URL: 'http://finance',
          TREASURY_SERVICE_URL: 'http://treasury',
        })[key],
    } as unknown as ConfigService
    return new UpstreamClient(http, config)
  }

  it('returns 0 revenue when sales-service 404s — never throws, never fabricates a non-zero number', async () => {
    const send = jest.fn().mockRejectedValue({ response: { status: 404 } })
    const client = buildClient(send)

    const revenue = await client.salesRevenueCents(7, '2026-09')

    expect(revenue).toBe(0)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://sales/sales/7/totals?period=2026-09' }),
    )
  })

  it('returns the real revenue field from sales-service totals', async () => {
    const send = jest.fn().mockResolvedValue({ response: { data: { total_revenue_cents: 123456 } } })
    const client = buildClient(send)

    expect(await client.salesRevenueCents(7, '2026-09')).toBe(123456)
  })

  it('returns null from finance-service on 404 — distinct from a real zero reconciliation', async () => {
    const send = jest.fn().mockRejectedValue({ response: { status: 404 } })
    const client = buildClient(send)

    expect(await client.financeFor(7, '2026-09')).toBeNull()
  })

  it('re-throws a non-404 error — a transport failure must not look like "no data"', async () => {
    const send = jest.fn().mockRejectedValue({ response: { status: 503 } })
    const client = buildClient(send)

    await expect(client.salesRevenueCents(7, '2026-09')).rejects.toBeTruthy()
  })

  it('sums treasury categories as |inflow - outflow|, skipping movement/pending and neutralized rows', async () => {
    const send = jest.fn().mockResolvedValue({
      response: {
        data: [
          { kind: 'expense', direction: 'outflow', amount_cents: 10000, category: 'Luz', neutralized_with_id: null },
          { kind: 'revenue', direction: 'inflow', amount_cents: 50000, category: 'Receita - Mensalidade', neutralized_with_id: null },
          { kind: 'movement', direction: 'outflow', amount_cents: 99999, category: 'Movimentação entre contas', neutralized_with_id: null },
          { kind: 'expense', direction: 'outflow', amount_cents: 500, category: 'Luz', neutralized_with_id: 3 },
        ],
      },
    })
    const client = buildClient(send)

    const totals = await client.treasuryCategoryTotals('2026-09')

    expect(totals.get('Luz')).toBe(10000)
    expect(totals.get('Receita - Mensalidade')).toBe(50000)
    expect(totals.has('Movimentação entre contas')).toBe(false)
  })

  it('lists only active stores', async () => {
    const send = jest.fn().mockResolvedValue({
      response: {
        data: [
          { id: 1, name: 'A', status: 'active' },
          { id: 2, name: 'B', status: 'inactive' },
        ],
      },
    })
    const client = buildClient(send)

    expect(await client.activeStores()).toEqual([{ id: 1, name: 'A' }])
  })
})
```

- [ ] **Step 5: Run the tests, verify they fail**

Run: `cd backend/apps/accounting-service && pnpm test -- upstream.client`
Expected: FAIL — `Cannot find module './upstream.client'`.

- [ ] **Step 6: Implement `UpstreamClient`**

Create
`backend/apps/accounting-service/src/modules/accounting/services/upstream.client.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'

export interface ActiveStore {
  id: number
  name: string
}

interface TreasuryTransaction {
  kind: string
  direction: 'inflow' | 'outflow'
  amount_cents: number
  category: string
  neutralized_with_id: number | null
}

/**
 * Reads the four services the DRE auto-fill is built from. A 404 means
 * "no data for that store/period", a real answer that must never be
 * mistaken for a transport failure — the two lead to very different
 * ledger entries (skip vs. abort). Same shape as finance-service's own
 * UpstreamClient, on purpose.
 */
@Injectable()
export class UpstreamClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async activeStores(correlationId?: string): Promise<ActiveStore[]> {
    const stores = await this.get<{ id: number; name: string; status: string }[]>(
      `${this.config.getOrThrow<string>('STORES_SERVICE_URL')}/stores`,
      [],
      correlationId,
    )
    return stores.filter(s => s.status === 'active').map(s => ({ id: s.id, name: s.name }))
  }

  async salesRevenueCents(storeId: number, period: string, correlationId?: string): Promise<number> {
    const result = await this.get<{ total_revenue_cents: number } | null>(
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/${storeId}/totals?period=${encodeURIComponent(period)}`,
      null,
      correlationId,
    )
    return result?.total_revenue_cents ?? 0
  }

  async financeFor(
    storeId: number,
    period: string,
    correlationId?: string,
  ): Promise<{ cogs_cents: number; loss_value_cents: number } | null> {
    return this.get<{ cogs_cents: number; loss_value_cents: number } | null>(
      `${this.config.getOrThrow<string>('FINANCE_SERVICE_URL')}/finance/${storeId}/${encodeURIComponent(period)}`,
      null,
      correlationId,
    )
  }

  /** Keyed by the raw `category` text; value is |inflow − outflow| cents, revenue and expense alike. */
  async treasuryCategoryTotals(period: string, correlationId?: string): Promise<Map<string, number>> {
    const rows = await this.get<TreasuryTransaction[]>(
      `${this.config.getOrThrow<string>('TREASURY_SERVICE_URL')}/treasury/transactions?period=${encodeURIComponent(period)}`,
      [],
      correlationId,
    )

    const net = new Map<string, number>()
    for (const row of rows) {
      if (row.kind !== 'revenue' && row.kind !== 'expense') continue
      if (row.neutralized_with_id !== null) continue
      const signed = row.direction === 'inflow' ? row.amount_cents : -row.amount_cents
      net.set(row.category, (net.get(row.category) ?? 0) + signed)
    }

    return new Map([...net.entries()].map(([category, value]) => [category, Math.abs(value)]))
  }

  private async get<T>(url: string, whenAbsent: T, correlationId?: string): Promise<T> {
    try {
      const result = await this.http.send<T>({
        http_method: 'get',
        url,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 8000,
      })
      return (result.response.data as T) ?? whenAbsent
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return whenAbsent
      throw error
    }
  }
}
```

- [ ] **Step 7: Register it in the module**

In
`backend/apps/accounting-service/src/modules/accounting/accounting.module.ts`,
add `HttpClientModule` to `imports` and `UpstreamClient` to `providers`
(matching `finance-service`'s own `finance.module.ts` exactly):

```typescript
import { HttpClientModule } from '@app/http-client'
// ...
import { UpstreamClient } from './services/upstream.client'

@Module({
  imports: [HttpClientModule /* , ...existing imports */],
  providers: [AccountingService, UpstreamClient /* , ...existing providers */],
  // ...
})
```

- [ ] **Step 8: Run the tests, verify they pass**

Run: `cd backend/apps/accounting-service && pnpm test -- upstream.client`
Expected: PASS, 6/6.

- [ ] **Step 9: Typecheck the whole service**

Run: `cd backend/apps/accounting-service && pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add backend/apps/accounting-service/package.json backend/apps/accounting-service/src/config/env.validation.ts backend/apps/accounting-service/src/modules/accounting/accounting.module.ts backend/apps/accounting-service/docker-compose.yml backend/apps/accounting-service/src/modules/accounting/services/upstream.client.ts backend/apps/accounting-service/src/modules/accounting/services/upstream.client.spec.ts pnpm-lock.yaml
git commit -m "feat(accounting): add UpstreamClient for stores/sales/finance/treasury reads"
```

---

### Task 3: `AccountingService.syncFromUpstreams()`

**Files:**
- Modify: `backend/apps/accounting-service/src/modules/accounting/services/accounting.service.ts`
- Test: `backend/apps/accounting-service/test/sync-from-upstreams.integration-spec.ts`

**Interfaces:**
- Consumes: `UpstreamClient` (Task 2) — all four methods.
- Produces (read by Task 4): `AccountingService.syncFromUpstreams(period:
  string, correlationId?: string): Promise<{ stores_ok: number[];
  stores_failed: number[] }>` — syncs the network-level `treasury_category`
  accounts, then loops every active store syncing its `sales_revenue` /
  `finance_cogs` / `finance_loss` accounts.

- [ ] **Step 1: Write the failing integration test**

Create
`backend/apps/accounting-service/test/sync-from-upstreams.integration-spec.ts`:

```typescript
import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AccountingService } from '../src/modules/accounting/services/accounting.service'
import { UpstreamClient } from '../src/modules/accounting/services/upstream.client'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

describe('syncFromUpstreams', () => {
  let app: TestingModule
  let accounting: AccountingService
  let prisma: PrismaClientService
  const period = '2099-04'
  const luzAccountCode = '4.3.04' // real seeded account, auto_source: treasury_category, category "Luz"
  const vendasAccountCode = '3.1.01' // real seeded account, auto_source: sales_revenue, per_store

  const upstream = {
    activeStores: jest.fn(),
    salesRevenueCents: jest.fn(),
    financeFor: jest.fn(),
    treasuryCategoryTotals: jest.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideProvider(UpstreamClient)
      .useValue(upstream)
      .compile()

    app = await moduleRef.init()
    accounting = app.get(AccountingService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { period } })
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('writes the network treasury_category accounts and the per-store accounts for every active store', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 501, name: 'Loja Teste' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 16800]]))
    upstream.salesRevenueCents.mockResolvedValue(500000)
    upstream.financeFor.mockResolvedValue({ cogs_cents: 200000, loss_value_cents: 5000 })

    const result = await accounting.syncFromUpstreams(period)

    expect(result).toEqual({ stores_ok: [501], stores_failed: [] })

    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    const luzEntry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(luzEntry).toMatchObject({ amount_cents: 16800, origin: 'treasury' })

    const vendas = await prisma.account.findUnique({ where: { code: vendasAccountCode } })
    const vendasEntry = await prisma.ledgerEntry.findFirst({ where: { account_id: vendas!.id, period, store_id: 501 } })
    expect(vendasEntry).toMatchObject({ amount_cents: 500000, origin: 'sales' })
  })

  it('never overwrites an account whose current entry is origin: manual', async () => {
    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    await accounting.putEntry({ account_id: luz!.id, period, amount_cents: 999900, origin: 'manual' })

    upstream.activeStores.mockResolvedValue([])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 16800]]))

    await accounting.syncFromUpstreams(period)

    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(entry?.amount_cents).toBe(999900)
    expect(entry?.origin).toBe('manual')
  })

  it('leaves a store with no sales/finance data untouched and does not count it as failed', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 502, name: 'Loja Sem Dado' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.salesRevenueCents.mockResolvedValue(0) // UpstreamClient's own 404 fallback
    upstream.financeFor.mockResolvedValue(null) // UpstreamClient's own 404 fallback

    const result = await accounting.syncFromUpstreams(period)

    expect(result).toEqual({ stores_ok: [502], stores_failed: [] })
    const vendas = await prisma.account.findUnique({ where: { code: vendasAccountCode } })
    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: vendas!.id, period, store_id: 502 } })
    expect(entry).toBeNull()
  })

  it('names a store whose upstream call threw, and still syncs the other stores', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 503, name: 'Loja Erro' }, { id: 504, name: 'Loja Ok' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.salesRevenueCents.mockImplementation((storeId: number) => {
      if (storeId === 503) throw new Error('ECONNREFUSED')
      return Promise.resolve(777700)
    })
    upstream.financeFor.mockResolvedValue(null)

    const result = await accounting.syncFromUpstreams(period)

    expect(result.stores_failed).toEqual([503])
    expect(result.stores_ok).toEqual([504])
    const vendas = await prisma.account.findUnique({ where: { code: vendasAccountCode } })
    const okEntry = await prisma.ledgerEntry.findFirst({ where: { account_id: vendas!.id, period, store_id: 504 } })
    expect(okEntry?.amount_cents).toBe(777700)
  })

  it('writes a real zero when the category nets to exactly zero this period — distinct from "category absent" (undefined)', async () => {
    upstream.activeStores.mockResolvedValue([])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 0]])) // present, reversed to net zero — not "no transaction at all"

    await accounting.syncFromUpstreams(period)

    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(entry).toMatchObject({ amount_cents: 0, origin: 'treasury' })
  })

  it('re-running the sync overwrites a PREVIOUS non-manual value with the newer total', async () => {
    upstream.activeStores.mockResolvedValue([])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 10000]]))
    await accounting.syncFromUpstreams(period)

    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 24000]]))
    await accounting.syncFromUpstreams(period)

    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(entry).toMatchObject({ amount_cents: 24000, origin: 'treasury' })
  })

  it('never writes 4.2.01 (Repasse de vendas) or 4.2.03 (Deslocamento)', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 505, name: 'Loja' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Pedágio', 1000], ['Combustível', 2000]]))
    upstream.salesRevenueCents.mockResolvedValue(0)
    upstream.financeFor.mockResolvedValue(null)

    await accounting.syncFromUpstreams(period)

    const repasse = await prisma.account.findUnique({ where: { code: '4.2.01' } })
    const deslocamento = await prisma.account.findUnique({ where: { code: '4.2.03' } })
    expect(await prisma.ledgerEntry.findFirst({ where: { account_id: repasse!.id, period } })).toBeNull()
    expect(await prisma.ledgerEntry.findFirst({ where: { account_id: deslocamento!.id, period } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend/apps/accounting-service && pnpm test:integration -- sync-from-upstreams`
Expected: FAIL — `accounting.syncFromUpstreams is not a function`.

- [ ] **Step 3: Implement `syncFromUpstreams`**

In
`backend/apps/accounting-service/src/modules/accounting/services/accounting.service.ts`,
inject `UpstreamClient` in the constructor:

```typescript
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly upstream: UpstreamClient,
  ) {}
```

Add the import at the top: `import { UpstreamClient } from './upstream.client'`.

Add this method (placed near `computeSnapshot`, in the "DRE" section):

```typescript
  /**
   * Pulls real data already in the system into LedgerEntry before a close,
   * for every account `Account.auto_source` marks as automatic. Never
   * touches an account whose CURRENT entry is `origin: 'manual'` — approved
   * by the operator 2026-10-05, no exception in this pass. A 404 from an
   * upstream (handled inside UpstreamClient, surfaced here as "no data")
   * never writes anything; a thrown error for one store is caught and
   * named, never aborting the others.
   */
  async syncFromUpstreams(period: string, correlationId?: string): Promise<{ stores_ok: number[]; stores_failed: number[] }> {
    const mappedAccounts = await this.prisma.account.findMany({
      where: { statement: 'pnl', auto_source: { not: null } },
    })

    await this.syncNetworkAccounts(period, mappedAccounts, correlationId)

    const stores = await this.upstream.activeStores(correlationId)
    const stores_ok: number[] = []
    const stores_failed: number[] = []

    for (const store of stores) {
      try {
        await this.syncStoreAccounts(period, store.id, mappedAccounts, correlationId)
        stores_ok.push(store.id)
      } catch {
        stores_failed.push(store.id)
      }
    }

    return { stores_ok, stores_failed }
  }

  private async syncNetworkAccounts(
    period: string,
    accounts: { id: number; auto_source: string | null; treasury_category: string | null }[],
    correlationId?: string,
  ): Promise<void> {
    const treasuryAccounts = accounts.filter(a => a.auto_source === 'treasury_category')
    if (treasuryAccounts.length === 0) return

    const totals = await this.upstream.treasuryCategoryTotals(period, correlationId)

    for (const account of treasuryAccounts) {
      const amount = totals.get(account.treasury_category!)
      if (amount === undefined) continue // no transaction this period for that category — never write 0 for "absent"
      if (await this.isManual(account.id, period, null)) continue

      await this.putEntry({ account_id: account.id, period, amount_cents: amount, origin: 'treasury' })
    }
  }

  private async syncStoreAccounts(
    period: string,
    storeId: number,
    accounts: { id: number; auto_source: string | null }[],
    correlationId?: string,
  ): Promise<void> {
    const salesAccount = accounts.find(a => a.auto_source === 'sales_revenue')
    const cogsAccount = accounts.find(a => a.auto_source === 'finance_cogs')
    const lossAccount = accounts.find(a => a.auto_source === 'finance_loss')

    if (salesAccount && !(await this.isManual(salesAccount.id, period, storeId))) {
      const revenue = await this.upstream.salesRevenueCents(storeId, period, correlationId)
      if (revenue > 0) {
        await this.putEntry({ account_id: salesAccount.id, period, store_id: storeId, amount_cents: revenue, origin: 'sales' })
      }
    }

    if (cogsAccount || lossAccount) {
      const finance = await this.upstream.financeFor(storeId, period, correlationId)
      if (finance) {
        if (cogsAccount && finance.cogs_cents > 0 && !(await this.isManual(cogsAccount.id, period, storeId))) {
          await this.putEntry({ account_id: cogsAccount.id, period, store_id: storeId, amount_cents: finance.cogs_cents, origin: 'finance' })
        }
        if (lossAccount && finance.loss_value_cents > 0 && !(await this.isManual(lossAccount.id, period, storeId))) {
          await this.putEntry({ account_id: lossAccount.id, period, store_id: storeId, amount_cents: finance.loss_value_cents, origin: 'finance' })
        }
      }
    }
  }

  private async isManual(accountId: number, period: string, storeId: number | null): Promise<boolean> {
    const existing = await this.prisma.ledgerEntry.findFirst({ where: { account_id: accountId, period, store_id: storeId } })
    return existing?.origin === 'manual'
  }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend/apps/accounting-service && pnpm test:integration -- sync-from-upstreams`
Expected: PASS, 7/7.

- [ ] **Step 5: Run the whole integration suite (nothing else broke)**

Run: `cd backend/apps/accounting-service && pnpm test:integration`
Expected: all PASS, including Task 1's `account-auto-source` and the
pre-existing `accounting.integration-spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounting-service/src/modules/accounting/services/accounting.service.ts backend/apps/accounting-service/test/sync-from-upstreams.integration-spec.ts
git commit -m "feat(accounting): sync LedgerEntry from treasury/sales/finance before close"
```

---

### Task 4: Wire sync into "Fechar o mês", loop all stores on network close

**Files:**
- Modify: `backend/apps/accounting-service/src/modules/accounting/services/accounting.service.ts`
- Modify: `backend/apps/accounting-service/src/modules/accounting/controllers/accounting.controller.ts`
- Test: `backend/apps/accounting-service/test/close-month.integration-spec.ts`

**Interfaces:**
- Consumes: `syncFromUpstreams` (Task 3), `computeSnapshot` (existing),
  `pnlByStore`-style store listing — reuses `UpstreamClient.activeStores`
  already fetched inside `syncFromUpstreams`, so this task adds one more
  small method rather than re-fetching store status.
- Produces: `AccountingService.closeMonth(period: string, storeId:
  number | undefined, storeCount: number, close: boolean, correlationId?:
  string): Promise<PnlSnapshot & { synced: { stores_ok: number[];
  stores_failed: number[] } }>` — this REPLACES the controller's direct
  call to `computeSnapshot`, which stays as a private building block.

- [ ] **Step 1: Write the failing integration test**

Create
`backend/apps/accounting-service/test/close-month.integration-spec.ts`:

```typescript
import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AccountingService } from '../src/modules/accounting/services/accounting.service'
import { UpstreamClient } from '../src/modules/accounting/services/upstream.client'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

describe('closeMonth', () => {
  let app: TestingModule
  let accounting: AccountingService
  let prisma: PrismaClientService
  const period = '2099-05'

  const upstream = {
    activeStores: jest.fn(),
    salesRevenueCents: jest.fn(),
    financeFor: jest.fn(),
    treasuryCategoryTotals: jest.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideProvider(UpstreamClient)
      .useValue(upstream)
      .compile()
    app = await moduleRef.init()
    accounting = app.get(AccountingService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterEach(async () => {
    await prisma.pnlSnapshot.deleteMany({ where: { period } })
    await prisma.ledgerEntry.deleteMany({ where: { period } })
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('closing the network closes every active store too, and reports who synced', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 601, name: 'Loja A' }, { id: 602, name: 'Loja B' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.salesRevenueCents.mockResolvedValue(100000)
    upstream.financeFor.mockResolvedValue(null)

    const result = await accounting.closeMonth(period, undefined, 2, true)

    expect(result.synced).toEqual({ stores_ok: [601, 602], stores_failed: [] })
    expect(result.status).toBe('closed')
    expect(result.store_id).toBeNull()

    const storeSnapshotA = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 601 } })
    const storeSnapshotB = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 602 } })
    expect(storeSnapshotA?.status).toBe('closed')
    expect(storeSnapshotB?.status).toBe('closed')
  })

  it('closing ONE store from its own view only touches that store, never the network or siblings', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 603, name: 'Loja C' }])
    upstream.salesRevenueCents.mockResolvedValue(50000)
    upstream.financeFor.mockResolvedValue(null)
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())

    const result = await accounting.closeMonth(period, 603, 1, true)

    expect(result.store_id).toBe(603)
    expect(upstream.activeStores).not.toHaveBeenCalled()
    const network = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: null } })
    expect(network).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd backend/apps/accounting-service && pnpm test:integration -- close-month`
Expected: FAIL — `accounting.closeMonth is not a function`.

- [ ] **Step 3: Implement `closeMonth`**

In `accounting.service.ts`, add (near `computeSnapshot`):

```typescript
  /**
   * The real entry point for "Fechar o mês"/"Reapurar e fechar". Syncs
   * real data in first (Task 3), then freezes the snapshot. Closing from
   * the NETWORK view (no storeId) cascades to every active store in the
   * same request — closes the gap this service's own CLAUDE.md names
   * ("fechar 24 lojas são 24 chamadas"). Closing ONE store from its own
   * view stays scoped to that store alone, same as today.
   */
  async closeMonth(
    period: string,
    storeId: number | undefined,
    storeCount: number,
    close: boolean,
    correlationId?: string,
  ): Promise<ReturnType<typeof this.computeSnapshot> extends Promise<infer T> ? T & { synced: { stores_ok: number[]; stores_failed: number[] } } : never> {
    if (storeId !== undefined) {
      const snapshot = await this.computeSnapshot(period, storeId, storeCount, close)
      return { ...snapshot, synced: { stores_ok: [], stores_failed: [] } }
    }

    const synced = await this.syncFromUpstreams(period, correlationId)
    const networkSnapshot = await this.computeSnapshot(period, undefined, storeCount, close)

    for (const okStoreId of synced.stores_ok) {
      await this.computeSnapshot(period, okStoreId, 1, close)
    }

    return { ...networkSnapshot, synced }
  }
```

- [ ] **Step 4: Update the controller to call `closeMonth` instead of `computeSnapshot`**

In `accounting.controller.ts`, change the `compute` handler:

```typescript
  @Post('pnl/:period/compute')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sync real data in, then freeze the period',
    description:
      'Closing the network (no store_id) now also syncs and closes every active store in the same request.',
  })
  compute(
    @Param('period') period: string,
    @Query('store_id') storeId?: string,
    @Query('store_count') storeCount?: string,
    @Query('close') close?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.accounting.closeMonth(
      period,
      storeId ? Number(storeId) : undefined,
      storeCount ? Number(storeCount) : 0,
      close === 'true',
      correlationId,
    )
  }
```

Add `Headers` to the `@nestjs/common` import at the top of the file.

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd backend/apps/accounting-service && pnpm test:integration -- close-month`
Expected: PASS, 2/2.

- [ ] **Step 6: Run the whole integration + unit suite**

Run:
```bash
cd backend/apps/accounting-service
pnpm test
pnpm test:integration
pnpm typecheck
```
Expected: everything PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/accounting-service/src/modules/accounting/services/accounting.service.ts backend/apps/accounting-service/src/modules/accounting/controllers/accounting.controller.ts backend/apps/accounting-service/test/close-month.integration-spec.ts
git commit -m "feat(accounting): close-month cascades sync+close to every active store"
```

---

### Task 5: Gateway bug fix — `compute` route drops its query string

**Files:**
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/accounting.controller.ts`
- Test: `backend/apps/gateway-service/test/accounting.integration-spec.ts` (create if it does not exist — check first; if a sibling domain controller already has one, follow its exact shape)

**Interfaces:**
- No new interface — fixes an existing route (`POST
  /accounting/pnl/:period/compute`) to forward `store_id`, `store_count`,
  `close` as query string to `accounting-service`, the same way
  `getPnlByPeriod` already forwards its own query string two routes down
  in the same file.

**Why this is in THIS plan, not a separate one:** found while researching
Task 4 — the gateway route's handler only reads `@Param('period')` and
`@Body()`, builds `path` with no query string at all, and
`accounting-service`'s own `compute`/`closeMonth` reads `store_id`,
`store_count` and `close` ONLY from the query string. Without this fix,
`close=true` and `store_count` from the real admin UI never reach
`accounting-service` — this plan's own feature would silently never
actually close anything when clicked through the browser.

- [ ] **Step 1: Confirm the bug (read, no code change yet)**

Run: `grep -n "postPnlByPeriodCompute" -A 12 backend/apps/gateway-service/src/modules/domains/controllers/accounting.controller.ts`
Expected: shows the handler builds `path` with no `${search}` anywhere,
unlike `getPnlByPeriod` just below it in the same file.

- [ ] **Step 2: Write the failing test**

First check whether this file already has an integration test:
`find backend/apps/gateway-service -iname "accounting*.spec.ts" -o -iname "accounting*integration*"`.

If one exists, add this test inside its existing `describe` block for the
compute route; if none exists, create
`backend/apps/gateway-service/test/accounting-compute.integration-spec.ts`
following whatever HTTP-testing pattern another domain controller's
existing integration test in this same service already uses (e.g.
`supertest` against the Fastify instance, with `DomainClient` mocked to
capture the outgoing call) — read one sibling file first and match its
exact setup before writing this test, since the harness for mocking
`DomainClient` is established elsewhere in this service and must not be
reinvented here.

The test itself, regardless of harness: call `POST
/accounting/pnl/2026-09/compute?store_count=20&close=true` (authenticated
as a session with `accounting:write`) and assert the mocked
`DomainClient.accounting` call received `path:
'/accounting/pnl/2026-09/compute?store_count=20&close=true'`.

- [ ] **Step 3: Run it, verify it fails**

Run the gateway-service test command for this new/modified file.
Expected: FAIL — captured `path` has no query string.

- [ ] **Step 4: Fix the handler**

In `backend/apps/gateway-service/src/modules/domains/controllers/accounting.controller.ts`:

```typescript
  @Post('pnl/:period/compute')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Sync real data in, then freeze the period' })
  async postPnlByPeriodCompute(
    @Param('period') period: string,
    @Query() query: Record<string, string>,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.accounting({
      method: 'post',
      path: `/accounting/pnl/${encodeURIComponent(period)}/compute${search ? `?${search}` : ''}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
```

- [ ] **Step 5: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 6: Run the gateway-service suite**

Run: `cd backend/apps/gateway-service && pnpm test && pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/gateway-service/src/modules/domains/controllers/accounting.controller.ts backend/apps/gateway-service/test/
git commit -m "fix(gateway): forward query string on POST /accounting/pnl/:period/compute"
```

---

### Task 6: Frontend — surface `synced` result, update loading copy

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/accounting.ts`
- Modify: `frontend/apps/admin/src/app/(app)/finance/pnl/page.tsx`

**Interfaces:**
- Consumes: `POST /accounting/pnl/:period/compute` now returns `{
  ...PnlSnapshot, synced: { stores_ok: number[]; stores_failed: number[]
  } }` (Task 4).

- [ ] **Step 1: Extend the RTK Query type and mutation return type**

In `frontend/apps/admin/src/lib/api/accounting.ts`, add a field to
`PnlSnapshot` is wrong — `synced` is not part of the snapshot shape
itself, it is extra. Instead, change just the `computePnl` mutation's
result type:

```typescript
    computePnl: builder.mutation<
      PnlSnapshot & { synced: { stores_ok: number[]; stores_failed: number[] } },
      { period: string; storeId?: number; storeCount: number; close?: boolean }
    >({
```

(Leave the `query` function and the rest of the endpoint untouched.)

- [ ] **Step 2: Show which stores failed, and update the loading label**

In `frontend/apps/admin/src/app/(app)/finance/pnl/page.tsx`, change the
`close()` function:

```typescript
  async function close() {
    const result = await compute({ period, storeId, storeCount: activeStores, close: true })
      .unwrap()
      .catch(() => null);
    if (result) {
      const failed = result.synced.stores_failed;
      toast.success(
        failed.length === 0
          ? `DRE de ${fmtPeriod(period)} fechado.`
          : `DRE de ${fmtPeriod(period)} fechado — ${failed.length} loja(s) sem dado automático: ${failed.join(", ")}.`,
      );
    }
  }
```

And the button label:

```tsx
            <Button variant="outline" onClick={close} disabled={computing}>
              {data?.status === "closed" ? <Lock /> : <RefreshCw />}
              {computing ? "Buscando dados e apurando..." : data?.status === "closed" ? "Reapurar e fechar" : "Fechar o mês"}
            </Button>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @agiliz/admin typecheck && pnpm --filter @agiliz/admin lint`
Expected: no errors (this app has no automated test suite — verification
here is typecheck/lint only, same as every other frontend change this
session; no live-browser check is possible, same disclosed limitation as
before).

- [ ] **Step 4: Commit**

```bash
git add frontend/apps/admin/src/lib/api/accounting.ts "frontend/apps/admin/src/app/(app)/finance/pnl/page.tsx"
git commit -m "feat(admin): surface which stores failed auto-sync on DRE close"
```

---

### Task 7: Frontend — manual entry dialog on each DRE account row

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/finance/pnl/page.tsx`

**Interfaces:**
- Consumes: `usePutEntryMutation` (already exists in
  `lib/api/accounting.ts`, already typed — see Current Work; never called
  by anything until this task), `toCents`/`fromCents`/`ResourceFormDialog`
  (already exist in `@/components/resource-form-dialog`, already imported
  in this file? — check the top of `pnl/page.tsx`; if not imported, add
  the import).

- [ ] **Step 1: Add the imports this task needs**

At the top of `pnl/page.tsx`, add (if not already present):

```typescript
import { Pencil } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ResourceFormDialog, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { usePutEntryMutation } from "@/lib/api/accounting";
```

(`useState` may already be imported alongside `useMemo` at the top — check
and merge into the existing React import line rather than duplicating it.)

- [ ] **Step 2: Define the manual-entry schema and fields, once, near `OPERATIONS`**

```typescript
const manualEntrySchema = z.object({
  amount: z.string().min(1, "Informe o valor"),
});
type ManualEntryForm = z.infer<typeof manualEntrySchema>;
const MANUAL_ENTRY_FIELDS: FieldSpec<ManualEntryForm>[] = [
  { name: "amount", label: "Valor (R$)", kind: "number", hint: "Lançamento manual — nunca sobrescrito por uma busca automática futura." },
];
```

- [ ] **Step 3: Add the edit affordance to `AccountRow`**

`AccountRow` (defined lower in the same file) needs two new props:
`period: string` and `canWrite: boolean`, and must render the dialog next
to the existing code badge. Change its signature and the label cell:

```tsx
function AccountRow({
  node,
  depth,
  netRevenue,
  compareView,
  period,
  canWrite,
}: {
  node: AccountNode;
  depth: number;
  netRevenue: number;
  compareView?: PnlView;
  period: string;
  canWrite: boolean;
}) {
  const [putEntry] = usePutEntryMutation();
  const [open, setOpen] = useState(false);
  // ...existing pct/compareNode/varCents/varPct lines stay exactly as they are...

  return (
    <>
      <TableRow>
        <TableCell style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
          <span className="text-sm">{node.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{node.code}</span>
          {canWrite && (
            <ResourceFormDialog
              title={`Lançar ${node.label} manualmente`}
              description="Substitui o valor atual desta conta e nunca é sobrescrito por uma busca automática futura."
              trigger={
                <Button variant="ghost" size="icon" className="ml-1 size-5">
                  <Pencil className="size-3" />
                </Button>
              }
              open={open}
              onOpenChange={setOpen}
              schema={manualEntrySchema}
              fields={MANUAL_ENTRY_FIELDS}
              defaultValues={{ amount: node.amount_cents ? (node.amount_cents / 100).toFixed(2) : "" } as ManualEntryForm}
              onSubmit={(values) =>
                putEntry({
                  account_id: node.id,
                  period,
                  amount_cents: toCents(values.amount),
                  origin: "manual",
                }).unwrap()
              }
            />
          )}
        </TableCell>
        {/* ...the rest of the row (Origem/valor/%/comparação cells) stays exactly as it is today... */}
```

Note: `node.id` here is the ACCOUNT id (`AccountNode.id`), not a store id —
confirm against the `AccountNode` interface in `lib/api/accounting.ts`
before wiring (it is: `id: number` is the account's own id, inherited
straight from `Account.id`). This dialog edits the NETWORK-level entry
(`store_id` omitted) — editing a per-store line from this consolidated
view is out of scope for this task (the consolidated DRE table does not
show per-store rows at all today; this dialog matches what the table
already shows).

- [ ] **Step 4: Pass the two new props at both call sites of `AccountRow`**

`AccountRow` is invoked from two places in the same file: inside
`SectionRows` (`section.accounts.map(...)`) and recursively inside itself
(`node.children.map(...)`). Add `period={period}` and `canWrite={canWrite}`
to BOTH call sites — `SectionRows` itself needs the same two new props
threaded through from `PnlPage`'s own JSX where it renders
`<SectionRows key={section.section} section={section} netRevenue={...} compareView={...} />` (`data.sections.map(...)`, inside the `RequestState` block).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @agiliz/admin typecheck && pnpm --filter @agiliz/admin lint`
Expected: no errors. Fix any prop-threading mismatch the compiler flags —
`AccountRow`/`SectionRows` are called from more than one place, and a
missed site will show as a type error, not a runtime surprise.

- [ ] **Step 6: Commit**

```bash
git add "frontend/apps/admin/src/app/(app)/finance/pnl/page.tsx"
git commit -m "feat(admin): manual DRE entry dialog on each account row"
```

---

## Final notes for whoever executes this plan

- No automated frontend test suite exists in this app (documented gap,
  `frontend/apps/admin/CLAUDE.md`) — Tasks 6 and 7 are verified by
  typecheck/lint only, exactly like every other admin-panel change made
  this session. There is no credential available to log into the real
  admin UI and click through this live; say so explicitly when reporting
  these two tasks done, rather than implying a browser check happened.
- `pnpm prisma:migrate` (Task 1) prompts interactively for a migration
  name when the migration folder doesn't already match what Prisma
  expects to generate — since the folder is created by hand in Step 2,
  `prisma migrate dev` should detect it as already-applied-shaped and
  apply cleanly; if it instead tries to generate a NEW migration, stop and
  use `prisma migrate resolve` guidance instead of letting it invent a
  second migration for the same change.
