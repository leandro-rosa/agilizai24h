import { reconcile, valuationDateFor, type SkuQuantities } from './reconcile'

const cost = (sku: string, cents: number, effectiveFrom = '2026-01-01') => ({
  sku,
  product_id: 1,
  cost_cents: cents,
  effective_from: effectiveFrom,
})

const quantities = (overrides: Partial<SkuQuantities> & { sku: string }): SkuQuantities => ({
  restocked: 0,
  sold: 0,
  remaining: 0,
  stockInconsistent: false,
  adjustment: 0,
  lossByReason: [],
  ...overrides,
})

describe('reconcile', () => {
  describe('the four figures', () => {
    it('values restocking, COGS and remaining stock at cost', () => {
      const result = reconcile([quantities({ sku: 'A', restocked: 10, sold: 6, remaining: 4 })], [cost('A', 250)], [])

      expect(result.restocked_value_cents).toBe(2500)
      expect(result.cogs_cents).toBe(1500)
      expect(result.remaining_value_cents).toBe(1000)
    })

    it('values loss from the classified removals only', () => {
      // supply already decided what counts; this never re-derives it.
      const result = reconcile(
        [quantities({ sku: 'A', restocked: 10, lossByReason: [{ reason: 'expired', quantity: 3 }] })],
        [cost('A', 250)],
        [],
      )

      expect(result.loss_quantity).toBe(3)
      expect(result.loss_value_cents).toBe(750)
    })

    it('reports zero loss for a month whose removals were all non-loss', () => {
      // supply sends no loss-counting reasons at all in that case, and the
      // other figures must still be computed.
      const result = reconcile([quantities({ sku: 'A', restocked: 10, sold: 6, remaining: 1 })], [cost('A', 250)], [])

      expect(result.loss_value_cents).toBe(0)
      expect(result.restocked_value_cents).toBe(2500)
    })
  })

  describe('unpriced SKUs', () => {
    it('never values an unpriced SKU at zero', () => {
      // Treating a missing cost as zero understates COGS and loss, which makes
      // the numbers look better — so nobody questions them.
      const result = reconcile(
        [
          quantities({ sku: 'A', restocked: 10, sold: 6, remaining: 4 }),
          quantities({ sku: 'GHOST', restocked: 100, sold: 90, remaining: 10 }),
        ],
        [cost('A', 250)],
        [{ sku: 'GHOST', reason: 'no_cost_for_date' }],
      )

      // Only A contributed; GHOST added nothing rather than adding zero.
      expect(result.restocked_value_cents).toBe(2500)
      expect(result.lines.map(line => line.sku)).toEqual(['A'])
    })

    it('marks the reconciliation incomplete and says which SKU and why', () => {
      const result = reconcile(
        [quantities({ sku: 'GHOST', restocked: 100 })],
        [],
        [{ sku: 'GHOST', reason: 'unknown_sku' }],
      )

      expect(result.complete).toBe(false)
      expect(result.unvalued).toEqual([
        { sku: 'GHOST', reason: 'unknown_sku', restocked: 100, sold: 0, remaining: 0, loss_quantity: 0 },
      ])
    })

    it('keeps the unvalued quantities visible, not just the fact of exclusion', () => {
      const result = reconcile(
        [quantities({ sku: 'GHOST', restocked: 100, sold: 90, lossByReason: [{ reason: 'expired', quantity: 5 }] })],
        [],
        [{ sku: 'GHOST', reason: 'no_cost_for_date' }],
      )

      expect(result.unvalued[0]).toMatchObject({ restocked: 100, sold: 90, loss_quantity: 5 })
    })

    it('marks a fully priced month complete', () => {
      const result = reconcile([quantities({ sku: 'A', restocked: 10 })], [cost('A', 250)], [])

      expect(result.complete).toBe(true)
    })

    it('treats a recorded cost of zero as a real cost, not as missing', () => {
      const result = reconcile([quantities({ sku: 'FREE', restocked: 10 })], [cost('FREE', 0)], [])

      expect(result.complete).toBe(true)
      expect(result.restocked_value_cents).toBe(0)
      expect(result.unvalued).toEqual([])
    })
  })

  describe('inconsistent stock', () => {
    it('never calls a month clean when a valued balance was flagged inconsistent', () => {
      // Seen live: a reconciliation reported remaining stock of MINUS 37500
      // centavos and `complete: true`. inventory-service reports a negative
      // balance rather than zeroing it, precisely so the problem stays visible
      // — and finance was dropping that flag on the floor.
      const result = reconcile(
        [quantities({ sku: 'A', restocked: 0, sold: 90, remaining: -90, stockInconsistent: true })],
        [cost('A', 250)],
        [],
      )

      expect(result.complete).toBe(false)
      expect(result.inconsistent_stock).toEqual(['A'])
    })

    it('still values the flagged SKU, since the figure is the evidence', () => {
      // Excluding it would hide the size of the problem, and the totals would
      // silently stop matching the movement data they came from.
      const result = reconcile(
        [quantities({ sku: 'A', restocked: 10, sold: 90, remaining: -80, stockInconsistent: true })],
        [cost('A', 100)],
        [],
      )

      expect(result.remaining_value_cents).toBe(-8000)
      expect(result.lines.map(line => line.sku)).toEqual(['A'])
    })

    it('leaves a consistent month clean', () => {
      const result = reconcile(
        [quantities({ sku: 'A', restocked: 10, sold: 6, remaining: 4, stockInconsistent: false })],
        [cost('A', 250)],
        [],
      )

      expect(result.complete).toBe(true)
      expect(result.inconsistent_stock).toEqual([])
    })

    it('names only the flagged SKUs, not every SKU in the month', () => {
      const result = reconcile(
        [
          quantities({ sku: 'A', remaining: 4 }),
          quantities({ sku: 'B', remaining: -4, stockInconsistent: true }),
        ],
        [cost('A', 100), cost('B', 100)],
        [],
      )

      expect(result.inconsistent_stock).toEqual(['B'])
    })
  })

  describe('loss breakdowns', () => {
    it('breaks loss down by reason, in units and currency', () => {
      const result = reconcile(
        [
          quantities({
            sku: 'A',
            lossByReason: [
              { reason: 'expired', quantity: 3 },
              { reason: 'damaged_product', quantity: 2 },
            ],
          }),
        ],
        [cost('A', 250)],
        [],
      )

      expect(result.loss_by_reason).toEqual([
        { reason: 'damaged_product', quantity: 2, value_cents: 500 },
        { reason: 'expired', quantity: 3, value_cents: 750 },
      ])
    })

    it('breaks loss down by SKU', () => {
      const result = reconcile(
        [
          quantities({ sku: 'B', lossByReason: [{ reason: 'expired', quantity: 1 }] }),
          quantities({ sku: 'A', lossByReason: [{ reason: 'expired', quantity: 2 }] }),
        ],
        [cost('A', 100), cost('B', 300)],
        [],
      )

      expect(result.loss_by_sku).toEqual([
        { sku: 'A', quantity: 2, value_cents: 200 },
        { sku: 'B', quantity: 1, value_cents: 300 },
      ])
    })

    it('makes both breakdowns sum to the total', () => {
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

      const byReason = result.loss_by_reason.reduce((sum, entry) => sum + entry.value_cents, 0)
      const bySku = result.loss_by_sku.reduce((sum, entry) => sum + entry.value_cents, 0)

      expect(byReason).toBe(result.loss_value_cents)
      expect(bySku).toBe(result.loss_value_cents)
    })

    it('leaves an unpriced SKU out of the loss breakdowns entirely', () => {
      const result = reconcile(
        [quantities({ sku: 'GHOST', lossByReason: [{ reason: 'expired', quantity: 99 }] })],
        [],
        [{ sku: 'GHOST', reason: 'unknown_sku' }],
      )

      expect(result.loss_by_reason).toEqual([])
      expect(result.loss_value_cents).toBe(0)
      // But the fact is not lost — it is reported as unvalued.
      expect(result.unvalued[0].loss_quantity).toBe(99)
    })

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
  })

  describe('exact arithmetic', () => {
    it('sums many lines with no drift', () => {
      // The same arithmetic in floating point accumulates error, and the
      // resulting mismatch against the operators' spreadsheet would be small,
      // real, and very expensive to diagnose.
      const items = Array.from({ length: 1000 }, (_, i) => quantities({ sku: `S${i}`, restocked: 1 }))
      const costs = Array.from({ length: 1000 }, (_, i) => cost(`S${i}`, 1))

      const result = reconcile(items, costs, [])

      expect(result.restocked_value_cents).toBe(1000)
      expect(Number.isInteger(result.restocked_value_cents)).toBe(true)
    })

    it('keeps every total an integer', () => {
      const result = reconcile([quantities({ sku: 'A', restocked: 7, sold: 3, remaining: 4 })], [cost('A', 333)], [])

      for (const total of [result.restocked_value_cents, result.cogs_cents, result.remaining_value_cents]) {
        expect(Number.isInteger(total)).toBe(true)
      }
    })
  })

  describe('empty month', () => {
    it('produces zeroes and stays complete when there is simply nothing', () => {
      const result = reconcile([], [], [])

      expect(result).toMatchObject({ restocked_value_cents: 0, cogs_cents: 0, complete: true })
    })
  })

  describe('the unclassified stock adjustment (design D6)', () => {
    it('values an inbound adjustment at current cost, never as restocked value', () => {
      const result = reconcile([quantities({ sku: 'A', restocked: 0, adjustment: 12 })], [cost('A', 250)], [])

      expect(result.restocked_value_cents).toBe(0)
      expect(result.unclassified_stock_adjustment_value_cents).toBe(3000)
    })

    it('values an outbound adjustment as negative, never reducing real loss', () => {
      const result = reconcile([quantities({ sku: 'A', adjustment: -4 })], [cost('A', 250)], [])

      expect(result.unclassified_stock_adjustment_value_cents).toBe(-1000)
      expect(result.loss_value_cents).toBe(0)
    })

    it('nets inbound and outbound across SKUs into one figure', () => {
      const result = reconcile(
        [quantities({ sku: 'A', adjustment: 10 }), quantities({ sku: 'B', adjustment: -4 })],
        [cost('A', 100), cost('B', 200)],
        [],
      )

      // 10×100 − 4×200 = 1000 − 800 = 200
      expect(result.unclassified_stock_adjustment_value_cents).toBe(200)
    })

    it('still counts adjusted-in units toward remaining stock value', () => {
      const result = reconcile(
        [quantities({ sku: 'A', adjustment: 10, remaining: 10 })],
        [cost('A', 250)],
        [],
      )

      expect(result.remaining_value_cents).toBe(2500)
    })

    it('flags every SKU with a non-zero adjustment, sorted by magnitude', () => {
      const result = reconcile(
        [
          quantities({ sku: 'A', adjustment: -2 }),
          quantities({ sku: 'B', adjustment: 9 }),
          quantities({ sku: 'C', adjustment: 0 }),
        ],
        [cost('A', 100), cost('B', 100), cost('C', 100)],
        [],
      )

      expect(result.adjustment_flags.map(entry => entry.sku)).toEqual(['B', 'A'])
      expect(result.adjustment_flags.every(entry => entry.quantity !== 0)).toBe(true)
    })

    it('is never traced to an origin SKU history — it is simply this period, this SKU', () => {
      // There is no origin-store field anywhere in the shape; the adjustment
      // is valued the same way regardless of what caused it.
      const result = reconcile([quantities({ sku: 'A', adjustment: 5 })], [cost('A', 300)], [])

      expect(result.lines[0]).toMatchObject({ adjustment_quantity: 5, adjustment_value_cents: 1500 })
    })
  })

  describe('the recorded closing balance (design D5 — no longer cross-checked)', () => {
    it('a SKU with an ordinary balance stays complete', () => {
      const result = reconcile([quantities({ sku: 'A', restocked: 10 })], [cost('A', 100)], [])

      expect(result.complete).toBe(true)
    })
  })
})

describe('valuationDateFor', () => {
  it('uses the last day of the month', () => {
    expect(valuationDateFor('2026-03')).toBe('2026-03-31')
    expect(valuationDateFor('2026-04')).toBe('2026-04-30')
  })

  it('handles February in a leap year', () => {
    expect(valuationDateFor('2028-02')).toBe('2028-02-29')
  })

  it('handles February in a common year', () => {
    expect(valuationDateFor('2026-02')).toBe('2026-02-28')
  })

  it('handles December', () => {
    expect(valuationDateFor('2026-12')).toBe('2026-12-31')
  })
})
