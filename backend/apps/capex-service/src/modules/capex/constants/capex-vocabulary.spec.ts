import { itemCostCents, paybackMonths } from './capex-vocabulary'

describe('itemCostCents', () => {
  it('uses the cash amount when there was no financing', () => {
    expect(itemCostCents({ cash_amount_cents: 259_000, financed_amount_cents: 0 })).toBe(259_000)
  })

  it('uses the financed total when the purchase was financed', () => {
    // Refrigerador da planilha: R$ 2.590 a vista, R$ 2.890 em 10x. Somar o a
    // vista subestimaria o investimento em R$ 300 — o custo do credito.
    expect(itemCostCents({ cash_amount_cents: 259_000, financed_amount_cents: 289_000 })).toBe(289_000)
  })
})

describe('paybackMonths', () => {
  it('divides the investment by the monthly profit', () => {
    expect(paybackMonths(1_200_000, 100_000)).toBe(12)
  })

  it('rounds to two decimals', () => {
    expect(paybackMonths(1_000_000, 300_000)).toBe(3.33)
  })

  it('is undefined when profit is zero — nothing pays back a store that does not profit', () => {
    // 0 diria "ja se pagou", que e o contrario da verdade.
    expect(paybackMonths(1_200_000, 0)).toBeNull()
  })

  it('is undefined when profit is negative', () => {
    expect(paybackMonths(1_200_000, -50_000)).toBeNull()
  })

  it('is zero when nothing was invested', () => {
    expect(paybackMonths(0, 100_000)).toBe(0)
  })
})
