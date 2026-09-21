import { INGESTION_QUEUES, type SalesRowsJob, type SalesTransactionsJob } from '@app/ingestion-contracts'
import { IngestionService } from './ingestion.service'

interface StagedRowFixture {
  store_id: number
  sku: string
  quantity: number | null
  amount_cents: number | null
}

interface StagedSalesTransactionFixture {
  store_id: number
  occurred_at: Date | null
  sku: string
  quantity: number
  amount_paid_cents: number
  original_amount_cents: number | null
  discount_cents: number | null
  result: string
  method: string | null
  acquirer: string | null
  card_brand: string | null
  card_last_digits: string | null
  internal_code: string | null
  acquirer_code: string | null
  pos_id: string | null
  machine_model: string | null
  buyer_number: string | null
}

describe('IngestionService.finalize — sales', () => {
  const build = (opts: {
    storeId?: number | null
    staged: StagedRowFixture[]
    stagedTransactions?: StagedSalesTransactionFixture[]
    rejectedRows?: number
  }) => {
    const holdIt = jest.fn().mockResolvedValue({ id: 'job-1' })

    const prisma = {
      ingestion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ing-1',
          file_type: 'sales',
          store_id: opts.storeId === undefined ? 55 : opts.storeId,
          period: '2026-08',
          correlation_id: null,
          rejected_rows: opts.rejectedRows ?? 0,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      stagedRow: {
        findMany: jest.fn().mockResolvedValue(opts.staged),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      // Empty by default — these tests exercise the per-SKU aggregate
      // (StagedRow), not add-sales-transaction-detail's separate table.
      stagedSalesTransaction: {
        findMany: jest.fn().mockResolvedValue(opts.stagedTransactions ?? []),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      // The array form of $transaction just needs to await whatever
      // already-created promises it is handed — the individual calls above
      // are what matter to these tests, not the transaction wrapper itself.
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    }

    const broker = { holdIt }

    return {
      service: new IngestionService(prisma as never, broker as never),
      holdIt,
      prismaUpdate: prisma.ingestion.update,
    }
  }

  const salesMessages = (holdIt: jest.Mock): SalesRowsJob[] =>
    holdIt.mock.calls.filter(([call]) => call.queueName === INGESTION_QUEUES.SALES_ROWS).map(([call]) => call.message)

  it('sums quantity and revenue across several staged rows for the same (store, sku) — the network-wide, per-transaction format\'s critical case', async () => {
    // The same store+SKU on 3 transaction rows within one ingestion — exactly
    // what the Aug 2026 network-wide sales export produces (11,080
    // transaction rows collapsing to far fewer distinct store+SKU pairs).
    const { service, holdIt } = build({
      staged: [
        { store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 },
        { store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 },
        { store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 },
      ],
    })

    await service.finalize('ing-1')

    const messages = salesMessages(holdIt)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ storeId: 55, period: '2026-08' })
    // 3, not 1: neither the last row nor the first is allowed to win — every
    // row's quantity and revenue must be counted.
    expect(messages[0].rows).toEqual([{ sku: 'GUA-350', quantitySold: 3, revenueCents: 2370 }])
  })

  it('keeps two different SKUs for the same store as two separate rows, each correctly summed', async () => {
    const { service, holdIt } = build({
      staged: [
        { store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 },
        { store_id: 55, sku: 'GUA-350', quantity: 2, amount_cents: 1580 },
        { store_id: 55, sku: 'COCA-350', quantity: 1, amount_cents: 650 },
      ],
    })

    await service.finalize('ing-1')

    const messages = salesMessages(holdIt)
    expect(messages).toHaveLength(1)
    expect(messages[0].rows).toEqual(
      expect.arrayContaining([
        { sku: 'GUA-350', quantitySold: 3, revenueCents: 2370 },
        { sku: 'COCA-350', quantitySold: 1, revenueCents: 650 },
      ]),
    )
  })

  it('publishes one job per store when staged rows span several stores — the network-wide format covers the whole network in one ingestion', async () => {
    const { service, holdIt } = build({
      storeId: null, // network-wide upload: no single upload-time store
      staged: [
        { store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 },
        { store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 },
        { store_id: 77, sku: 'GUA-350', quantity: 5, amount_cents: 3950 },
      ],
    })

    await service.finalize('ing-1')

    const messages = salesMessages(holdIt)
    expect(messages).toHaveLength(2)

    const byStore = new Map(messages.map(message => [message.storeId, message]))
    expect(byStore.get(55)!.rows).toEqual([{ sku: 'GUA-350', quantitySold: 2, revenueCents: 1580 }])
    expect(byStore.get(77)!.rows).toEqual([{ sku: 'GUA-350', quantitySold: 5, revenueCents: 3950 }])
  })

  it('publishes nothing when there are no staged rows, and still marks the ingestion completed', async () => {
    const { service, holdIt, prismaUpdate } = build({ staged: [] })

    await service.finalize('ing-1')

    expect(salesMessages(holdIt)).toHaveLength(0)
    expect(prismaUpdate).toHaveBeenCalledWith({ where: { id: 'ing-1' }, data: { status: 'completed' } })
  })

  it('the old, pre-aggregated per-SKU format — always exactly one row per (store, sku) already — is a no-op sum, unchanged', async () => {
    const { service, holdIt } = build({
      staged: [
        { store_id: 55, sku: 'GUA-350', quantity: 12, amount_cents: 9480 },
        { store_id: 55, sku: 'COCA-350', quantity: 4, amount_cents: 2600 },
      ],
    })

    await service.finalize('ing-1')

    const messages = salesMessages(holdIt)
    expect(messages).toHaveLength(1)
    expect(messages[0].rows).toEqual(
      expect.arrayContaining([
        { sku: 'GUA-350', quantitySold: 12, revenueCents: 9480 },
        { sku: 'COCA-350', quantitySold: 4, revenueCents: 2600 },
      ]),
    )
  })

  it('reports partially_completed, never completed, when the ingestion had rejections', async () => {
    const { service, prismaUpdate } = build({
      staged: [{ store_id: 55, sku: 'GUA-350', quantity: 1, amount_cents: 790 }],
      rejectedRows: 2,
    })

    await service.finalize('ing-1')

    expect(prismaUpdate).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { status: 'partially_completed' },
    })
  })
})

