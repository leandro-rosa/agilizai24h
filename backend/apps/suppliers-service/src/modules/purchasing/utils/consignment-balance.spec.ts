import { computeBalance, storeLocation, type Movement } from './consignment-balance'
import type { KeyedSale } from './consignment-sale-key'

const CUTOFF = new Date('2026-09-30T03:00:00Z')
const at = (iso: string) => new Date(iso)
const move = (kind: Movement['kind'], quantity: number, when = '2026-10-02T12:00:00Z', over: Partial<Movement> = {}): Movement => ({ supplierId: 7, sku: 'A', location: storeLocation(1), kind, quantity, occurredAt: at(when), ...over })
const sale = (quantity: number, when = '2026-10-03T12:00:00Z', over: Partial<KeyedSale> = {}): KeyedSale => ({ key: `k-${when}-${quantity}`, storeId: 1, sku: 'A', occurredAt: at(when), quantity, result: 'OK', receiptId: 'C', ...over })

/** Every sale of the fixture is attributed to supplier 7 unless a test says otherwise. */
const balance = (input: Omit<Parameters<typeof computeBalance>[0], 'saleSupplier'> & { saleSupplier?: Map<string, number> }) =>
  computeBalance({ ...input, saleSupplier: input.saleSupplier ?? new Map(input.sales.map(s => [s.key, 7])) })

describe('computeBalance — per supplier, only that supplier\'s own sales are subtracted', () => {
  it('another supplier\'s sales and unattributed sales do not reduce this supplier\'s balance', () => {
    const sales = [sale(2, '2026-10-03T12:00:00Z'), sale(4, '2026-10-04T12:00:00Z'), sale(3, '2026-10-05T12:00:00Z')]
    const input = { sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), sales }
    const saleSupplier = new Map([[sales[0].key, 7], [sales[1].key, 8]]) // the third sale is unattributed

    const seven = computeBalance({ ...input, supplierId: 7, saleSupplier, movements: [move('opening', 3, '2026-09-30T03:00:00Z')] })
    const eight = computeBalance({ ...input, supplierId: 8, saleSupplier, movements: [move('opening', 10, '2026-09-30T03:00:00Z', { supplierId: 8 })] })

    expect(seven).toMatchObject({ balance: 1, netSales: 2 })
    expect(eight).toMatchObject({ balance: 6, netSales: 4 })
  })

  it('without a supplier filter the figure is the location total: every OK sale subtracts', () => {
    const sales = [sale(2), sale(4, '2026-10-04T12:00:00Z')]
    const result = computeBalance({ sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), movements: [move('opening', 10, '2026-09-30T03:00:00Z')], sales })

    expect(result.balance).toBe(4)
  })

  it('a sale exactly at the cutoff is in the first period, so it also reduces the balance', () => {
    const result = balance({ supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), movements: [move('opening', 10, '2026-09-30T03:00:00Z')], sales: [sale(1, '2026-09-30T03:00:00Z')] })

    expect(result).toMatchObject({ balance: 9, netSales: 1 })
  })
})

describe('computeBalance — stock is a ledger minus the sales since the cutoff', () => {
  it('the reference case: 20 in stock, 30 received, 18 sold, 2 expired and withdrawn → 30 sellable', () => {
    const result = balance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'),
      movements: [move('opening', 20, '2026-09-30T03:00:00Z'), move('receipt', 30), move('expiry_writeoff', -2, '2026-10-05T12:00:00Z')],
      sales: [sale(18)],
    })

    expect(result).toMatchObject({ balance: 30, netSales: 18, negative: false })
  })

  it('does not depend on any closing: asking again gives the same number', () => {
    const input = { supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), movements: [move('opening', 5, '2026-09-30T03:00:00Z')], sales: [sale(2)] }

    expect(balance(input).balance).toBe(3)
    expect(balance(input).balance).toBe(3)
  })

  it('ignores movements before the cutoff (the count already reflects them) and anything after the queried instant', () => {
    const result = balance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-04T00:00:00Z'),
      movements: [move('opening', 10, '2026-09-30T03:00:00Z'), move('receipt', 99, '2026-09-29T12:00:00Z'), move('receipt', 5, '2026-10-03T00:00:00Z'), move('receipt', 50, '2026-10-09T00:00:00Z')],
      sales: [sale(1, '2026-09-29T12:00:00Z'), sale(2, '2026-10-03T12:00:00Z'), sale(40, '2026-10-09T12:00:00Z')],
    })

    expect(result.balance).toBe(13)
  })

  it('counts only OK sales of this store and SKU', () => {
    const result = balance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'),
      movements: [move('opening', 10, '2026-09-30T03:00:00Z')],
      sales: [sale(1), sale(5, '2026-10-04T12:00:00Z', { result: 'CANCELADO' }), sale(7, '2026-10-05T12:00:00Z', { storeId: 2 }), sale(9, '2026-10-06T12:00:00Z', { sku: 'B' })],
    })

    expect(result).toMatchObject({ balance: 9, netSales: 1 })
  })

  it('reports a negative balance instead of clamping it to zero', () => {
    const result = balance({ supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'), movements: [move('opening', 2, '2026-09-30T03:00:00Z')], sales: [sale(5)] })

    expect(result).toMatchObject({ balance: -3, negative: true })
  })

  it('breaks the balance down by kind, and a supplier filter drops other suppliers movements', () => {
    const result = balance({
      supplierId: 7, sku: 'A', location: storeLocation(1), cutoff: CUTOFF, at: at('2026-10-10T00:00:00Z'),
      movements: [move('opening', 4, '2026-09-30T03:00:00Z'), move('transfer_in', 6), move('receipt', 100, '2026-10-02T12:00:00Z', { supplierId: 8 })],
      sales: [],
    })

    expect(result.byKind).toEqual({ opening: 4, transfer_in: 6 })
    expect(result.balance).toBe(10)
  })
})
