# Fluxo de caixa (`/finance/cash-flow`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-premise `/finance/cash-flow` page with a real dashboard (regime de caixa) built on the same `bank_transaction` data as Lançamentos, and move the manual-premise form to `/finance/cash-flow/premises`.

**Architecture:** One new pure aggregation function in `treasury-service` (`computeCashFlow`) does all the balance/entradas-saídas math over already-fetched rows; the service method wraps it with two Prisma reads (opening balance via `groupBy`, in-range rows via `findMany`). A new `GET /treasury/transactions/cash-flow` route (treasury-service + gateway proxy) exposes it. The frontend adds one RTK Query hook, a new memoized `CashFlowMovementsTable`, and rebuilds `/finance/cash-flow/page.tsx` on top of it — reusing `SummaryCard` (promoted to a shared component), `DateRangePicker`, `ChartContainer`, and `useGetAccountsQuery`, all of which already exist.

**Tech Stack:** NestJS + Prisma (treasury-service), Fastify BFF (gateway-service), Next.js App Router + RTK Query + recharts + shadcn/ui (frontend/apps/admin).

**Spec:** `docs/superpowers/specs/2026-09-16-fluxo-de-caixa-design.md`

## Global Constraints

- Regime de caixa sempre: every query filters by `occurred_on` (real date), never `period` (competência).
- A `neutralized_with_id`-linked pair is excluded from every total, same rule `summary()`/`transactionsBySupplier()` already use (`neutralized_with_id: null` in every `where`) — confirmed in `prisma/schema.prisma:104-107`: "Um par vinculado é excluído dos totais dos dois lados."
- Saldo (opening/closing) = signed sum of ALL rows in scope, any `kind`/category. Entradas/Saídas = same sum EXCEPT the category `"Movimentação entre contas"` is dropped, and ONLY when `account_id` is unset ("Todas as contas"); with a specific `account_id`, nothing is excluded. This is what makes `saldo inicial + entradas − saídas = saldo final` hold for any account selection.
- Open Finance, Google Drive live sync, voice/photo capture, "Previsto" regime, and "Itens que explicam a diferença" are explicitly out of scope — do not add UI affordances for any of them, not even disabled placeholders.
- No automated test runner exists in `frontend/apps/admin` (confirmed: no `test` script, no vitest/jest/RTL in `package.json`) — frontend tasks are verified via `pnpm --filter @agiliz/admin typecheck`/`lint` plus live browser verification, not unit tests. `treasury-service` has `jest` configured and is verified with real TDD.
- Dev containers (`agiliz-treasury-dev`, `agiliz-gateway-dev`) do NOT bind-mount source — each `docker-compose.yml`'s `dev` target `COPY`s the repo at build time and runs `pnpm start` (no watch). A code change only reaches the running container after `docker compose build <service>-dev && docker compose up -d <service>-dev` from that service's directory.

---

### Task 1: `computeCashFlow` pure aggregation function

**Files:**
- Create: `backend/apps/treasury-service/src/modules/treasury/utils/cash-flow.ts`
- Test: `backend/apps/treasury-service/src/modules/treasury/utils/cash-flow.spec.ts`

**Interfaces:**
- Produces: `computeCashFlow(from: string, to: string, accountId: number | null, openingBalanceCents: number, transactions: CashFlowTransaction[]): CashFlowSummary`, plus the exported types `CashFlowTransaction`, `DailyCashFlow`, `CashFlowSummary`, and the exported constant `INTERNAL_TRANSFER_CATEGORY`. Task 2 imports all of these.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/apps/treasury-service/src/modules/treasury/utils/cash-flow.spec.ts
import { computeCashFlow, INTERNAL_TRANSFER_CATEGORY, type CashFlowTransaction } from './cash-flow'

function tx(partial: Partial<CashFlowTransaction> & Pick<CashFlowTransaction, 'occurred_on' | 'direction' | 'amount_cents'>): CashFlowTransaction {
  return { category: 'Estoque', ...partial }
}

describe('computeCashFlow', () => {
  it('returns the opening balance unchanged with no transactions in range', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 10_000, [])

    expect(result).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      account_id: null,
      opening_balance_cents: 10_000,
      inflow_cents: 0,
      outflow_cents: 0,
      closing_balance_cents: 10_000,
      daily: [],
    })
  })

  it('accumulates a running daily balance across multiple days, sorted ascending', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-02', direction: 'inflow', amount_cents: 500 }),
      tx({ occurred_on: '2026-06-01', direction: 'outflow', amount_cents: 200 }),
      tx({ occurred_on: '2026-06-02', direction: 'outflow', amount_cents: 100 }),
    ])

    expect(result.daily).toEqual([
      { date: '2026-06-01', inflow_cents: 0, outflow_cents: 200, balance_cents: -200 },
      { date: '2026-06-02', inflow_cents: 500, outflow_cents: 100, balance_cents: 200 },
    ])
    expect(result.inflow_cents).toBe(500)
    expect(result.outflow_cents).toBe(300)
    expect(result.closing_balance_cents).toBe(200)
  })

  it('excludes "Movimentação entre contas" from entradas/saídas in consolidated view, but keeps it in the balance', () => {
    // Same real transfer recorded on both accounts' statements: an outflow
    // leg on account 1 and the paired inflow leg on account 2, same day,
    // same amount — this is what makes the exclusion net to zero.
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-05', direction: 'outflow', amount_cents: 1_000, category: INTERNAL_TRANSFER_CATEGORY }),
      tx({ occurred_on: '2026-06-05', direction: 'inflow', amount_cents: 1_000, category: INTERNAL_TRANSFER_CATEGORY }),
      tx({ occurred_on: '2026-06-05', direction: 'inflow', amount_cents: 300, category: 'Vendas' }),
    ])

    expect(result.inflow_cents).toBe(300) // the transfer inflow leg is excluded
    expect(result.outflow_cents).toBe(0) // the transfer outflow leg is excluded
    // Balance reflects the true cash position: both transfer legs + the sale.
    expect(result.closing_balance_cents).toBe(1_000 - 1_000 + 300)
    // Formula closes exactly because both transfer legs landed in the window.
    expect(result.closing_balance_cents).toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })

  it('does NOT exclude "Movimentação entre contas" when a specific account is selected', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', 17, 0, [
      tx({ occurred_on: '2026-06-05', direction: 'outflow', amount_cents: 1_000, category: INTERNAL_TRANSFER_CATEGORY }),
    ])

    // From this single account's perspective the transfer is real cash
    // leaving — excluding it here would break the closing-balance identity.
    expect(result.outflow_cents).toBe(1_000)
    expect(result.closing_balance_cents).toBe(-1_000)
    expect(result.closing_balance_cents).toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })

  it('counts non-transfer `movement` categories (empréstimo, sócio, CDB) as real entradas/saídas', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-10', direction: 'inflow', amount_cents: 5_000, category: 'Financiamento/empréstimo' }),
    ])

    expect(result.inflow_cents).toBe(5_000)
    expect(result.closing_balance_cents).toBe(5_000)
  })

  it('documents the known edge case: a transfer pair split across the window boundary does not close exactly', () => {
    // Only the outflow leg of this transfer falls inside [from, to] — its
    // paired inflow leg landed the next day, past `to`. The balance still
    // reflects the real leg that happened in-window; the KPI cards drop it
    // (transfer exclusion) — so the identity has a residual, by design. See
    // "Gap conhecido" in the spec.
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-30', direction: 'outflow', amount_cents: 1_000, category: INTERNAL_TRANSFER_CATEGORY }),
    ])

    expect(result.inflow_cents).toBe(0)
    expect(result.outflow_cents).toBe(0) // excluded from the KPI view
    expect(result.closing_balance_cents).toBe(-1_000) // but the cash really left
    expect(result.closing_balance_cents).not.toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter treasury-service test -- cash-flow.spec.ts`
Expected: FAIL — `Cannot find module './cash-flow'`

- [ ] **Step 3: Write the implementation**

```typescript
// backend/apps/treasury-service/src/modules/treasury/utils/cash-flow.ts

