import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { PDFDocument } from '@cantoo/pdf-lib'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { InMemoryDriveClient } from '../src/modules/drive-source/testing/in-memory-drive.client'
import { xlsxBuffer } from '../src/modules/drive-source/testing/workbook-fixtures'
import { TreasuryDriveImportService } from '../src/modules/treasury-drive-source/services/treasury-drive-import.service'
import { TreasuryDriveRepository } from '../src/modules/treasury-drive-source/services/treasury-drive.repository'
import { TreasuryDriveScanService } from '../src/modules/treasury-drive-source/services/treasury-drive-scan.service'
import type { TreasuryDriveConfig } from '../src/modules/treasury-drive-source/config/treasury-drive.config'
import type { SheetRows } from '../src/modules/ingestion/utils/read-workbook-rows'
import type { TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'

/**
 * Real native Google Sheets, exported by the real GoogleDriveClient as genuine xlsx — same
 * reasoning as treasury-drive-scan.integration-spec.ts: built with xlsxBuffer() rather than a
 * raw CSV/text string, so the real ExcelJS/SheetJS reading path is exercised and no mojibake
 * fixture artefact (the bug Task 8 found) can hide here either.
 */
const c6StatementSheet = (extraRow?: unknown[]): SheetRows => ({
  sheetName: 'Sheet1',
  rows: [
    ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe'],
    ['2026-08-03', '2026-08-03', 'Pix recebido', 'Pix recebido de ALELO S.A.', 445.93, 0, null, null],
    ...(extraRow ? [extraRow] : []),
  ],
})

/** Content that matches none of the three Drive-sourced treasury signatures (no C6/Itaú headers at all). */
const unrelatedSheet = (): SheetRows => ({
  sheetName: 'Sheet1',
  rows: [
    ['Nothing recognizable', 'here'],
    ['just some', 'random content'],
  ],
})

const PAGBANK_SHEET: SheetRows = {
  sheetName: 'Sheet1',
  rows: [
    ['Nome do Titular : AGILIZ.AI LTDA'],
    ['Banco : 290 - PagSeguro Internet S/A'],
    [],
    ['Data', 'Tipo', 'Descrição', 'Entradas', 'Saidas', 'Saldo'],
    ['01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null],
  ],
}

/** A real, short, PDF-lib-built PDF. `drawText` lines are placed top-to-bottom (decreasing y) so
 * pdf-parse extracts them in the same order they're listed here — if a future pdf-parse upgrade
 * ever changes that ordering, the RED step below will show lines out of order, not missing text;
 * widen the y gaps, don't change the assertions. Page width is 800pt (not a narrower size) — Task
 * 7 measured directly that a 400pt-wide page truncates "CNPJ Agência Conta" down to "CNPJ Agê"
 * once rendered text runs past the page's right edge, and this file's own Nubank fixture below
 * reuses that exact 44-character CNPJ line, so the same truncation risk applies here.
 * Imports from `@cantoo/pdf-lib`, not the plain `pdf-lib` already used elsewhere in this service's
 * tests — confirmed directly that the plain package's `PDFDocument` has no `encrypt` method at
 * all (only this fork adds it, with the exact `{ userPassword, ownerPassword }` shape used below),
 * which the password-protected C6-invoice fixtures need. */
async function buildPdf(lines: string[], password?: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([800, 50 + lines.length * 20])
  lines.forEach((line, i) => page.drawText(line, { x: 10, y: page.getHeight() - 30 - i * 20 }))
  if (password) await doc.encrypt({ userPassword: password, ownerPassword: password })
  return Buffer.from(await doc.save())
}

const config = (overrides: Partial<TreasuryDriveConfig> = {}): TreasuryDriveConfig => ({
  enabled: true,
  rootFolderId: 'root',
  monthFolders: ['agosto'],
  scanCron: '0 6 * * *',
  ...overrides,
})

/**
 * Runs against the real dev Postgres (DATABASE_URL, port 5438) via DbClientModule/
 * PrismaClientService — the same pattern treasury-drive-scan.integration-spec.ts and
 * chunk-accumulation.integration-spec.ts use, not the throwaway-container helper (that one is
 * reserved for test:integration:drive). The table is cleared after every test.
 *
 * This file covers `TreasuryDriveImportService.runImport` — the WORKER side (download, re-detect,
 * S3-upload, publish) — and `requestImport`'s own "queue failure must not leave the file stuck at
 * importing" behavior. The atomic-claim guarantee itself (`requestImport`'s 409 on an
 * already-`imported`/`importing` file, and the true-concurrency race) is exercised at the HTTP
 * layer in treasury-drive-files.integration-spec.ts — see this module's own CLAUDE.md/Finding 1:
 * that guarantee now lives on the REQUEST path, not inside `runImport`, so it belongs to the
 * controller/HTTP-level test, not here.
 */
describe('TreasuryDriveImportService', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let repo: TreasuryDriveRepository

  const published: { queueName: string; message: TreasuryRawRowsJob }[] = []
  const broker = {
    holdIt: jest.fn(async (call: { queueName: string; message: TreasuryRawRowsJob }) => {
      published.push(call)
      return { id: randomUUID() }
    }),
  }
  const s3 = { uploadFile: jest.fn() }
  const producer = { enqueueImport: jest.fn().mockResolvedValue(undefined) }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    repo = new TreasuryDriveRepository(prisma)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.treasuryDriveFile.deleteMany({})
    await app?.close()
  }, 30000)

  beforeEach(() => {
    broker.holdIt.mockClear()
    s3.uploadFile.mockReset().mockResolvedValue({})
    producer.enqueueImport.mockReset().mockResolvedValue(undefined)
    published.length = 0
  })

  afterEach(async () => {
    await prisma.treasuryDriveFile.deleteMany({})
  })

  /** Scans the fake Drive so a tracked row exists, and returns it plus the client used to build it. */
  const tracked = async (client: InMemoryDriveClient) => {
    await new TreasuryDriveScanService(repo).scan(client, config())
    const [file] = await repo.list()
    return file
  }

  const service = () => new TreasuryDriveImportService(repo, producer as never, broker as never, s3 as never)

  describe('runImport (the worker side: download, re-detect, upload, publish)', () => {
    it("publishes a TreasuryRawRowsJob with the confirmed accountId/period and the file's real content, using a real S3 upload (never the brief's placeholder objectKey)", async () => {
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
      const file = await tracked(client)
      // The request path already claimed the file before a job would ever reach the worker.
      await repo.claimForImporting(file.id)

      const result = await service().runImport(file.id, client, 42, '2026-08', undefined)

      expect(result?.status).toBe('imported')
      expect(published).toHaveLength(1)
      expect(published[0].queueName).toBe('treasury.raw-rows')
      expect(published[0].message.accountId).toBe(42)
      expect(published[0].message.period).toBe('2026-08')
      expect(published[0].message.source).toBe('c6_statement')
      expect(published[0].message.rows).toHaveLength(1)

      // The real S3Service upload, not the brief's placeholder string.
      const objectKey = published[0].message.objectKey
      expect(objectKey).not.toMatch(/PLACEHOLDER/i)
      expect(objectKey).toMatch(/^treasury-imports\/2026-08\/c6_statement\/.+/)
      expect(s3.uploadFile).toHaveBeenCalledTimes(1)
      const [key, body, contentType] = s3.uploadFile.mock.calls[0]
      expect(key).toBe(objectKey)
      expect(Buffer.isBuffer(body)).toBe(true)
      expect(contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

      const after = await repo.findById(file.id)
      expect(after).toMatchObject({ status: 'imported', imported_account_id: 42 })
    })

    it('does nothing (no download, no publish) for a stale or duplicate job whose file is no longer "importing"', async () => {
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
      const file = await tracked(client)
      // Never claimed (still "new") — nothing on the request path handed this job its slot.

      const result = await service().runImport(file.id, client, 42, '2026-08', undefined)

      expect(result).toBeUndefined()
      expect(published).toHaveLength(0)
      expect(s3.uploadFile).not.toHaveBeenCalled()
      const after = await repo.findById(file.id)
      expect(after?.status).toBe('new')
    })

    it('marks the file "error" and does not publish anything when the re-fetched content no longer matches any known signature', async () => {
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
      const file = await tracked(client)
      client.edit(file.drive_file_id, xlsxBuffer([unrelatedSheet()]))
      await repo.claimForImporting(file.id)

      await expect(service().runImport(file.id, client, 42, '2026-08', undefined)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'unrecognized' }),
      })

      expect(published).toHaveLength(0)
      expect(s3.uploadFile).not.toHaveBeenCalled()
      const after = await repo.findById(file.id)
      expect(after?.status).toBe('error')
      expect(after?.error_detail).toMatch(/no recognizable signature/i)
    })

    it('imports a C6 invoice found as a password-protected PDF (the real September case), using the PDF parser', async () => {
      const pdfBytes = await buildPdf(
        ['Ola, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou', '05 set Compra Mercado 150,00'],
        'inv-test-pw',
      )
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'fatura c6 setembro.pdf': { mimeType: 'application/pdf', content: pdfBytes } } } })
      const file = await tracked(client)
      await repo.claimForImporting(file.id)

      const result = await service().runImport(file.id, client, 42, '2026-10', 'inv-test-pw')

      expect(result?.status).toBe('imported')
      expect(published[0].message.source).toBe('c6_invoice')
      expect(published[0].message.rows).toHaveLength(1)
      expect(published[0].message.rows[0]).toMatchObject({ occurredOn: '2026-09-05', amountCents: 15000, direction: 'outflow' })
      const [, , contentType] = s3.uploadFile.mock.calls[0]
      expect(contentType).toBe('application/pdf')
    })

    it('imports a Nubank statement found as a PDF, using parseNubankStatement', async () => {
      const pdfBytes = await buildPdf([
        'AGILIZ.AI LTDA',
        '60.819.321/0001-44 0001  CNPJ Agência Conta',
        'Movimentações',
        '01 SET 2026 Total de entradas +100,00',
        'PIX recebido JOAO 100,00',
      ])
      const client = InMemoryDriveClient.fromTree('root', { agosto: { nubank: { 'extrato nubank.pdf': { mimeType: 'application/pdf', content: pdfBytes } } } })
      const file = await tracked(client)
      await repo.claimForImporting(file.id)

      const result = await service().runImport(file.id, client, 42, '2026-09', undefined)

      expect(result?.status).toBe('imported')
      expect(published[0].message.source).toBe('nubank_statement')
      expect(published[0].message.rows).toHaveLength(1)
      expect(published[0].message.rows[0]).toMatchObject({ occurredOn: '2026-09-01', amountCents: 10000, direction: 'inflow' })
    })

    it('imports a PagBank statement found as a mislabeled-PDF xlsx, using parsePagBankStatementSheet', async () => {
      const client = InMemoryDriveClient.fromTree('root', { agosto: { pagseguro: { 'extrato.pdf': { mimeType: 'application/pdf', content: xlsxBuffer([PAGBANK_SHEET]) } } } })
      const file = await tracked(client)
      await repo.claimForImporting(file.id)

      const result = await service().runImport(file.id, client, 42, '2026-09', undefined)

      expect(result?.status).toBe('imported')
      expect(published[0].message.source).toBe('pagbank_statement')
      expect(published[0].message.rows).toHaveLength(1)
      expect(published[0].message.rows[0]).toMatchObject({ amountCents: 586, direction: 'inflow' })
      const [, , contentType] = s3.uploadFile.mock.calls[0]
      expect(contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    })

    it('refuses import with "unrecognized" when a password-protected file has no configured password', async () => {
      const pdfBytes = await buildPdf(['Ola, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou'], 'inv-test-pw')
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'fatura c6.pdf': { mimeType: 'application/pdf', content: pdfBytes } } } })
      const file = await tracked(client)
      await repo.claimForImporting(file.id)

      await expect(service().runImport(file.id, client, 42, '2026-10', undefined)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'unrecognized' }),
      })

      expect(published).toHaveLength(0)
      const after = await repo.findById(file.id)
      expect(after?.status).toBe('error')
    })
  })

  describe('requestImport (the request side: claim, queue)', () => {
    it('claims the file, queues the import and returns "importing"', async () => {
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
      const file = await tracked(client)

      const result = await service().requestImport(file.id, 42, '2026-08')

      expect(result).toEqual({ id: file.id, status: 'importing' })
      expect(producer.enqueueImport).toHaveBeenCalledWith({ fileId: file.id, accountId: 42, period: '2026-08' }, undefined)
      const after = await repo.findById(file.id)
      expect(after?.status).toBe('importing')
    })

    it('marks the file back to "error" (never stuck at "importing" with no job actually queued) when enqueueing fails', async () => {
      const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
      const file = await tracked(client)
      producer.enqueueImport.mockRejectedValueOnce(new Error('queue unreachable'))

      await expect(service().requestImport(file.id, 42, '2026-08')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'queue_unavailable' }),
      })

      const after = await repo.findById(file.id)
      // `error` (not stuck at `importing`) is claimable again — a retry from the operator can proceed.
      expect(after?.status).toBe('error')
    })
  })
})
