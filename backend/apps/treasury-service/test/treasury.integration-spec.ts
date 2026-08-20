import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { TreasuryService } from '../src/modules/treasury/services/treasury.service'

/** Runs against the Postgres from this service's docker-compose. */
describe('treasury integration', () => {
  let app: TestingModule
  let treasury: TreasuryService
  let prisma: PrismaClientService

  let accountId: number
  const period = '2099-01'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    treasury = app.get(TreasuryService)
    prisma = app.get(PrismaClientService)

    const account = await treasury.createAccount({
      name: `Conta teste ${Date.now()}`,
      kind: 'checking',
      institution: 'Banco Teste',
    })
    accountId = account.id
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.bankTransaction.deleteMany({ where: { period } })
      await prisma.settlementReceipt.deleteMany({ where: { period } })
      await prisma.bankAccount.deleteMany({ where: { id: accountId } })
    }
    await app?.close()
  }, 30000)

  const outflow = (amount: number, over: Partial<Parameters<TreasuryService['createTransaction']>[0]> = {}) =>
    treasury.createTransaction({
      account_id: accountId,
      occurred_on: '2099-01-15',
      period,
      direction: 'outflow',
      amount_cents: amount,
      counterparty_raw: 'FORNECEDOR TESTE',
      entry_type: 'estoque',
      category: 'estoque geral',
      nature: 'cogs',
      ...over,
    })

  describe('transaction', () => {
    it('keeps the amount positive and the sign in `direction`', async () => {
      const created = await outflow(150_00)

      expect(created.amount_cents).toBe(150_00)
      expect(created.direction).toBe('outflow')
    })

    it('refuses an installment index without its total', async () => {
      await expect(outflow(100_00, { installment_index: 2 })).rejects.toThrow(/juntos ou nenhum/)
    })

    it('refuses an installment index beyond the total', async () => {
      await expect(outflow(100_00, { installment_index: 5, installment_total: 3 })).rejects.toThrow(/maior que/)
    })
  })

  describe('summary', () => {
    it('separates inflow from outflow rather than netting them into one figure', async () => {
      await outflow(200_00, { nature: 'operating', category: 'gasolina' })
      await outflow(300_00, { direction: 'inflow', nature: 'operating', category: 'gasolina' })

      const summary = await treasury.summary({ period })

      expect(summary.inflow_cents).toBeGreaterThanOrEqual(300_00)
      expect(summary.outflow_cents).toBeGreaterThanOrEqual(200_00)
      expect(summary.net_cents).toBe(summary.inflow_cents - summary.outflow_cents)
    })

    it('counts transactions with no supplier resolved as pending work', async () => {
      await outflow(50_00)

      const summary = await treasury.summary({ period })

      expect(summary.unresolved_count).toBeGreaterThan(0)
    })
  })

  describe('mappings', () => {
    it('classifies only what is still unresolved', async () => {
      const raw = `MERCADO DO TESTE ${Date.now()}`
      const pending = await outflow(75_00, { counterparty_raw: raw, nature: 'operating' })

      const mapping = await treasury.createMapping({
        match_text: raw,
        display_name: 'Mercado do Teste',
        entry_type: 'estoque',
        category: 'congelados',
        nature: 'cogs',
      })

      const result = await treasury.applyMappings(period)
      expect(result.classified).toBeGreaterThan(0)

      const after = await prisma.bankTransaction.findUnique({ where: { id: pending.id } })
      expect(after?.nature).toBe('cogs')
      expect(after?.category).toBe('congelados')

      await treasury.deleteMapping(mapping.id)
    })

    it('refuses a second rule for the same spelling', async () => {
      const raw = `DUPLICADO ${Date.now()}`
      const first = await treasury.createMapping({
        match_text: raw,
        display_name: 'Duplicado',
        entry_type: 'estoque',
        category: 'geral',
        nature: 'cogs',
      })

      await expect(
        treasury.createMapping({
          match_text: raw.toLowerCase(),
          display_name: 'Outro',
          entry_type: 'estoque',
          category: 'geral',
          nature: 'cogs',
        }),
      ).rejects.toThrow(/já é mapeado/)

      await treasury.deleteMapping(first.id)
    })
  })

  describe('settlement', () => {
    it('derives the fee from the rate in force when it is not supplied', async () => {
      const acquirer = `Teste ${Date.now()}`
      await treasury.createFee({
        acquirer,
        payment_method: 'credit',
        rate_bps: 297,
        effective_from: '2099-01-01',
      })

      const receipt = await treasury.upsertSettlement(
        { period, payment_method: 'credit', gross_cents: 10_000, settled_on: '2099-01-20' },
        acquirer,
      )

      expect(receipt.fee_cents).toBe(297)
      expect(receipt.net_cents).toBe(10_000 - 297)

      await prisma.acquirerFee.deleteMany({ where: { acquirer } })
    })

    it('never overrides a fee that was supplied — the acquirer statement wins', async () => {
      const receipt = await treasury.upsertSettlement({
        period,
        payment_method: 'pix',
        gross_cents: 10_000,
        fee_cents: 42,
      })

      expect(receipt.fee_cents).toBe(42)
    })
  })
})