/** One row as read from `bank_transaction`, already scoped to the query window. */
export interface CashFlowTransaction {
  occurred_on: string // "YYYY-MM-DD"
  direction: 'inflow' | 'outflow'
  amount_cents: number
  category: string
}

export interface DailyCashFlow {
  date: string
  inflow_cents: number
  outflow_cents: number
  /** Running balance through the end of this day — always includes every row, transfers included. */
  balance_cents: number
}

export interface CashFlowSummary {
  from: string
  to: string
  /** `null` = "Todas as contas" (consolidated). */
  account_id: number | null
  opening_balance_cents: number
  inflow_cents: number
  outflow_cents: number
  closing_balance_cents: number
  daily: DailyCashFlow[]
}

/**
 * Transferência entre as próprias contas Agiliz.AI — a categoria que sai de
 * Entradas/Saídas no consolidado (cada transferência grava uma perna de
 * saída numa conta e uma perna de entrada em outra, então soma zero ali),
 * mas NUNCA sai do saldo (é caixa real se movendo).
 */
export const INTERNAL_TRANSFER_CATEGORY = 'Movimentação entre contas'

/**
 * Agrega lançamentos já filtrados por `occurred_on` em [from, to] num
 * resumo de fluxo de caixa. Dois acumuladores independentes por dia — o
 * saldo soma TODA linha (é o saldo de caixa de verdade), Entradas/Saídas
 * somam tudo MENOS `INTERNAL_TRANSFER_CATEGORY` quando `accountId` é nulo
 * (consolidado). Com uma conta específica, nada é excluído — do ponto de
 * vista de uma conta isolada uma transferência é caixa real saindo/entrando
 * dela, e excluir quebraria "saldo inicial + entradas − saídas = saldo
 * final" para essa visão.
 *
 * A identidade acima fecha exatamente sempre que as duas pernas de cada
 * transferência caem dentro de [from, to] — o caso comum. Se uma
 * transferência for cortada pela borda do range (uma perna dentro, a outra
 * fora), o saldo ainda reflete a perna real que aconteceu na janela, mas
 * essa perna some do lado Entradas/Saídas — a diferença é o residual, não
 * escondido, não corrigido à força (ver spec, "Gap conhecido").
 */
