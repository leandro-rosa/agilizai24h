import 'reflect-metadata'
import { HoldItBullMQBroker } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { DbClientModule } from '../../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../../src/modules/db-client/prisma-client.service'
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service'
import { DriveFilesController } from '../../src/modules/drive-source/controllers/drive-files.controller'
import { DRIVE_CONFIG, loadDriveConfig, type DriveConfig } from '../../src/modules/drive-source/config/drive.config'
import { DRIVE_CLIENT } from '../../src/modules/drive-source/services/drive-client'
import { DriveFilesQueryService } from '../../src/modules/drive-source/services/drive-files-query.service'
import { DriveImportService } from '../../src/modules/drive-source/services/drive-import.service'
import { DriveProducer } from '../../src/modules/drive-source/services/drive.producer'
import { DriveRepository } from '../../src/modules/drive-source/services/drive.repository'
import { DriveScanService } from '../../src/modules/drive-source/services/drive-scan.service'
import { DriveValidationService } from '../../src/modules/drive-source/services/drive-validation.service'
import { InMemoryDriveClient } from '../../src/modules/drive-source/testing/in-memory-drive.client'
import { daysOn, range, salesSheetFor, xlsxBuffer } from '../../src/modules/drive-source/testing/workbook-fixtures'
import { integrationDatabaseUrl } from '../support/test-database'

const AUGUST = '2026-08'
const ADM = '[TESTE] Loja ADM'
const TAIPAS = '[TESTE] Loja Taipas'
const SECRET_KEY = 'PRIVATE-KEY-MATERIAL-THAT-MUST-NEVER-BE-RETURNED'

const completeAugust = () => salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, [1, 2, 3, 4, 5]) })
const withGap = () => salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, [1, 2, 3, 4, 5], range(10, 21)) })

