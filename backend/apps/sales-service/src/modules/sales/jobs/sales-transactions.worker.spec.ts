import { SalesTransactionsWorker } from './sales-transactions.worker'
import { INGESTION_QUEUES } from '@app/ingestion-contracts'

const jobFor = (data: unknown) => ({ id: '1', data, queueName: INGESTION_QUEUES.SALES_TRANSACTIONS }) as never

describe('SalesTransactionsWorker', () => {
  const build = () => {
    const transactions = { ingestPeriodTransactions: jest.fn().mockResolvedValue(undefined) }
    return { worker: new SalesTransactionsWorker(transactions as never), transactions }
  }

  const validJob = {
    schemaVersion: 1,
    ingestionId: 'ing-1',
    storeId: 7,
    period: '2026-08',
    rows: [{ sku: 'A', quantity: 1, amountPaidCents: 500, result: 'OK', method: 'PIX' }],
  }

  it('ingests a well-formed batch', async () => {
    const { worker, transactions } = build()

    await worker.process(jobFor(validJob))

    expect(transactions.ingestPeriodTransactions).toHaveBeenCalledWith({
      storeId: 7,
      period: '2026-08',
      ingestionId: 'ing-1',
      rows: validJob.rows,
    })
  })

  it('stages a non-OK transaction the same as an OK one — the aggregate, not this table, excludes it', async () => {
    const { worker, transactions } = build()
    const declined = { ...validJob, rows: [{ sku: 'A', quantity: 1, amountPaidCents: 500, result: 'Recusada' }] }

    await worker.process(jobFor(declined))

    expect(transactions.ingestPeriodTransactions).toHaveBeenCalledWith(expect.objectContaining({ rows: declined.rows }))
  })

  it('rejects a payload version it does not understand instead of mis-reading it', async () => {
    const { worker, transactions } = build()

    await expect(worker.process(jobFor({ ...validJob, schemaVersion: 2 }))).rejects.toThrow(/schemaVersion/)
    expect(transactions.ingestPeriodTransactions).not.toHaveBeenCalled()
  })

  it('rejects a malformed period rather than writing under it', async () => {
    const { worker, transactions } = build()

    await expect(worker.process(jobFor({ ...validJob, period: '2026-3' }))).rejects.toThrow(/period/)
    expect(transactions.ingestPeriodTransactions).not.toHaveBeenCalled()
  })

  it('accepts an empty batch', async () => {
    const { worker, transactions } = build()

    await worker.process(jobFor({ ...validJob, rows: [] }))

    expect(transactions.ingestPeriodTransactions).toHaveBeenCalledWith(expect.objectContaining({ rows: [] }))
  })
})