describe('IngestionService.finalize — sales transaction detail (add-sales-transaction-detail)', () => {
  const transactionFixture = (overrides: Partial<StagedSalesTransactionFixture> = {}): StagedSalesTransactionFixture => ({
    store_id: 55,
    occurred_at: null,
    sku: 'GUA-350',
    quantity: 1,
    amount_paid_cents: 790,
    original_amount_cents: null,
    discount_cents: null,
    result: 'OK',
    method: null,
    acquirer: null,
    card_brand: null,
    card_last_digits: null,
    internal_code: null,
    acquirer_code: null,
    pos_id: null,
    machine_model: null,
    buyer_number: null,
    ...overrides,
  })

  const build = (opts: { staged: StagedSalesTransactionFixture[] }) => {
    const holdIt = jest.fn().mockResolvedValue({ id: 'job-1' })

    const prisma = {
      ingestion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ing-1',
          file_type: 'sales',
          store_id: null,
          period: '2026-08',
          correlation_id: null,
          rejected_rows: 0,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      stagedRow: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue(undefined) },
      stagedSalesTransaction: {
        findMany: jest.fn().mockResolvedValue(opts.staged),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    }

    return { service: new IngestionService(prisma as never, { holdIt } as never), holdIt }
  }

  const transactionMessages = (holdIt: jest.Mock): SalesTransactionsJob[] =>
    holdIt.mock.calls
      .filter(([call]) => call.queueName === INGESTION_QUEUES.SALES_TRANSACTIONS)
      .map(([call]) => call.message)

  it('publishes every staged transaction unsummed — not aggregated by SKU like the per-SKU path', async () => {
    const { service, holdIt } = build({
      staged: [
        transactionFixture({ quantity: 1, amount_paid_cents: 790 }),
        transactionFixture({ quantity: 1, amount_paid_cents: 790 }),
      ],
    })

    await service.finalize('ing-1')

    const messages = transactionMessages(holdIt)
    expect(messages).toHaveLength(1)
    expect(messages[0].rows).toHaveLength(2)
    expect(messages[0].rows).toEqual([
      expect.objectContaining({ sku: 'GUA-350', quantity: 1, amountPaidCents: 790 }),
      expect.objectContaining({ sku: 'GUA-350', quantity: 1, amountPaidCents: 790 }),
    ])
  })

  it('publishes one job per store, same as the aggregate path', async () => {
    const { service, holdIt } = build({
      staged: [transactionFixture({ store_id: 55 }), transactionFixture({ store_id: 77 })],
    })

    await service.finalize('ing-1')

    const messages = transactionMessages(holdIt)
    expect(messages).toHaveLength(2)
    expect(new Set(messages.map(message => message.storeId))).toEqual(new Set([55, 77]))
  })

  it('carries a non-OK result through untouched — this table never filters by result', async () => {
    const { service, holdIt } = build({ staged: [transactionFixture({ result: 'CANCELADO' })] })

    await service.finalize('ing-1')

    expect(transactionMessages(holdIt)[0].rows).toEqual([expect.objectContaining({ result: 'CANCELADO' })])
  })

  it('publishes nothing when there is no transaction detail — the old sales format never stages any', async () => {
    const { service, holdIt } = build({ staged: [] })

    await service.finalize('ing-1')

    expect(transactionMessages(holdIt)).toHaveLength(0)
  })
})
