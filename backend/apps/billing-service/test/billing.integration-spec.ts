import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { BillingService } from '../src/modules/billing/services/billing.service'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/** Runs against the Postgres from this service's docker-compose. */
describe('billing integration', () => {
  let app: TestingModule
  let billing: BillingService
  let prisma: PrismaClientService

  const stamp = Date.now()
  let clientId: number
  let contractId: number
  const invoiceNumbers: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    billing = app.get(BillingService)
    prisma = app.get(PrismaClientService)

    const client = await billing.createClient({
      name: `Cliente ${stamp}`,
      legal_name: `Cliente ${stamp} S.A.`,
      tax_id: `13.743.550/${String(stamp).slice(-4)}-42`,
      segment: 'company',
    })
    clientId = client.id

    const contract = await billing.createContract({
      client_id: clientId,
      reference: `Contrato ${stamp}`,
      kind: 'partnership',
      monthly_fee_cents: 70_000,
      revenue_share_bps: 500,
      payment_term_days: 30,
      starts_on: '2026-01-01',
      store_ids: [1, 2],
    })
    contractId = contract.id
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.invoice.deleteMany({ where: { number: { in: invoiceNumbers } } })
      await prisma.revenueShare.deleteMany({ where: { contract_id: contractId } })
      await prisma.contractStore.deleteMany({ where: { contract_id: contractId } })
      await prisma.contract.deleteMany({ where: { id: contractId } })
      await prisma.clientSite.deleteMany({ where: { client_id: clientId } })
      await prisma.client.deleteMany({ where: { id: clientId } })
    }
    await app?.close()
  }, 30000)

  const issue = async (over: Partial<Parameters<BillingService['createInvoice']>[0]> = {}) => {
    const number = over.number ?? `NF${stamp}${invoiceNumbers.length}`
    invoiceNumbers.push(number)
    return billing.createInvoice({
      client_id: clientId,
      contract_id: contractId,
      number,
      kind: 'monthly_fee',
      period: '2026-01',
      amount_cents: 70_000,
      issued_on: '2026-01-14',
      ...over,
    })
  }

  describe('contract', () => {
    it('covers more than one store', async () => {
      const contract = await billing.findContract(contractId)

      // O aditivo "Plena Saúde - Itaqua e Mogi" cobre duas lojas — a
      // cardinalidade é real, não hipotética.
      expect(contract.stores).toHaveLength(2)
    })

    it('replaces the whole coverage rather than adding to it', async () => {
      await billing.updateContract(contractId, { store_ids: [3] })
      const after = await billing.findContract(contractId)

      expect(after.stores.map(s => s.store_id)).toEqual([3])

      await billing.updateContract(contractId, { store_ids: [1, 2] })
    })
  })

  describe('invoice', () => {
    it('derives the due date from the issue date and term', async () => {
      const invoice = await issue()

      // Emitida 14/01 com 30 dias: vence 13/02 — como na planilha.
      expect(invoice.due_on.toISOString().slice(0, 10)).toBe('2026-02-13')
    })

    it('falls back to the contract term when none is given', async () => {
      const invoice = await issue()

      expect(invoice.payment_term_days).toBe(30)
    })

    it('recomputes the due date when the issue date changes', async () => {
      const invoice = await issue()
      const moved = await billing.updateInvoice(invoice.id, { issued_on: '2026-02-01' })

      // due_on é derivado; deixá-lo defasado quebraria o aging em silêncio.
      expect(moved.due_on.toISOString().slice(0, 10)).toBe('2026-03-03')
    })

    it('refuses a duplicate invoice number', async () => {
      const invoice = await issue()

      await expect(issue({ number: invoice.number })).rejects.toThrow(/já existe/)
    })
  })

  describe('aging', () => {
    it('derives overdue from the due date rather than a stored status', async () => {
      await issue({ issued_on: '2026-01-14' })

      // Referência bem depois do vencimento: a nota tem de aparecer vencida
      // sem ninguém ter rodado job nenhum.
      const view = await billing.aging(new Date('2026-06-01T00:00:00.000Z'))

      expect(view.overdue_amount_cents).toBeGreaterThan(0)
      expect(view.buckets.find(b => b.key === 'd60_plus')?.invoice_count).toBeGreaterThan(0)
    })

    it('does not count a paid invoice as receivable', async () => {
      const invoice = await issue()
      const before = await billing.aging(new Date('2026-06-01T00:00:00.000Z'))

      await billing.markPaid(invoice.id, '2026-02-10')
      const after = await billing.aging(new Date('2026-06-01T00:00:00.000Z'))

      expect(after.open_amount_cents).toBe(before.open_amount_cents - invoice.amount_cents)
    })
  })

  describe('revenue share', () => {
    it('falls back to the contract rate', async () => {
      const share = await billing.upsertRevenueShare({
        contract_id: contractId,
        store_id: 1,
        period: '2026-01',
        base_revenue_cents: 198_000,
      })

      expect(share.rate_bps).toBe(500)
      expect(share.amount_cents).toBe(9_900)
    })

    it('is idempotent by store and period', async () => {
      await billing.upsertRevenueShare({
        contract_id: contractId,
        store_id: 1,
        period: '2026-01',
        base_revenue_cents: 400_000,
      })

      const rows = await prisma.revenueShare.findMany({ where: { store_id: 1, period: '2026-01' } })

      expect(rows).toHaveLength(1)
      expect(rows[0].base_revenue_cents).toBe(400_000)
    })
  })
})
