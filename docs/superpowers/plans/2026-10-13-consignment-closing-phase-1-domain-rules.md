# Fechamento de consignação — Fase 1: regras de domínio puras

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar, como funções puras e testadas, todas as regras de cálculo da spec (períodos, identidade de venda, saldo, custo, atribuição, ajustes, devoluções e o cálculo do fechamento), sem banco, rede ou framework.

**Architecture:** Arquivos pequenos em `backend/apps/suppliers-service/src/modules/purchasing/utils/`, prefixo `consignment-`, cada um com seu `.spec.ts`, no mesmo estilo de `settlement.ts`/`settlement.spec.ts`. Entradas e saídas são tipos simples; as fases seguintes (persistência, upstream, serviço, UI) só ligam fontes reais a estas funções.

**Tech Stack:** TypeScript, jest 30 + ts-jest (`pnpm test` dentro de `backend/apps/suppliers-service`). Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-13-supplier-consignment-closing-design.md`

## Roteiro das fases (planos separados, escritos depois de esta fase estar verde)

1. **Esta fase** — regras puras.
2. Persistência e razão no suppliers-service: migração Prisma, acordo/custos/saldo inicial, movimentos, migração dos acertos antigos (§3, §4, §8).
3. Upstream: rota de vendas por loja com chaves no sales-service; motivo por visita, `Origem`/`Lote`/`Validade` opcionais e evento de recebimento parcial (§5A, §4).
4. Serviço e fluxo do fechamento: estados, pagamentos, confirmação, cancelamento/reversão, aceite parcial, exportação PDF/Excel, gateway e permissões (§6, §7).
5. Interface no admin (§9).

## Global Constraints

- Intervalos de período são **semiabertos `[início, fim)`**, sem sobreposição e sem lacuna; o primeiro período começa exatamente no corte.
- Dias selecionados são interpretados em **America/Sao_Paulo**, incluídos por inteiro (fim = início do dia seguinte).
- Só vendas com `result === 'OK'` entram no repasse; venda sem instante ou sem identificador de recibo é **pendência bloqueante**, nunca zero.
- **Repasse = soma(quantidade líquida vendida × custo de repasse vigente na data da venda).** Não usa preço de venda; não desconta imposto, taxa de cartão, margem ou despesa; vencidos não vendidos não geram pagamento nem desconto.
- Custo ausente na data da venda **bloqueia**. Nunca se usa "custo do lote recebido".
- Venda de SKU com saldo de **dois ou mais fornecedores** não é atribuída sozinha: pendência bloqueante; o sistema só sugere (ESTIMATIVA).
- Saldo negativo é reportado, nunca zerado. Vendas nunca viram movimento: o saldo desconta as vendas líquidas desde o corte até a data consultada.
- Dinheiro em **centavos inteiros**; nunca float.
- Estilo do repo: TypeScript sem ponto e vírgula, aspas simples, funções puras com `.spec.ts` ao lado; comentários só onde explicam uma regra de negócio.

## Review Focus

1. Venda sem instante ou sem identificador de recibo: deve bloquear a confirmação, nunca sumir do total (Task 8).
2. Venda exatamente no instante `end` do período: pertence ao período seguinte, não ao atual (Tasks 1 e 8).
3. Rodar o cálculo de novo com vendas já confirmadas: não pode cobrar de novo (`claimedKeys`) (Task 8).
4. SKU com saldo de dois fornecedores: pendência, não atribuição silenciosa (Tasks 5 e 8).
5. Saldo negativo e chave de venda que sumiu de uma reimportação: aparecem como sinal (`negative`, `missing`), nunca como zero nem como cancelamento presumido (Tasks 3 e 6).

---

### Task 1: Períodos em America/Sao_Paulo

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-period.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-period.spec.ts`

**Interfaces:**
- Consumes: `addDays(day: string, delta: number): string`, `isDay(value: string): boolean` de `./week`.
- Produces: `interface Period { start: Date; end: Date }`; `spDayStart(day: string): Date`; `spDayOf(instant: Date): string`; `periodFromDays(firstDay: string, lastDay: string): Period`; `contains(period: Period, instant: Date): boolean`; `overlaps(a: Period, b: Period): boolean`; `findGaps(periods: Period[]): Period[]`; `suggestNext(lastEnd: Date | null, cutoff: Date, lengthDays: number): Period`.

- [ ] **Step 1: Write the failing test**

```ts
import { contains, findGaps, overlaps, periodFromDays, spDayOf, spDayStart, suggestNext } from './consignment-period'

describe('consignment periods — America/Sao_Paulo, half-open [start, end)', () => {
  it('a selected day range includes the first and the last day entirely', () => {
    const period = periodFromDays('2026-09-30', '2026-10-06')

    expect(period.start.toISOString()).toBe('2026-09-30T03:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-10-07T03:00:00.000Z')
    expect(contains(period, new Date('2026-10-07T02:59:59.999Z'))).toBe(true)
  })

  it('an instant exactly on `end` belongs to the next period, not this one', () => {
    const period = periodFromDays('2026-09-30', '2026-10-06')

    expect(contains(period, period.end)).toBe(false)
    expect(contains(period, period.start)).toBe(true)
  })

  it('maps an instant to its Sao Paulo calendar day', () => {
    expect(spDayOf(new Date('2026-10-01T02:59:59Z'))).toBe('2026-09-30')
    expect(spDayOf(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10-01')
    expect(spDayStart('2026-10-01').toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })

  it('rejects impossible days and reversed ranges', () => {
    expect(() => spDayStart('2026-02-30')).toThrow(RangeError)
    expect(() => periodFromDays('2026-10-06', '2026-09-30')).toThrow(RangeError)
  })

  it('adjacent periods do not overlap; shared time does', () => {
    const a = periodFromDays('2026-09-30', '2026-10-06')
    const b = periodFromDays('2026-10-07', '2026-10-13')
    const c = periodFromDays('2026-10-06', '2026-10-08')

    expect(overlaps(a, b)).toBe(false)
    expect(overlaps(a, c)).toBe(true)
  })

  it('reports a gap between non-adjacent periods, even when an earlier one is long', () => {
    const long = periodFromDays('2026-09-30', '2026-10-20')
    const inside = periodFromDays('2026-10-05', '2026-10-06')
    const later = periodFromDays('2026-10-23', '2026-10-25')

    expect(findGaps([long, inside, later])).toEqual([{ start: long.end, end: later.start }])
    expect(findGaps([long, periodFromDays('2026-10-21', '2026-10-22')])).toEqual([])
  })

  it('suggests the first period starting exactly at the cutoff, then each one at the previous end', () => {
    const cutoff = new Date('2026-09-30T00:00:00-03:00')
    const first = suggestNext(null, cutoff, 7)
    const second = suggestNext(first.end, cutoff, 7)

    expect(first.start).toEqual(cutoff)
    expect(first.end.toISOString()).toBe('2026-10-07T03:00:00.000Z')
    expect(second.start).toEqual(first.end)
    expect(second.end.toISOString()).toBe('2026-10-14T03:00:00.000Z')
  })

  it('a mid-day cutoff still starts at the cutoff and ends on a day boundary', () => {
    const cutoff = new Date('2026-09-30T15:00:00-03:00')
    const first = suggestNext(null, cutoff, 7)

    expect(first.start).toEqual(cutoff)
    expect(first.end.toISOString()).toBe('2026-10-07T03:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (em `backend/apps/suppliers-service`): `pnpm test -- consignment-period`
Expected: FAIL, `Cannot find module './consignment-period'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { addDays, isDay } from './week'

