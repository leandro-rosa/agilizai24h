import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../../src/modules/db-client/prisma-client.service'
import { DriveRepository } from '../../src/modules/drive-source/services/drive.repository'
import { integrationDatabaseUrl } from '../support/test-database'

/**
 * Persistence guarantees of the Drive source, asserted against a THROWAWAY
 * Postgres (see test/support/with-test-db.sh) — never the real database.
 */
describe('Drive source persistence', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let repository: DriveRepository

  const file = (overrides: Record<string, unknown> = {}) => ({
    drive_file_id: `drive-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Relatório_2026.xlsx',
    path: 'agosto-26',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fingerprint: 'md5-a',
    ...overrides,
  })

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

  describe('the migration', () => {
    it('is additive: it creates the two Drive tables and never alters or drops anything', () => {
      const sql = readFileSync(
        join(__dirname, '../../prisma/migrations/20260919163000_add_drive_source/migration.sql'),
        'utf8',
      )

      expect(sql).toMatch(/CREATE TABLE "drive_file"/)
      expect(sql).toMatch(/CREATE TABLE "drive_scan_run"/)
      expect(sql).not.toMatch(/ALTER TABLE/)
      expect(sql).not.toMatch(/DROP /)
      expect(sql).not.toMatch(/"ingestion"/)
    })

    it('leaves the Ingestion table exactly as it was', async () => {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'ingestion'`

      expect(columns.map(c => c.column_name).filter(name => name.startsWith('drive') || name.startsWith('imported'))).toEqual([])
    })
  })

  describe('one row per Drive file', () => {
    it('refuses the same Drive file id twice', async () => {
      await repository.create(file({ drive_file_id: 'same-id' }))

      await expect(repository.create(file({ drive_file_id: 'same-id' }))).rejects.toThrow()
    })
  })

  describe('duplicate content is refused by the database, not only by the application', () => {
    const imported = (overrides: Record<string, unknown> = {}) =>
      file({
        status: 'imported',
        imported_sha256: 'sha-a',
        imported_file_type: 'sales',
        imported_period: '2026-08',
        ...overrides,
      })

    it('refuses a second import of the same content for the same type and period', async () => {
      await repository.create(imported())

      await expect(repository.create(imported())).rejects.toThrow()
    })

    it('allows the same content for another period or another type', async () => {
      await repository.create(imported())

      await expect(repository.create(imported({ imported_period: '2026-09' }))).resolves.toBeDefined()
      await expect(repository.create(imported({ imported_file_type: 'supply' }))).resolves.toBeDefined()
    })

    it('never collides for files that were not imported: their columns are NULL', async () => {
      await repository.create(file())
      await repository.create(file())

      expect(await prisma.driveFile.count()).toBe(2)
    })

    it('finds the earlier import of identical content, excluding the file being checked', async () => {
      const earlier = await repository.create(imported())

      expect((await repository.findImportedByContent('sha-a', 'sales', '2026-08'))?.id).toBe(earlier.id)
      expect(await repository.findImportedByContent('sha-a', 'sales', '2026-08', earlier.id)).toBeNull()
      expect(await repository.findImportedByContent('sha-a', 'sales', '2026-07')).toBeNull()
      expect(await repository.findImportedByContent('sha-other', 'sales', '2026-08')).toBeNull()
    })
  })

  describe('claimForImport', () => {
    const claim = { confirmedBy: 'ana@example.com', fileType: 'sales', period: '2026-08' }

    it('lets exactly one of two simultaneous claims win', async () => {
      const created = await repository.create(file({ status: 'new' }))

      const results = await Promise.all([
        repository.claimForImport(created.id, ['new', 'changed', 'error'], claim),
        repository.claimForImport(created.id, ['new', 'changed', 'error'], claim),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      expect((await repository.findById(created.id))?.status).toBe('importing')
    })

    it('refuses a file that is not in an importable status', async () => {
      const created = await repository.create(file({ status: 'ignored' }))

      expect(await repository.claimForImport(created.id, ['new', 'changed', 'error'], claim)).toBe(false)
      expect((await repository.findById(created.id))?.status).toBe('ignored')
    })

    it('records who confirmed it and, when validation was reviewed, the hash that was reviewed', async () => {
      const created = await repository.create(file({ status: 'changed' }))

      await repository.claimForImport(created.id, ['changed'], { ...claim, validationConfirmedSha256: 'sha-reviewed' })
      const after = await repository.findById(created.id)

      expect(after).toMatchObject({
        confirmed_by: 'ana@example.com',
        import_file_type: 'sales',
        import_period: '2026-08',
        validation_confirmed_by: 'ana@example.com',
        validation_confirmed_sha256: 'sha-reviewed',
      })
      expect(after?.confirmed_at).toBeInstanceOf(Date)
    })
  })

  describe('scan runs', () => {
    it('keeps only the newest runs when pruning', async () => {
      for (let i = 0; i < 35; i++) {
        await prisma.driveScanRun.create({
          data: { trigger: 'schedule', outcome: 'ok', started_at: new Date(Date.UTC(2026, 8, 1, 0, i)) },
        })
      }

      expect(await repository.pruneScanRuns(30)).toBe(5)
      expect(await prisma.driveScanRun.count()).toBe(30)
      expect((await repository.latestScanRun())?.started_at.toISOString()).toBe('2026-09-01T00:34:00.000Z')
    })

    it('deletes nothing while there are not more runs than the limit', async () => {
      await prisma.driveScanRun.create({ data: { trigger: 'manual', outcome: 'ok' } })

      expect(await repository.pruneScanRuns(30)).toBe(0)
    })

    it('reports a running scan until it is finished', async () => {
      const run = await repository.startScanRun('manual')
      expect(await repository.hasRunningScan()).toBe(true)

      await repository.finishScanRun(run.id, { outcome: 'ok', filesSeen: 3, skippedByPattern: 20, newCount: 2, changedCount: 0 })

      expect(await repository.hasRunningScan()).toBe(false)
      expect(await repository.latestScanRun()).toMatchObject({ outcome: 'ok', files_seen: 3, skipped_by_pattern: 20 })
    })
  })

  describe('what an import would replace', () => {
    const ingestion = (overrides: Record<string, unknown>) => ({
      id: `ing-${Math.random().toString(36).slice(2, 10)}`,
      file_type: 'sales',
      object_key: 'k',
      original_name: 'f.xlsx',
      period: '2026-08',
      ...overrides,
    })

    it('is the latest completed or partially completed ingestion of the same type and period', async () => {
      await prisma.ingestion.create({ data: ingestion({ id: 'old', status: 'completed', uploaded_at: new Date('2026-09-01') }) })
      await prisma.ingestion.create({ data: ingestion({ id: 'new', status: 'partially_completed', uploaded_at: new Date('2026-09-10') }) })
      await prisma.ingestion.create({ data: ingestion({ id: 'failed', status: 'failed', uploaded_at: new Date('2026-09-15') }) })
      await prisma.ingestion.create({ data: ingestion({ id: 'other-period', status: 'completed', period: '2026-07' }) })

      expect((await repository.findReplaceableIngestion('sales', '2026-08'))?.id).toBe('new')
      expect(await repository.findReplaceableIngestion('supply', '2026-08')).toBeNull()
    })

    it('finds ingestions by id for the derived status of imported files', async () => {
      await prisma.ingestion.create({ data: ingestion({ id: 'ing-1', status: 'failed', error: 'boom' }) })

      expect(await repository.findIngestions(['ing-1', 'missing'])).toMatchObject([{ id: 'ing-1', status: 'failed', error: 'boom' }])
      expect(await repository.findIngestions([])).toEqual([])
    })
  })
})