export function computeCashFlow(
  from: string,
  to: string,
  accountId: number | null,
  openingBalanceCents: number,
  transactions: CashFlowTransaction[],
): CashFlowSummary {
  const excludeTransfers = accountId === null

  const byDate = new Map<string, { balanceDelta: number; flowInflow: number; flowOutflow: number }>()
  for (const t of transactions) {
    const bucket = byDate.get(t.occurred_on) ?? { balanceDelta: 0, flowInflow: 0, flowOutflow: 0 }
    const signed = t.direction === 'inflow' ? t.amount_cents : -t.amount_cents
    bucket.balanceDelta += signed

    const countsAsFlow = !excludeTransfers || t.category !== INTERNAL_TRANSFER_CATEGORY
    if (countsAsFlow) {
      if (t.direction === 'inflow') bucket.flowInflow += t.amount_cents
      else bucket.flowOutflow += t.amount_cents
    }
    byDate.set(t.occurred_on, bucket)
  }

  let runningBalance = openingBalanceCents
  const daily: DailyCashFlow[] = [...byDate.keys()].sort().map(date => {
    const bucket = byDate.get(date)!
    runningBalance += bucket.balanceDelta
    return { date, inflow_cents: bucket.flowInflow, outflow_cents: bucket.flowOutflow, balance_cents: runningBalance }
  })

  return {
    from,
    to,
    account_id: accountId,
    opening_balance_cents: openingBalanceCents,
    inflow_cents: daily.reduce((sum, d) => sum + d.inflow_cents, 0),
    outflow_cents: daily.reduce((sum, d) => sum + d.outflow_cents, 0),
    closing_balance_cents: runningBalance,
    daily,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter treasury-service test -- cash-flow.spec.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter treasury-service typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/treasury-service/src/modules/treasury/utils/cash-flow.ts backend/apps/treasury-service/src/modules/treasury/utils/cash-flow.spec.ts
git commit -m "feat(treasury): computeCashFlow pure aggregation for regime-de-caixa dashboard"
```

---

### Task 2: `CashFlowQueryDto` + `TreasuryService.cashFlow()`

**Files:**
- Modify: `backend/apps/treasury-service/src/modules/treasury/dto/treasury.dto.ts`
- Modify: `backend/apps/treasury-service/src/modules/treasury/services/treasury.service.ts`

**Interfaces:**
- Consumes: `computeCashFlow`, `CashFlowTransaction`, `CashFlowSummary` from Task 1 (`../utils/cash-flow`).
- Produces: `CashFlowQueryDto` (exported from `dto/treasury.dto.ts`), `TreasuryService.cashFlow(filter: CashFlowQueryDto): Promise<CashFlowSummary>`. Task 4 (controller) consumes both.

- [ ] **Step 1: Add `CashFlowQueryDto`**

Add to `backend/apps/treasury-service/src/modules/treasury/dto/treasury.dto.ts`, right after `ListTransactionsDto` (the class currently ending around line 265 with the closing `}` before `CreateMappingDto` starts):

```typescript
export class CashFlowQueryDto {
  @ApiProperty({ example: '2026-06-01', description: 'Início do range, sobre `occurred_on` (data real).' })
  @IsDateString()
  occurred_from: string

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  occurred_to: string

  @ApiPropertyOptional({ description: 'Omitido = "Todas as contas" (consolidado).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  account_id?: number
}
```

`ApiProperty`, `IsDateString`, `IsOptional`, `Type`, `IsInt` are already imported at the top of this file (used by `CreateTransactionDto`/`ListTransactionsDto`) — no new imports needed.

- [ ] **Step 2: Add `TreasuryService.cashFlow()`**

In `backend/apps/treasury-service/src/modules/treasury/services/treasury.service.ts`:

Add to the DTO type-only import block at the top:

```typescript
import type {
  BulkUpdateTransactionsDto,
  CashFlowQueryDto,
  CreateAccountDto,
  CreateFeeDto,
  CreateMappingDto,
  CreateTransactionDto,
  ListTransactionsDto,
  UpdateAccountDto,
  UpdateMappingDto,
  UpdateTransactionDto,
  UpsertSettlementDto,
} from '../dto/treasury.dto'
```

Add a new value import right below it:

```typescript
import { computeCashFlow, type CashFlowSummary } from '../utils/cash-flow'
```

Add the method — place it right after `summary()` (which ends around line 254, just before `transactionsBySupplier()`):

```typescript
  /**
   * Fluxo de caixa em regime de caixa — mesma tabela de `summary()`, mas por
   * `occurred_on` (data real) em vez de `period` (competência), e com saldo
   * de verdade (toda linha, qualquer `kind`) em vez de só receita/despesa.
   * Ver `computeCashFlow` pra a regra completa de o que entra em Entradas/
   * Saídas vs. saldo. `neutralized_with_id: null` nas duas queries, mesma
   * regra de `summary()`/`transactionsBySupplier()` — um par neutralizado
   * nunca entra em total nenhum.
   *
   * Gap conhecido, não escondido (documentado também na tela — ver
   * `frontend/apps/admin/.../finance/cash-flow/page.tsx`): `opening_balance_cents`
   * assume saldo zero antes do primeiro `bank_transaction` importado da
   * conta. Períodos que dependem de um mês sem extrato importado (ver
   * lacunas conhecidas no CLAUDE.md deste serviço) vêm com saldo inicial
   * incorreto — não há como resolver sem o extrato que falta ou uma âncora
   * de saldo manual, que não existe nesta fase.
   */
  async cashFlow(filter: CashFlowQueryDto): Promise<CashFlowSummary> {
    const from = new Date(filter.occurred_from)
    const to = new Date(filter.occurred_to)
    const accountId = filter.account_id ?? null

    const openingRows = await this.prisma.bankTransaction.groupBy({
      by: ['direction'],
      where: {
        occurred_on: { lt: from },
        neutralized_with_id: null,
        ...(accountId !== null ? { account_id: accountId } : {}),
      },
      _sum: { amount_cents: true },
    })
    const openingInflow = openingRows.find(r => r.direction === 'inflow')?._sum.amount_cents ?? 0
    const openingOutflow = openingRows.find(r => r.direction === 'outflow')?._sum.amount_cents ?? 0

    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        occurred_on: { gte: from, lte: to },
        neutralized_with_id: null,
        ...(accountId !== null ? { account_id: accountId } : {}),
      },
      select: { occurred_on: true, direction: true, amount_cents: true, category: true },
    })

    return computeCashFlow(
      filter.occurred_from,
      filter.occurred_to,
      accountId,
      openingInflow - openingOutflow,
      rows.map(r => ({
        occurred_on: r.occurred_on.toISOString().slice(0, 10),
        direction: r.direction as 'inflow' | 'outflow',
        amount_cents: r.amount_cents,
        category: r.category,
      })),
    )
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter treasury-service typecheck`
Expected: clean. (`direction` on `BankTransaction` is `String` in Prisma, not a union — the `as 'inflow' | 'outflow'` cast is required and safe: the column only ever holds those two values, same assumption `summary()` already makes implicitly.)

- [ ] **Step 4: Run full test suite**

Run: `pnpm --filter treasury-service test`
Expected: PASS (the 8 pre-existing vocabulary tests + the 6 new cash-flow tests).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/treasury-service/src/modules/treasury/dto/treasury.dto.ts backend/apps/treasury-service/src/modules/treasury/services/treasury.service.ts
git commit -m "feat(treasury): CashFlowQueryDto and TreasuryService.cashFlow()"
```

---

### Task 3: Prisma index for `(account_id, occurred_on)`

**Files:**
- Modify: `backend/apps/treasury-service/prisma/schema.prisma`
- Create (generated): `backend/apps/treasury-service/prisma/migrations/<timestamp>_add_account_occurred_on_index/migration.sql`

**Interfaces:** none — this task has no code interface, only a DB index other tasks' queries benefit from.

- [ ] **Step 1: Add the index**

In `backend/apps/treasury-service/prisma/schema.prisma`, inside `model BankTransaction`, add one line to the existing `@@index` block (currently lines 119-127):

```prisma
  @@index([period])
  @@index([account_id, period])
  @@index([account_id, occurred_on])
  @@index([supplier_id])
  @@index([nature, period])
  @@index([store_id, period])
  @@index([kind, period])
  @@index([neutralized_with_id])
  @@index([pending_import_id])
  @@index([mapping_rule_id])
  @@map("bank_transaction")
```

(New line inserted right after `@@index([account_id, period])` — every other existing index untouched.)

- [ ] **Step 2: Generate the migration against the running dev Postgres**

The treasury Postgres is published on the host at port 5442 (see `backend/apps/treasury-service/docker-compose.yml`, default credentials `agiliz`/`agiliz-dev-secret`, db `treasury`). Run from the repo root:

```bash
cd backend/apps/treasury-service
DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@localhost:5442/treasury" pnpm exec prisma migrate dev --name add_account_occurred_on_index
```

Expected: Prisma prints the new migration folder name and applies it — `bank_transaction_account_id_occurred_on_idx` created, no data loss (index-only change).

- [ ] **Step 3: Verify the migration file was generated**

Run: `ls backend/apps/treasury-service/prisma/migrations/ | tail -1`
Expected: a new `<timestamp>_add_account_occurred_on_index` directory, containing a `migration.sql` with a single `CREATE INDEX` statement.

- [ ] **Step 4: Typecheck (regenerates the Prisma client types)**

Run: `pnpm --filter treasury-service typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/treasury-service/prisma/schema.prisma backend/apps/treasury-service/prisma/migrations/
git commit -m "perf(treasury): index (account_id, occurred_on) for the cash-flow queries"
```

---

### Task 4: Routes — `treasury-service` controller + `gateway-service` proxy + docs

**Files:**
- Modify: `backend/apps/treasury-service/src/modules/treasury/controllers/treasury.controller.ts`
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/treasury.controller.ts`
- Modify: `backend/apps/treasury-service/CLAUDE.md`
- Modify: `backend/apps/gateway-service/CLAUDE.md`

**Interfaces:**
- Consumes: `TreasuryService.cashFlow()` and `CashFlowQueryDto` from Task 2.
- Produces: `GET /treasury/transactions/cash-flow` (treasury-service, internal) and `GET /treasury/transactions/cash-flow` (gateway, public, `treasury:read`). Task 5 (frontend) calls the gateway route.

- [ ] **Step 1: Add the route in `treasury-service`**

In `backend/apps/treasury-service/src/modules/treasury/controllers/treasury.controller.ts`, add `CashFlowQueryDto` to the existing type-only-looking import block (it's actually a value import already, since decorators need the real class — check the existing import statement, it imports `ListTransactionsDto` etc. as values already):

```typescript
import {
  BulkUpdateTransactionsDto,
  CashFlowQueryDto,
  CreateAccountDto,
  CreateFeeDto,
  CreateMappingDto,
  CreateTransactionDto,
  ListTransactionsDto,
  NeutralizeDto,
  UpdateAccountDto,
  UpdateMappingDto,
  UpdateTransactionDto,
  UpsertSettlementDto,
} from '../dto/treasury.dto'
```

Add the route right after `@Get('transactions/by-supplier')`'s handler (a `GET` sibling under `transactions/`, no `:id` route exists for `GET` so there's no ordering hazard like the `PATCH .../bulk` one):

```typescript
  @Get('transactions/cash-flow')
  @ApiOperation({ summary: 'Cash-flow summary (regime de caixa) for a day range, optionally scoped to one account' })
  cashFlow(@Query() query: CashFlowQueryDto) {
    return this.treasury.cashFlow(query)
  }
```

- [ ] **Step 2: Add the proxy route in `gateway-service`**

In `backend/apps/gateway-service/src/modules/domains/controllers/treasury.controller.ts`, add right after the `getTransactionsBySupplier` (or equivalent `transactions/by-supplier`) handler — anywhere among the other `GET transactions/*` handlers is fine, there's no route-ordering hazard for `GET`:

```typescript
  @Get('transactions/cash-flow')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'Cash-flow summary (regime de caixa) for a day range' })
  async getTransactionsCashFlow(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/transactions/cash-flow${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
```

- [ ] **Step 3: Typecheck both services**

Run: `pnpm --filter treasury-service typecheck && pnpm --filter gateway-service typecheck`
Expected: both clean.

- [ ] **Step 4: Document the new route**

In `backend/apps/treasury-service/CLAUDE.md`, add a row to the routes table right after the `GET /treasury/transactions/by-supplier` row:

```markdown
| `GET /treasury/transactions/cash-flow` | `{ occurred_from, occurred_to, account_id? }` → saldo inicial/final, entradas/saídas e `daily[]` — regime de caixa (não confundir com `summary`, que é competência e só receita/despesa) |
```

In `backend/apps/gateway-service/CLAUDE.md`, update the treasury row's route count and note (currently ends in "...`PATCH .../transactions/bulk` (`:write`...) aplica `nature`/`category` em lote..."):

```markdown
| `/treasury/accounts`, `/treasury/transactions`, `/treasury/mappings`, `/treasury/fees`, `/treasury/settlements`, `/treasury/categories` | `treasury:read` / `:write` | 24 rotas; `GET /treasury/transactions/summary` traz `unresolved_count`, `movement_cents`, `pending_count`/`pending_cents`; `.../by-supplier` consolida entre contas; `.../cash-flow` (regime de caixa, por `occurred_on`, usado só pela tela Fluxo de caixa — diferente de `summary`, que é por `period`); `.../neutralization-candidates` só sugere, `POST .../neutralize` (`:write`) vincula; `PATCH .../transactions/bulk` (`:write`, declarada antes de `:id` de propósito) aplica `nature`/`category` em lote — `nature` só grava nas linhas selecionadas com `kind: expense`, ignora as demais sem erro |
```

- [ ] **Step 5: Commit**

```bash
git add backend/apps/treasury-service/src/modules/treasury/controllers/treasury.controller.ts backend/apps/gateway-service/src/modules/domains/controllers/treasury.controller.ts backend/apps/treasury-service/CLAUDE.md backend/apps/gateway-service/CLAUDE.md
git commit -m "feat(treasury): expose GET /treasury/transactions/cash-flow through the gateway"
```

---

### Task 5: Frontend — RTK Query wiring

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/treasury.ts`

**Interfaces:**
- Produces: `useGetCashFlowSummaryQuery(filter: CashFlowFilter)`, and the types `CashFlowSummary`, `DailyCashFlow`, `CashFlowFilter`, exported from `@/lib/api/treasury`. Task 7 (movements table) and Task 9 (main page) consume these.

- [ ] **Step 1: Widen `toQuery`'s parameter type**

`toQuery` (around line 285) is currently typed to `TransactionFilter`. Widen it so it can serialize any flat filter object, including the new cash-flow one — its implementation already does a generic `Object.entries` + `String(value)`, so this is a type-only change:

```typescript
function toQuery(filter: Record<string, string | number | boolean | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}
```

- [ ] **Step 2: Add the response types and filter type**

Add near `TransactionSummary` (find it via `grep -n "export interface TransactionSummary" frontend/apps/admin/src/lib/api/treasury.ts`), right after it:

```typescript
export interface DailyCashFlow {
  date: string;
  inflow_cents: number;
  outflow_cents: number;
  balance_cents: number;
}

export interface CashFlowSummary {
  from: string;
  to: string;
  account_id: number | null;
  opening_balance_cents: number;
  inflow_cents: number;
  outflow_cents: number;
  closing_balance_cents: number;
  daily: DailyCashFlow[];
}

export interface CashFlowFilter {
  occurred_from: string;
  occurred_to: string;
  account_id?: number;
}
```

- [ ] **Step 3: Add the query endpoint**

Add right after `getTransactionSummary` in the `endpoints` builder:

```typescript
    getCashFlowSummary: builder.query<CashFlowSummary, CashFlowFilter>({
      query: (filter) => `/treasury/transactions/cash-flow${toQuery(filter)}`,
      providesTags: ["Transaction"],
    }),
```

- [ ] **Step 4: Export the hook**

Add to the destructured export block at the bottom, right after `useGetTransactionSummaryQuery`:

```typescript
  useGetCashFlowSummaryQuery,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @agiliz/admin typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/lib/api/treasury.ts
git commit -m "feat(admin): useGetCashFlowSummaryQuery"
```

---

### Task 6: Promote `SummaryCard` to a shared component

**Files:**
- Create: `frontend/apps/admin/src/components/summary-card.tsx`
- Modify: `frontend/apps/admin/src/app/(app)/treasury/page.tsx`

**Interfaces:**
- Produces: `SummaryCard` (default usage: `import { SummaryCard } from "@/components/summary-card"`), same props it has today: `{ label: string; value: string; tone?: "positive" | "critical" | "attention" | "muted"; hint?: string; onClick?: () => void; icon?: LucideIcon; trend?: number | null }`. Task 9 (main dashboard page) consumes this.

- [ ] **Step 1: Create the shared component**

`treasury/page.tsx` currently defines `SummaryCard` as a local (non-exported) function, right after `TreasuryPage`'s closing `}` (search `function SummaryCard({` to find it — it spans from its own JSDoc comment through its closing `}`, roughly 60 lines, using `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/card` and `TrendingUp`/`TrendingDown` from `lucide-react`).

Move that whole function (JSDoc comment included) verbatim into a new file:

```typescript
// frontend/apps/admin/src/components/summary-card.tsx
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * `trend` é sempre calculado de um segundo `getTransactionSummaryQuery` do
 * mês anterior de verdade — nunca uma variação inventada. `trendPercent`
 * volta `null` sem base de comparação (mês anterior zerado), e aqui isso
 * vira "sem comparação" em vez de uma seta/porcentagem sem sentido — mesmo
 * princípio de "vazio honesto" do resto do painel (ver DESIGN.md), só que
 * na célula do card. Compartilhado entre Lançamentos e Fluxo de caixa —
 * não duplicar.
 */
export function SummaryCard({
  label,
  value,
  tone,
  hint,
  onClick,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  tone?: "positive" | "critical" | "attention" | "muted";
  hint?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  trend?: number | null;
}) {
  const color =
    tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : tone === "attention" ? "text-warning" : "";
  const badgeBg =
    tone === "positive"
      ? "bg-success/12 text-success"
      : tone === "critical"
        ? "bg-destructive/12 text-destructive"
        : tone === "attention"
          ? "bg-warning/12 text-warning"
          : "bg-muted text-muted-foreground";
  return (
    <Card
      className={`${tone === "muted" ? "border-dashed" : ""} ${onClick ? "cursor-pointer transition-colors hover:bg-accent/50" : ""}`}
      {...(onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && onClick() } : {})}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          {Icon && (
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${badgeBg}`}>
              <Icon className="size-4" />
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${tone === "muted" ? "text-muted-foreground" : color}`}>{value}</p>
        {trend !== undefined &&
          (trend === null ? (
            <p className="mt-1 text-xs text-muted-foreground">Sem comparação com o mês anterior</p>
          ) : (
            <p className={`mt-1 flex items-center gap-1 text-xs ${trend >= 0 ? "text-success" : "text-destructive"}`}>
              {trend >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {Math.abs(trend).toFixed(0)}% vs. mês anterior
            </p>
          ))}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
```

(Note the one real change from the original: the inline `onKeyDown` handler's parameter now has an explicit `(e: React.KeyboardEvent)` type. Inside `treasury/page.tsx` this was inferred from JSX context; as a standalone exported function it needs the annotation, or `tsc` will complain about an implicit `any`.)

- [ ] **Step 2: Delete the local definition and import the shared one**

In `treasury/page.tsx`:
- Delete the local `function SummaryCard({ ... }) { ... }` block entirely (the one just moved).
- Add the import: `import { SummaryCard } from "@/components/summary-card";` (alongside the other `@/components/*` imports near the top).
- `TrendingDown`/`TrendingUp` may now be unused in `treasury/page.tsx` if nothing else in that file uses them — check with `grep -n "TrendingDown\|TrendingUp" frontend/apps/admin/src/app/\(app\)/treasury/page.tsx`; if the only remaining hits are the `lucide-react` import line itself, remove both names from that import.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @agiliz/admin typecheck && pnpm --filter @agiliz/admin lint`
Expected: both clean, no unused-import warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/apps/admin/src/components/summary-card.tsx "frontend/apps/admin/src/app/(app)/treasury/page.tsx"
git commit -m "refactor(admin): promote SummaryCard to a shared component"
```

---

### Task 7: `CashFlowMovementsTable` component

**Files:**
- Create: `frontend/apps/admin/src/components/cash-flow-movements-table.tsx`

**Interfaces:**
- Consumes: `BankTransaction`, `BankAccount` types from `@/lib/api/treasury` (already exist).
- Produces: `CashFlowMovementsTable` component, props `{ transactions: BankTransaction[]; accountById: Map<number, { name: string }> }`. Task 9 (main page) consumes this.

- [ ] **Step 1: Write the component**

Mirrors `TransactionsTable` in `treasury/page.tsx` (memoized for the same reason — this list can be as large as the Lançamentos one) but with the column set the spec calls for: Data | Descrição | Tipo (Entrada/Saída/Transferência) | Valor | Regime | Conciliado. No inline editing here — this is a read-only, regime-de-caixa VIEW; editing still happens in Lançamentos.

```typescript
// frontend/apps/admin/src/components/cash-flow-movements-table.tsx
"use client";

import { memo } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { date, money } from "@/lib/format";
import type { BankTransaction } from "@/lib/api/treasury";

const INTERNAL_TRANSFER_CATEGORY = "Movimentação entre contas";

function movementType(t: BankTransaction): "Transferência" | "Entrada" | "Saída" {
  if (t.category === INTERNAL_TRANSFER_CATEGORY) return "Transferência";
  return t.direction === "inflow" ? "Entrada" : "Saída";
}

/**
 * Mesmo raciocínio de `TransactionsTable` (Lançamentos): `memo` porque um
 * período cheio passa de 2 mil lançamentos, e esta tabela não deve
 * re-renderizar quando outro estado da página (filtro de conta, seletor de
 * período) muda sem afetar `transactions`/`accountById`.
 */
export const CashFlowMovementsTable = memo(function CashFlowMovementsTable({
  transactions,
  accountById,
}: {
  transactions: BankTransaction[];
  accountById: Map<number, { name: string }>;
}) {
  if (transactions.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma movimentação neste período.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Descrição</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead className="tabular text-right">Valor</TableHead>
          <TableHead>Regime</TableHead>
          <TableHead>Conciliado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => {
          const type = movementType(t);
          return (
            <TableRow key={t.id}>
              <TableCell className="tabular whitespace-nowrap">{date(t.occurred_on)}</TableCell>
              <TableCell>
                <span className="font-medium">{t.counterparty_raw}</span>
                <div className="text-xs text-muted-foreground">
                  {accountById.get(t.account_id)?.name ?? `Conta ${t.account_id}`}
                </div>
              </TableCell>
              <TableCell className={type === "Entrada" ? "text-success" : undefined}>{type}</TableCell>
              <TableCell className={`tabular text-right ${t.direction === "inflow" ? "text-success" : ""}`}>
                {t.direction === "inflow" ? "+" : "−"}
                {money(t.amount_cents)}
              </TableCell>
              {/* Sempre Realizado nesta fase — "Previsto" está fora de escopo (ver spec). */}
              <TableCell>Realizado</TableCell>
              <TableCell>
                <StatusBadge tone={t.kind === "pending" ? "attention" : "positive"}>
                  {t.kind === "pending" ? "Pendente" : "Sim"}
                </StatusBadge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
});
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter @agiliz/admin typecheck && pnpm --filter @agiliz/admin lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/apps/admin/src/components/cash-flow-movements-table.tsx
git commit -m "feat(admin): CashFlowMovementsTable"
```

---

### Task 8: Move the premises form to `/finance/cash-flow/premises`

**Files:**
- Create: `frontend/apps/admin/src/app/(app)/finance/cash-flow/premises/page.tsx`
- Delete: `frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx` (recreated as the new dashboard in Task 9 — deleting it here keeps this task a clean, reviewable move)

**Interfaces:** none new — this is a pure relocation of the existing `CashFlowPage` component and its existing `accounting-service` hooks.

- [ ] **Step 1: Copy the file to its new location, updating only the title**

Read the current `frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx` in full, then write it to `frontend/apps/admin/src/app/(app)/finance/cash-flow/premises/page.tsx` unchanged except the `PageHeader` title/description, so the breadcrumb and heading don't still say "Fluxo de caixa" once the real dashboard also carries that name:

```typescript
      <PageHeader
        title="Premissas mensais"
        description="Saldo inicial, recebimentos, OPEX, empréstimos e CAPEX digitados por mês — usado enquanto payback e repasse dependerem de premissa, não de dado real."
        actions={
```

(Every other line — imports, schema, `FIELDS`, the query/mutation hooks, the chart, the table — is copied verbatim, no logic change.)

- [ ] **Step 2: Delete the old file at the original path**

```bash
rm "frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx"
```

(This intentionally leaves the route with no `page.tsx` for one commit — Task 9 restores it as the new dashboard. If executing tasks in strict sequence this is a brief, local, non-deployed gap; if that's undesirable, do Task 8 and Task 9 in the same working session before committing either.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @agiliz/admin typecheck`
Expected: clean (the old route simply won't exist until Task 9 — Next.js doesn't error on a missing page at typecheck time).

- [ ] **Step 4: Commit**

```bash
git add "frontend/apps/admin/src/app/(app)/finance/cash-flow/premises/page.tsx" "frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx"
git commit -m "refactor(admin): move the manual cash-flow premises form to /finance/cash-flow/premises"
```

---

### Task 9: The new `/finance/cash-flow` dashboard page

**Files:**
- Create: `frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx`

**Interfaces:**
- Consumes: `SummaryCard` (Task 6), `CashFlowMovementsTable` (Task 7), `useGetCashFlowSummaryQuery`/`CashFlowSummary`/`DailyCashFlow` (Task 5), plus already-existing `useGetAccountsQuery`, `useGetTransactionsQuery`, `useGetTransactionSummaryQuery` (for `by_category`, called with `occurred_from`/`occurred_to`), `DateRangePicker`/`DayRange`, `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartConfig`, `money`/`moneyCompact`/`date`/`currentPeriod` from `@/lib/format`.

- [ ] **Step 1: Write the page**

```typescript
// frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Landmark, Scale, Wallet } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, Pie, PieChart, XAxis, YAxis } from "recharts";

import { DateRangePicker, type DayRange } from "@/components/date-range-picker";
import { CashFlowMovementsTable } from "@/components/cash-flow-movements-table";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { SummaryCard } from "@/components/summary-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { date, money, moneyCompact } from "@/lib/format";
import {
  useGetAccountsQuery,
  useGetCashFlowSummaryQuery,
  useGetTransactionSummaryQuery,
  useGetTransactionsQuery,
} from "@/lib/api/treasury";

const dailyChartConfig: ChartConfig = {
  inflow_cents: { label: "Entradas", color: "var(--success)" },
  outflow_cents: { label: "Saídas", color: "var(--destructive)" },
  balance_cents: { label: "Saldo do dia", color: "var(--chart-1)" },
};

const CATEGORY_DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Primeiro e último dia do mês corrente, em "YYYY-MM-DD" — o range padrão ao abrir a tela. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toIso(from), to: toIso(to) };
}

export default function CashFlowDashboardPage() {
  const [range, setRange] = useState<DayRange>(currentMonthRange());
  const [accountId, setAccountId] = useState<string>("all");

  const { data: accounts } = useGetAccountsQuery();
  const accountById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);

  const filter = {
    occurred_from: range.from ?? currentMonthRange().from,
    occurred_to: range.to ?? currentMonthRange().to,
    ...(accountId === "all" ? {} : { account_id: Number(accountId) }),
  };

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useGetCashFlowSummaryQuery(filter, { skip: !range.from || !range.to });

  // "Despesa por categoria" reaproveita o `summary()` de Lançamentos — mesma
  // regra de by_category (só kind: expense), só que por occurred_on em vez
  // de period. Nenhum código novo no backend para isso (ver spec).
  const { data: categorySummary } = useGetTransactionSummaryQuery(filter, { skip: !range.from || !range.to });

  const { data: movements, isLoading: movementsLoading, error: movementsError, refetch: refetchMovements } = useGetTransactionsQuery(
    filter,
    { skip: !range.from || !range.to },
  );

  const dailyChartData = (summary?.daily ?? []).map((d) => ({
    ...d,
    inflow_cents: d.inflow_cents / 100,
    outflow_cents: d.outflow_cents / 100,
    balance_cents: d.balance_cents / 100,
    label: date(d.date),
  }));

  const donutData = (categorySummary?.by_category ?? []).map((row, i) => ({
    name: row.category,
    value: row.outflow_cents / 100,
    fill: CATEGORY_DONUT_COLORS[i % CATEGORY_DONUT_COLORS.length],
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fluxo de caixa"
        description="Trajetória de caixa em regime de caixa — data real de pagamento/recebimento, nunca competência."
        actions={
          <Button variant="outline" asChild>
            <Link href="/finance/cash-flow/premises">Premissas mensais</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {(accounts ?? []).map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RequestState
        isLoading={summaryLoading}
        error={summaryError}
        isEmpty={!summary}
        emptyMessage="Sem dado de fluxo de caixa para este período."
        onRetry={refetchSummary}
        loadingRows={2}
      >
        {summary && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                label="Saldo inicial"
                value={money(summary.opening_balance_cents)}
                icon={Wallet}
                tone="muted"
                hint="Soma do extrato importado antes desta data — contas com lacuna de importação conhecida (ver CLAUDE.md) ficam incorretas aqui."
              />
              <SummaryCard label="Entradas" value={money(summary.inflow_cents)} icon={ArrowUpCircle} tone="positive" />
              <SummaryCard label="Saídas" value={money(summary.outflow_cents)} icon={ArrowDownCircle} tone="critical" />
              <SummaryCard
                label="Saldo final"
                value={money(summary.closing_balance_cents)}
                icon={Scale}
                tone={summary.closing_balance_cents >= 0 ? "positive" : "critical"}
                hint="Saldo inicial + entradas − saídas"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Fluxo de caixa diário</CardTitle>
                </CardHeader>
                <CardContent>
                  {dailyChartData.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nenhuma movimentação neste período.</p>
                  ) : (
                    <ChartContainer config={dailyChartConfig} className="h-64 w-full">
                      <ComposedChart data={dailyChartData} margin={{ top: 24 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--muted-foreground)" }}
                          tickFormatter={(value: number) => moneyCompact(value * 100)}
                        />
                        <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />} />
                        <Bar dataKey="inflow_cents" fill="var(--color-inflow_cents)" radius={4} />
                        <Bar dataKey="outflow_cents" fill="var(--color-outflow_cents)" radius={4} />
                        <Line type="monotone" dataKey="balance_cents" stroke="var(--color-balance_cents)" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Despesas por categoria</CardTitle>
                </CardHeader>
                <CardContent>
                  {donutData.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nenhuma despesa classificada neste período.</p>
                  ) : (
                    <ChartContainer config={{}} className="h-64 w-full">
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />} />
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} />
                      </PieChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Contas</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {(accounts ?? []).map((a) => {
                  const lastMovement = (movements ?? [])
                    .filter((t) => t.account_id === a.id)
                    .sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))[0];
                  return (
                    <div key={a.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
                      <span className="flex items-center gap-2">
                        <Landmark className="size-4 text-muted-foreground" />
                        {a.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {lastMovement ? `Extrato importado até ${date(lastMovement.occurred_on)}` : "Sem extrato importado"}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </RequestState>

      <RequestState
        isLoading={movementsLoading}
        error={movementsError}
        isEmpty={(movements ?? []).length === 0}
        emptyMessage="Nenhuma movimentação neste período."
        onRetry={refetchMovements}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Movimentações</CardTitle>
          </CardHeader>
          <CardContent>
            <CashFlowMovementsTable transactions={movements ?? []} accountById={accountById} />
          </CardContent>
        </Card>
      </RequestState>
    </div>
  );
}
```

Notes on decisions embedded above (so the implementer doesn't second-guess them):
- The spec lists a "fórmula de fechamento em destaque" (Saldo inicial · Entradas · Saídas · Saldo final) AND, separately, "4 cards de KPI" with overlapping terms (Entradas, Saídas, Saldo do período, Saldo final conciliado) — mirroring how the original mockup spec listed them as two sections. With "conciliado" simplified to "já classificado" (per the approved design doc), "saldo final" and "saldo final conciliado" collapsed into the same number, so a second near-duplicate row of cards would just repeat the first one. This page renders ONE row of 4 `SummaryCard`s that satisfies both: each term is its own card (the formula), and the row IS the KPI row. Deliberate collapse, not an oversight.
- `filter` is built as `occurred_from`/`occurred_to`/optional `account_id` — the exact shape `CashFlowFilter` and `TransactionFilter` (for the reused `summary`/`transactions` endpoints) both accept, since both already support `occurred_from`/`occurred_to`/`account_id`.
- `useGetTransactionSummaryQuery` and `useGetTransactionsQuery` here are the SAME hooks Lançamentos uses — just called with `occurred_from`/`occurred_to` instead of `period`. No backend change needed for either, per the spec.
- `DateRangePicker` is used for the day-range selector — same component Lançamentos already uses for its own (unrelated) date-range filter.
- No `useMemo` is added around `dailyChartData`/`donutData`/`accountById`'s per-render `.map()`/`.filter()` beyond what's shown — this page's data volume is a handful of accounts and (at most) `daily.length` ≈ days in the selected range (≤31), not the ~2000-row scale that made memoization necessary on Lançamentos. The one exception, `accountById`, IS memoized (small map, but built from a query result reused across renders — matches the established pattern). `CashFlowMovementsTable` (Task 7) is the component that actually renders up to ~2000 rows, and it is already `memo`-wrapped.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @agiliz/admin typecheck`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @agiliz/admin lint`
Expected: clean (same 2 pre-existing `ingestion/page.tsx` warnings, nothing new).

- [ ] **Step 4: Commit**

```bash
git add "frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx"
git commit -m "feat(admin): rebuild /finance/cash-flow as a real regime-de-caixa dashboard"
```

---

### Task 10: Document the split in `frontend/apps/admin/CLAUDE.md`

**Files:**
- Modify: `frontend/apps/admin/CLAUDE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a note under the Tesouraria section**

Find the `## Tesouraria` (or equivalent) section header in `frontend/apps/admin/CLAUDE.md` and add, after the existing bullet list, a new bullet:

```markdown
- **`/finance/cash-flow` é dois arquivos, não um**: `page.tsx` (o dashboard
  real, regime de caixa — `GET /treasury/transactions/cash-flow`, dado
  agregado pelo `computeCashFlow` puro em `treasury-service/.../utils/
  cash-flow.ts`) e `premises/page.tsx` (o formulário mensal antigo,
  `accounting-service`, PREMISSA digitada — ainda vivo porque
  `capex-service`/`billing-service` dependem dele enquanto payback/repasse
  forem métrica derivada, ver CLAUDE.md raiz). Os números de Entrada/Despesa
  do dashboard **divergem de propósito** dos cards de Lançamentos: aqui
  inclui `kind: movement` não-transferência (empréstimo, sócio, CDB) porque
  é caixa real, e exclui só a categoria "Movimentação entre contas" — nunca
  os dois ao mesmo tempo. Ver
  `docs/superpowers/specs/2026-09-16-fluxo-de-caixa-design.md` para a
  regra completa.
```

- [ ] **Step 2: Commit**

```bash
git add frontend/apps/admin/CLAUDE.md
git commit -m "docs(admin): document the cash-flow dashboard/premises split"
```

---

### Task 11: End-to-end verification

**Files:** none — this task runs the built feature, no code changes.

**Interfaces:** none.

- [ ] **Step 1: Rebuild and restart the two backend dev containers**

Source is not bind-mounted into `agiliz-treasury-dev`/`agiliz-gateway-dev` — a fresh image is required to pick up Tasks 1-4:

```bash
cd backend/apps/treasury-service && docker compose build treasury-dev && docker compose up -d treasury-dev
cd ../gateway-service && docker compose build gateway-dev && docker compose up -d gateway-dev
```

Expected: both build steps end with the image tag printed (`Built`), both `up -d` steps end `Started`.

- [ ] **Step 2: Confirm both containers are healthy**

```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "treasury-dev|gateway-dev"
```

Expected: both rows show `(healthy)`.

- [ ] **Step 3: Smoke-test the new endpoint directly**

```bash
docker exec agiliz-gateway-dev node -e "
fetch('http://agiliz-treasury-dev:3000/treasury/transactions/cash-flow?occurred_from=2026-06-01&occurred_to=2026-06-30')
  .then(async r => { console.log(r.status); console.log(await r.text()); })
"
```

Expected: `200`, a JSON body with `opening_balance_cents`, `inflow_cents`, `outflow_cents`, `closing_balance_cents`, and a `daily` array. Sanity-check by hand: `closing_balance_cents` should equal `opening_balance_cents + inflow_cents - outflow_cents` for this consolidated (no `account_id`) call, for the reasons Task 1 documents.

- [ ] **Step 4: Create a disposable QA user, verify in a real browser, then delete it**

Same procedure already established this session (see this session's own history for the exact commands) — do NOT reset the real user `barbara@agilizai24h.com.br`'s password:

```bash
docker exec agiliz-gateway-dev node -e "
fetch('http://agiliz-iam-dev:3000/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'qa.cashflow.test@agilizai24h.com.br', name: 'QA Cash Flow Test', password: '<generate a random 20-char password>', roles: ['administrator'] })
}).then(async r => { console.log(r.status); console.log(await r.text()); })
"
```

Then, using the browser automation tool available in this environment:
- Log in at `http://192.168.15.10:3000/login` with that user (use the gateway's `ADMIN_ORIGIN` host, not `localhost` — a different origin gets CORS-blocked, as discovered earlier this session).
- Navigate to `http://192.168.15.10:3000/finance/cash-flow`.
- Confirm: 4 KPI cards render (Saldo inicial, Entradas, Saídas, Saldo final), the daily chart renders bars+line, the donut renders, the "Contas" card lists real accounts with an "Extrato importado até ..." label (never a fake "sincronizado" claim), the movements table renders with Tipo/Regime/Conciliado columns, and the "Premissas mensais" button navigates to `/finance/cash-flow/premises` showing the old manual-entry form intact.
- By hand, for one account selected in the account filter (not "Todas as contas"), confirm `saldo final = saldo inicial + entradas − saídas` holds exactly (read the 4 KPI card values).

- [ ] **Step 5: Clean up**

```bash
docker exec agiliz-iam-postgres psql -U agiliz -d iam -c "DELETE FROM \"user\" WHERE email='qa.cashflow.test@agilizai24h.com.br';"
```

- [ ] **Step 6: Final full-workspace check**

```bash
pnpm turbo run typecheck lint --filter=treasury-service --filter=gateway-service --filter=@agiliz/admin
```

Expected: all green.
