import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { CapexService } from '../src/modules/capex/services/capex.service'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/** Runs against the Postgres from this service's docker-compose. */
describe('capex integration', () => {
  let app: TestingModule
  let capex: CapexService
  let prisma: PrismaClientService

  const stamp = Date.now()
  const storeId = 900_000 + (stamp % 1000)
  let investorId: number

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    capex = app.get(CapexService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      const investment = await prisma.storeInvestment.findUnique({ where: { store_id: storeId } })
      if (investment) await prisma.investmentItem.deleteMany({ where: { store_investment_id: investment.id } })
      await prisma.storeInvestment.deleteMany({ where: { store_id: storeId } })
      if (investorId) await prisma.investor.deleteMany({ where: { id: investorId } })
    }
    await app?.close()
  }, 30000)

  const item = (over: Partial<Parameters<CapexService['createItem']>[0]> = {}) =>
    capex.createItem({
      store_id: storeId,
      category: 'fridge',
      description: 'Refrigerador vertical',
      cash_amount_cents: 259_000,
      purchased_on: '2025-10-04',
      funding_source: 'Josias',
      investment_kind: 'fixed',
      ...over,
    })

  describe('store investment', () => {
    it('sums the items into the store total on every write', async () => {
      await item()
      await item({ category: 'freezer', description: 'Freezer', cash_amount_cents: 179_000 })

      const investment = await capex.findInvestment(storeId)

      expect(investment.total_invested_cents).toBe(259_000 + 179_000)
    })

    it('counts the financed total, not the cash price, when a purchase was financed', async () => {
      await capex.createItem({
        store_id: storeId,
        category: 'furniture',
        description: 'Kit de estantes',
        cash_amount_cents: 53_328,
        financed_amount_cents: 66_664,
        installments: 8,
        purchased_on: '2025-07-09',
        funding_source: 'Bárbara',
        investment_kind: 'initial',
      })

      const investment = await capex.findInvestment(storeId)

      // A diferença entre à vista e parcelado é o custo do crédito; somar o à
      // vista subestimaria o investimento.
      expect(investment.total_invested_cents).toBe(259_000 + 179_000 + 66_664)
    })

    it('multiplies by quantity', async () => {
      const before = await capex.findInvestment(storeId)
      await item({ category: 'baskets', description: 'Cestos', cash_amount_cents: 36_000, quantity: 3 })
      const after = await capex.findInvestment(storeId)

      expect(after.total_invested_cents).toBe(before.total_invested_cents + 36_000 * 3)
    })
  })

  describe('payback', () => {
    it('is undefined while no profit is recorded', async () => {
      const investment = await capex.findInvestment(storeId)

      // Nenhum numero de meses paga uma loja sem lucro — null, nao 0.
      expect(investment.payback_months).toBeNull()
    })

    it('divides the invested total by the monthly profit', async () => {
      const investment = await capex.upsertInvestment({
        store_id: storeId,
        monthly_revenue_cents: 1_500_000,
        monthly_profit_cents: 100_000,
      })

      const expected = Math.round((investment.total_invested_cents / 100_000) * 100) / 100
      expect(Number(investment.payback_months)).toBe(expected)
    })

    it('sorts undefined payback last, not first', async () => {
      const rows = await capex.payback()
      const nulls = rows.filter(r => r.payback_months === null)

      if (nulls.length > 0 && rows.length > nulls.length) {
        // Ordenar null como zero colocaria a loja que nao se paga em primeiro,
        // no lugar da que se paga mais rapido.
        expect(rows[rows.length - 1].payback_months).toBeNull()
      }
    })

    it('recomputes the total when an item is removed', async () => {
      const extra = await item({ category: 'camera', description: 'Câmera', cash_amount_cents: 50_000 })
      const withExtra = await capex.findInvestment(storeId)

      await capex.deleteItem(extra.id)
      const without = await capex.findInvestment(storeId)

      expect(without.total_invested_cents).toBe(withExtra.total_invested_cents - 50_000)
    })
  })

  describe('investors', () => {
    it('reports committed minus contributed', async () => {
      const investor = await capex.createInvestor({
        name: `Investidor ${stamp}`,
        committed_amount_cents: 4_500_000,
      })
      investorId = investor.id

      await capex.addContribution(investor.id, {
        contributed_on: '2025-10-01',
        amount_cents: 400_000,
        kind: 'equipment',
      })
      await capex.addContribution(investor.id, {
        contributed_on: '2025-07-28',
        amount_cents: 500_000,
        kind: 'stock',
      })

      const summary = await capex.investorSummary()
      const row = summary.find(r => r.investor_id === investor.id)!

      expect(row.contributed_amount_cents).toBe(900_000)
      expect(row.difference_cents).toBe(4_500_000 - 900_000)
    })
  })
})
