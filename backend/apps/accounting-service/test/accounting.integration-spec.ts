import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AccountingService } from '../src/modules/accounting/services/accounting.service'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/** Runs against the Postgres from this service's docker-compose. */
describe('accounting integration', () => {
  let app: TestingModule
  let accounting: AccountingService
  let prisma: PrismaClientService

  const period = '2099-03'
  const codes: string[] = []
  const stamp = Date.now()

  const account = async (label: string, section: string, sign: number, order: number) => {
    const code = `T${stamp}.${order}`
    codes.push(code)
    return accounting.createAccount({
      code,
      label,
      statement: 'pnl',
      section: section as 'gross_revenue',
      sign,
      sort_order: order,
    })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    accounting = app.get(AccountingService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.pnlSnapshot.deleteMany({ where: { period } })
      await prisma.account.deleteMany({ where: { code: { in: codes } } })
    }
    await app?.close()
  }, 30000)

  describe('ledger entry', () => {
    it('is idempotent by account, period and store', async () => {
      const revenue = await account('Vendas lojas', 'gross_revenue', 1, 1)

      await accounting.putEntry({ account_id: revenue.id, period, amount_cents: 100_00 })
      await accounting.putEntry({ account_id: revenue.id, period, amount_cents: 250_00 })

      const entries = await prisma.ledgerEntry.findMany({ where: { account_id: revenue.id, period } })

      // Relançar substitui, não duplica — é o que permite reprocessar um mês
      // sem limpar antes, o caminho pelo qual a planilha acumula linha repetida.
      expect(entries).toHaveLength(1)
      expect(entries[0].amount_cents).toBe(250_00)
    })

    it('keeps the network line separate from a store line', async () => {
      const fixed = await account('Contador', 'fixed_expenses', -1, 2)

      await accounting.putEntry({ account_id: fixed.id, period, amount_cents: 500_00 })
      await accounting.putEntry({ account_id: fixed.id, period, store_id: 1, amount_cents: 90_00 })

      const entries = await prisma.ledgerEntry.findMany({ where: { account_id: fixed.id, period } })

      expect(entries).toHaveLength(2)
      expect(entries.filter(e => e.store_id === null)).toHaveLength(1)
    })

    it('records where the number came from', async () => {
      const cogs = await account('CMV', 'cogs', -1, 3)

      const entry = await accounting.putEntry({
        account_id: cogs.id,
        period,
        amount_cents: 40_00,
        origin: 'finance',
        source_ref: 'reconciliation/1',
      })

      // Rotular a origem é o que permite dizer se a linha é FATO (veio de um
      // serviço) ou PREMISSA (alguém digitou) — regra da raiz do repo.
      expect(entry.origin).toBe('finance')
    })
  })

  describe('P&L', () => {
    it('cascades the sections into the totals', async () => {
      const view = await accounting.pnl(period)

      expect(view.totals.net_revenue_cents).toBe(
        view.totals.gross_revenue_cents - (view.sections.find(s => s.section === 'deductions')?.amount_cents ?? 0),
      )
      expect(view.status).toBe('open')
    })

    it('freezes the period when closed', async () => {
      const snapshot = await accounting.computeSnapshot(period, undefined, 24, true)

      expect(snapshot.status).toBe('closed')
      expect(snapshot.store_count).toBe(24)
    })

    it('re-computing the same period replaces the snapshot instead of adding one', async () => {
      await accounting.computeSnapshot(period, undefined, 24, true)
      await accounting.computeSnapshot(period, undefined, 25, true)

      const rows = await prisma.pnlSnapshot.findMany({ where: { period, store_id: null } })

      // O índice único parcial da migration é o que garante isto para a linha
      // da rede — o @@unique do Prisma não cobre coluna nula em Postgres.
      expect(rows).toHaveLength(1)
      expect(rows[0].store_count).toBe(25)
    })
  })

  describe('cash flow', () => {
    it('always derives the closing balance', async () => {
      const flow = await accounting.upsertCashFlow({
        period,
        opening_balance_cents: 10_000_00,
        receipts_cents: 5_000_00,
        opex_cents: 2_000_00,
        loan_payments_cents: 500_00,
        capex_cents: 1_000_00,
      })

      expect(flow.closing_balance_cents).toBe(10_000_00 + 5_000_00 - 2_000_00 - 500_00 - 1_000_00)

      await prisma.cashFlowSnapshot.deleteMany({ where: { period } })
    })
  })
})
