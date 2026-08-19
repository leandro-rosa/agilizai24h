import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import 'reflect-metadata'
import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { SheeterModule } from '@app/sheeter'
import { HoldItBullMQBroker } from '@app/hold-it'
import { S3Service } from '@app/aws'
import type { Job } from 'bullmq'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { ParseFileWorker } from '../src/modules/ingestion/jobs/parse-file.worker'
import { StagedRowsWorker } from '../src/modules/ingestion/jobs/staged-rows.worker'
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service'
import { UpstreamClient } from '../src/modules/ingestion/services/upstream.client'

/**
 * Drives the real parser against the real operators' exports (see
 * test/fixtures/README.md), against a real Postgres. S3 and the queue broker
 * are stubbed — driven directly, the same pattern
 * chunk-accumulation.integration-spec.ts already uses — since what is under
 * test is the parsing and staging, not transport. stores-service and
 * products-service are stubbed too: every store name and product code in the
 * fixtures resolves, so what is exercised is ingestion's own logic, not
 * whether those services happen to have matching records today.
 */
describe('real exports', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let ingestions: IngestionService
  let parseFileWorker: ParseFileWorker
  let stagedRowsWorker: StagedRowsWorker

  const FIXTURES = join(__dirname, 'fixtures')
  // Each ROW becomes its own BullMQ job — @app/hold-it's real holdItALot
  // calls queue.addBulk with one job per message, never one job per batch.
  const publishedStagedRows: unknown[] = []
  const publishedFinal: { queueName: string; message: unknown }[] = []
  const ingestionIds: string[] = []

  const KNOWN_STORES: Record<string, number> = {
    'ascenty - jdi01': 101,
    'ascenty - sp03 copa': 102,
    'rolls-royce': 103,
  }

  beforeAll(async () => {
    const brokerStub = {
      holdIt: async (call: { queueName: string; message: unknown }) => {
        publishedFinal.push(call)
        return { id: randomUUID() }
      },
      holdItALot: async (call: { queueName: string; messages: unknown[] }) => {
        publishedStagedRows.push(...call.messages)
        return call.messages.map(() => ({ id: randomUUID() }))
      },
    }

    const s3Stub = {
      getFile: async (key: string) => ({
        body: readFileSync(join(FIXTURES, key)),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    }

    const upstreamStub = {
      resolveStoreByExternalCode: async (code: string) => {
        const id = KNOWN_STORES[code.trim().toLowerCase()]
        return id ? { id, name: code, external_code: code } : null
      },
      // Every code in the fixtures resolves to itself as sku — what is under
      // test is ingestion's own logic, not products-service's matching rules.
      resolveSkus: async (skus: string[]) => ({
        matched: skus.map(sku => ({ id: Number(sku.replace(/\D/g, '')) || 1, sku, name: sku })),
        unmatched: [],
      }),
      resolveProductNames: async (names: string[]) => ({
        matched: names.map(name => ({ source_name: name, product: { id: 1, sku: name, name } })),
        unmatched: [],
      }),
    }

    // A tiny @Global() module, so both stubs are visible inside
    // `SheeterModule`'s own encapsulated scope too — `SheeterProcessorService`
    // and `XlsWriterService` ask for `HoldItBullMQBroker`/`S3Service`, and in
    // production those bindings come from `@app/hold-it` and `@app/aws`'s own
    // @Global() modules. A plain root-level `providers` entry would not cross
    // that boundary.
    @Global()
    @Module({
      providers: [
        { provide: HoldItBullMQBroker, useValue: brokerStub },
        { provide: S3Service, useValue: s3Stub },
      ],
      exports: [HoldItBullMQBroker, S3Service],
    })
    class StubModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StubModule, DbClientModule, SheeterModule],
      providers: [
        IngestionService,
        ParseFileWorker,
        StagedRowsWorker,
        { provide: UpstreamClient, useValue: upstreamStub },
      ],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    ingestions = app.get(IngestionService)
    parseFileWorker = app.get(ParseFileWorker)
    stagedRowsWorker = app.get(StagedRowsWorker)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.stagedRow.deleteMany({ where: { ingestion_id: { in: ingestionIds } } })
      await prisma.ingestionOperation.deleteMany({ where: { ingestion_id: { in: ingestionIds } } })
      await prisma.ingestionRejection.deleteMany({ where: { ingestion_id: { in: ingestionIds } } })
      await prisma.ingestion.deleteMany({ where: { id: { in: ingestionIds } } })
    }
    await app?.close()
  }, 30000)

  beforeEach(() => {
    publishedStagedRows.length = 0
    publishedFinal.length = 0
  })

  /** Runs a fixture end-to-end: parse → chunk → stage → finalize. */
  async function ingest(
    fileType: 'sales' | 'supply',
    fixtureName: string,
    extra: { storeId?: number; period?: string } = {},
  ) {
    const id = randomUUID()
    ingestionIds.push(id)

    await prisma.ingestion.create({
      data: {
        id,
        file_type: fileType,
        object_key: fixtureName,
        original_name: fixtureName,
        store_id: extra.storeId ?? null,
        period: extra.period ?? '2026-04',
      },
    })

    await parseFileWorker.process({ data: { ingestionId: id } } as Job<{ ingestionId: string }>)

    // Simulate the real STAGED_ROWS queue: one job per row, in order — same
    // as BullMQ would deliver them.
    for (const row of publishedStagedRows) {
      await stagedRowsWorker.process({ data: row } as unknown as Job<Parameters<typeof stagedRowsWorker.process>[0]['data']>)
    }

    return id
  }

  describe('sales', () => {
    it('accepts every real row — today, all five would be rejected', async () => {
      const id = await ingest('sales', 'real-sales.xlsx', { storeId: 1, period: '2026-02' })

      const ingestion = await ingestions.findById(id)

      expect(ingestion.rejected_rows).toBe(0)
      expect(ingestion.accepted_rows).toBe(5)
      expect(ingestion.status).toBe('completed')
    }, 30000)
  })

  describe('restocking', () => {
    it('attributes every operation to its own store, from Cliente, not the uploader', async () => {
      const id = await ingest('supply', 'real-restocking.xlsx')

      const operations = await ingestions.operationsFor(id)
      const bySheet = new Map(operations.map(o => [o.sheet_name, o]))

      expect(bySheet.get('Operação 1')).toMatchObject({ store_id: 101, operation_kind: 'restocking' })
      expect(bySheet.get('Operação 2')).toMatchObject({ store_id: 102, operation_kind: 'inventory' })
      expect(bySheet.get('Operação 3')).toMatchObject({ store_id: 103, operation_kind: 'combined' })

      // One SupplyRowsJob per store — never one for the whole file.
      const supplyMessages = publishedFinal.filter(call => call.queueName === 'ingestion.supply-rows')
      expect(supplyMessages).toHaveLength(3)
      expect(new Set(supplyMessages.map(call => (call.message as { storeId: number }).storeId))).toEqual(
        new Set([101, 102, 103]),
      )
    }, 30000)

    it('splits the real mixed-reason removal correctly, never producing the combined total', async () => {
      const id = await ingest('supply', 'real-restocking.xlsx')

      const jdi01 = publishedFinal.find(
        call => call.queueName === 'ingestion.supply-rows' && (call.message as { storeId: number }).storeId === 101,
      )!.message as { removals: { sku: string; reason: string; quantityRemoved: number }[] }

      // "-1 Outro motivo, -1 Validade vencida" on the real row for sku 1008.
      const forSku = jdi01.removals.filter(r => r.sku === '1008')
      expect(forSku).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sku: '1008', reason: 'other_reason', quantityRemoved: 1 }),
          expect.objectContaining({ sku: '1008', reason: 'expired', quantityRemoved: 1 }),
        ]),
      )
      expect(forSku.some(r => r.quantityRemoved === 2)).toBe(false)

      expect((await ingestions.findById(id)).rejected_rows).toBe(0)
    }, 30000)

    it('reports the adjustment separately, never as a restock or a removal', async () => {
      const id = await ingest('supply', 'real-restocking.xlsx')

      const sp03Copa = publishedFinal.find(
        call => call.queueName === 'ingestion.supply-rows' && (call.message as { storeId: number }).storeId === 102,
      )!.message as {
        restocks: { sku: string }[]
        removals: unknown[]
        adjustments: { sku: string; quantity: number }[]
      }

      // Operação 2 (Inventário) carries real Diferença values on 4 of its 5 rows.
      expect(sp03Copa.adjustments.length).toBeGreaterThan(0)
      expect(sp03Copa.removals).toEqual([])

      expect((await ingestions.findById(id)).rejected_rows).toBe(0)
    }, 30000)

    it('lets a combined operation contribute to both restocked value and the adjustment figure', async () => {
      const id = await ingest('supply', 'real-restocking.xlsx')

      const rollsRoyce = publishedFinal.find(
        call => call.queueName === 'ingestion.supply-rows' && (call.message as { storeId: number }).storeId === 103,
      )!.message as { restocks: { sku: string; quantityRestocked: number }[] }

      // Operação 3 (Combinado) has a real Qtd. abastecida on every row.
      expect(rollsRoyce.restocks.length).toBe(6)
      expect(rollsRoyce.restocks.every(row => row.quantityRestocked > 0)).toBe(true)

      expect((await ingestions.findById(id)).rejected_rows).toBe(0)
    }, 30000)

    it('carries the recorded closing balance through for the cross-check', async () => {
      const id = await ingest('supply', 'real-restocking.xlsx')

      const jdi01 = publishedFinal.find(
        call => call.queueName === 'ingestion.supply-rows' && (call.message as { storeId: number }).storeId === 101,
      )!.message as { recordedClosingBalances: { sku: string; quantity: number }[] }

      expect(jdi01.recordedClosingBalances.length).toBeGreaterThan(0)

      expect((await ingestions.findById(id)).rejected_rows).toBe(0)
    }, 30000)
  })

  describe('failure paths', () => {
    it('fails the whole file when a required column is missing, naming it', async () => {
      const id = randomUUID()
      ingestionIds.push(id)

      await prisma.ingestion.create({
        data: {
          id,
          file_type: 'supply',
          object_key: 'missing-column.xlsx',
          original_name: 'missing-column.xlsx',
          store_id: null,
          period: '2026-04',
        },
      })

      await expect(
        parseFileWorker.process({ data: { ingestionId: id } } as Job<{ ingestionId: string }>),
      ).rejects.toThrow()

      const ingestion = await ingestions.findById(id)
      expect(ingestion.status).toBe('failed')
    }, 30000)

    it('reports a row whose recorded balance does not satisfy the identity, rather than absorbing it', async () => {
      const id = await ingest('supply', 'broken-balance.xlsx')

      const ingestion = await ingestions.findById(id)

      expect(ingestion.rejected_rows).toBe(1)
      expect(ingestion.rejections[0]).toMatchObject({ reason: 'balance_mismatch' })
    }, 30000)

    it('rejects a non-zero adjustment on a restocking-kind operation, rather than accumulating it silently', async () => {
      // Never observed in the real export — 0 of 89,252 rows — but the design
      // treats a restocking operation carrying Diferença as a shape it does
      // not recognise, same fail-loud philosophy as everything else here.
      const id = await ingest('supply', 'unexpected-adjustment.xlsx')

      const ingestion = await ingestions.findById(id)

      expect(ingestion.rejected_rows).toBe(1)
      expect(ingestion.rejections[0]).toMatchObject({ reason: 'unexpected_adjustment' })

      const supplyMessages = publishedFinal.filter(call => call.queueName === 'ingestion.supply-rows')
      expect(supplyMessages).toHaveLength(0)
    }, 30000)
  })

  describe('accumulation and resolution edge cases', () => {
    it('sums a store restocked across several operations, rather than the last one winning', async () => {
      const id = await ingest('supply', 'multi-operation-same-store.xlsx')

      const message = publishedFinal.find(call => call.queueName === 'ingestion.supply-rows')!.message as {
        restocks: { sku: string; quantityRestocked: number }[]
      }

      // Operação 1 restocks 6, Operação 2 restocks 4 more — same store, same
      // SKU. 10, not 4: neither operation is allowed to overwrite the other.
      expect(message.restocks).toEqual([{ sku: '6098', quantityRestocked: 10 }])
      expect((await ingestions.findById(id)).rejected_rows).toBe(0)
    }, 30000)

    it('fails only the operation whose store cannot be resolved, ingesting its siblings', async () => {
      const id = await ingest('supply', 'unresolved-store.xlsx')

      const ingestion = await ingestions.findById(id)

      // The resolvable operation (Ascenty - JDI01) still reaches supply-service.
      const supplyMessages = publishedFinal.filter(call => call.queueName === 'ingestion.supply-rows')
      expect(supplyMessages).toHaveLength(1)
      expect((supplyMessages[0].message as { storeId: number }).storeId).toBe(101)

      // The unresolvable one (Loja Fantasma Que Nao Existe) is reported, once,
      // naming the sheet — not per row.
      expect(ingestion.rejections).toContainEqual(
        expect.objectContaining({ reason: 'unresolved_store', row_reference: 'Operação 2' }),
      )
    }, 30000)
  })
})