const HOUR_MS = 3_600_000
/** America/Sao_Paulo has been UTC-3 all year since 2019 (no daylight saving), so a fixed offset keeps this pure. */
const SP_OFFSET_HOURS = 3

/** Half-open: `start` is inside, `end` belongs to the next period. */
export interface Period {
  start: Date
  end: Date
}

export function spDayStart(day: string): Date {
  if (!isDay(day)) throw new RangeError(`not a calendar day: ${day}`)

  return new Date(`${day}T00:00:00-03:00`)
}

export function spDayOf(instant: Date): string {
  return new Date(instant.getTime() - SP_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10)
}

/** The selected days, both included entirely. */
export function periodFromDays(firstDay: string, lastDay: string): Period {
  const start = spDayStart(firstDay)
  const end = spDayStart(addDays(lastDay, 1))
  if (end.getTime() <= start.getTime()) throw new RangeError('the last day is before the first day')

  return { start, end }
}

export function contains(period: Period, instant: Date): boolean {
  return instant.getTime() >= period.start.getTime() && instant.getTime() < period.end.getTime()
}

export function overlaps(a: Period, b: Period): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
}

/** Uncovered stretches between the periods, by start time; a period inside another one hides nothing. */
export function findGaps(periods: Period[]): Period[] {
  const sorted = [...periods].sort((a, b) => a.start.getTime() - b.start.getTime())
  const gaps: Period[] = []
  let reach = sorted[0]?.end

  for (const period of sorted.slice(1)) {
    if (reach && period.start.getTime() > reach.getTime()) gaps.push({ start: reach, end: period.start })
    if (!reach || period.end.getTime() > reach.getTime()) reach = period.end
  }

  return gaps
}

