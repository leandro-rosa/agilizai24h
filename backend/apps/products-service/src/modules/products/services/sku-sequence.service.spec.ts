import { ConflictException } from '@nestjs/common'
import { SkuSequenceService } from './sku-sequence.service'

/** An in-memory stand-in for the counter row and the product table: just the statements the service issues. */
function fake(start: number, used: string[] = []) {
  const state = { last: start, products: new Set(used) }
  const prisma = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql.includes('UPDATE sku_sequence SET last_value = last_value + 1')) {
        if (state.last >= (values[0] as number)) return []
        state.last += 1

        return [{ last_value: state.last }]
      }
      if (sql.includes('SELECT last_value')) return [{ last_value: state.last }]
      if (sql.includes('FROM product')) return [...state.products].filter(sku => /^\d{6}$/.test(sku) && Number(sku) > (values[0] as number)).sort().map(sku => ({ sku }))
      throw new Error(`unexpected ${sql}`)
    }),
    $executeRaw: jest.fn(async (_strings: TemplateStringsArray, value: number) => {
      state.last = Math.max(state.last, value)
    }),
    product: { findUnique: jest.fn(async ({ where }: any) => (state.products.has(where.sku) ? { id: 1 } : null)) },
  }

  return { service: new SkuSequenceService(prisma as never), state, prisma }
}

describe('SkuSequenceService', () => {
  it('the first automatic SKU after the owner\'s last one (100112) is 100113', async () => {
    const { service } = fake(100112)

    expect(await service.allocate()).toBe('100113')
    expect(await service.allocate()).toBe('100114')
  })

  it('simultaneous registrations never receive the same number', async () => {
    const { service } = fake(100112)
    const got = await Promise.all(Array.from({ length: 25 }, () => service.allocate()))

    expect(new Set(got).size).toBe(25)
    expect(got.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => 100113 + i))
  })

  it('skips a code that a product already uses (typed by hand or imported before the counter reached it)', async () => {
    const { service } = fake(100112, ['100113', '100114'])

    expect(await service.allocate()).toBe('100115')
  })

  it('never reuses a number: the counter only grows, even when the product that had it is gone', async () => {
    const { service, state } = fake(100112)
    const first = await service.allocate()
    state.products.delete(first)

    expect(await service.allocate()).toBe('100114')
  })

  it('an explicit six-digit SKU above the counter moves the counter up; a lower one or another shape does not', async () => {
    const { service, state } = fake(100112)
    await service.observe('100500')
    expect(state.last).toBe(100500)
    await service.observe('100200')
    expect(state.last).toBe(100500)
    await service.observe('REF-GUA-350')
    await service.observe('1234')
    expect(state.last).toBe(100500)
    expect(await service.allocate()).toBe('100501')
  })

  it('the forecast shows the likely next number, skips used ones, and reserves nothing', async () => {
    const { service, state } = fake(100112, ['100113'])

    expect(await service.forecast()).toMatchObject({ suggested: '100114', highest: '100112', forecast: true })
    expect(await service.forecast()).toMatchObject({ suggested: '100114' })
    expect(state.last).toBe(100112)
  })

  it('at 999999 there is no automatic SKU left: it says so instead of wrapping or looping', async () => {
    const { service } = fake(999_999)

    await expect(service.allocate()).rejects.toBeInstanceOf(ConflictException)
    expect(await service.forecast()).toMatchObject({ suggested: null })
  })
})
