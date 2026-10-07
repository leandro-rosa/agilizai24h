import { BadRequestException } from '@nestjs/common'
import { CostService } from './cost.service'
import { PriceService } from './price.service'

interface Row {
  id: number
  product_id: number
  effective_from: Date
  source: string
  source_ref: string | null
  [key: string]: unknown
}

/** An in-memory stand-in for the two version tables, matching the `where` shapes the services use. */
function table(valueField: 'cost_cents' | 'price_cents') {
  const rows: Row[] = []
  const matches = (row: Row, where: Record<string, any> = {}) =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key]
      if (expected && typeof expected === 'object' && 'lte' in expected) return (actual as Date).getTime() <= (expected.lte as Date).getTime()
      if (expected && typeof expected === 'object' && 'lt' in expected) return (actual as Date).getTime() < (expected.lt as Date).getTime()
      if (expected && typeof expected === 'object' && 'in' in expected) return (expected.in as unknown[]).includes(actual)
      if (expected instanceof Date) return (actual as Date).getTime() === expected.getTime()
      return actual === expected
    })

  return {
    rows,
    api: {
      findFirst: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
      findMany: async ({ where }: any = {}) => rows.filter(row => matches(row, where)),
      create: async ({ data }: any) => {
        const row = { id: rows.length + 1, created_at: new Date(), ...data } as Row
        rows.push(row)
        return row
      },
    },
    valueField,
  }
}

function build() {
  const costs = table('cost_cents')
  const prices = table('price_cents')
  const product = { id: 10, sku: 'MONS', name: 'Monster' }
  const prisma = {
    product: { findUnique: async ({ where }: any) => (where.sku === 'MONS' ? product : null), findMany: async () => [product] },
    costVersion: costs.api,
    priceVersion: prices.api,
  }
  const productsRepo = { findBySkus: async (skus: string[]) => (skus.includes('MONS') ? [product] : []) }
  const costsRepo = {
    findUpTo: async (ids: number[], asOf: Date) => costs.rows.filter(row => ids.includes(row.product_id) && row.effective_from.getTime() <= asOf.getTime()),
    findAllForProduct: async (id: number) => costs.rows.filter(row => row.product_id === id),
  }

  return { cost: new CostService(productsRepo as never, costsRepo as never, prisma as never), price: new PriceService(prisma as never), costs, prices }
}

const day = (value: string) => new Date(`${value}T00:00:00Z`)
const manual = (reason = 'fornecedor reajustou') => ({ source: 'manual', actor: 'ana@agiliz.ai', reason })
const invoice = (item = 31) => ({ source: 'invoice', supplierId: 5, purchaseId: 9, purchaseItemId: item, sourceRef: `purchase-item:${item}`, invoiceNumber: '13021', purchaseQuantity: 150, purchaseTotalCents: 93000 })

describe('cost versions are append-only', () => {
  it('keeps the old version when a new one is recorded', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570)
    await cost.recordCost('MONS', day('2026-10-10'), 620)

    expect(costs.rows).toHaveLength(2)
  })

  it('recording the same date again ADDS a corrective version instead of overwriting, and the later one is in force', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    const correction = await cost.recordCost('MONS', day('2026-08-01'), 580, manual())

    expect(costs.rows.map(row => row.cost_cents)).toEqual([570, 580])
    expect(correction).toMatchObject({ created: true, in_force: true })
    expect((await cost.costAsOf('MONS', day('2026-08-20'))).cost_cents).toBe(580)
  })

  it('recording the very same value, date and source again writes nothing', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    const again = await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })

    expect(again.created).toBe(false)
    expect(costs.rows).toHaveLength(1)
  })

  it('an invoice beats a manual entry of the same date, even one recorded later, and says the manual one is not in force', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())
    const later = await cost.recordCost('MONS', day('2026-10-10'), 640, manual())

    expect(later.in_force).toBe(false)
    expect((await cost.costAsOf('MONS', day('2026-10-10'))).cost_cents).toBe(620)
  })

  it('a later effective date beats an earlier invoice', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())
    await cost.recordCost('MONS', day('2026-10-15'), 650, manual())

    expect((await cost.costAsOf('MONS', day('2026-10-12'))).cost_cents).toBe(620)
    expect((await cost.costAsOf('MONS', day('2026-10-20'))).cost_cents).toBe(650)
  })

  it('an idempotency key creates the version once: syncing the same purchase item twice is one version', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice(31))
    const again = await cost.recordCost('MONS', day('2026-10-10'), 620, invoice(31))

    expect(again.created).toBe(false)
    expect(costs.rows).toHaveLength(1)
  })

  it('stores the provenance of an invoice cost: supplier, purchase, invoice and the original quantity and total', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())

    expect(costs.rows[0]).toMatchObject({ source: 'invoice', supplier_id: 5, purchase_id: 9, purchase_item_id: 31, invoice_number: '13021', purchase_quantity: 150, purchase_total_cents: 93000 })
  })

  it('refuses a manual cost with no reason and records nothing', async () => {
    const { cost, costs } = build()

    await expect(cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'manual', actor: 'ana@agiliz.ai' })).rejects.toBeInstanceOf(BadRequestException)
    expect(costs.rows).toHaveLength(0)
  })
})