/** The first period starts exactly at the cutoff; the next ones at the previous end. The end is always a Sao Paulo day boundary. */
export function suggestNext(lastEnd: Date | null, cutoff: Date, lengthDays: number): Period {
  const start = lastEnd ?? cutoff

  return { start, end: spDayStart(addDays(spDayOf(start), lengthDays)) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-period`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-period.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-period.spec.ts
git commit -m "feat(suppliers): consignment periods in Sao Paulo, half-open and gap-free"
```

---

### Task 2: Identidade individual da venda

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-sale-key.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-sale-key.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `interface SaleFact { storeId: number; sku: string; occurredAt: Date | null; quantity: number; result: string; receiptId: string | null }`; `interface KeyedSale extends SaleFact { key: string; occurredAt: Date; receiptId: string }`; `receiptIdOf(row: { coupon?: string | null; internalCode?: string | null; acquirerCode?: string | null }): string | null`; `keySales(facts: SaleFact[]): { keyed: KeyedSale[]; unidentified: SaleFact[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { keySales, receiptIdOf, type SaleFact } from './consignment-sale-key'

const fact = (over: Partial<SaleFact> = {}): SaleFact => ({ storeId: 1, sku: 'A', occurredAt: new Date('2026-10-01T15:00:00Z'), quantity: 1, result: 'OK', receiptId: 'C-1', ...over })

describe('receiptIdOf — the receipt identifier', () => {
  it('prefers coupon, then internal code, then acquirer code, ignoring blanks', () => {
    expect(receiptIdOf({ coupon: ' C-9 ', internalCode: 'I-1', acquirerCode: 'A-1' })).toBe('C-9')
    expect(receiptIdOf({ coupon: '  ', internalCode: 'I-1' })).toBe('I-1')
    expect(receiptIdOf({ coupon: null, internalCode: null, acquirerCode: 'A-1' })).toBe('A-1')
    expect(receiptIdOf({})).toBeNull()
  })
})

describe('keySales — one stable key per sale row', () => {
  it('builds store|sku|instant|receipt|ordinal', () => {
    const { keyed } = keySales([fact()])

    expect(keyed[0].key).toBe('1|A|2026-10-01T15:00:00.000Z|C-1|0')
  })

  it('numbers identical rows of one receipt deterministically, whatever the input order', () => {
    const a = keySales([fact({ quantity: 2 }), fact({ quantity: 1 })]).keyed
    const b = keySales([fact({ quantity: 1 }), fact({ quantity: 2 })]).keyed

    expect(a.map(s => [s.key, s.quantity])).toEqual(b.map(s => [s.key, s.quantity]))
    expect(new Set(a.map(s => s.key)).size).toBe(2)
  })

  it('a row that later turns non-OK keeps its key (so the change is seen as a cancellation, not a new sale)', () => {
    const before = keySales([fact()]).keyed[0].key
    const after = keySales([fact({ result: 'CANCELADO' })]).keyed[0].key

    expect(after).toBe(before)
  })

  it('sets aside rows without an instant or without a receipt identifier — never keyed, never dropped', () => {
    const rows = [fact({ occurredAt: null }), fact({ receiptId: null }), fact()]
    const { keyed, unidentified } = keySales(rows)

    expect(keyed).toHaveLength(1)
    expect(unidentified).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-sale-key`
Expected: FAIL, `Cannot find module './consignment-sale-key'`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface SaleFact {
  storeId: number
  sku: string
  /** Null when the report carries no timestamp: the day of the sale is unknown, not zero. */
  occurredAt: Date | null
  quantity: number
  /** The report's `Resultado`, verbatim. Only `OK` is a confirmed sale. */
  result: string
  receiptId: string | null
}

export interface KeyedSale extends SaleFact {
  key: string
  occurredAt: Date
  receiptId: string
}

const present = (value?: string | null) => (value && value.trim() !== '' ? value.trim() : null)

/** Coupon, else internal code, else acquirer code. */
export function receiptIdOf(row: { coupon?: string | null; internalCode?: string | null; acquirerCode?: string | null }): string | null {
  return present(row.coupon) ?? present(row.internalCode) ?? present(row.acquirerCode)
}

/**
 * The key does NOT include the result: a sale that is later cancelled in a corrected report keeps its key, so the
 * change is detected as an adjustment of a confirmed line instead of looking like a new sale.
 */
export function keySales(facts: SaleFact[]): { keyed: KeyedSale[]; unidentified: SaleFact[] } {
  const unidentified: SaleFact[] = []
  const identified: Array<{ fact: SaleFact & { occurredAt: Date; receiptId: string }; base: string; index: number }> = []

  facts.forEach((fact, index) => {
    if (!fact.occurredAt || !fact.receiptId) {
      unidentified.push(fact)

      return
    }
    const base = `${fact.storeId}|${fact.sku}|${fact.occurredAt.toISOString()}|${fact.receiptId}`
    identified.push({ fact: { ...fact, occurredAt: fact.occurredAt, receiptId: fact.receiptId }, base, index })
  })

  identified.sort((a, b) => a.base.localeCompare(b.base) || a.fact.quantity - b.fact.quantity || a.fact.result.localeCompare(b.fact.result) || a.index - b.index)

  const seen = new Map<string, number>()
  const keyed = identified.map(({ fact, base }) => {
    const ordinal = seen.get(base) ?? 0
    seen.set(base, ordinal + 1)

    return { ...fact, key: `${base}|${ordinal}` }
  })

  return { keyed, unidentified }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-sale-key`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-sale-key.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-sale-key.spec.ts
git commit -m "feat(suppliers): stable per-sale key for consignment closings"
```

---

### Task 3: Saldo por local, independente do fechamento

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-balance.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-balance.spec.ts`

**Interfaces:**
- Consumes: `KeyedSale` de `./consignment-sale-key`.
- Produces: `type MovementKind = 'opening' | 'receipt' | 'transfer_in' | 'transfer_out' | 'expiry_writeoff' | 'return_sellable' | 'loss' | 'correction'`; `interface Movement { supplierId: number; sku: string; location: string; kind: MovementKind; quantity: number; occurredAt: Date }` (`quantity` já assinada); `const storeLocation = (storeId: number) => string` (`'store:<id>'`); `interface Balance { balance: number; negative: boolean; netSales: number; byKind: Partial<Record<MovementKind, number>> }`; `computeBalance(input: { supplierId?: number; sku: string; location: string; cutoff: Date; at: Date; movements: Movement[]; sales: KeyedSale[] }): Balance`.

- [ ] **Step 1: Write the failing test**

```ts
import { computeBalance, storeLocation, type Movement } from './consignment-balance'
import type { KeyedSale } from './consignment-sale-key'

const CUTOFF = new Date('2026-09-30T03:00:00Z')
const at = (iso: string) => new Date(iso)
const move = (kind: Movement['kind'], quantity: number, when = '2026-10-02T12:00:00Z', over: Partial<Movement> = {}): Movement => ({ supplierId: 7, sku: 'A', location: storeLocation(1), kind, quantity, occurredAt: at(when), ...over })
const sale = (quantity: number, when = '2026-10-03T12:00:00Z', over: Partial<KeyedSale> = {}): KeyedSale => ({ key: `k-${when}-${quantity}`, storeId: 1, sku: 'A', occurredAt: at(when), quantity, result: 'OK', receiptId: 'C', ...over })

describe('computeBalance — stock is a ledger minus the sales since the cutoff', () => {
  it('the reference case: 20 in stock, 30 received, 18 sold, 2 expired and withdrawn → 30 sellable', () => {
    const result = computeBalance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'),
      movements: [move('opening', 20, '2026-09-30T03:00:00Z'), move('receipt', 30), move('expiry_writeoff', -2, '2026-10-05T12:00:00Z')],
      sales: [sale(18)],
    })

    expect(result).toMatchObject({ balance: 30, netSales: 18, negative: false })
  })

  it('does not depend on any closing: asking again gives the same number', () => {
    const input = { supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), movements: [move('opening', 5, '2026-09-30T03:00:00Z')], sales: [sale(2)] }

    expect(computeBalance(input).balance).toBe(3)
    expect(computeBalance(input).balance).toBe(3)
  })

  it('ignores movements before the cutoff (the count already reflects them) and anything after the queried instant', () => {
    const result = computeBalance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-04T00:00:00Z'),
      movements: [move('opening', 10, '2026-09-30T03:00:00Z'), move('receipt', 99, '2026-09-29T12:00:00Z'), move('receipt', 5, '2026-10-03T00:00:00Z'), move('receipt', 50, '2026-10-09T00:00:00Z')],
      sales: [sale(1, '2026-09-29T12:00:00Z'), sale(2, '2026-10-03T12:00:00Z'), sale(40, '2026-10-09T12:00:00Z')],
    })

    expect(result.balance).toBe(13)
  })

  it('counts only OK sales of this store and SKU', () => {
    const result = computeBalance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'),
      movements: [move('opening', 10, '2026-09-30T03:00:00Z')],
      sales: [sale(1), sale(5, '2026-10-04T12:00:00Z', { result: 'CANCELADO' }), sale(7, '2026-10-05T12:00:00Z', { storeId: 2 }), sale(9, '2026-10-06T12:00:00Z', { sku: 'B' })],
    })

    expect(result).toMatchObject({ balance: 9, netSales: 1 })
  })

  it('reports a negative balance instead of clamping it to zero', () => {
    const result = computeBalance({ supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), movements: [move('opening', 2, '2026-09-30T03:00:00Z')], sales: [sale(5)] })

    expect(result).toMatchObject({ balance: -3, negative: true })
  })

  it('breaks the balance down by kind, and a supplier filter drops other suppliers movements', () => {
    const result = computeBalance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'),
      movements: [move('opening', 4, '2026-09-30T03:00:00Z'), move('transfer_in', 6), move('receipt', 100, '2026-10-02T12:00:00Z', { supplierId: 8 })],
      sales: [],
    })

    expect(result.byKind).toEqual({ opening: 4, transfer_in: 6 })
    expect(result.balance).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-balance`
Expected: FAIL, `Cannot find module './consignment-balance'`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { KeyedSale } from './consignment-sale-key'

export type MovementKind = 'opening' | 'receipt' | 'transfer_in' | 'transfer_out' | 'expiry_writeoff' | 'return_sellable' | 'loss' | 'correction'

/** `quantity` is signed: transfer_out, expiry_writeoff, return_sellable and losses are negative. */
export interface Movement {
  supplierId: number
  sku: string
  location: string
  kind: MovementKind
  quantity: number
  occurredAt: Date
}

export interface Balance {
  balance: number
  /** A negative balance means the movement data is wrong somewhere; it is reported, never clamped. */
  negative: boolean
  netSales: number
  byKind: Partial<Record<MovementKind, number>>
}

export const storeLocation = (storeId: number) => `store:${storeId}`

/**
 * Balance at `at` = movements (the opening at the cutoff, then everything after it) − OK sales since the cutoff.
 * Sales are never ledger movements, so confirming a closing neither subtracts them again nor hides them here.
 */
export function computeBalance(input: { supplierId?: number; sku: string; location: string; cutoff: Date; at: Date; movements: Movement[]; sales: KeyedSale[] }): Balance {
  const byKind: Partial<Record<MovementKind, number>> = {}
  let ledger = 0

  for (const movement of input.movements) {
    if (movement.sku !== input.sku || movement.location !== input.location) continue
    if (input.supplierId !== undefined && movement.supplierId !== input.supplierId) continue
    const counted = movement.kind === 'opening' ? movement.occurredAt <= input.at : movement.occurredAt > input.cutoff && movement.occurredAt <= input.at
    if (!counted) continue
    ledger += movement.quantity
    byKind[movement.kind] = (byKind[movement.kind] ?? 0) + movement.quantity
  }

  const netSales = input.sales
    .filter(s => s.result === 'OK' && s.sku === input.sku && s.occurredAt > input.cutoff && s.occurredAt <= input.at && input.location === `store:${s.storeId}`)
    .reduce((sum, s) => sum + s.quantity, 0)

  const balance = ledger - netSales

  return { balance, negative: balance < 0, netSales, byKind }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-balance`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-balance.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-balance.spec.ts
git commit -m "feat(suppliers): consignment stock balance derived from ledger minus sales since cutoff"
```

---

### Task 4: Custo de repasse vigente na data da venda

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-cost.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-cost.spec.ts`

