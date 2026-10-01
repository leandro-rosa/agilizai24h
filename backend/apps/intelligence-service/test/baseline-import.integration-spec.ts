import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { BaselineImportService } from '../src/modules/baseline/baseline-import.service'
import { BaselineRepository } from '../src/modules/baseline/baseline.repository'
import { ProductPackagingWriter } from '../src/modules/baseline/product-packaging.writer'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { ProductsClient } from '../src/modules/sources/products.client'
import { PRICING_SHEET_ROWS } from './fixtures/pricing-sheet.fixture'
import { resetDisposableDb } from './support/reset-db'

/** The import against a disposable Postgres, with the product catalogue and the packaging write stubbed. */
describe('baseline import', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let importer: BaselineImportService
  let baselines: BaselineRepository

  const catalogue = [
    { id: 1, sku: '5050', name: 'x', package_type: null },
    { id: 2, sku: '1070', name: 'x', package_type: 'fardo' }, // already right
    { id: 3, sku: '1071', name: 'x', package_type: null },
    { id: 4, sku: '5012', name: 'x', package_type: null },
    { id: 5, sku: '5003', name: 'x', package_type: null },
    { id: 6, sku: '1014', name: 'x', package_type: null },
    { id: 7, sku: '6098', name: 'x', package_type: null },
    { id: 8, sku: '1072', name: 'x', package_type: null },
    { id: 9, sku: '6030', name: 'x', package_type: null },
    { id: 10, sku: '100018', name: 'x', package_type: null },
    { id: 11, sku: '6024', name: 'x', package_type: null },
    { id: 12, sku: '9987', name: 'x', package_type: null },
  ]
  const patched: { id: number; packageType: string }[] = []
  let failFor: number | null = null

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [
        BaselineRepository,
        BaselineImportService,
        { provide: ProductsClient, useValue: { products: async () => catalogue } },
        {
          provide: ProductPackagingWriter,
          useValue: {
            setPackageType: async (id: number, packageType: string) => {
              if (id === failFor) throw new Error('products-service unavailable')
              patched.push({ id, packageType })
            },
          },
        },
      ],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    await resetDisposableDb(prisma)
    importer = app.get(BaselineImportService)
    baselines = app.get(BaselineRepository)
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  beforeEach(() => {
    patched.length = 0
    failFor = null
  })

  it('a dry run (the default) reports everything and writes nothing', async () => {
    const report = await importer.run({ source: 'sheet.xlsx', rows: PRICING_SHEET_ROWS })

    expect(report.apply).toBe(false)
    expect(await prisma.baselineQuantity.count()).toBe(0)
    expect(patched).toEqual([])
    expect(report.totals.baselinesToAdd).toBeGreaterThan(0)
  })

  it('reports the real conflict, the identical duplicate and the filler apart', async () => {
    const report = await importer.run({ source: 'sheet.xlsx', rows: PRICING_SHEET_ROWS })

    expect(report.conflicts.map(c => c.sku)).toEqual(['6024'])
    expect(report.totals.collapsedDuplicates).toBe(1)
    expect(report.totals.ignoredBlank).toBe(2)
    expect(report.totals.rejected).toBe(0)
    // the conflicting SKU is not imported
    expect(report.totals.accepted).toBe(12)
  })

  it('applies with the owner resolution for 6024 (unidade): baselines recorded, packaging written only where it differs', async () => {
    const report = await importer.run({
      source: 'precificacao(1).xlsx',
      rows: PRICING_SHEET_ROWS,
      resolutions: { '6024': { measure: 'unidade' } },
      apply: true,
      effectiveFrom: '2026-09-30T00:00:00Z',
    })

    expect(report.apply).toBe(true)
    expect(report.conflicts).toEqual([])
    expect(report.resolved).toEqual([{ sku: '6024', chosen: { quantity: 10, measure: 'unidade' } }])
    expect(report.totals.accepted).toBe(13)

    expect((await baselines.current('5012', new Date('2026-10-01T00:00:00Z')))?.quantity).toBe(21)
    expect((await baselines.current('6024', new Date('2026-10-01T00:00:00Z')))?.quantity).toBe(10)
    // packaging written for everything but the product that already had it right and the one the catalogue lacks
    expect(patched.find(p => p.id === 11)).toEqual({ id: 11, packageType: 'unidade' })
    expect(patched.find(p => p.id === 2)).toBeUndefined()
    expect(report.notInCatalogue).toEqual(['100125'])
    expect(report.totals.packagingUnchanged).toBe(1)
  })

  it('the SKU absent from the catalogue still gets its baseline — only its packaging is skipped', async () => {
    expect((await baselines.current('100125', new Date('2026-10-01T00:00:00Z')))?.quantity).toBe(6)
  })

  it('an identical re-import adds nothing to the history', async () => {
    const before = await prisma.baselineQuantity.count()

    const report = await importer.run({ source: 'again.xlsx', rows: PRICING_SHEET_ROWS, resolutions: { '6024': { measure: 'unidade' } }, apply: true })

    expect(report.totals.baselinesToAdd).toBe(0)
    expect(report.totals.baselinesUnchanged).toBe(13)
    expect(await prisma.baselineQuantity.count()).toBe(before)
  })

  it('a re-import with a changed value keeps both values in the history', async () => {
    const rows = PRICING_SHEET_ROWS.map(row => (String(row.SKU) === '5012' ? { ...row, 'qtd itens por loja': 12 } : row))

    await importer.run({ source: 'v2.xlsx', rows, resolutions: { '6024': { measure: 'unidade' } }, apply: true, effectiveFrom: '2026-10-05T00:00:00Z' })

    const history = await baselines.history('5012')
    expect(history.map(h => h.quantity)).toEqual([21, 12])
    expect(history.map(h => h.source)).toEqual(['precificacao(1).xlsx', 'v2.xlsx'])
    expect((await baselines.current('5012', new Date('2026-10-10T00:00:00Z')))?.quantity).toBe(12)
  })

  it('one product failing its packaging write is reported and does not stop the others', async () => {
    const rows = PRICING_SHEET_ROWS.map(row => (String(row.SKU) === '5003' ? { ...row, Medida: 'unidade' } : row))
    failFor = 5

    const report = await importer.run({ source: 'v3.xlsx', rows, resolutions: { '6024': { measure: 'unidade' } }, apply: true })

    expect(report.packagingFailed).toEqual([{ sku: '5003', detail: 'products-service unavailable' }])
    expect(report.totals.packagingFailed).toBe(1)
  })
})