describe('an invoice cost', () => {
  it('rises: creates the version and reports the cost it replaced', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    const result = await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())

    expect(result).toMatchObject({ created: true, unchanged: false, in_force: true, previous_cost_cents: 570, cost_cents: 620 })
    expect(costs.rows).toHaveLength(2)
  })

  it('at the cost already in force creates NO version, so a purchase at an unchanged price does not clutter the history', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 620, { source: 'catalogue_sync' })
    const result = await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())

    expect(result).toMatchObject({ created: false, unchanged: true, previous_cost_cents: 620 })
    expect(costs.rows).toHaveLength(1)
  })

  it('the first cost of a product has no previous cost and is created', async () => {
    const { cost, costs } = build()
    const result = await cost.recordCost('MONS', day('2026-10-10'), 850, invoice())

    expect(result).toMatchObject({ created: true, unchanged: false, previous_cost_cents: null, cost_cents: 850 })
    expect(costs.rows[0]).toMatchObject({ source: 'invoice', cost_cents: 850 })
  })

  it('a manual cost at the same value is still recorded: only an invoice is treated as a confirmation', async () => {
    const { cost, costs } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 620, { source: 'catalogue_sync' })
    await cost.recordCost('MONS', day('2026-10-10'), 620, manual())

    expect(costs.rows).toHaveLength(2)
  })

  it('an older invoice received late compares with the cost in force on ITS date, not with today\'s', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice(31))
    const late = await cost.recordCost('MONS', day('2026-09-05'), 570, invoice(32))

    expect(late).toMatchObject({ unchanged: true, previous_cost_cents: 570 })
  })
})