**Interfaces:**
- Consumes: `spDayOf(instant: Date): string` de `./consignment-period`.
- Produces: `interface CostVigencia { sku: string; validFrom: string; unitCostCents: number }` (`validFrom` = `YYYY-MM-DD`); `interface ResolvedCost { unitCostCents: number; validFrom: string }`; `resolveCost(costs: CostVigencia[], sku: string, soldAt: Date): ResolvedCost | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { resolveCost, type CostVigencia } from './consignment-cost'

const costs: CostVigencia[] = [
  { sku: 'A', validFrom: '2026-09-01', unitCostCents: 730 },
  { sku: 'A', validFrom: '2026-10-05', unitCostCents: 760 },
  { sku: 'B', validFrom: '2026-09-01', unitCostCents: 595 },
]

describe('resolveCost — the agreed cost in force on the day of the sale', () => {
  it('uses the vigência that was in force on the sale day, not the latest one', () => {
    expect(resolveCost(costs, 'A', new Date('2026-10-04T15:00:00Z'))).toEqual({ unitCostCents: 730, validFrom: '2026-09-01' })
    expect(resolveCost(costs, 'A', new Date('2026-10-06T15:00:00Z'))).toEqual({ unitCostCents: 760, validFrom: '2026-10-05' })
  })

  it('judges the day in Sao Paulo: 02:00Z of Oct 5 is still Oct 4 there', () => {
    expect(resolveCost(costs, 'A', new Date('2026-10-05T02:00:00Z'))?.unitCostCents).toBe(730)
    expect(resolveCost(costs, 'A', new Date('2026-10-05T03:00:00Z'))?.unitCostCents).toBe(760)
  })

  it('returns null — never a guess — before the first vigência or for a SKU without cost', () => {
    expect(resolveCost(costs, 'A', new Date('2026-08-31T15:00:00Z'))).toBeNull()
    expect(resolveCost(costs, 'Z', new Date('2026-10-06T15:00:00Z'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-cost`
Expected: FAIL, `Cannot find module './consignment-cost'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { spDayOf } from './consignment-period'

/** An agreed cost that applies from `validFrom` (a Sao Paulo day) until the next vigência of the same SKU. */
export interface CostVigencia {
  sku: string
  validFrom: string
  unitCostCents: number
}

export interface ResolvedCost {
  unitCostCents: number
  validFrom: string
}

/** The agreed cost in force on the sale day. NOT the received-lot cost: this delivery has no lot-cost mode. */
export function resolveCost(costs: CostVigencia[], sku: string, soldAt: Date): ResolvedCost | null {
  const day = spDayOf(soldAt)
  const inForce = costs.filter(c => c.sku === sku && c.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom))

  return inForce.length ? { unitCostCents: inForce[0].unitCostCents, validFrom: inForce[0].validFrom } : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-cost`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-cost.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-cost.spec.ts
git commit -m "feat(suppliers): consignment cost resolved by sale-day vigência"
```

---

### Task 5: Atribuição da venda ao fornecedor

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-attribution.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-attribution.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `interface SupplierBalance { supplierId: number; balance: number }`; `type AttributionBasis = 'single' | 'manual' | 'none' | 'ambiguous'`; `interface Attribution { supplierId: number | null; basis: AttributionBasis; pending: boolean; suggestion: number | null }`; `attributeSale(holders: SupplierBalance[], manualSupplierId?: number | null): Attribution`.

- [ ] **Step 1: Write the failing test**

```ts
import { attributeSale } from './consignment-attribution'

