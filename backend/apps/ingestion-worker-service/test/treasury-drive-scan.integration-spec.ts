import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { InMemoryDriveClient } from '../src/modules/drive-source/testing/in-memory-drive.client'
import { TreasuryDriveScanService } from '../src/modules/treasury-drive-source/services/treasury-drive-scan.service'
import { TreasuryDriveRepository } from '../src/modules/treasury-drive-source/services/treasury-drive.repository'
import type { TreasuryDriveConfig } from '../src/modules/treasury-drive-source/config/treasury-drive.config'

const C6_STATEMENT_HEADER_CSV =
  'Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Tipo,Detalhe\n2026-08-03,2026-08-03,Pix recebido,Pix recebido de ALELO S.A.,445.93,0,,'
const ITAU_HEADER_CSV =
  'Atualização:,15/09/2026,\nAgência:,2059,\nConta:,0099676-5,\nLançamentos,,\nPeriodo:,01/08/2026 até 31/08/2026,'

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
      agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } },
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
      julho: { c6: { 'extrato c6 julho': { sheet: C6_STATEMENT_HEADER_CSV } } },
      agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } },
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
      agosto: { itau: { 'comprovantes itau': { 'photo.jpg': 'not-a-spreadsheet' }, Entradas_Saidas: { sheet: ITAU_HEADER_CSV } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, config())

    const files = await repo.list()
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('Entradas_Saidas')
  })

  it('re-scanning an unchanged file does not flip it back to "new" once imported', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } } })
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
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } } })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)
    await service.scan(client, config())
    const [first] = await repo.list()

    client.edit(first.drive_file_id, C6_STATEMENT_HEADER_CSV + '\n2026-08-04,2026-08-04,Novo,Novo,10,0,,')
    await service.scan(client, config())

    const [after] = await repo.list()
    expect(after.status).toBe('changed')
  })
})