describe('the past does not change when a later cost is recorded', () => {
  it('August stays at the August cost after an October cost exists (the acceptance case)', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    const august = await cost.costAsOf('MONS', day('2026-08-31'))

    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())
    const augustAgain = await cost.costAsOf('MONS', day('2026-08-31'))

    expect(augustAgain).toEqual(august)
    expect(augustAgain.cost_cents).toBe(570)
  })

  it('reports no cost before the first version, never falling back to a later one', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    const result = await cost.bulkCostAsOf(['MONS'], day('2026-07-31'))

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toEqual([{ sku: 'MONS', reason: 'no_cost_for_date' }])
    expect(result.complete).toBe(false)
  })

  it('keeps the partitioned contract: resolved, unresolved and complete', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    const result = await cost.bulkCostAsOf(['MONS', 'NOPE'], day('2026-09-01'))

    expect(result.as_of).toBe('2026-09-01')
    expect(result.resolved).toEqual([{ sku: 'MONS', product_id: 10, cost_cents: 570, effective_from: '2026-08-01', source: 'catalogue_sync', invoice_number: null }])
    expect(result.unresolved).toEqual([{ sku: 'NOPE', reason: 'unknown_sku' }])
  })

  it('says where the cost in force came from, and the invoice number when it came from one', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())

    const august = await cost.bulkCostAsOf(['MONS'], day('2026-09-30'))
    const october = await cost.bulkCostAsOf(['MONS'], day('2026-10-31'))

    expect(august.resolved[0]).toMatchObject({ cost_cents: 570, source: 'catalogue_sync', invoice_number: null })
    expect(october.resolved[0]).toMatchObject({ cost_cents: 620, source: 'invoice', invoice_number: '13021' })
  })

  it('resolves among the requested sources only: a newer manual cost never stands in for the last received purchase', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    await cost.recordCost('MONS', day('2026-09-05'), 600, invoice())
    await cost.recordCost('MONS', day('2026-10-20'), 650, manual())

    const inForce = await cost.bulkCostAsOf(['MONS'], day('2026-10-31'))
    const purchases = await cost.bulkCostAsOf(['MONS'], day('2026-10-31'), ['invoice'])
    const beforeAnyPurchase = await cost.bulkCostAsOf(['MONS'], day('2026-08-31'), ['invoice'])

    expect(inForce.resolved[0]).toMatchObject({ cost_cents: 650, source: 'manual' })
    expect(purchases.resolved[0]).toMatchObject({ cost_cents: 600, source: 'invoice', effective_from: '2026-09-05' })
    expect(beforeAnyPurchase.resolved).toEqual([])
    expect(beforeAnyPurchase.unresolved).toEqual([{ sku: 'MONS', reason: 'no_cost_for_date' }])
  })
})

describe('listing the history of a cost', () => {
  it('derives when each version stops being in force and which were superseded', async () => {
    const { cost } = build()
    await cost.recordCost('MONS', day('2026-08-01'), 570, { source: 'catalogue_sync' })
    await cost.recordCost('MONS', day('2026-10-10'), 620, invoice())

    const list = await cost.listVersions(10)

    expect(list.map(v => [v.cost_cents, v.valid_to, v.superseded, v.source])).toEqual([
      [570, '2026-10-09', false, 'catalogue_sync'],
      [620, null, false, 'invoice'],
    ])
  })
})

describe('price versions are append-only too', () => {
  it('a same-date correction is added and the latest recorded is in force; the earlier one is kept', async () => {
    const { price, prices } = build()
    await price.recordPrice('MONS', day('2026-10-07'), 650, { source: 'pricing_intelligence', actor: 'ana@agiliz.ai', sourceRef: 'decision-1' })
    const second = await price.recordPrice('MONS', day('2026-10-07'), 620, { source: 'pricing_intelligence', actor: 'ana@agiliz.ai', sourceRef: 'decision-2' })

    expect(prices.rows.map(row => row.price_cents)).toEqual([650, 620])
    expect(second.in_force).toBe(true)
    expect((await price.priceAsOf('MONS', day('2026-10-08'))).price_cents).toBe(620)
  })

  it('the pricing decision id is an idempotency key: the same decision writes one price', async () => {
    const { price, prices } = build()
    const meta = { source: 'pricing_intelligence', actor: 'ana@agiliz.ai', sourceRef: 'decision-1' }
    await price.recordPrice('MONS', day('2026-10-07'), 650, meta)
    const again = await price.recordPrice('MONS', day('2026-10-07'), 650, meta)

    expect(again.created).toBe(false)
    expect(prices.rows).toHaveLength(1)
  })

  it('lists newest first with the end of each validity', async () => {
    const { price } = build()
    await price.recordPrice('MONS', day('2026-08-01'), 1190, { source: 'catalogue_sync' })
    await price.recordPrice('MONS', day('2026-09-16'), 1250, { source: 'manual', actor: 'ana@agiliz.ai', reason: 'reajuste' })

    const list = await price.listVersions(10)

    expect(list.map(v => [v.price_cents, v.valid_to])).toEqual([
      [1250, null],
      [1190, '2026-09-15'],
    ])
  })

  it('refuses a price that comes from an invoice', async () => {
    const { price } = build()

    await expect(price.recordPrice('MONS', day('2026-08-01'), 1190, { source: 'invoice' })).rejects.toBeInstanceOf(BadRequestException)
  })
})
