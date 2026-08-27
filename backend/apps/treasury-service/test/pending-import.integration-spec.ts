import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import type { TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { PendingImportService } from '../src/modules/treasury/services/pending-import.service'
import { TreasuryService } from '../src/modules/treasury/services/treasury.service'

/** Runs against the Postgres from this service's docker-compose (same instance treasury.integration-spec.ts uses). */
describe('pending import staging (add-treasury-statement-ingestion)', () => {
  let app: TestingModule
  let pendingImports: PendingImportService
  let treasury: TreasuryService
  let prisma: PrismaClientService

  let accountId: number
  const period = '2098-01' // dedicated year, never used by treasury.integration-spec.ts's own tests

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    pendingImports = app.get(PendingImportService)
    treasury = app.get(TreasuryService)
    prisma = app.get(PrismaClientService)

    const account = await treasury.createAccount({
      name: `Conta staging teste ${Date.now()}`,
      kind: 'checking',
      institution: 'Banco Teste',
    })
    accountId = account.id
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.pendingImport.deleteMany({ where: { account_id: accountId } })
      await prisma.bankTransaction.deleteMany({ where: { account_id: accountId } })
      await prisma.bankAccount.deleteMany({ where: { id: accountId } })
    }
    await app?.close()
  }, 30000)

  const job = (overrides: Partial<TreasuryRawRowsJob> = {}): TreasuryRawRowsJob => ({
    schemaVersion: 1,
    source: 'pagbank_statement',
    accountId,
    period,
    objectKey: `treasury-imports/${period}/pagbank_statement/test.pdf`,
    rows: [
      {
        occurredOn: `${period}-15`,
        amountCents: 10000,
        direction: 'outflow',
        counterpartyRaw: `FORNECEDOR TESTE STAGING ${Date.now()}`,
        sourceRef: 'p1L1',
      },
    ],
    rejections: [],
    ...overrides,
  })

  it('stages rows as a new PendingImport with kind: pending for an unmapped favorecido', async () => {
    const result = await pendingImports.createOrReplace(job())
    expect(result.replaced).toBe(false)

    const created = await pendingImports.getById(result.pendingImportId)
    expect(created.status).toBe('staged')
    expect(created.transactions).toHaveLength(1)
    expect(created.transactions[0].suggested_kind).toBe('pending')
    expect(created.transactions[0].suggested_supplier_id).toBeNull()
  })

  it('resolves a row against an existing mapping rule on arrival', async () => {
    const raw = `MAPEADO STAGING ${Date.now()}`
    const rule = await treasury.createMapping({
      match_text: raw,
      display_name: 'Mapeado Staging',
      entry_type: 'estoque',
      category: 'estoque geral',
      kind: 'expense',
      nature: 'cogs',
    })

    const result = await pendingImports.createOrReplace(
      job({ rows: [{ occurredOn: `${period}-16`, amountCents: 5000, direction: 'outflow', counterpartyRaw: raw }] }),
    )
    const created = await pendingImports.getById(result.pendingImportId)

    expect(created.transactions[0]).toMatchObject({
      suggested_kind: 'expense',
      suggested_category: 'estoque geral',
      suggested_nature: 'cogs',
      mapping_rule_id: rule.id,
    })

    await treasury.deleteMapping(rule.id)
  })

  it('re-uploading while staged replaces the pending transactions, not adds to them', async () => {
    const first = await pendingImports.createOrReplace(
      job({
        source: 'c6_statement',
        rows: [
          { occurredOn: `${period}-10`, amountCents: 100, direction: 'outflow', counterpartyRaw: 'A' },
          { occurredOn: `${period}-11`, amountCents: 200, direction: 'outflow', counterpartyRaw: 'B' },
          { occurredOn: `${period}-12`, amountCents: 300, direction: 'outflow', counterpartyRaw: 'C' },
        ],
      }),
    )
    expect((await pendingImports.getById(first.pendingImportId)).transactions).toHaveLength(3)

    const second = await pendingImports.createOrReplace(
      job({
        source: 'c6_statement',
        rows: [{ occurredOn: `${period}-13`, amountCents: 400, direction: 'outflow', counterpartyRaw: 'D' }],
      }),
    )

    // Replace is a delete-then-recreate (design: simpler than update-in-place,
    // cascade handles the children) — the id is free to change; what must
    // hold is that the OLD import's id is gone and only the new content exists.
    expect(second.replaced).toBe(true)
    await expect(pendingImports.getById(first.pendingImportId)).rejects.toThrow(/not found/)
    const after = await pendingImports.getById(second.pendingImportId)
    expect(after.transactions).toHaveLength(1)
    expect(after.transactions[0].counterparty_raw).toBe('D')
  })

  it('confirm converts every pending transaction into a real BankTransaction in one batch', async () => {
    const staged = await pendingImports.createOrReplace(
      job({
        source: 'nubank_statement',
        rows: [
          { occurredOn: `${period}-05`, amountCents: 1000, direction: 'outflow', counterpartyRaw: 'X' },
          { occurredOn: `${period}-06`, amountCents: 2000, direction: 'inflow', counterpartyRaw: 'Y' },
        ],
      }),
    )

    const result = await pendingImports.confirm(staged.pendingImportId)
    expect(result.confirmed).toBe(2)

    const bankTransactions = await prisma.bankTransaction.findMany({
      where: { account_id: accountId, period, counterparty_raw: { in: ['X', 'Y'] } },
    })
    expect(bankTransactions).toHaveLength(2)
    expect(bankTransactions.every(t => t.kind === 'pending')).toBe(true)
    // Traceable back to this import; unmapped rows carry no rule.
    expect(bankTransactions.every(t => t.pending_import_id === staged.pendingImportId)).toBe(true)
    expect(bankTransactions.every(t => t.mapping_rule_id === null)).toBe(true)

    const confirmedImport = await pendingImports.getById(staged.pendingImportId)
    expect(confirmedImport.status).toBe('confirmed')
  })

  it('a structuralHint row confirms with pending_import_id set but no mapping_rule_id — the format answered, not a de-para rule', async () => {
    const raw = `SISPAG HINT STAGING ${Date.now()}`
    const staged = await pendingImports.createOrReplace(
      job({
        source: 'itau_statement',
        rows: [
          {
            occurredOn: `${period}-22`,
            amountCents: 3300,
            direction: 'outflow',
            counterpartyRaw: raw,
            structuralHint: { kind: 'pending' },
          },
        ],
      }),
    )

    const staging = await pendingImports.getById(staged.pendingImportId)
    expect(staging.transactions[0].mapping_rule_id).toBeNull()

    await pendingImports.confirm(staged.pendingImportId)

    const [bankTransaction] = await prisma.bankTransaction.findMany({ where: { counterparty_raw: raw } })
    expect(bankTransaction.pending_import_id).toBe(staged.pendingImportId)
    expect(bankTransaction.mapping_rule_id).toBeNull()
  })

  it('confirm rejects an import that is not staged', async () => {
    const staged = await pendingImports.createOrReplace(job({ source: 'itau_statement' }))
    await pendingImports.confirm(staged.pendingImportId)

    await expect(pendingImports.confirm(staged.pendingImportId)).rejects.toThrow(/not staged/)
  })

  it('reject discards the pending transactions and leaves no BankTransaction rows', async () => {
    const raw = `REJEITADO STAGING ${Date.now()}`
    const staged = await pendingImports.createOrReplace(
      job({ source: 'bradesco_statement', rows: [{ occurredOn: `${period}-07`, amountCents: 999, direction: 'outflow', counterpartyRaw: raw }] }),
    )

    await pendingImports.reject(staged.pendingImportId)

    const afterReject = await pendingImports.getById(staged.pendingImportId)
    expect(afterReject.status).toBe('rejected')
    expect(afterReject.transactions).toHaveLength(0)

    const bankTransactions = await prisma.bankTransaction.findMany({ where: { counterparty_raw: raw } })
    expect(bankTransactions).toHaveLength(0)
  })

  it('re-uploading a confirmed source creates a new import and flags likely duplicates', async () => {
    const raw = `DUPLICADO STAGING ${Date.now()}`
    const firstStaged = await pendingImports.createOrReplace(
      job({
        source: 'c6_invoice',
        rows: [{ occurredOn: `${period}-20`, amountCents: 7777, direction: 'outflow', counterpartyRaw: raw }],
      }),
    )
    await pendingImports.confirm(firstStaged.pendingImportId)

    const secondStaged = await pendingImports.createOrReplace(
      job({
        source: 'c6_invoice',
        rows: [{ occurredOn: `${period}-20`, amountCents: 7777, direction: 'outflow', counterpartyRaw: raw }],
      }),
    )

    expect(secondStaged.pendingImportId).not.toBe(firstStaged.pendingImportId)
    const secondDetail = await pendingImports.getById(secondStaged.pendingImportId)
    expect(secondDetail.transactions[0].likely_duplicate_of_id).not.toBeNull()
  })

  it('updateTransaction corrects a suggested classification and clears nature when kind stops being expense', async () => {
    const staged = await pendingImports.createOrReplace(job({ source: 'pagbank_statement' }))
    const transactionId = (await pendingImports.getById(staged.pendingImportId)).transactions[0].id

    const updated = await pendingImports.updateTransaction(staged.pendingImportId, transactionId, {
      suggested_kind: 'movement',
    })

    expect(updated.suggested_kind).toBe('movement')
    expect(updated.suggested_nature).toBeNull()
  })

  it('attachProof resolves a SISPAG-style line once a matching rule exists for the typed payee', async () => {
    const raw = `SISPAG SEM NOME ${Date.now()}`
    const staged = await pendingImports.createOrReplace(
      job({
        source: 'itau_statement',
        rows: [
          {
            occurredOn: `${period}-21`,
            amountCents: 4200,
            direction: 'outflow',
            counterpartyRaw: raw,
            structuralHint: { kind: 'pending' },
          },
        ],
      }),
    )
    const transactionId = (await pendingImports.getById(staged.pendingImportId)).transactions[0].id

    const resolvedName = `FORNECEDOR RESOLVIDO SISPAG ${Date.now()}`
    const rule = await treasury.createMapping({
      match_text: resolvedName,
      display_name: 'Fornecedor Resolvido',
      entry_type: 'estoque',
      category: 'estoque geral',
      kind: 'expense',
      nature: 'cogs',
    })

    const updated = await pendingImports.attachProof(staged.pendingImportId, transactionId, {
      proof_object_key: 'treasury-imports/proofs/test.png',
      counterparty_raw: resolvedName,
    })

    expect(updated.proof_object_key).toBe('treasury-imports/proofs/test.png')
    expect(updated.suggested_kind).toBe('expense')
    expect(updated.suggested_category).toBe('estoque geral')

    await treasury.deleteMapping(rule.id)
  })
})
