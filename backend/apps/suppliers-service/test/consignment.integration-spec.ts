import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/**
 * Constraints of the consignment tables, with SYNTHETIC data. Runs ONLY against a throwaway database
 * (CONSIGNMENT_IT_THROWAWAY_DB=true and DATABASE_URL pointing at it): never against the real one.
 */
const throwaway = process.env.CONSIGNMENT_IT_THROWAWAY_DB === 'true'

;(throwaway ? describe : describe.skip)('consignment tables (throwaway database, synthetic data)', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let supplierId: number

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule] }).compile()
    prisma = app.get(PrismaClientService)
    const supplier = await prisma.supplier.create({ data: { name: '[SINTÉTICO] consignado', category: 'frozen' } })
    supplierId = supplier.id
  })

  afterAll(async () => {
    await prisma.consignmentCost.deleteMany({ where: { supplier_id: supplierId } })
    await prisma.consignmentAgreement.deleteMany({ where: { supplier_id: supplierId } })
    await prisma.settlement.deleteMany({ where: { supplier_id: supplierId } })
    await prisma.supplier.delete({ where: { id: supplierId } })
    await app.close()
  })

  const settlement = (over: Record<string, unknown> = {}) => ({
    supplier_id: supplierId, week_start: new Date('2026-09-22T00:00:00Z'), period_start: new Date('2026-09-22T00:00:00Z'), period_end: new Date('2026-09-30T00:00:00Z'),
    kind: 'legacy', state: 'paid', owed_cents: 100, evidence: {}, ...over,
  })

  it('refuses a settlement whose period ends before it starts', async () => {
    await expect(prisma.settlement.create({ data: settlement({ week_start: new Date('2026-08-01T00:00:00Z'), period_start: new Date('2026-08-10T00:00:00Z'), period_end: new Date('2026-08-10T00:00:00Z') }) as never })).rejects.toThrow()
  })

  it('refuses an unknown settlement kind', async () => {
    await expect(prisma.settlement.create({ data: settlement({ week_start: new Date('2026-07-01T00:00:00Z'), period_start: new Date('2026-07-01T00:00:00Z'), period_end: new Date('2026-07-08T00:00:00Z'), kind: 'other' }) as never })).rejects.toThrow()
  })

  it('keeps one agreement per supplier', async () => {
    await prisma.consignmentAgreement.create({ data: { supplier_id: supplierId, period_days: 7 } })
    await expect(prisma.consignmentAgreement.create({ data: { supplier_id: supplierId, period_days: 10 } })).rejects.toThrow()
  })

  it('keeps one cost per supplier, SKU and vigência — a correction is another vigência', async () => {
    await prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-1', valid_from: new Date('2026-09-01T00:00:00Z'), unit_cost_cents: 730 } })
    await expect(prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-1', valid_from: new Date('2026-09-01T00:00:00Z'), unit_cost_cents: 999 } })).rejects.toThrow()
    await expect(prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-1', valid_from: new Date('2026-10-05T00:00:00Z'), unit_cost_cents: 760 } })).resolves.toBeDefined()
  })

  it('refuses a negative cost', async () => {
    await expect(prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-2', valid_from: new Date('2026-09-01T00:00:00Z'), unit_cost_cents: -1 } })).rejects.toThrow()
  })
})