describe('attributeSale — which supplier a sale belongs to', () => {
  it('one supplier holds the SKU there → attributed (derived fact)', () => {
    expect(attributeSale([{ supplierId: 7, balance: 12 }])).toEqual({ supplierId: 7, basis: 'single', pending: false, suggestion: null })
  })

  it('suppliers with no sellable balance do not count as holders', () => {
    expect(attributeSale([{ supplierId: 7, balance: 12 }, { supplierId: 8, balance: 0 }, { supplierId: 9, balance: -3 }]).supplierId).toBe(7)
  })

  it('nobody holds the SKU → not ours and not pending (it came from stock that is not consigned)', () => {
    expect(attributeSale([])).toEqual({ supplierId: null, basis: 'none', pending: false, suggestion: null })
  })

  it('two or more holders → NOT attributed, pending, with the largest balance only as a suggestion', () => {
    expect(attributeSale([{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }])).toEqual({ supplierId: null, basis: 'ambiguous', pending: true, suggestion: 8 })
  })

  it('a manual assignment resolves an ambiguity, and only to a supplier that is a holder', () => {
    const holders = [{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }]

    expect(attributeSale(holders, 7)).toEqual({ supplierId: 7, basis: 'manual', pending: false, suggestion: null })
    expect(attributeSale(holders, 99)).toMatchObject({ pending: true, basis: 'ambiguous' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-attribution`
Expected: FAIL, `Cannot find module './consignment-attribution'`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface SupplierBalance {
  supplierId: number
  balance: number
}

export type AttributionBasis = 'single' | 'manual' | 'none' | 'ambiguous'

export interface Attribution {
  supplierId: number | null
  basis: AttributionBasis
  /** True when the sale cannot be assigned without the operator: it blocks a closing that depends on it. */
  pending: boolean
  /** An ESTIMATE only (largest sellable balance); never applied by itself. */
  suggestion: number | null
}

/** A sale carries no lot, so the ledger proves a supplier only when exactly one holds the SKU in that store. */
export function attributeSale(holders: SupplierBalance[], manualSupplierId?: number | null): Attribution {
  const sellable = holders.filter(h => h.balance > 0)

  if (sellable.length === 0) return { supplierId: null, basis: 'none', pending: false, suggestion: null }
  if (sellable.length === 1) return { supplierId: sellable[0].supplierId, basis: 'single', pending: false, suggestion: null }
  if (manualSupplierId != null && sellable.some(h => h.supplierId === manualSupplierId)) return { supplierId: manualSupplierId, basis: 'manual', pending: false, suggestion: null }

  const largest = [...sellable].sort((a, b) => b.balance - a.balance || a.supplierId - b.supplierId)[0]

  return { supplierId: null, basis: 'ambiguous', pending: true, suggestion: largest.supplierId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-attribution`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-attribution.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-attribution.spec.ts
git commit -m "feat(suppliers): consignment sale attribution, ambiguous holders stay pending"
```

---

### Task 6: Ajustes de vendas já confirmadas

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-adjustments.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-adjustments.spec.ts`

**Interfaces:**
- Consumes: `KeyedSale` de `./consignment-sale-key`; `Period`, `contains` de `./consignment-period`.
- Produces: `interface ConfirmedSaleLine { saleKey: string; storeId: number; sku: string; quantity: number; unitCostCents: number }` (uma linha por chave, já líquida de ajustes anteriores); `type AdjustmentKind = 'adjustment_cancel' | 'adjustment_late' | 'adjustment_qty'`; `interface Adjustment { saleKey: string; kind: AdjustmentKind; storeId: number; sku: string; occurredAt: Date | null; quantity: number; unitCostCents: number | null }` (`quantity` = delta assinado; `unitCostCents` nulo para `adjustment_late`, o fechamento resolve pela vigência); `computeAdjustments(input: { confirmed: ConfirmedSaleLine[]; current: KeyedSale[]; covered: Period[] }): { adjustments: Adjustment[]; missing: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { computeAdjustments, type ConfirmedSaleLine } from './consignment-adjustments'
import { periodFromDays } from './consignment-period'
import type { KeyedSale } from './consignment-sale-key'

const covered = [periodFromDays('2026-10-01', '2026-10-07')]
const sale = (key: string, quantity: number, over: Partial<KeyedSale> = {}): KeyedSale => ({ key, storeId: 1, sku: 'A', occurredAt: new Date('2026-10-03T15:00:00Z'), quantity, result: 'OK', receiptId: 'C', ...over })
const line = (saleKey: string, quantity: number, unitCostCents = 730): ConfirmedSaleLine => ({ saleKey, storeId: 1, sku: 'A', quantity, unitCostCents })

describe('computeAdjustments — changes to sales a confirmed closing already counted', () => {
  it('a confirmed sale that turned non-OK becomes a negative adjustment at the ORIGINAL cost', () => {
    const { adjustments } = computeAdjustments({ confirmed: [line('k1', 3, 730)], current: [sale('k1', 3, { result: 'CANCELADO' })], covered })

    expect(adjustments).toEqual([{ saleKey: 'k1', kind: 'adjustment_cancel', storeId: 1, sku: 'A', occurredAt: new Date('2026-10-03T15:00:00Z'), quantity: -3, unitCostCents: 730 }])
  })

  it('a changed quantity becomes the difference', () => {
    const { adjustments } = computeAdjustments({ confirmed: [line('k1', 3)], current: [sale('k1', 5)], covered })

    expect(adjustments[0]).toMatchObject({ kind: 'adjustment_qty', quantity: 2, unitCostCents: 730 })
  })

  it('a sale imported later, dated inside a confirmed period, is a late adjustment (cost resolved by the closing)', () => {
    const { adjustments } = computeAdjustments({ confirmed: [], current: [sale('k9', 4)], covered })

    expect(adjustments).toEqual([{ saleKey: 'k9', kind: 'adjustment_late', storeId: 1, sku: 'A', occurredAt: new Date('2026-10-03T15:00:00Z'), quantity: 4, unitCostCents: null }])
  })

  it('an unconfirmed sale OUTSIDE every confirmed period is a regular sale, not an adjustment', () => {
    const { adjustments } = computeAdjustments({ confirmed: [], current: [sale('k9', 4, { occurredAt: new Date('2026-10-20T15:00:00Z') })], covered })

    expect(adjustments).toEqual([])
  })

  it('an unchanged sale produces nothing, so running it again is idempotent', () => {
    const input = { confirmed: [line('k1', 3)], current: [sale('k1', 3)], covered }

    expect(computeAdjustments(input).adjustments).toEqual([])
  })

  it('a confirmed key absent from the latest import is reported as missing, never presumed cancelled', () => {
    const result = computeAdjustments({ confirmed: [line('gone', 2)], current: [], covered })

    expect(result).toEqual({ adjustments: [], missing: ['gone'] })
  })

  it('a late NON-OK sale is not an adjustment (it was never counted)', () => {
    const { adjustments } = computeAdjustments({ confirmed: [], current: [sale('k9', 4, { result: 'CANCELADO' })], covered })

    expect(adjustments).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-adjustments`
Expected: FAIL, `Cannot find module './consignment-adjustments'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { contains, type Period } from './consignment-period'
import type { KeyedSale } from './consignment-sale-key'

/** One line per sale key, net of earlier adjustments: what confirmed closings have counted so far. */
export interface ConfirmedSaleLine {
  saleKey: string
  storeId: number
  sku: string
  quantity: number
  unitCostCents: number
}

export type AdjustmentKind = 'adjustment_cancel' | 'adjustment_late' | 'adjustment_qty'

export interface Adjustment {
  saleKey: string
  kind: AdjustmentKind
  storeId: number
  sku: string
  occurredAt: Date | null
  /** Signed delta in units. */
  quantity: number
  /** Null for a late sale: the closing resolves the cost in force on the sale day. */
  unitCostCents: number | null
}

/**
 * Compares what confirmed closings counted with the sales as they stand now. A confirmed closing is never reopened:
 * differences become traceable adjustments for the next open closing.
 */
export function computeAdjustments(input: { confirmed: ConfirmedSaleLine[]; current: KeyedSale[]; covered: Period[] }): { adjustments: Adjustment[]; missing: string[] } {
  const currentByKey = new Map(input.current.map(s => [s.key, s]))
  const confirmedKeys = new Set(input.confirmed.map(l => l.saleKey))
  const adjustments: Adjustment[] = []
  const missing: string[] = []

  for (const line of input.confirmed) {
    const now = currentByKey.get(line.saleKey)
    if (!now) {
      missing.push(line.saleKey)
      continue
    }
    const wanted = now.result === 'OK' ? now.quantity : 0
    if (wanted === line.quantity) continue
    adjustments.push({
      saleKey: line.saleKey,
      kind: wanted === 0 ? 'adjustment_cancel' : 'adjustment_qty',
      storeId: line.storeId,
      sku: line.sku,
      occurredAt: now.occurredAt,
      quantity: wanted - line.quantity,
      unitCostCents: line.unitCostCents,
    })
  }

  for (const sale of input.current) {
    if (confirmedKeys.has(sale.key) || sale.result !== 'OK') continue
    if (!input.covered.some(period => contains(period, sale.occurredAt))) continue
    adjustments.push({ saleKey: sale.key, kind: 'adjustment_late', storeId: sale.storeId, sku: sale.sku, occurredAt: sale.occurredAt, quantity: sale.quantity, unitCostCents: null })
  }

  return { adjustments, missing }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-adjustments`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-adjustments.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-adjustments.spec.ts
git commit -m "feat(suppliers): traceable adjustments for cancelled, changed and late sales"
```

---

### Task 7: Retiradas, vencimento e devoluções parciais

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-expiry.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-expiry.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `type RemovalState = 'expired_withdrawn' | 'other_reason' | 'to_check'`; `classifyRemoval(reason: string | null): RemovalState`; `type ShelfState = 'not_applicable' | 'expired_in_store' | 'check_permanence' | 'withdrawn'`; `shelfState(input: { expiryReached: boolean; removalRegistered: boolean; traceableUnits: number | null }): ShelfState`; `validateReturn(input: { writtenOff: number; alreadyReturned: number; newQuantity: number }): { ok: true } | { ok: false; reason: string }`; `interface ExpiryPosition { writtenOff: number; returned: number; awaitingReturn: number; status: 'awaiting' | 'partial' | 'returned' }`; `expiryPosition(writtenOff: number, returns: number[]): ExpiryPosition`.

- [ ] **Step 1: Write the failing test**

```ts
import { classifyRemoval, expiryPosition, shelfState, validateReturn } from './consignment-expiry'

describe('classifyRemoval — a withdrawal is expiry only when its reason says so', () => {
  it('maps the supply reasons: expired is expiry, the others are other reasons', () => {
    expect(classifyRemoval('expired')).toBe('expired_withdrawn')
    for (const reason of ['damaged_product', 'other_reason', 'return', 'transfer', 'internal_use']) expect(classifyRemoval(reason)).toBe('other_reason')
  })

  it('a missing or unknown reason is a withdrawal to check — never defaulted to expiry', () => {
    expect(classifyRemoval(null)).toBe('to_check')
    expect(classifyRemoval('')).toBe('to_check')
    expect(classifyRemoval('something_new')).toBe('to_check')
  })
})

describe('shelfState — "still in the store" needs proof', () => {
  it('no expiry reached → not applicable', () => {
    expect(shelfState({ expiryReached: false, removalRegistered: false, traceableUnits: 5 })).toBe('not_applicable')
  })

  it('a registered withdrawal wins', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: true, traceableUnits: 5 })).toBe('withdrawn')
  })

  it('expired and units are traceable there → expired in store', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: false, traceableUnits: 3 })).toBe('expired_in_store')
  })

  it('expired but no withdrawal and no traceable balance → check permanence (absence of a record proves nothing)', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: false, traceableUnits: null })).toBe('check_permanence')
  })

  it('expired, no withdrawal, and a traceable zero → nothing is there to withdraw', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: false, traceableUnits: 0 })).toBe('not_applicable')
  })
})

