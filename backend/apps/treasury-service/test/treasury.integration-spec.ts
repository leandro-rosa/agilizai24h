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
      kind: 'expense',
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
      const pending = await outflow(75_00, { counterparty_raw: raw, kind: 'pending', nature: undefined })

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

  describe('kind / nature', () => {
    it('requires nature only for kind expense', async () => {
      const expense = await outflow(10_00, { kind: 'expense', nature: 'cogs' })
      expect(expense.nature).toBe('cogs')

      const movement = await outflow(20_00, { kind: 'movement', nature: undefined })
      expect(movement.nature).toBeNull()
    })

    it('strips a nature sent alongside a non-expense kind', async () => {
      // Defensivo: mesmo se o chamador mandar nature, kind != expense nunca a persiste.
      const movement = await treasury.createTransaction({
        account_id: accountId,
        occurred_on: '2099-01-15',
        period,
        direction: 'outflow',
        amount_cents: 30_00,
        counterparty_raw: 'PGTO FAT CARTAO C6 TESTE',
        entry_type: 'movimentacao',
        category: 'fatura',
        kind: 'movement',
        nature: 'administrative',
      })

      expect(movement.nature).toBeNull()
    })
  })

  describe('mapping resolution', () => {
    it('prefers an exact rule over a contains rule for the same text', async () => {
      const suffix = Date.now()
      const exactText = `ZZTESTE EXATO ${suffix}`
      const exact = await treasury.createMapping({
        match_text: exactText,
        display_name: 'Teste Exato',
        entry_type: 'deslocamento',
        category: 'Categoria exata',
        kind: 'expense',
        nature: 'operating',
        match_type: 'exact',
      })
      const contains = await treasury.createMapping({
        match_text: `ZZTESTE ${suffix}`,
        display_name: 'Teste genérico (contains)',
        entry_type: 'deslocamento',
        category: 'Categoria genérica',
        kind: 'expense',
        nature: 'operating',
        match_type: 'contains',
      })

      const pending = await outflow(15_00, { counterparty_raw: exactText, kind: 'pending', nature: undefined })
      await treasury.applyMappings(period)

      const after = await prisma.bankTransaction.findUnique({ where: { id: pending.id } })
      expect(after?.category).toBe('Categoria exata')

      await treasury.deleteMapping(exact.id)
      await treasury.deleteMapping(contains.id)
    })

    it('the longest matching contains rule wins', async () => {
      const short = await treasury.createMapping({
        match_text: 'REST',
        display_name: 'Genérico REST',
        entry_type: 'deslocamento',
        category: 'Categoria curta',
        kind: 'expense',
        nature: 'operating',
        match_type: 'contains',
      })
      const long = await treasury.createMapping({
        match_text: 'RESTAURANTE ESPECIFICO',
        display_name: 'Específico',
        entry_type: 'deslocamento',
        category: 'Categoria longa',
        kind: 'expense',
        nature: 'operating',
        match_type: 'contains',
      })

      const pending = await outflow(15_00, {
        counterparty_raw: `RESTAURANTE ESPECIFICO LTDA ${Date.now()}`,
        kind: 'pending',
        nature: undefined,
      })
      await treasury.applyMappings(period)

      const after = await prisma.bankTransaction.findUnique({ where: { id: pending.id } })
      expect(after?.category).toBe('Categoria longa')

      await treasury.deleteMapping(short.id)
      await treasury.deleteMapping(long.id)
    })

    it('applyMappings reclassifies a pending row into a movement kind, not just expense', async () => {
      const raw = `TRANSFERENCIA PROPRIA TESTE ${Date.now()}`
      const rule = await treasury.createMapping({
        match_text: raw,
        display_name: 'Conta própria de teste',
        entry_type: 'movimentacao',
        category: 'Movimentação entre contas',
        kind: 'movement',
        match_type: 'exact',
      })

      const pending = await outflow(500_00, { counterparty_raw: raw, kind: 'pending', nature: undefined })
      const result = await treasury.applyMappings(period)
      expect(result.classified).toBeGreaterThan(0)

      const after = await prisma.bankTransaction.findUnique({ where: { id: pending.id } })
      expect(after?.kind).toBe('movement')
      expect(after?.nature).toBeNull()
      expect(after?.supplier_id).toBeNull()

      await treasury.deleteMapping(rule.id)
    })

    it('never touches a row that is not pending, even without a supplier resolved', async () => {
      const raw = `JA CLASSIFICADO ${Date.now()}`
      const rule = await treasury.createMapping({
        match_text: raw,
        display_name: 'Não deveria aplicar',
        entry_type: 'estoque',
        category: 'não deveria aparecer',
        kind: 'expense',
        nature: 'cogs',
        match_type: 'exact',
      })

      // kind: movement já classificado à mão, supplier_id continua null (nunca tem fornecedor) —
      // não pode ser confundido com "pendente" só por causa do supplier_id.
      const alreadyMovement = await outflow(60_00, {
        counterparty_raw: raw,
        kind: 'movement',
        nature: undefined,
      })

      await treasury.applyMappings(period)

      const after = await prisma.bankTransaction.findUnique({ where: { id: alreadyMovement.id } })
      expect(after?.category).not.toBe('não deveria aparecer')
      expect(after?.kind).toBe('movement')

      await treasury.deleteMapping(rule.id)
    })
  })

  describe('summary — kind exclusions', () => {
    it('excludes movement and pending from revenue/expense totals, reporting them separately', async () => {
      // Ano dedicado, nunca usado por outro teste do arquivo — evita herdar
      // lançamentos acumulados no período `2099-01` compartilhado.
      const isolatedPeriod = '2100-01'

      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${isolatedPeriod}-10`,
        period: isolatedPeriod,
        direction: 'outflow',
        amount_cents: 100_00,
        counterparty_raw: 'DESPESA REAL',
        entry_type: 'estoque',
        category: 'estoque geral',
        kind: 'expense',
        nature: 'cogs',
      })
      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${isolatedPeriod}-11`,
        period: isolatedPeriod,
        direction: 'outflow',
        amount_cents: 900_00,
        counterparty_raw: 'PGTO FAT CARTAO C6',
        entry_type: 'movimentacao',
        category: 'fatura',
        kind: 'movement',
      })
      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${isolatedPeriod}-12`,
        period: isolatedPeriod,
        direction: 'outflow',
        amount_cents: 40_00,
        counterparty_raw: 'AINDA NAO IDENTIFICADO',
        entry_type: 'a classificar',
        category: 'a classificar',
        kind: 'pending',
      })

      const summary = await treasury.summary({ period: isolatedPeriod })

      expect(summary.outflow_cents).toBe(100_00)
      expect(summary.movement_cents).toBe(900_00)
      expect(summary.pending_count).toBe(1)
      expect(summary.pending_cents).toBe(40_00)

      await prisma.bankTransaction.deleteMany({ where: { period: isolatedPeriod } })
    })
  })

  describe('date filters (occurred_on range)', () => {
    it('occurred_from/occurred_to narrows both listTransactions and summary to a sub-range of days', async () => {
      // Ano dedicado, nunca usado por outro teste do arquivo — evita herdar
      // lançamentos acumulados no período `2099-01` compartilhado.
      const isolatedPeriod = '2101-01'

      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${isolatedPeriod}-05`,
        period: isolatedPeriod,
        direction: 'outflow',
        amount_cents: 10_00,
        counterparty_raw: 'FORA DO RANGE ANTES',
        entry_type: 'estoque',
        category: 'estoque geral',
        kind: 'expense',
        nature: 'cogs',
      })
      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${isolatedPeriod}-15`,
        period: isolatedPeriod,
        direction: 'outflow',
        amount_cents: 20_00,
        counterparty_raw: 'DENTRO DO RANGE',
        entry_type: 'estoque',
        category: 'estoque geral',
        kind: 'expense',
        nature: 'cogs',
      })
      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${isolatedPeriod}-25`,
        period: isolatedPeriod,
        direction: 'outflow',
        amount_cents: 40_00,
        counterparty_raw: 'FORA DO RANGE DEPOIS',
        entry_type: 'estoque',
        category: 'estoque geral',
        kind: 'expense',
        nature: 'cogs',
      })

      const rows = await treasury.listTransactions({
        period: isolatedPeriod,
        occurred_from: `${isolatedPeriod}-10`,
        occurred_to: `${isolatedPeriod}-20`,
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].counterparty_raw).toBe('DENTRO DO RANGE')

      const summary = await treasury.summary({
        period: isolatedPeriod,
        occurred_from: `${isolatedPeriod}-10`,
        occurred_to: `${isolatedPeriod}-20`,
      })
      expect(summary.outflow_cents).toBe(20_00)

      await prisma.bankTransaction.deleteMany({ where: { period: isolatedPeriod } })
    })
  })

  describe('by-supplier consolidation', () => {
    it('sums a fornecedor across two accounts into one total', async () => {
      const otherAccount = await treasury.createAccount({
        name: `Conta 2 ${Date.now()}`,
        kind: 'checking',
        institution: 'Banco Teste 2',
      })

      const supplierPeriod = '2101-01'
      const supplierId = Math.floor(Math.random() * 1_000_000) + 1

      await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${supplierPeriod}-05`,
        period: supplierPeriod,
        direction: 'outflow',
        amount_cents: 300_00,
        counterparty_raw: 'FORNECEDOR MULTI CONTA',
        supplier_id: supplierId,
        entry_type: 'estoque',
        category: 'estoque geral',
        kind: 'expense',
        nature: 'cogs',
      })
      await treasury.createTransaction({
        account_id: otherAccount.id,
        occurred_on: `${supplierPeriod}-06`,
        period: supplierPeriod,
        direction: 'outflow',
        amount_cents: 450_00,
        counterparty_raw: 'FORNECEDOR MULTI CONTA',
        supplier_id: supplierId,
        entry_type: 'estoque',
        category: 'estoque geral',
        kind: 'expense',
        nature: 'cogs',
      })

      const bySupplier = await treasury.transactionsBySupplier(supplierPeriod)
      const total = bySupplier.find(row => row.supplier_id === supplierId)

      expect(total?.outflow_cents).toBe(750_00)
      expect(total?.transaction_count).toBe(2)

      await prisma.bankTransaction.deleteMany({ where: { period: supplierPeriod } })
      await prisma.bankAccount.deleteMany({ where: { id: otherAccount.id } })
    })
  })

  describe('neutralization', () => {
    it('confirmed pair is excluded from totals but both rows still exist', async () => {
      const neutralPeriod = '2102-01'

      const failed = await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${neutralPeriod}-08`,
        period: neutralPeriod,
        direction: 'outflow',
        amount_cents: 724_816,
        counterparty_raw: 'PIX RECUSADO',
        entry_type: 'a classificar',
        category: 'a classificar',
        kind: 'pending',
      })
      const reversed = await treasury.createTransaction({
        account_id: accountId,
        occurred_on: `${neutralPeriod}-08`,
        period: neutralPeriod,
        direction: 'inflow',
        amount_cents: 724_816,
        counterparty_raw: 'ENTRADAS PIX ESTORNADO',
        entry_type: 'a classificar',
        category: 'a classificar',
        kind: 'pending',
      })

      const candidates = await treasury.neutralizationCandidates(neutralPeriod)
      expect(candidates.some(c => c.a_id === failed.id && c.b_id === reversed.id)).toBe(true)

      await treasury.neutralize(failed.id, reversed.id)

      const summary = await treasury.summary({ period: neutralPeriod })
      expect(summary.pending_count).toBe(0)

      const bothStillExist = await prisma.bankTransaction.findMany({
        where: { id: { in: [failed.id, reversed.id] } },
      })
      expect(bothStillExist).toHaveLength(2)

      await treasury.unneutralize(failed.id)
      const afterUndo = await prisma.bankTransaction.findUnique({ where: { id: failed.id } })
      expect(afterUndo?.neutralized_with_id).toBeNull()

      await prisma.bankTransaction.deleteMany({ where: { period: neutralPeriod } })
    })

    it('refuses to neutralize transactions from different periods', async () => {
      const a = await outflow(10_00)
      const otherPeriodTx = await treasury.createTransaction({
        account_id: accountId,
        occurred_on: '2099-02-01',
        period: '2099-02',
        direction: 'inflow',
        amount_cents: 10_00,
        counterparty_raw: 'OUTRO PERIODO',
        entry_type: 'a classificar',
        category: 'a classificar',
        kind: 'pending',
      })

      await expect(treasury.neutralize(a.id, otherPeriodTx.id)).rejects.toThrow(/mesmo período/)

      await prisma.bankTransaction.deleteMany({ where: { id: otherPeriodTx.id } })
    })
  })

  describe('seed data', () => {
    it('the confirmed classification rules loaded without duplicate match_text', async () => {
      const seeded = await prisma.counterpartyMapping.findMany({
        where: { match_text: { in: ['AMBEV', 'PONTO FRIO EQUIPAMENTOS', 'PGTO FAT CARTAO C6'] } },
      })

      expect(seeded).toHaveLength(3)
      expect(new Set(seeded.map(rule => rule.match_text)).size).toBe(3)
    })
  })
})
