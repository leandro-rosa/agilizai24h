import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
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

  const service = () => new TreasuryDriveImportService(repo, broker as never, s3 as never)

  it("publishes a TreasuryRawRowsJob with the confirmed accountId/period and the file's real content, using a real S3 upload (never the brief's placeholder objectKey)", async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
    const file = await tracked(client)

    const result = await service().import(file.id, client, 42, '2026-08')

    expect(result.status).toBe('imported')
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

  it('refuses a second import of the same already-imported file', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
    const file = await tracked(client)

    await service().import(file.id, client, 42, '2026-08')
    await expect(service().import(file.id, client, 42, '2026-08')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'already_imported' }),
    })

    expect(published).toHaveLength(1)
    expect(s3.uploadFile).toHaveBeenCalledTimes(1)
  })

  it('marks the file "error" and does not publish anything when the re-fetched content no longer matches any known signature', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
    const file = await tracked(client)
    client.edit(file.drive_file_id, xlsxBuffer([unrelatedSheet()]))

    await expect(service().import(file.id, client, 42, '2026-08')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'unrecognized' }),
    })

    expect(published).toHaveLength(0)
    expect(s3.uploadFile).not.toHaveBeenCalled()
    const after = await repo.findById(file.id)
    expect(after?.status).toBe('error')
    expect(after?.error_detail).toMatch(/no recognizable signature/i)
  })
})
