import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service'

/**
 * The subtlest failure in the whole ingestion design, asserted directly.
 *
 * sheeter splits a file into N queue jobs, and the sinks replace a period
 * wholesale. If each chunk handed its rows straight to a sink, every batch
 * would wipe the one before it and only the final chunk's rows would survive —
 * a period silently missing most of its data, with a "completed" status.
 *
 * Staging exists to prevent exactly that, so these tests drive the accumulation
 * directly rather than through Redis: what matters is that N chunks produce ONE
 * handover carrying ALL the rows.
 */
describe('chunk accumulation', () => {
  let app: TestingModule
  let ingestions: IngestionService
  let prisma: PrismaClientService

  const published: { queueName: string; message: unknown }[] = []
  const ingestionIds: string[] = []

  const newIngestion = async (fileType: 'sales' | 'supply' | 'cost', expectedChunks: number) => {
    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ingestionIds.push(id)

    await prisma.ingestion.create({
      data: {
        id,
        file_type: fileType,
        object_key: 'k',
        original_name: 'f.xlsx',
        store_id: 12345,
        period: '2026-03',
        status: 'processing',
        expected_chunks: expectedChunks,
      },
    })

    return id
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [
        IngestionService,
        {
          // The broker is stubbed so the handover can be inspected precisely;
          // the real queue path is covered by sales and supply's own suites.
          provide: (await import('@app/hold-it')).HoldItBullMQBroker,
          useValue: {
            holdIt: async (call: { queueName: string; message: unknown }) => {
              published.push(call)
              return { id: '1' }
            },
          },
        },
      ],
    }).compile()

    app = await moduleRef.init()
    ingestions = app.get(IngestionService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.ingestion.deleteMany({ where: { id: { in: ingestionIds } } })
    await app?.close()
  }, 30000)

  beforeEach(() => {
    published.length = 0
  })

  it('hands over once, with every chunk rows, rather than once per chunk', async () => {
    const id = await newIngestion('sales', 3)

    // Three chunks, as sheeter would produce for a file above its batch size.
    await ingestions.stageRows(id, [{ sku: 'A', quantity: 1, amountCents: 100 }])
    expect(await ingestions.completeChunk(id, 1, 0)).toBe(false)

    await ingestions.stageRows(id, [{ sku: 'B', quantity: 2, amountCents: 200 }])
    expect(await ingestions.completeChunk(id, 1, 0)).toBe(false)

    await ingestions.stageRows(id, [{ sku: 'C', quantity: 3, amountCents: 300 }])
    const isLast = await ingestions.completeChunk(id, 1, 0)
    expect(isLast).toBe(true)

    await ingestions.finalize(id)

    // Exactly one handover...
    expect(published).toHaveLength(1)
    // ...carrying all three chunks' rows, not just the last one's.
    const message = published[0].message as { rows: { sku: string }[] }
    expect(message.rows.map(row => row.sku).sort()).toEqual(['A', 'B', 'C'])
  }, 30000)

  it('reports the last chunk only once, even when chunks finish together', async () => {
    const id = await newIngestion('sales', 4)

    const results = await Promise.all([
      ingestions.completeChunk(id, 1, 0),
      ingestions.completeChunk(id, 1, 0),
      ingestions.completeChunk(id, 1, 0),
      ingestions.completeChunk(id, 1, 0),
    ])

    // Exactly one chunk may see itself as last: two would hand the sink the
    // batch twice, none would leave the file permanently unfinished.
    expect(results.filter(Boolean)).toHaveLength(1)
  }, 30000)

  it('clears the staging area once the rows are handed over', async () => {
    const id = await newIngestion('sales', 1)
    await ingestions.stageRows(id, [{ sku: 'A', quantity: 1, amountCents: 100 }])
    await ingestions.completeChunk(id, 1, 0)

    await ingestions.finalize(id)

    expect(await prisma.stagedRow.count({ where: { ingestion_id: id } })).toBe(0)
  }, 30000)

  it('splits supply rows into restocks and per-reason removals on handover', async () => {
    const id = await newIngestion('supply', 1)

    await ingestions.stageRows(id, [
      { sku: 'A', quantity: 100 },
      { sku: 'A', reasonKey: 'return', quantity: 6, sourceText: '-6 Devolução, -3 Outro motivo' },
      { sku: 'A', reasonKey: 'other_reason', quantity: 3, sourceText: '-6 Devolução, -3 Outro motivo' },
    ])
    await ingestions.completeChunk(id, 3, 0)

    await ingestions.finalize(id)

    const message = published[0].message as {
      restocks: { sku: string; quantityRestocked: number }[]
      removals: { reason: string; quantityRemoved: number }[]
    }

    expect(message.restocks).toEqual([{ sku: 'A', quantityRestocked: 100 }])
    expect(message.removals).toEqual([
      { sku: 'A', reason: 'return', quantityRemoved: 6, sourceText: '-6 Devolução, -3 Outro motivo' },
      { sku: 'A', reason: 'other_reason', quantityRemoved: 3, sourceText: '-6 Devolução, -3 Outro motivo' },
    ])
    // The combined 9 is never produced.
    expect(message.removals.some(removal => removal.quantityRemoved === 9)).toBe(false)
  }, 30000)

  it('marks an import with rejections as partially completed, never completed', async () => {
    const id = await newIngestion('sales', 1)
    await ingestions.stageRows(id, [{ sku: 'A', quantity: 1, amountCents: 100 }])
    await ingestions.recordRejections(id, [
      { rowReference: 'sheet1!row 5', reason: 'unknown_name', detail: 'Could not resolve product "X"' },
    ])
    await ingestions.completeChunk(id, 1, 1)

    await ingestions.finalize(id)

    const ingestion = await ingestions.findById(id)
    expect(ingestion.status).toBe('partially_completed')
    expect(ingestion.rejected_rows).toBe(1)
    expect(ingestion.rejections[0].detail).toMatch(/Could not resolve product/)
  }, 30000)

  it('marks a clean import as completed', async () => {
    const id = await newIngestion('sales', 1)
    await ingestions.stageRows(id, [{ sku: 'A', quantity: 1, amountCents: 100 }])
    await ingestions.completeChunk(id, 1, 0)

    await ingestions.finalize(id)

    expect((await ingestions.findById(id)).status).toBe('completed')
  }, 30000)

  it('gives cost rows the uploaded period as their effective date', async () => {
    const id = await newIngestion('cost', 1)
    await ingestions.stageRows(id, [{ sku: 'A', amountCents: 250 }])
    await ingestions.completeChunk(id, 1, 0)

    await ingestions.finalize(id)

    const message = published[0].message as { rows: { effectiveFrom: string }[] }
    // Without this a price sheet would either overwrite history or need a guess.
    expect(message.rows[0].effectiveFrom).toBe('2026-03-01')
  }, 30000)
})
