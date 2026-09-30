import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { InMemoryDriveClient } from '../src/modules/drive-source/testing/in-memory-drive.client'
import { xlsxBuffer } from '../src/modules/drive-source/testing/workbook-fixtures'
import { TreasuryDriveScanService } from '../src/modules/treasury-drive-source/services/treasury-drive-scan.service'
import { TreasuryDriveRepository } from '../src/modules/treasury-drive-source/services/treasury-drive.repository'
import type { TreasuryDriveConfig } from '../src/modules/treasury-drive-source/config/treasury-drive.config'
import type { SheetRows } from '../src/modules/ingestion/utils/read-workbook-rows'

/**
 * Real native Google Sheets, exported by the real GoogleDriveClient as genuine xlsx (it always
 * requests XLSX_MIME — see google-drive.client.ts's exportSheet — never CSV). Built with
 * xlsxBuffer(), the same helper drive-import.throwaway-db-spec.ts and
 * drive-validation.throwaway-db-spec.ts already use for exactly this "native sheet" fixture
 * shape, rather than a raw string: InMemoryDriveClient.fromTree writes a NativeSheet's content
 * verbatim, and a raw UTF-8 CSV string routed through readWorkbookRows's SheetJS-CSV-autodetect
 * fallback would decode as Windows-1252 (mojibaking every accented header) — a fixture artefact
 * this feature's real integration can never hit, since the real Drive never returns raw CSV.
 */
const c6StatementSheet = (extraRow?: unknown[]): SheetRows => ({
  sheetName: 'Sheet1',
  rows: [
    ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe'],
    ['2026-08-03', '2026-08-03', 'Pix recebido', 'Pix recebido de ALELO S.A.', 445.93, 0, null, null],
    ...(extraRow ? [extraRow] : []),
  ],
})

const itauStatementSheet = (): SheetRows => ({
  sheetName: 'Sheet1',
  rows: [
    [null, null, null],
    ['Atualização:', '15/09/2026', null],
    ['Agência:', '2059', null],
    ['Conta:', '0099676-5', null],
    ['Lançamentos', null, null],
    ['Periodo:', '01/08/2026 até 31/08/2026', null],
  ],
})

/**
 * Runs against the real dev Postgres (DATABASE_URL, port 5438) via
 * DbClientModule/PrismaClientService — the same pattern
 * chunk-accumulation.integration-spec.ts uses, not the throwaway-container
 * helper (that one is reserved for test:integration:drive). The table is
 * cleared after every test since drive_file_id values are deterministic
 * ("file-1", "file-2", ...) across InMemoryDriveClient instances and would
 * otherwise collide with a previous test's leftover rows.
 */
describe('TreasuryDriveScanService', () => {
  let app: TestingModule
  let prisma: PrismaClientService

  const config = (overrides: Partial<TreasuryDriveConfig> = {}): TreasuryDriveConfig => ({
    enabled: true,
    rootFolderId: 'root',
    monthFolders: ['agosto'],
    scanCron: '0 6 * * *',
    ...overrides,
  })

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.treasuryDriveFile.deleteMany({})
    await app?.close()
  }, 30000)

  afterEach(async () => {
    await prisma.treasuryDriveFile.deleteMany({})
  })

  it('tracks a new file under an allowlisted month/bank folder', async () => {
    const client = InMemoryDriveClient.fromTree('root', {
      agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    const result = await service.scan(client, config())

    expect(result.new).toBe(1)
    const files = await repo.list()
    expect(files[0]).toMatchObject({ month_folder_name: 'agosto', bank_folder_name: 'c6', detected_source: 'c6_statement', status: 'new' })
  })

  it('ignores a month folder not in the allowlist, even a real one (julho)', async () => {
    const client = InMemoryDriveClient.fromTree('root', {
      julho: { c6: { 'extrato c6 julho': { sheet: xlsxBuffer([c6StatementSheet()]) } } },
      agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, config())

    const files = await repo.list()
    expect(files).toHaveLength(1)
    expect(files[0].month_folder_name).toBe('agosto')
  })

  it('skips a subfolder inside a bank folder as noise (e.g. "comprovantes itau")', async () => {
    const client = InMemoryDriveClient.fromTree('root', {
      agosto: { itau: { 'comprovantes itau': { 'photo.jpg': 'not-a-spreadsheet' }, Entradas_Saidas: { sheet: xlsxBuffer([itauStatementSheet()]) } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, config())

    const files = await repo.list()
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('Entradas_Saidas')
  })

  it('re-scanning an unchanged file does not flip it back to "new" once imported', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, config())
    const [first] = await repo.list()
    await repo.markImported(first.id, 1)

    await service.scan(client, config())
    const [after] = await repo.list()
    expect(after.status).toBe('imported')
  })

  it('flips status to "changed" when the file content hash differs on a re-scan', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)
    await service.scan(client, config())
    const [first] = await repo.list()

    client.edit(first.drive_file_id, xlsxBuffer([c6StatementSheet(['2026-08-04', '2026-08-04', 'Novo', 'Novo', 10, 0, null, null])]))
    await service.scan(client, config())

    const [after] = await repo.list()
    expect(after.status).toBe('changed')
  })

  it('tracks a real Sheet file and does not abort the scan when a non-Sheet file (e.g. a PDF, uploaded by hand) sits in the same bank folder', async () => {
    // `exportSheet` only ever works for a native Google Sheet (see InMemoryDriveClient's own
    // doc comment) — a real Drive folder with a hand-uploaded PDF statement alongside the real
    // Sheets is exactly the scenario that used to throw 403 and abort every file after it.
    const client = InMemoryDriveClient.fromTree('root', {
      agosto: {
        c6: {
          'comprovante.pdf': { mimeType: 'application/pdf', content: 'not-a-spreadsheet' },
          'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) },
        },
      },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    const result = await service.scan(client, config())

    expect(result.seen).toBe(2)
    expect(result.new).toBe(2)
    const files = await repo.list()
    const sheetFile = files.find(f => f.name === 'extrato c6 agosto')
    const pdfFile = files.find(f => f.name === 'comprovante.pdf')
    expect(sheetFile).toMatchObject({ detected_source: 'c6_statement', status: 'new' })
    expect(pdfFile).toMatchObject({ detected_source: null, status: 'new' })
  })
})