describe('validateReturn / expiryPosition — partial deliveries to the supplier', () => {
  it('accepts a delivery up to what was written off, in total', () => {
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 5, newQuantity: 3 })).toEqual({ ok: true })
  })

  it('refuses a delivery that would exceed the written-off quantity, and non-positive ones', () => {
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 5, newQuantity: 4 })).toEqual({ ok: false, reason: 'the returned total would exceed the written-off quantity (9 > 8)' })
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 0, newQuantity: 0 })).toEqual({ ok: false, reason: 'the returned quantity must be a positive whole number' })
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 0, newQuantity: 1.5 })).toEqual({ ok: false, reason: 'the returned quantity must be a positive whole number' })
  })

  it('derives the position from the individual deliveries, never from an overwritten total', () => {
    expect(expiryPosition(8, [])).toEqual({ writtenOff: 8, returned: 0, awaitingReturn: 8, status: 'awaiting' })
    expect(expiryPosition(8, [3, 2])).toEqual({ writtenOff: 8, returned: 5, awaitingReturn: 3, status: 'partial' })
    expect(expiryPosition(8, [3, 5])).toEqual({ writtenOff: 8, returned: 8, awaitingReturn: 0, status: 'returned' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-expiry`
Expected: FAIL, `Cannot find module './consignment-expiry'`

- [ ] **Step 3: Write minimal implementation**

```ts
export type RemovalState = 'expired_withdrawn' | 'other_reason' | 'to_check'

const OTHER_REASONS = new Set(['damaged_product', 'other_reason', 'return', 'transfer', 'internal_use'])

/** Reason keys are the supply-service's six removal reasons. Only `expired` is expiry; a missing reason is never presumed. */
export function classifyRemoval(reason: string | null): RemovalState {
  if (reason === 'expired') return 'expired_withdrawn'

  return reason && OTHER_REASONS.has(reason) ? 'other_reason' : 'to_check'
}

export type ShelfState = 'not_applicable' | 'expired_in_store' | 'check_permanence' | 'withdrawn'

/** `traceableUnits` is null when neither a traceable balance nor a physical count exists. */
export function shelfState(input: { expiryReached: boolean; removalRegistered: boolean; traceableUnits: number | null }): ShelfState {
  if (!input.expiryReached) return 'not_applicable'
  if (input.removalRegistered) return 'withdrawn'
  if (input.traceableUnits === null) return 'check_permanence'

  return input.traceableUnits > 0 ? 'expired_in_store' : 'not_applicable'
}

export function validateReturn(input: { writtenOff: number; alreadyReturned: number; newQuantity: number }): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(input.newQuantity) || input.newQuantity <= 0) return { ok: false, reason: 'the returned quantity must be a positive whole number' }
  const total = input.alreadyReturned + input.newQuantity
  if (total > input.writtenOff) return { ok: false, reason: `the returned total would exceed the written-off quantity (${total} > ${input.writtenOff})` }

  return { ok: true }
}

export interface ExpiryPosition {
  writtenOff: number
  returned: number
  awaitingReturn: number
  status: 'awaiting' | 'partial' | 'returned'
}

/** One entry per delivery to the supplier; the position is always their sum, so nothing is overwritten. */
export function expiryPosition(writtenOff: number, returns: number[]): ExpiryPosition {
  const returned = returns.reduce((sum, quantity) => sum + quantity, 0)

  return { writtenOff, returned, awaitingReturn: writtenOff - returned, status: returned === 0 ? 'awaiting' : returned >= writtenOff ? 'returned' : 'partial' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-expiry`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-expiry.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-expiry.spec.ts
git commit -m "feat(suppliers): expiry withdrawals, shelf state and partial supplier returns"
```

---

### Task 8: Cálculo do fechamento

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-closing.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-closing.spec.ts`

**Interfaces:**
- Consumes: `Period`, `contains`, `overlaps` de `./consignment-period`; `KeyedSale`, `SaleFact` de `./consignment-sale-key`; `attributeSale`, `SupplierBalance` de `./consignment-attribution`; `resolveCost`, `CostVigencia` de `./consignment-cost`; `Adjustment` de `./consignment-adjustments`.
- Produces: `interface ClosingInput`, `interface ClosingLine`, `type BlockerCode = 'sale_unidentified' | 'attribution_pending' | 'cost_missing' | 'sales_incomplete'`, `interface Blocker`, `interface PricedAdjustment`, `interface ClosingResult`, `computeClosing(input: ClosingInput): ClosingResult` (campos abaixo).

- [ ] **Step 1: Write the failing test**

```ts
import { computeClosing, type ClosingInput } from './consignment-closing'
import { periodFromDays } from './consignment-period'
import type { KeyedSale, SaleFact } from './consignment-sale-key'

const CUTOFF = new Date('2026-09-30T00:00:00-03:00')
const period = periodFromDays('2026-09-30', '2026-10-06')
const sale = (key: string, quantity: number, over: Partial<KeyedSale> = {}): KeyedSale => ({ key, storeId: 1, sku: 'A', occurredAt: new Date('2026-10-02T15:00:00Z'), quantity, result: 'OK', receiptId: 'C', ...over })

const base = (over: Partial<ClosingInput> = {}): ClosingInput => ({
  supplierId: 7,
  period,
  cutoff: CUTOFF,
  sales: [],
  unidentifiedSales: [],
  holdersOf: () => [{ supplierId: 7, balance: 50 }],
  manualAssignments: new Map(),
  costs: [{ sku: 'A', validFrom: '2026-09-01', unitCostCents: 730 }, { sku: 'B', validFrom: '2026-09-01', unitCostCents: 595 }],
  claimedKeys: new Set(),
  legacyCovered: [],
  adjustments: [],
  salesImportedUntil: new Date('2026-10-07T03:00:00Z'),
  partialAccepted: false,
  ...over,
})

describe('computeClosing — what to pay the supplier', () => {
  it('owed = net units sold × the agreed cost, and the reference case pays 18 units (expired units change nothing)', () => {
    const result = computeClosing(base({ sales: [sale('k1', 18)] }))

    expect(result.owedCents).toBe(18 * 730)
    expect(result.lines).toEqual([{ storeId: 1, sku: 'A', costValidFrom: '2026-09-01', unitCostCents: 730, netUnits: 18, totalCents: 13140, saleKeys: ['k1'] }])
    expect(result.confirmable).toBe(true)
  })

  it('splits one SKU by cost vigência instead of showing a single cost that hides the difference', () => {
    const result = computeClosing(base({
      costs: [{ sku: 'A', validFrom: '2026-09-01', unitCostCents: 730 }, { sku: 'A', validFrom: '2026-10-03', unitCostCents: 760 }],
      sales: [sale('k1', 2), sale('k2', 3, { occurredAt: new Date('2026-10-04T15:00:00Z') })],
    }))

    expect(result.lines.map(l => [l.costValidFrom, l.unitCostCents, l.netUnits])).toEqual([['2026-09-01', 730, 2], ['2026-10-03', 760, 3]])
    expect(result.owedCents).toBe(2 * 730 + 3 * 760)
  })

  it('reports cancelled units apart and never charges them', () => {
    const result = computeClosing(base({ sales: [sale('k1', 4), sale('k2', 2, { result: 'CANCELADO' })] }))

    expect(result.owedCents).toBe(4 * 730)
    expect(result.cancellations).toEqual([{ storeId: 1, sku: 'A', units: 2 }])
  })

  it('a sale exactly at the period end belongs to the next closing', () => {
    const result = computeClosing(base({ sales: [sale('edge', 5, { occurredAt: period.end })] }))

    expect(result.owedCents).toBe(0)
    expect(result.lines).toEqual([])
  })

  it('never charges a sale already claimed by a confirmed closing, nor one inside a legacy settled interval', () => {
    const legacy = periodFromDays('2026-10-01', '2026-10-03')
    const result = computeClosing(base({
      sales: [sale('claimed', 5), sale('legacy', 7, { occurredAt: new Date('2026-10-02T20:00:00Z') }), sale('free', 1, { occurredAt: new Date('2026-10-05T15:00:00Z') })],
      claimedKeys: new Set(['claimed']),
      legacyCovered: [legacy],
    }))

    expect(result.lines.map(l => l.saleKeys)).toEqual([['free']])
  })

  it('blocks on a sale without instant or receipt identifier — it is never silently zero', () => {
    const loose: SaleFact = { storeId: 1, sku: 'A', occurredAt: null, quantity: 3, result: 'OK', receiptId: 'C' }
    const result = computeClosing(base({ sales: [sale('k1', 1)], unidentifiedSales: [loose] }))

    expect(result.blockers).toEqual([{ code: 'sale_unidentified', storeId: 1, sku: 'A' }])
    expect(result.confirmable).toBe(false)
  })

  it('blocks when two suppliers hold the SKU and no manual assignment exists; a manual one resolves it', () => {
    const holders = () => [{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }]
    const blocked = computeClosing(base({ sales: [sale('k1', 2)], holdersOf: holders }))

    expect(blocked.blockers).toEqual([{ code: 'attribution_pending', saleKey: 'k1', storeId: 1, sku: 'A' }])
    expect(blocked.owedCents).toBe(0)

    const resolved = computeClosing(base({ sales: [sale('k1', 2)], holdersOf: holders, manualAssignments: new Map([['k1', 7]]) }))
    expect(resolved.confirmable).toBe(true)
    expect(resolved.owedCents).toBe(2 * 730)
  })

  it('leaves out sales attributed to another supplier, and sales of SKUs nobody holds', () => {
    const result = computeClosing(base({ sales: [sale('other', 2), sale('none', 4, { sku: 'B' })], holdersOf: sale => (sale.sku === 'A' ? [{ supplierId: 8, balance: 5 }] : []) }))

    expect(result.lines).toEqual([])
    expect(result.blockers).toEqual([])
  })

  it('blocks a sale without an agreed cost on its day', () => {
    const result = computeClosing(base({ sales: [sale('k1', 1, { sku: 'Z' })], holdersOf: () => [{ supplierId: 7, balance: 5 }] }))

    expect(result.blockers).toEqual([{ code: 'cost_missing', saleKey: 'k1', storeId: 1, sku: 'Z' }])
  })

  it('blocks a period the imports do not cover yet, unless the partial period was explicitly accepted', () => {
    const early = new Date('2026-10-04T03:00:00Z')

    expect(computeClosing(base({ sales: [sale('k1', 1)], salesImportedUntil: early })).blockers).toEqual([{ code: 'sales_incomplete' }])
    expect(computeClosing(base({ sales: [sale('k1', 1)], salesImportedUntil: null })).blockers).toEqual([{ code: 'sales_incomplete' }])
    expect(computeClosing(base({ sales: [sale('k1', 1)], salesImportedUntil: early, partialAccepted: true })).confirmable).toBe(true)
  })

  it('adds priced adjustments: a cancellation at its original cost, a late sale at the cost of its own day', () => {
    const result = computeClosing(base({
      sales: [sale('k1', 2)],
      adjustments: [
        { saleKey: 'old', kind: 'adjustment_cancel', storeId: 1, sku: 'A', occurredAt: new Date('2026-09-20T15:00:00Z'), quantity: -3, unitCostCents: 700 },
        { saleKey: 'late', kind: 'adjustment_late', storeId: 1, sku: 'A', occurredAt: new Date('2026-09-25T15:00:00Z'), quantity: 4, unitCostCents: null },
      ],
    }))

    expect(result.adjustments).toEqual([
      { saleKey: 'old', kind: 'adjustment_cancel', storeId: 1, sku: 'A', quantity: -3, unitCostCents: 700, totalCents: -2100 },
      { saleKey: 'late', kind: 'adjustment_late', storeId: 1, sku: 'A', quantity: 4, unitCostCents: 730, totalCents: 2920 },
    ])
    expect(result.adjustmentsCents).toBe(820)
    expect(result.owedCents).toBe(2 * 730 + 820)
  })

  it('blocks a late adjustment that has no cost on its day', () => {
    const result = computeClosing(base({ adjustments: [{ saleKey: 'late', kind: 'adjustment_late', storeId: 1, sku: 'Z', occurredAt: new Date('2026-09-25T15:00:00Z'), quantity: 1, unitCostCents: null }] }))

    expect(result.blockers).toEqual([{ code: 'cost_missing', saleKey: 'late', storeId: 1, sku: 'Z' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- consignment-closing`
Expected: FAIL, `Cannot find module './consignment-closing'`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Adjustment, AdjustmentKind } from './consignment-adjustments'
import { attributeSale, type SupplierBalance } from './consignment-attribution'
import { resolveCost, type CostVigencia } from './consignment-cost'
import { contains, type Period } from './consignment-period'
import type { KeyedSale, SaleFact } from './consignment-sale-key'

export interface ClosingInput {
  supplierId: number
  period: Period
  cutoff: Date
  /** Keyed sales of the supplier's linked SKUs, any result. */
  sales: KeyedSale[]
  /** Linked-SKU sales without an instant or receipt identifier that could belong to this closing. */
  unidentifiedSales: SaleFact[]
  /** Suppliers holding the sale's SKU in its store at the time of the sale, with their sellable balance. */
  holdersOf: (sale: KeyedSale) => SupplierBalance[]
  /** Manual attributions: sale key → supplier id. */
  manualAssignments: Map<string, number>
  costs: CostVigencia[]
  /** Sale keys already counted by a confirmed closing with an active financial obligation. */
  claimedKeys: Set<string>
  /** Intervals already settled by legacy weekly settlements: their sales are never charged again. */
  legacyCovered: Period[]
  adjustments: Adjustment[]
  /** Latest instant the sales imports reach; null when unknown. */
  salesImportedUntil: Date | null
  /** The operator accepted a partial period (permission, confirmation and justification live in the service). */
  partialAccepted: boolean
}

export interface ClosingLine {
  storeId: number
  sku: string
  /** One line per cost vigência, so differing costs are never hidden behind one number. */
  costValidFrom: string
  unitCostCents: number
  netUnits: number
  totalCents: number
  saleKeys: string[]
}

export type BlockerCode = 'sale_unidentified' | 'attribution_pending' | 'cost_missing' | 'sales_incomplete'

export interface Blocker {
  code: BlockerCode
  saleKey?: string
  storeId?: number
  sku?: string
}

export interface PricedAdjustment {
  saleKey: string
  kind: AdjustmentKind
  storeId: number
  sku: string
  quantity: number
  unitCostCents: number
  totalCents: number
}

export interface ClosingResult {
  lines: ClosingLine[]
  cancellations: Array<{ storeId: number; sku: string; units: number }>
  adjustments: PricedAdjustment[]
  salesCents: number
  adjustmentsCents: number
  owedCents: number
  blockers: Blocker[]
  confirmable: boolean
}

/**
 * Owed = Σ net units sold × agreed cost in force on the sale day. Expired or returned units are not an input here on
 * purpose: they are not owed and are never subtracted from the sales.
 */
export function computeClosing(input: ClosingInput): ClosingResult {
  const blockers: Blocker[] = []
  const lines = new Map<string, ClosingLine>()
  const cancelled = new Map<string, { storeId: number; sku: string; units: number }>()

  for (const loose of input.unidentifiedSales) blockers.push({ code: 'sale_unidentified', storeId: loose.storeId, sku: loose.sku })

  const eligible = input.sales.filter(
    s => contains(input.period, s.occurredAt) && s.occurredAt >= input.cutoff && !input.claimedKeys.has(s.key) && !input.legacyCovered.some(p => contains(p, s.occurredAt)),
  )

  for (const sale of eligible) {
    const attribution = attributeSale(input.holdersOf(sale), input.manualAssignments.get(sale.key))
    if (sale.result === 'OK' && attribution.pending) {
      blockers.push({ code: 'attribution_pending', saleKey: sale.key, storeId: sale.storeId, sku: sale.sku })
      continue
    }
    if (attribution.supplierId !== input.supplierId) continue

    if (sale.result !== 'OK') {
      const id = `${sale.storeId}|${sale.sku}`
      const entry = cancelled.get(id) ?? { storeId: sale.storeId, sku: sale.sku, units: 0 }
      entry.units += sale.quantity
      cancelled.set(id, entry)
      continue
    }

    const cost = resolveCost(input.costs, sale.sku, sale.occurredAt)
    if (!cost) {
      blockers.push({ code: 'cost_missing', saleKey: sale.key, storeId: sale.storeId, sku: sale.sku })
      continue
    }
    const id = `${sale.storeId}|${sale.sku}|${cost.validFrom}`
    const line = lines.get(id) ?? { storeId: sale.storeId, sku: sale.sku, costValidFrom: cost.validFrom, unitCostCents: cost.unitCostCents, netUnits: 0, totalCents: 0, saleKeys: [] }
    line.netUnits += sale.quantity
    line.totalCents += sale.quantity * cost.unitCostCents
    line.saleKeys.push(sale.key)
    lines.set(id, line)
  }

  const adjustments: PricedAdjustment[] = []
  for (const adjustment of input.adjustments) {
    const cost = adjustment.unitCostCents ?? (adjustment.occurredAt ? resolveCost(input.costs, adjustment.sku, adjustment.occurredAt)?.unitCostCents : undefined)
    if (cost === undefined) {
      blockers.push({ code: 'cost_missing', saleKey: adjustment.saleKey, storeId: adjustment.storeId, sku: adjustment.sku })
      continue
    }
    adjustments.push({ saleKey: adjustment.saleKey, kind: adjustment.kind, storeId: adjustment.storeId, sku: adjustment.sku, quantity: adjustment.quantity, unitCostCents: cost, totalCents: adjustment.quantity * cost })
  }

  const reaches = input.salesImportedUntil !== null && input.salesImportedUntil.getTime() >= input.period.end.getTime()
  if (!reaches && !input.partialAccepted) blockers.push({ code: 'sales_incomplete' })

  const lineList = [...lines.values()].sort((a, b) => a.storeId - b.storeId || a.sku.localeCompare(b.sku) || a.costValidFrom.localeCompare(b.costValidFrom))
  const salesCents = lineList.reduce((sum, line) => sum + line.totalCents, 0)
  const adjustmentsCents = adjustments.reduce((sum, adjustment) => sum + adjustment.totalCents, 0)

  return { lines: lineList, cancellations: [...cancelled.values()], adjustments, salesCents, adjustmentsCents, owedCents: salesCents + adjustmentsCents, blockers, confirmable: blockers.length === 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- consignment-closing`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-closing.ts backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-closing.spec.ts
git commit -m "feat(suppliers): consignment closing calculation with blockers, adjustments and cost vigências"
```

---

### Task 9: Verificação da fase

**Files:**
- Nenhum arquivo novo.

- [ ] **Step 1: Run the whole unit suite of the service**

Run (em `backend/apps/suppliers-service`): `pnpm test`
Expected: PASS, incluindo os testes antigos de `settlement`, `payables` e `order-flow` sem alteração.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 3: Confirm nothing outside the new files changed**

Run (na raiz): `git diff --stat <commit anterior à Task 1>..HEAD -- . ':!docs'`
Expected: apenas arquivos `consignment-*.ts` e `consignment-*.spec.ts` em `backend/apps/suppliers-service/src/modules/purchasing/utils/`.

- [ ] **Step 4: Record the phase in the service CLAUDE.md**

Acrescentar ao fim de `backend/apps/suppliers-service/CLAUDE.md` uma seção curta, no formato das existentes (sem prosa genérica):

```markdown
## Fechamento de consignação — regras puras (`utils/consignment-*.ts`, fase 1)

Regras do fechamento por consignação como funções puras, ainda sem persistência nem rota (fases 2–5 em `docs/superpowers/plans/`). Spec: `docs/superpowers/specs/2026-10-13-supplier-consignment-closing-design.md`. `consignment-period` (intervalos semiabertos em America/Sao_Paulo, offset fixo −03:00: o Brasil não tem horário de verão desde 2019), `consignment-sale-key` (chave por loja+SKU+instante+recibo+ordem, sem o `result`), `consignment-balance` (razão menos vendas desde o corte; negativo reportado), `consignment-cost` (vigência na data da venda; nunca custo do lote), `consignment-attribution` (dois fornecedores = pendência), `consignment-adjustments` (cancelamento, venda tardia e quantidade como ajustes; chave que some é `missing`, não cancelamento), `consignment-expiry` (retirada por motivo; devolução parcial = soma de entregas), `consignment-closing` (repasse + bloqueios).
```

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/CLAUDE.md
git commit -m "docs(suppliers): record consignment closing pure rules"
```
