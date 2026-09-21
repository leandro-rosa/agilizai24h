import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../../src/modules/db-client/prisma-client.service'
import { loadDriveConfig, type DriveConfig } from '../../src/modules/drive-source/config/drive.config'
import { DriveRepository } from '../../src/modules/drive-source/services/drive.repository'
import { DriveScanService } from '../../src/modules/drive-source/services/drive-scan.service'
import type { DriveItem } from '../../src/modules/drive-source/services/drive-client'
import { InMemoryDriveClient } from '../../src/modules/drive-source/testing/in-memory-drive.client'
import { integrationDatabaseUrl } from '../support/test-database'

/** The real repository and database (a THROWAWAY one), with a fake Drive: nothing here can reach a real Drive or a real database. */
describe('Drive scan', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let repository: DriveRepository
  const producer = { enqueueValidation: jest.fn().mockResolvedValue(undefined) }

  const enabled = (extra: Record<string, unknown> = {}): DriveConfig =>
    loadDriveConfig({
      GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'a@b.c', private_key: 'k' })).toString('base64'),
      ...extra,
    })

  const legacyFiles = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`venda Ascenty - LOJA${i} agosto.xlsx`, `legacy-${i}`]),
  )

  const tree = () =>
    InMemoryDriveClient.fromTree('root', {
      'agosto-26': { 'Relatório_2026.xlsx': 'aug-report', ...legacyFiles, '[TESTE] Relatório_2026.xlsx': 'fake' },
      'julho-26': { 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx': 'jul-supply' },
      'setembro-26': { 'Relatório_2026': { 'dados.xlsx': 'sep-data' } },
    })

  const service = (client: InMemoryDriveClient, config: DriveConfig = enabled()) =>
    new DriveScanService(config, client, repository, producer as never)

  const row = (name: string) => prisma.driveFile.findFirstOrThrow({ where: { name } })

  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl()
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [DriveRepository],
    }).compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    repository = app.get(DriveRepository)
  }, 60000)

  beforeEach(() => producer.enqueueValidation.mockClear())

  afterEach(async () => {
    await prisma.driveFile.deleteMany()
    await prisma.driveScanRun.deleteMany()
    await prisma.ingestion.deleteMany()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('a first scan', () => {
    it('tracks only the report and restocking files and counts the twenty legacy per-store files as skipped', async () => {
      const summary = await service(tree()).scan('manual')

      expect(summary).toMatchObject({ outcome: 'ok', skippedByPattern: 20, newCount: 4, changedCount: 0 })
      const names = (await prisma.driveFile.findMany()).map(f => f.name).sort()
      expect(names).toEqual(['Abastecimentos 2026-07-01 _ 2026-07-31.xlsx', 'Relatório_2026.xlsx', 'dados.xlsx', '[TESTE] Relatório_2026.xlsx'].sort())
    })

    it('reads metadata only: nothing is downloaded or exported and no ingestion is created', async () => {
      const client = tree()

      await service(client).scan('schedule')

      expect(client.downloaded).toEqual([])
      expect(client.exported).toEqual([])
      expect(await prisma.ingestion.count()).toBe(0)
    })

    it('stores the suggestions with their reason', async () => {
      await service(tree()).scan('manual')

      expect(await row('Relatório_2026.xlsx')).toMatchObject({
        path: 'agosto-26',
        status: 'new',
        validation_status: 'none',
        suggested_file_type: 'sales',
        suggested_period: '2026-08',
        suggestion_note: 'generic_name',
      })
      expect(await row('Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toMatchObject({
        suggested_file_type: 'supply',
        suggested_period: '2026-07',
        suggestion_note: null,
      })
    })

    it('tracks a spreadsheet inside a report folder, taking the month from the month folder and the year from the folder', async () => {
      await service(tree()).scan('manual')

      expect(await row('dados.xlsx')).toMatchObject({
        path: 'setembro-26/Relatório_2026',
        suggested_file_type: 'sales',
        suggested_period: '2026-09',
      })
    })

    it('marks a file carrying the synthetic marker, so it can be labelled and never imported', async () => {
      await service(tree()).scan('manual')

      expect((await row('[TESTE] Relatório_2026.xlsx')).is_synthetic).toBe(true)
      expect((await row('Relatório_2026.xlsx')).is_synthetic).toBe(false)
    })

    it('queues a validation for every new file and records the run', async () => {
      const summary = await service(tree()).scan('manual')

      expect(producer.enqueueValidation).toHaveBeenCalledTimes(4)
      expect(await repository.latestScanRun()).toMatchObject({
        id: summary?.runId,
        trigger: 'manual',
        outcome: 'ok',
        files_seen: 24,
        skipped_by_pattern: 20,
        new_count: 4,
      })
    })

    it('queues no validation when automatic validation is off', async () => {
      await service(tree(), enabled({ DRIVE_AUTO_VALIDATE: 'false' })).scan('manual')

      expect(producer.enqueueValidation).not.toHaveBeenCalled()
      expect(await prisma.driveFile.count()).toBe(4)
    })
  })

  describe('a later scan', () => {
    const importedFile = async (client: InMemoryDriveClient) => {
      await service(client).scan('manual')
      const report = await row('Relatório_2026.xlsx')
      await prisma.driveFile.update({
        where: { id: report.id },
        data: { status: 'imported', imported_fingerprint: report.fingerprint, imported_ingestion_id: 'ing-1', imported_sha256: 'sha', imported_file_type: 'sales', imported_period: '2026-08' },
      })
      producer.enqueueValidation.mockClear()
      return report
    }

    it('does not propose an unchanged imported file again', async () => {
      const client = tree()
      await importedFile(client)

      const summary = await service(client).scan('schedule')

      expect((await row('Relatório_2026.xlsx')).status).toBe('imported')
      expect(summary?.newCount).toBe(0)
      expect(producer.enqueueValidation).not.toHaveBeenCalledWith({ fileId: (await row('Relatório_2026.xlsx')).id })
    })

    it('proposes an edited imported file as a replacement, with its validation reset, and queues it', async () => {
      const client = tree()
      const report = await importedFile(client)
      await prisma.driveFile.update({
        where: { id: report.id },
        data: { validation_status: 'passed', validation_report: { any: 'report' }, validated_fingerprint: report.fingerprint, content_sha256: 'sha' },
      })

      client.edit(await findDriveId(client, 'Relatório_2026.xlsx'), 'corrected-report')
      const summary = await service(client).scan('schedule')

      expect(await row('Relatório_2026.xlsx')).toMatchObject({
        status: 'changed',
        validation_status: 'none',
        validation_report: null,
        validated_fingerprint: null,
        content_sha256: null,
        imported_ingestion_id: 'ing-1', // what was imported stays untouched
      })
      expect(summary?.changedCount).toBe(1)
      expect(producer.enqueueValidation).toHaveBeenCalledWith({ fileId: report.id })
    })

    it('marks a file removed from the Drive as missing without touching what was ingested from it', async () => {
      const client = tree()
      const report = await importedFile(client)

      client.remove(await findDriveId(client, 'Relatório_2026.xlsx'))
      const summary = await service(client).scan('schedule')

      expect(summary?.missingCount).toBe(1)
      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'missing', imported_ingestion_id: 'ing-1', imported_sha256: 'sha' })
      expect(report.id).toBeDefined()
    })

    it('brings a missing file back as imported when it reappears unchanged', async () => {
      const client = tree()
      await importedFile(client)
      const id = await findDriveId(client, 'Relatório_2026.xlsx')
      const content = client.contentOf(id)

      client.remove(id)
      await service(client).scan('schedule')
      const parent = (await listAll(client, 'root')).find(i => i.name === 'agosto-26')!
      client.addFile(parent.id, 'Relatório_2026.xlsx', content, false, id)
      await service(client).scan('schedule')

      expect((await row('Relatório_2026.xlsx')).status).toBe('imported')
    })

    it('keeps an ignored file ignored while unchanged, and proposes it again once its content changes', async () => {
      const client = tree()
      await service(client).scan('manual')
      const report = await row('Relatório_2026.xlsx')
      await prisma.driveFile.update({ where: { id: report.id }, data: { status: 'ignored' } })

      await service(client).scan('schedule')
      expect((await row('Relatório_2026.xlsx')).status).toBe('ignored')

      client.edit(await findDriveId(client, 'Relatório_2026.xlsx'), 'edited')
      await service(client).scan('schedule')
      expect((await row('Relatório_2026.xlsx')).status).toBe('new')
    })

    it('never touches a file that is being imported, even if it vanished from the listing', async () => {
      const client = tree()
      await service(client).scan('manual')
      const report = await row('Relatório_2026.xlsx')
      await prisma.driveFile.update({ where: { id: report.id }, data: { status: 'importing' } })

      client.remove(await findDriveId(client, 'Relatório_2026.xlsx'))
      await service(client).scan('schedule')

      expect((await row('Relatório_2026.xlsx')).status).toBe('importing')
    })
  })

  describe('a scan that fails', () => {
    it('leaves every known file and status exactly as it was, and records why', async () => {
      const client = tree()
      await service(client).scan('manual')
      const before = await prisma.driveFile.findMany({ orderBy: { name: 'asc' } })

      client.failListing()
      const summary = await service(client).scan('schedule')

      expect(summary).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/no longer shared/) })
      expect(await prisma.driveFile.findMany({ orderBy: { name: 'asc' } })).toEqual(before)
      expect(await repository.latestScanRun()).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/no longer shared/) })
    })

    it('writes nothing when the listing fails halfway: files found before the failure are not half-recorded', async () => {
      const client = InMemoryDriveClient.fromTree('root', {
        'agosto-26': { 'Relatório_2026.xlsx': 'a' },
        'julho-26': { 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx': 'b' },
      })
      client.failListingOfFolder('julho-26', new Error('quota exceeded'))

      const summary = await service(client).scan('schedule')

      expect(summary).toMatchObject({ outcome: 'failed', error: 'quota exceeded' })
      expect(await prisma.driveFile.count()).toBe(0)
    })
  })

  describe('bookkeeping', () => {
    it('does nothing when the source is not configured: a stale schedule firing after the variables were removed', async () => {
      const summary = await service(tree(), loadDriveConfig({})).scan('schedule')

      expect(summary).toBeNull()
      expect(await prisma.driveScanRun.count()).toBe(0)
    })

    it('closes a run left running by a dead process, so it cannot block "Sincronizar agora"', async () => {
      const stale = await prisma.driveScanRun.create({ data: { trigger: 'schedule', started_at: new Date(Date.now() - 2 * 3600 * 1000) } })

      await service(tree()).scan('manual')

      expect(await prisma.driveScanRun.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
        outcome: 'failed',
        error: expect.stringMatching(/Interrupted/),
      })
      expect(await repository.hasRunningScan()).toBe(false)
    })

    it('keeps only the latest 30 runs', async () => {
      for (let i = 0; i < 33; i++) {
        await prisma.driveScanRun.create({ data: { trigger: 'schedule', outcome: 'ok', started_at: new Date(Date.UTC(2026, 7, 1, 0, i)) } })
      }

      await service(tree()).scan('manual')

      expect(await prisma.driveScanRun.count()).toBe(30)
    })
  })

  async function listAll(client: InMemoryDriveClient, folder: string): Promise<DriveItem[]> {
    const items: DriveItem[] = []
    for await (const item of client.listFolder(folder)) items.push(item)
    return items
  }

  async function findDriveId(client: InMemoryDriveClient, name: string): Promise<string> {
    for (const month of await listAll(client, 'root')) {
      for (const item of await listAll(client, month.id)) if (item.name === name) return item.id
    }
    throw new Error(`not found: ${name}`)
  }
})