/** The controller over the real services and a THROWAWAY database, reached through real HTTP handling. */
describe('Drive files HTTP API', () => {
  let app: NestFastifyApplication
  let prisma: PrismaClientService
  const producer = { enqueueScan: jest.fn(), enqueueValidation: jest.fn(), enqueueImport: jest.fn() }
  const s3 = { uploadFile: jest.fn() }
  let client: InMemoryDriveClient
  let cfg: DriveConfig

  const credential = () =>
    Buffer.from(JSON.stringify({ client_email: 'reader@project.iam.gserviceaccount.com', private_key: SECRET_KEY })).toString('base64')

  const config = (extra: Record<string, unknown> = {}) =>
    loadDriveConfig({ GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: credential(), DRIVE_AUTO_VALIDATE: 'false', ...extra })

  const http = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const response = await app.inject({ method, url, payload: payload as never })
    return { status: response.statusCode, body: response.body ? response.json() : undefined, raw: response.body }
  }

  const freshDrive = (sheet = completeAugust()) =>
    InMemoryDriveClient.fromTree('root', { 'agosto-26': { 'Relatório_2026.xlsx': xlsxBuffer([sheet]) } })

  /** The app holds this, and it always delegates to the CURRENT fake Drive: each test starts from a fresh one. */
  const drive = {
    listFolder: (id: string) => client.listFolder(id),
    download: (...args: Parameters<InMemoryDriveClient['download']>) => client.download(...args),
    exportSheet: (...args: Parameters<InMemoryDriveClient['exportSheet']>) => client.exportSheet(...args),
  }

  const build = async (driveConfig: DriveConfig) => {
    cfg = driveConfig
    client = freshDrive()
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      controllers: [DriveFilesController],
      providers: [
        DriveRepository,
        DriveFilesQueryService,
        DriveImportService,
        DriveValidationService,
        IngestionService,
        { provide: DRIVE_CONFIG, useValue: cfg },
        { provide: DRIVE_CLIENT, useValue: drive },
        { provide: DriveProducer, useValue: producer },
        { provide: S3Service, useValue: s3 },
        { provide: HoldItBullMQBroker, useValue: { holdIt: jest.fn().mockResolvedValue({ id: '1' }) } },
      ],
    }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    prisma = app.get(PrismaClientService)
  }

  const scanAndValidate = async () => {
    await new DriveScanService(cfg, client, app.get(DriveRepository), producer as never).scan('manual')
    const file = await prisma.driveFile.findFirstOrThrow({ where: { name: 'Relatório_2026.xlsx' } })
    const validation = app.get(DriveValidationService)
    validation.clock = () => new Date('2026-09-19T15:00:00Z')
    await validation.validate(file.id)
    return prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } })
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl()
    await build(config())
  }, 60000)

  beforeEach(() => {
    client = freshDrive()
    producer.enqueueScan.mockReset().mockResolvedValue('queued')
    producer.enqueueValidation.mockReset().mockResolvedValue(undefined)
    producer.enqueueImport.mockReset().mockResolvedValue(undefined)
    s3.uploadFile.mockReset().mockResolvedValue({})
  })

  afterEach(async () => {
    await prisma.driveFile.deleteMany()
    await prisma.driveScanRun.deleteMany()
    await prisma.ingestion.deleteMany()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /drive-files', () => {
    it('is empty before any scan', async () => {
      expect(await http('GET', '/drive-files')).toMatchObject({ status: 200, body: [] })
    })

    it('lists a tracked file with its suggestions and validation result, and none of the aggregated content behind it', async () => {
      const file = await scanAndValidate()

      const { status, body } = await http('GET', '/drive-files')

      expect(status).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        id: file.id,
        name: 'Relatório_2026.xlsx',
        path: 'agosto-26',
        status: 'new',
        suggested_file_type: 'sales',
        suggested_period: AUGUST,
        validation_status: 'passed',
        validation: expect.objectContaining({ outcome: 'passed', period: AUGUST, fileCoverage: 1 }),
        would_replace: null,
        duplicate_of: null,
      })
      expect(body[0].validation.storeDays).toBeUndefined()
      expect(JSON.stringify(body[0])).not.toContain('dayMask')
    })

    it('filters by status, and ignores anything that is not a status', async () => {
      const file = await scanAndValidate()
      await prisma.driveFile.update({ where: { id: file.id }, data: { status: 'ignored' } })

      expect((await http('GET', '/drive-files?status=new')).body).toEqual([])
      expect((await http('GET', '/drive-files?status=ignored')).body).toHaveLength(1)
      expect((await http('GET', '/drive-files?status=new,ignored')).body).toHaveLength(1)
      expect((await http('GET', '/drive-files?status=bogus')).body).toHaveLength(1)
    })

    it('shows what importing a waiting file would replace', async () => {
      await scanAndValidate()
      await prisma.ingestion.create({ data: { id: 'earlier', file_type: 'sales', object_key: 'k', original_name: 'a.xlsx', period: AUGUST, status: 'completed', uploaded_at: new Date('2026-09-05T12:00:00Z') } })

      const { body } = await http('GET', '/drive-files')

      expect(body[0].would_replace).toEqual({ ingestion_id: 'earlier', ingested_at: '2026-09-05T12:00:00.000Z', status: 'completed' })
    })

    it('shows an imported file whose ingestion failed as an error, with the ingestion\'s reason, so it can be retried', async () => {
      const file = await scanAndValidate()
      await prisma.ingestion.create({ data: { id: 'ing-1', file_type: 'sales', object_key: 'k', original_name: 'a.xlsx', period: AUGUST, status: 'failed', error: 'parse failed: missing column' } })
      await prisma.driveFile.update({ where: { id: file.id }, data: { status: 'imported', imported_ingestion_id: 'ing-1' } })

      const { body } = await http('GET', '/drive-files')

      expect(body[0]).toMatchObject({ status: 'error', error: 'parse failed: missing column', imported_ingestion_id: 'ing-1' })
      // …while what is stored is still "imported": the ingestion is not watched, only read.
      expect((await prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } })).status).toBe('imported')
    })
  })

  describe('GET /drive-files/status', () => {
    it('reports the source and the last scan, and never any credential', async () => {
      await new DriveScanService(cfg, client, app.get(DriveRepository), producer as never).scan('manual')

      const { status, body, raw } = await http('GET', '/drive-files/status')

      expect(status).toBe(200)
      expect(body).toMatchObject({
        configured: true,
        auto_validate: false,
        max_file_bytes: 25 * 1024 * 1024,
        scan_cron: '0 6 * * *',
        thresholds: cfg.thresholds,
        last_scan: expect.objectContaining({ outcome: 'ok', trigger: 'manual', files_seen: 1, new_count: 1 }),
      })
      for (const secret of [SECRET_KEY, credential(), 'client_email', 'private_key', 'reader@project']) {
        expect(raw).not.toContain(secret)
      }
    })

    it('has no last scan before the first one', async () => {
      expect((await http('GET', '/drive-files/status')).body.last_scan).toBeNull()
    })
  })

  describe('POST /drive-files/scan', () => {
    it('queues a scan and answers 202', async () => {
      expect(await http('POST', '/drive-files/scan')).toMatchObject({ status: 202, body: { status: 'queued' } })
      expect(producer.enqueueScan).toHaveBeenCalledWith({ trigger: 'manual' }, undefined)
    })

    it('says so when a scan is already running instead of queueing a second', async () => {
      producer.enqueueScan.mockResolvedValue('already_running')

      expect((await http('POST', '/drive-files/scan')).body).toEqual({ status: 'already_running' })
    })
  })

  describe('POST /drive-files/:id/validate', () => {
    it('re-evaluates a summarised file for another period at once, with no download', async () => {
      const file = await scanAndValidate()
      const downloads = client.downloaded.length

      const { status, body } = await http('POST', `/drive-files/${file.id}/validate`, { period: '2026-07' })

      expect(status).toBe(200)
      expect(body).toMatchObject({ id: file.id, status: 'evaluated', validation_status: 'blocked' })
      expect(body.validation.blocking[0]).toMatchObject({ code: 'period_mismatch', details: { observedMonth: AUGUST } })
      expect(client.downloaded).toHaveLength(downloads)
      expect(producer.enqueueValidation).not.toHaveBeenCalled()
    })

    it('queues a validation for a file that was never validated, carrying the type and period the person chose', async () => {
      await new DriveScanService(cfg, client, app.get(DriveRepository), producer as never).scan('manual')
      const file = await prisma.driveFile.findFirstOrThrow()

      const { status, body } = await http('POST', `/drive-files/${file.id}/validate`, { file_type: 'sales', period: AUGUST })

      expect(status).toBe(202)
      expect(body).toEqual({ id: file.id, status: 'queued' })
      expect(producer.enqueueValidation).toHaveBeenCalledWith({ fileId: file.id, fileType: 'sales', period: AUGUST }, undefined)
    })

    it('is a 404 for an unknown file, and a 409 for one that is being imported', async () => {
      const file = await scanAndValidate()

      expect((await http('POST', '/drive-files/00000000-0000-0000-0000-000000000000/validate', {})).status).toBe(404)
      await prisma.driveFile.update({ where: { id: file.id }, data: { status: 'importing' } })
      expect(await http('POST', `/drive-files/${file.id}/validate`, {})).toMatchObject({ status: 409, body: { code: 'not_validatable' } })
    })
  })

  describe('POST /drive-files/:id/import', () => {
    const body = (extra: Record<string, unknown> = {}) => ({ file_type: 'sales', period: AUGUST, confirmed_by: 'ana@example.com', ...extra })

    it('accepts a confirmed import with 202 and queues the job', async () => {
      const file = await scanAndValidate()

      const response = await http('POST', `/drive-files/${file.id}/import`, body())

      expect(response).toMatchObject({ status: 202, body: { id: file.id, status: 'importing' } })
      expect(producer.enqueueImport).toHaveBeenCalledTimes(1)
    })

    it('answers a replace with 409 and the body the admin needs to show what is replaced', async () => {
      const file = await scanAndValidate()
      await prisma.ingestion.create({ data: { id: 'earlier', file_type: 'sales', object_key: 'k', original_name: 'a.xlsx', period: AUGUST, status: 'completed', uploaded_at: new Date('2026-09-05T12:00:00Z') } })

      const response = await http('POST', `/drive-files/${file.id}/import`, body())

      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({ code: 'replace_confirmation_required', would_replace: { ingestion_id: 'earlier', status: 'completed' } })
    })

    it('answers unreviewed inconsistencies with 422, the findings and the hash to confirm', async () => {
      client = freshDrive(withGap())
      const file = await scanAndValidate()

      const response = await http('POST', `/drive-files/${file.id}/import`, body())

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({
        code: 'validation_confirmation_required',
        content_sha256: file.content_sha256,
        inconsistencies: expect.arrayContaining([expect.objectContaining({ code: 'low_store_coverage' })]),
      })
    })

    it('answers a blocked file with 422 and the reasons', async () => {
      const file = await scanAndValidate()

      const response = await http('POST', `/drive-files/${file.id}/import`, body({ period: '2026-07' }))

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({ code: 'blocked', blocking: [expect.objectContaining({ code: 'period_mismatch' })] })
    })

    it('answers a bad period with 400 and an unknown file with 404', async () => {
      const file = await scanAndValidate()

      expect(await http('POST', `/drive-files/${file.id}/import`, body({ period: 'agosto' }))).toMatchObject({ status: 400, body: { code: 'invalid_period' } })
      expect((await http('POST', '/drive-files/00000000-0000-0000-0000-000000000000/import', body())).status).toBe(404)
    })

    it('rejects a body with no file_type at the door', async () => {
      const file = await scanAndValidate()

      expect((await http('POST', `/drive-files/${file.id}/import`, { period: AUGUST })).status).toBe(400)
    })

    it('answers a second import of the same file with 409', async () => {
      const file = await scanAndValidate()
      await http('POST', `/drive-files/${file.id}/import`, body())

      expect(await http('POST', `/drive-files/${file.id}/import`, body())).toMatchObject({ status: 409, body: { code: 'not_importable' } })
    })
  })

  describe('POST /drive-files/:id/ignore', () => {
    it('ignores by default and restores with ignored: false', async () => {
      const file = await scanAndValidate()

      expect(await http('POST', `/drive-files/${file.id}/ignore`, {})).toMatchObject({ status: 200, body: { id: file.id, status: 'ignored' } })
      expect(await http('POST', `/drive-files/${file.id}/ignore`, { ignored: false })).toMatchObject({ status: 200, body: { status: 'new' } })
    })
  })

  describe('when the Drive source is not configured', () => {
    beforeAll(async () => {
      await app.close()
      await build(loadDriveConfig({}))
    })

    it('still lists and reports, but refuses to scan or validate', async () => {
      expect((await http('GET', '/drive-files')).body).toEqual([])
      expect((await http('GET', '/drive-files/status')).body).toMatchObject({ configured: false, last_scan: null })
      expect(await http('POST', '/drive-files/scan')).toMatchObject({ status: 409, body: { code: 'not_configured' } })
      expect((await http('POST', '/drive-files/x/validate', {})).status).toBe(409)
    })
  })
})
