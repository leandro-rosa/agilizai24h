import { NewProductChoiceService } from './new-product-choice.service'

const suggestion = (over: Record<string, unknown> = {}) => ({ sku: '110024', suggestedPriceCents: 610, confidence: 'low', dataUsed: [{ code: 'cost' }], ...over })

function make(over: Record<string, unknown> = {}) {
  const rows: Record<string, any>[] = []
  const prisma = {
    newProductPriceChoice: {
      findUnique: async ({ where }: any) => rows.find(r => r.idempotency_key === where.idempotency_key) ?? null,
      create: async ({ data }: any) => (rows.push(data), data),
      findMany: async () => rows,
    },
  }
  const newProduct = jest.fn(async () => ({ meta: { parameterVersion: 3 }, suggestion: suggestion(over) }))

  return { service: new NewProductChoiceService(prisma as never, { newProduct } as never), rows, newProduct }
}

const base = { idempotencyKey: 'k1', sku: '110024', actor: 'ana@agiliz.ai', costCents: 309, costOrigin: 'Nota fiscal 13021' }

describe('NewProductChoiceService', () => {
  it('records the suggestion as the server computed it, with the cost, the data used and the parameter version', async () => {
    const { service, rows, newProduct } = make()

    await service.record({ ...base, choice: 'suggested_accepted', chosenPriceCents: 610, decisionId: 'dec-1' })

    expect(newProduct).toHaveBeenCalledWith('110024', { costCents: 309, costOrigin: 'Nota fiscal 13021', costNotReceived: false }, undefined)
    expect(rows[0]).toMatchObject({ choice: 'suggested_accepted', suggested_price_cents: 610, chosen_price_cents: 610, confidence: 'low', parameter_version_id: 3, decision_id: 'dec-1', actor: 'ana@agiliz.ai', cost_cents: 309, data_used: [{ code: 'cost' }] })
  })

  it('"used the suggestion" is refused when the price is not the suggestion', async () => {
    const { service, rows } = make()

    await expect(service.record({ ...base, choice: 'suggested_accepted', chosenPriceCents: 650 })).rejects.toThrow('differs from the suggestion')
    expect(rows).toHaveLength(0)
  })

  it('a typed price needs a reason, and keeps both the suggestion and the typed price', async () => {
    const { service, rows } = make()
    await expect(service.record({ ...base, choice: 'changed_by_hand', chosenPriceCents: 690 })).rejects.toThrow('reason is required')

    await service.record({ ...base, choice: 'changed_by_hand', chosenPriceCents: 690, reason: 'Concorrente vende a 6,90' })

    expect(rows[0]).toMatchObject({ choice: 'changed_by_hand', suggested_price_cents: 610, chosen_price_cents: 690, reason: 'Concorrente vende a 6,90' })
  })

  it('saving without a price records the choice and no price', async () => {
    const { service, rows } = make()

    await service.record({ ...base, choice: 'left_without_price' })

    expect(rows[0]).toMatchObject({ choice: 'left_without_price', chosen_price_cents: null, suggested_price_cents: 610 })
    await expect(service.record({ ...base, idempotencyKey: 'k2', choice: 'left_without_price', chosenPriceCents: 500 })).rejects.toThrow('no chosen price')
  })

  it('accepting a suggestion that does not exist is refused', async () => {
    const { service } = make({ suggestedPriceCents: null })

    await expect(service.record({ ...base, choice: 'suggested_accepted', chosenPriceCents: 610 })).rejects.toThrow('no suggested price')
  })

  it('the same key is one record', async () => {
    const { service, rows } = make()

    await service.record({ ...base, choice: 'left_without_price' })
    const again = await service.record({ ...base, choice: 'left_without_price' })

    expect(again.created).toBe(false)
    expect(rows).toHaveLength(1)
  })

  it('needs the key, a known choice and the user', async () => {
    const { service } = make()

    await expect(service.record({ ...base, idempotencyKey: undefined, choice: 'left_without_price' })).rejects.toThrow('idempotencyKey')
    await expect(service.record({ ...base, choice: 'whatever' })).rejects.toThrow('choice must be one of')
    await expect(service.record({ ...base, actor: undefined, choice: 'left_without_price' })).rejects.toThrow('actor')
  })
})
