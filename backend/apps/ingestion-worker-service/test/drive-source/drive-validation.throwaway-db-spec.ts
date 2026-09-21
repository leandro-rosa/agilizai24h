import 'reflect-metadata'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../../src/modules/db-client/prisma-client.service'
import { loadDriveConfig, type DriveConfig } from '../../src/modules/drive-source/config/drive.config'
import { DriveRepository } from '../../src/modules/drive-source/services/drive.repository'
import { DriveScanService } from '../../src/modules/drive-source/services/drive-scan.service'
import { DriveValidationService } from '../../src/modules/drive-source/services/drive-validation.service'
import { InMemoryDriveClient } from '../../src/modules/drive-source/testing/in-memory-drive.client'
import {
  daysOn,
  legacyStoreSalesSheet,
  range,
  salesSheetFor,
  supplySheet,
  at,
  xlsxBuffer,
} from '../../src/modules/drive-source/testing/workbook-fixtures'
import type { StoredValidation } from '../../src/modules/drive-source/types/validation.types'
import { integrationDatabaseUrl } from '../support/test-database'

const AUGUST = '2026-08'
const MON_TO_FRI = [1, 2, 3, 4, 5]
// Synthetic store names, prefixed so they can never be mistaken for real stores.
const ADM = '[TESTE] Loja ADM'
const TAIPAS = '[TESTE] Loja Taipas'

/** A complete August: one store sells every day, the other Monday to Friday. */
const completeAugust = () => salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, MON_TO_FRI) })

describe('Drive validation', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let repository: DriveRepository
  const producer = { enqueueValidation: jest.fn().mockResolvedValue(undefined) }

  const config = (extra: Record<string, unknown> = {}): DriveConfig =>
    loadDriveConfig({
      GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'a@b.c', private_key: 'k' })).toString('base64'),
      DRIVE_AUTO_VALIDATE: 'false', // this suite validates on purpose, one call at a time
      ...extra,
    })

  /** Puts a file in the fake Drive, scans it into the database, and returns its row. */
  async function tracked(client: InMemoryDriveClient, cfg: DriveConfig, name: string) {
    await new DriveScanService(cfg, client, repository, producer as never).scan('manual')
    return prisma.driveFile.findFirstOrThrow({ where: { name } })
  }

  const validation = (client: InMemoryDriveClient, cfg: DriveConfig) => {
    const service = new DriveValidationService(cfg, client, repository)
    service.clock = () => new Date('2026-09-19T15:00:00Z')
    return service
  }

  const driveWith = (files: Record<string, Buffer | string | { sheet: Buffer }>, folder = 'agosto-26') =>
    InMemoryDriveClient.fromTree('root', { [folder]: files })

  const workspaces = () => readdirSync(tmpdir()).filter(entry => entry.startsWith('agiliz-drive-'))

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

  afterEach(async () => {
    await prisma.driveFile.deleteMany()
    await prisma.driveScanRun.deleteMany()
    await prisma.ingestion.deleteMany()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('a complete August sales report', () => {
    it('passes, and stores an aggregated report naming the thresholds it used', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report).toMatchObject({
        outcome: 'passed',
        format: 'network_sales',
        fileType: 'sales',
        period: '2026-08',
        periodShare: 1,
        fileCoverage: 1,
        thresholds: cfg.thresholds,
      })
      expect(await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        validation_status: 'passed',
        validated_fingerprint: row.fingerprint,
        content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    })

    it('reads the file, and only reads it: no ingestion is created and the temporary file is gone', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      const before = workspaces()

      await validation(client, cfg).validate(row.id)

      expect(client.downloaded).toEqual([expect.any(String)])
      expect(await prisma.ingestion.count()).toBe(0)
      expect(workspaces()).toEqual(before)
    })

    it('stores no row-level content: no buyer number, card digits, coupon, product or acquirer', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      await validation(client, cfg).validate(row.id)
      const stored = JSON.stringify((await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).validation_report)

      for (const secret of ['BUYER-777', 'CUPOM-123', '4242', 'Coca-Cola Zero', 'PDV-9', 'Visa', 'Cielo', 'Rua X']) {
        expect(stored).not.toContain(secret)
      }
      expect(stored).toContain(ADM) // store names and day masks are what it does keep
    })

    it('re-evaluates for another period from the stored aggregates, without downloading again', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      const service = validation(client, cfg)

      await service.validate(row.id)
      const report = await service.validate(row.id, { period: '2026-07' })

      expect(client.downloaded).toHaveLength(1)
      expect(report?.outcome).toBe('blocked')
      expect(report?.blocking[0]).toMatchObject({ code: 'period_mismatch', details: { period: '2026-07', observedMonth: '2026-08' } })
    })
  })

  describe('blocked files', () => {
    it('blocks the same file when the folder says July: the content is August', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) }, 'julho-26')
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.outcome).toBe('blocked')
      expect(report?.blocking[0]).toMatchObject({ code: 'period_mismatch', details: { period: '2026-07', observedMonth: '2026-08' } })
      expect((await row.id) && (await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).validation_status).toBe('blocked')
    })

    it('blocks an old per-store sales report with the reason', async () => {
      const cfg = config({ DRIVE_INCLUDE_PATTERNS: 'relat' })
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([legacyStoreSalesSheet()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.blocking.map(f => f.code)).toContain('legacy_format')
    })

    it('blocks a file that is not a spreadsheet: whatever it holds, it is not a sales or restocking report', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': 'this is not a spreadsheet at all' })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.outcome).toBe('blocked')
      expect(report?.blocking.map(f => f.code)).toContain('unknown_format')
    })

    it('refuses an oversized file on the Drive\'s own size, without downloading it', async () => {
      const cfg = config({ DRIVE_MAX_FILE_BYTES: '100' })
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.blocking[0]).toMatchObject({ code: 'too_large' })
      expect(client.downloaded).toEqual([])
    })

    it('refuses a native Sheet that turns out to be over the limit while it is being exported, and leaves no file behind', async () => {
      const cfg = config({ DRIVE_MAX_FILE_BYTES: '2000' })
      const client = driveWith({ 'Relatório_2026': { sheet: xlsxBuffer([completeAugust()]) } })
      const row = await tracked(client, cfg, 'Relatório_2026')
      const before = workspaces()

      const report = await validation(client, cfg).validate(row.id)

      expect(client.exported).toHaveLength(1)
      expect(report?.blocking[0]).toMatchObject({ code: 'too_large' })
      expect(workspaces()).toEqual(before)
    })

    it('accepts the same file once the limit is raised', async () => {
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const cfg = config({ DRIVE_MAX_FILE_BYTES: String(40 * 1024 * 1024) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      expect((await validation(client, cfg).validate(row.id))?.outcome).toBe('passed')
    })

    it('never reads a synthetic file: it is refused on its name, with no download at all', async () => {
      const cfg = config()
      const client = driveWith({ '[TESTE] Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, '[TESTE] Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.blocking[0]).toMatchObject({ code: 'synthetic' })
      expect(client.downloaded).toEqual([])
      expect(client.exported).toEqual([])
    })
  })

  describe('duplicates', () => {
    it('blocks a copy of a report that was already imported, naming the earlier import', async () => {
      const cfg = config()
      const bytes = xlsxBuffer([completeAugust()])
      const client = driveWith({ 'Relatório_2026.xlsx': bytes, 'Cópia de Relatório_2026.xlsx': bytes })
      await new DriveScanService(cfg, client, repository, producer as never).scan('manual')
      const original = await prisma.driveFile.findFirstOrThrow({ where: { name: 'Relatório_2026.xlsx' } })
      const copy = await prisma.driveFile.findFirstOrThrow({ where: { name: 'Cópia de Relatório_2026.xlsx' } })
      const service = validation(client, cfg)

      const first = await service.validate(original.id)
      await prisma.driveFile.update({
        where: { id: original.id },
        data: { status: 'imported', imported_sha256: first!.contentSha256, imported_file_type: 'sales', imported_period: '2026-08', imported_fingerprint: original.fingerprint, confirmed_at: new Date('2026-09-10T12:00:00Z') },
      })
      const report = await service.validate(copy.id)

      expect(report?.outcome).toBe('blocked')
      expect(report?.blocking[0]).toMatchObject({ code: 'duplicate', details: { of: original.id, path: 'agosto-26/Relatório_2026.xlsx' } })
      expect((await prisma.driveFile.findUniqueOrThrow({ where: { id: copy.id } })).duplicate_of_id).toBe(original.id)
    })

    it('does not treat a corrected report as a duplicate', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      const service = validation(client, cfg)
      const first = await service.validate(row.id)
      await prisma.driveFile.update({
        where: { id: row.id },
        data: { status: 'imported', imported_sha256: first!.contentSha256, imported_file_type: 'sales', imported_period: '2026-08', imported_fingerprint: row.fingerprint },
      })

      const parent = (await (async () => { const out = []; for await (const i of client.listFolder('root')) out.push(i); return out })())[0]
      const fileId = await (async () => { for await (const i of client.listFolder(parent.id)) return i.id })()
      client.edit(fileId!, xlsxBuffer([salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, MON_TO_FRI) }), supplySheet('x', 'y', at(2026, 8, 1))]))
      await new DriveScanService(cfg, client, repository, producer as never).scan('manual')
      const report = await service.validate(row.id)

      expect(report?.blocking.map(f => f.code)).not.toContain('duplicate')
    })
  })

  describe('coverage needs validation instead of blocking', () => {
    it('flags a store that is missing two weeks and lists it with the dates', async () => {
      const cfg = config()
      const sheet = salesSheetFor(AUGUST, {
        [ADM]: range(1, 31),
        [TAIPAS]: daysOn(AUGUST, MON_TO_FRI, range(10, 21)),
      })
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([sheet]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.outcome).toBe('needs_validation')
      expect(report?.blocking).toEqual([])
      const lowStore = report?.inconsistencies.find(i => i.code === 'low_store_coverage')
      expect(lowStore?.details).toMatchObject({ store: TAIPAS, expectedDays: 21, coveredDays: 11 })
      expect((lowStore?.details as { missingDates: string[] }).missingDates[0]).toBe('2026-08-10')
      expect((await prisma.driveFile.findFirstOrThrow({ where: { name: 'Relatório_2026.xlsx' } })).validation_status).toBe('needs_validation')
    })

    it('does not penalise a store that never sells on weekends', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report?.stores.find(s => s.name === TAIPAS)).toMatchObject({ normalWeekdays: MON_TO_FRI, expectedDays: 21, coveredDays: 21, coverage: 1 })
    })
  })

  describe('a restocking report', () => {
    it('passes on period identity alone, and the structure sets the type even when the name did not', async () => {
      const cfg = config()
      const workbook = xlsxBuffer([
        supplySheet('Operação 1', '[TESTE] Loja ADM', at(2026, 7, 2)),
        supplySheet('Operação 2', '[TESTE] Loja Taipas', at(2026, 7, 20)),
      ])
      const client = driveWith({ 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx': workbook }, 'julho-26')
      const row = await tracked(client, cfg, 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')

      const report = await validation(client, cfg).validate(row.id)

      expect(report).toMatchObject({ outcome: 'passed', format: 'supply', fileType: 'supply', period: '2026-07', fileCoverage: null, stores: [] })
    })
  })

  describe('suggestions refined by the content', () => {
    it('fills an empty period from the dates in the file, and says where it came from', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) }, 'arquivo-morto')
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      expect(row.suggested_period).toBeNull()

      await validation(client, cfg).validate(row.id)

      expect(await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        suggested_period: '2026-08',
        suggested_file_type: 'sales',
        suggestion_note: 'derived_from_content',
      })
    })

    it('lets the structure of a file win over its name for the type', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([supplySheet('Operação 1', ADM, at(2026, 8, 3))]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      expect(row.suggested_file_type).toBe('sales') // the generic name said sales

      await validation(client, cfg).validate(row.id)

      expect((await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).suggested_file_type).toBe('supply')
    })
  })

  describe('when things go wrong', () => {
    it('marks the validation failed with the reason when the Drive errors, and can be retried', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      client.failDownload((await (async () => { for await (const m of client.listFolder('root')) { for await (const f of client.listFolder(m.id)) return f.id } })())!, new Error('quota exceeded'))
      const before = workspaces()

      expect(await validation(client, cfg).validate(row.id)).toBeNull()

      expect(await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ validation_status: 'failed', error: 'quota exceeded' })
      expect(workspaces()).toEqual(before)
    })

    it('treats a file that was only touched, not edited, as still the version that was imported', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026': { sheet: xlsxBuffer([completeAugust()]) } })
      const row = await tracked(client, cfg, 'Relatório_2026')
      const service = validation(client, cfg)
      const first = await service.validate(row.id)
      await prisma.driveFile.update({
        where: { id: row.id },
        data: { status: 'imported', imported_sha256: first!.contentSha256, imported_file_type: 'sales', imported_period: '2026-08', imported_fingerprint: row.fingerprint },
      })
      const id = await (async () => { for await (const m of client.listFolder('root')) { for await (const f of client.listFolder(m.id)) return f.id } })()
      client.touch(id!)
      await new DriveScanService(cfg, client, repository, producer as never).scan('manual')
      expect((await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('changed')

      await service.validate(row.id)

      expect(await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'imported', validation_status: 'none' })
    })

    it('does nothing for a file being imported, or one that went missing', async () => {
      const cfg = config()
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const row = await tracked(client, cfg, 'Relatório_2026.xlsx')
      await prisma.driveFile.update({ where: { id: row.id }, data: { status: 'importing' } })

      expect(await validation(client, cfg).validate(row.id)).toBeNull()
      expect(client.downloaded).toEqual([])
    })
  })

  it('keeps the report separate from the content that produced it', async () => {
    const cfg = config()
    const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
    const row = await tracked(client, cfg, 'Relatório_2026.xlsx')

    await validation(client, cfg).validate(row.id)
    const stored = (await prisma.driveFile.findUniqueOrThrow({ where: { id: row.id } })).validation_report as unknown as StoredValidation

    expect(Object.keys(stored).sort()).toEqual(['content', 'report'])
    expect(stored.content.storeDays['2026-08'][ADM]).toMatchObject({ rows: 62 })
  })
})
