import 'reflect-metadata'
import { HoldItBullMQBroker } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../../src/modules/db-client/prisma-client.service'
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service'
import { loadDriveConfig, type DriveConfig } from '../../src/modules/drive-source/config/drive.config'
import { DriveImportService } from '../../src/modules/drive-source/services/drive-import.service'
import { DriveRepository } from '../../src/modules/drive-source/services/drive.repository'
import { DriveScanService } from '../../src/modules/drive-source/services/drive-scan.service'
import { DriveValidationService } from '../../src/modules/drive-source/services/drive-validation.service'
import { InMemoryDriveClient } from '../../src/modules/drive-source/testing/in-memory-drive.client'
import { daysOn, range, salesSheetFor, supplySheet, at, xlsxBuffer } from '../../src/modules/drive-source/testing/workbook-fixtures'
import type { ImportDriveFileRequest } from '../../src/modules/drive-source/types/drive-file.types'
import { integrationDatabaseUrl } from '../support/test-database'

const AUGUST = '2026-08'
const MON_TO_FRI = [1, 2, 3, 4, 5]
// Synthetic store names, prefixed so they can never be mistaken for real stores.
const ADM = '[TESTE] Loja ADM'
const TAIPAS = '[TESTE] Loja Taipas'

const completeAugust = () => salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, MON_TO_FRI) })
const taipasMissingTwoWeeks = () =>
  salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, MON_TO_FRI, range(10, 21)) })

const request = (overrides: Partial<ImportDriveFileRequest> = {}): ImportDriveFileRequest => ({
  file_type: 'sales',
  period: AUGUST,
  confirmed_by: 'ana@example.com',
  ...overrides,
})

/** The body a refusal carries: the admin reacts to its `code`. */
const refusedWith = (code: string) => ({ response: expect.objectContaining({ code }) })

/** The real repository, ingestion service and database (a THROWAWAY one), with a fake Drive, S3 and queue. */
describe('Drive import', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let repository: DriveRepository
  let ingestions: IngestionService
  const producer = { enqueueImport: jest.fn(), enqueueValidation: jest.fn() }
  const s3 = { uploadFile: jest.fn() }
  const queued: { queueName: string; message: unknown }[] = []

  const config = (extra: Record<string, unknown> = {}): DriveConfig =>
    loadDriveConfig({
      GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'a@b.c', private_key: 'k' })).toString('base64'),
      DRIVE_AUTO_VALIDATE: 'false',
      ...extra,
    })

  const services = (client: InMemoryDriveClient, cfg: DriveConfig = config()) => {
    const validation = new DriveValidationService(cfg, client, repository)
    validation.clock = () => new Date('2026-09-19T15:00:00Z')
    const imports = new DriveImportService(cfg, client, repository, validation, producer as never, s3 as never, ingestions)
    imports.clock = () => new Date('2026-09-19T15:00:00Z')
    const scan = () => new DriveScanService(cfg, client, repository, producer as never).scan('manual')
    return { validation, imports, scan }
  }

  const driveWith = (files: Record<string, Buffer | string | { sheet: Buffer }>, folder = 'agosto-26') =>
    InMemoryDriveClient.fromTree('root', { [folder]: files })

  const idOf = async (client: InMemoryDriveClient, name: string) => {
    for await (const month of client.listFolder('root')) {
      for await (const item of client.listFolder(month.id)) if (item.name === name) return item.id
    }
    throw new Error(`not in the fake Drive: ${name}`)
  }

  const row = (name: string) => prisma.driveFile.findFirstOrThrow({ where: { name } })

  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl()
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [
        DriveRepository,
        IngestionService,
        {
          provide: HoldItBullMQBroker,
          useValue: {
            holdIt: async (call: { queueName: string; message: unknown }) => {
              queued.push(call)
              return { id: '1' }
            },
          },
        },
        { provide: S3Service, useValue: s3 },
      ],
    }).compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    repository = app.get(DriveRepository)
    ingestions = app.get(IngestionService)
  }, 60000)

  beforeEach(() => {
    producer.enqueueImport.mockReset().mockResolvedValue(undefined)
    producer.enqueueValidation.mockReset().mockResolvedValue(undefined)
    s3.uploadFile.mockReset().mockResolvedValue({})
    queued.length = 0
  })

  afterEach(async () => {
    await prisma.driveFile.deleteMany()
    await prisma.driveScanRun.deleteMany()
    await prisma.ingestion.deleteMany()
  })

  afterAll(async () => {
    await app.close()
  })

  /** Scans the fake Drive, validates the file, and returns everything a test needs to import it. */
  async function ready(files: Record<string, Buffer | string | { sheet: Buffer }>, name = 'Relatório_2026.xlsx', folder = 'agosto-26', cfg = config()) {
    const client = driveWith(files, folder)
    const svc = services(client, cfg)
    await svc.scan()
    const file = await row(name)
    await svc.validation.validate(file.id)
    return { client, file: await row(name), ...svc }
  }

  describe('a normal import', () => {
    it('is accepted at once: the request records and queues, and writes nothing to storage or Ingestion', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      const response = await imports.requestImport(file.id, request(), 'corr-1')

      expect(response).toEqual({ id: file.id, status: 'importing' })
      expect(producer.enqueueImport).toHaveBeenCalledWith({ fileId: file.id }, 'corr-1')
      expect(s3.uploadFile).not.toHaveBeenCalled()
      expect(await prisma.ingestion.count()).toBe(0)
      expect(await row('Relatório_2026.xlsx')).toMatchObject({
        status: 'importing',
        confirmed_by: 'ana@example.com',
        import_file_type: 'sales',
        import_period: AUGUST,
      })
    })

    it('creates an ordinary ingestion through the existing path and links the Drive file to it', async () => {
      const bytes = xlsxBuffer([completeAugust()])
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': bytes })

      await imports.requestImport(file.id, request(), 'corr-1')
      await imports.runImport(file.id, 'corr-1')

      const ingestion = await prisma.ingestion.findFirstOrThrow()
      expect(ingestion).toMatchObject({ file_type: 'sales', period: AUGUST, store_id: null, status: 'accepted', original_name: 'Relatório_2026.xlsx', correlation_id: 'corr-1' })
      expect(ingestion.object_key).toMatch(/^ingestions\/2026-08\/network\/[0-9a-f-]{36}-Relatório_2026\.xlsx$/)

      expect(s3.uploadFile).toHaveBeenCalledTimes(1)
      const [key, body, contentType] = s3.uploadFile.mock.calls[0]
      expect(key).toBe(ingestion.object_key)
      expect(Buffer.compare(body, bytes)).toBe(0)
      expect(contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

      expect(queued).toEqual([expect.objectContaining({ queueName: 'ingestion.parse-file', message: { ingestionId: ingestion.id, correlationId: 'corr-1' } })])

      expect(await row('Relatório_2026.xlsx')).toMatchObject({
        status: 'imported',
        imported_ingestion_id: ingestion.id,
        imported_file_type: 'sales',
        imported_period: AUGUST,
        imported_sha256: file.content_sha256,
        imported_fingerprint: file.fingerprint,
        import_file_type: null,
        import_period: null,
        error: null,
      })
    })

    it('imports a restocking report with no store, the same way', async () => {
      const workbook = xlsxBuffer([supplySheet('Operação 1', ADM, at(2026, 7, 2)), supplySheet('Operação 2', TAIPAS, at(2026, 7, 20))])
      const { imports, file } = await ready({ 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx': workbook }, 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx', 'julho-26')

      await imports.requestImport(file.id, request({ file_type: 'supply', period: '2026-07' }))
      await imports.runImport(file.id)

      expect(await prisma.ingestion.findFirstOrThrow()).toMatchObject({ file_type: 'supply', period: '2026-07', store_id: null })
    })

    it('uploads a native Google Sheet as an .xlsx, since it has no extension of its own', async () => {
      const { imports, file } = await ready({ 'Relatório_2026': { sheet: xlsxBuffer([completeAugust()]) } }, 'Relatório_2026')

      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      const ingestion = await prisma.ingestion.findFirstOrThrow()
      expect(ingestion.original_name).toBe('Relatório_2026.xlsx')
      expect(ingestion.object_key).toMatch(/-Relatório_2026\.xlsx$/)
    })

    it('ignores a job for a file that nobody is importing: a stale or repeated job does nothing', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      await imports.runImport(file.id)

      expect(s3.uploadFile).not.toHaveBeenCalled()
      expect(await prisma.ingestion.count()).toBe(0)
      expect((await row('Relatório_2026.xlsx')).status).toBe('new')
    })
  })

  describe('what is refused, and what it leaves behind', () => {
    it('refuses a type or period that is not valid', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      await expect(imports.requestImport(file.id, request({ file_type: 'cost' as never }))).rejects.toMatchObject(refusedWith('invalid_file_type'))
      await expect(imports.requestImport(file.id, request({ period: '2026-13' }))).rejects.toMatchObject(refusedWith('invalid_period'))
      await expect(imports.requestImport(file.id, request({ period: 'agosto' }))).rejects.toMatchObject(refusedWith('invalid_period'))
      expect((await row('Relatório_2026.xlsx')).status).toBe('new')
    })

    it('refuses an unknown file', async () => {
      const { imports } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      await expect(imports.requestImport('00000000-0000-0000-0000-000000000000', request())).rejects.toMatchObject(refusedWith('not_found'))
    })

    it('refuses a synthetic file outright, and writes nothing', async () => {
      const { imports, file } = await ready({ '[TESTE] Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) }, '[TESTE] Relatório_2026.xlsx')

      await expect(imports.requestImport(file.id, request())).rejects.toMatchObject(refusedWith('synthetic_file'))
      expect(producer.enqueueImport).not.toHaveBeenCalled()
      expect((await row('[TESTE] Relatório_2026.xlsx')).status).toBe('new')
    })

    it('refuses a blocked file at once, naming the reason: the content is August, the person said July', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      const refusal = await imports.requestImport(file.id, request({ period: '2026-07' })).catch(e => e)

      expect(refusal.response).toMatchObject({ code: 'blocked', blocking: [expect.objectContaining({ code: 'period_mismatch' })] })
      expect(producer.enqueueImport).not.toHaveBeenCalled()
    })

    it('fails a file that was never validated when the job recomputes the checks — and nothing has been written before that', async () => {
      const client = driveWith({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      const { imports, scan } = services(client)
      await scan()
      const file = await row('Relatório_2026.xlsx') // never validated

      await imports.requestImport(file.id, request({ period: '2026-07' })) // nothing stored to refuse it on
      await imports.runImport(file.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'error', error: expect.stringMatching(/2026-08/), validation_status: 'blocked' })
      expect(s3.uploadFile).not.toHaveBeenCalled()
      expect(await prisma.ingestion.count()).toBe(0)
      expect((await row('Relatório_2026.xlsx')).imported_sha256).toBeNull()
    })

    it('refuses a file whose status does not allow it', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await prisma.driveFile.update({ where: { id: file.id }, data: { status: 'ignored' } })

      await expect(imports.requestImport(file.id, request())).rejects.toMatchObject(refusedWith('not_importable'))
    })
  })

  describe('inconsistencies must be reviewed, and the review is bound to the content reviewed', () => {
    const withGap = () => xlsxBuffer([taipasMissingTwoWeeks()])

    it('refuses to import a file that needs validation without the confirmation, and says what to review', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': withGap() })
      expect(file.validation_status).toBe('needs_validation')

      const refusal = await imports.requestImport(file.id, request()).catch(e => e)

      expect(refusal.response).toMatchObject({
        code: 'validation_confirmation_required',
        content_sha256: file.content_sha256,
        inconsistencies: expect.arrayContaining([expect.objectContaining({ code: 'low_store_coverage' })]),
      })
      expect(producer.enqueueImport).not.toHaveBeenCalled()
    })

    it('refuses a confirmation for different content', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': withGap() })

      await expect(imports.requestImport(file.id, request({ confirm_validation: { content_sha256: 'not-the-reviewed-hash' } }))).rejects.toMatchObject(
        refusedWith('validation_confirmation_required'),
      )
    })

    it('imports once the reviewed hash is confirmed, and records who validated it and when', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': withGap() })

      await imports.requestImport(file.id, request({ confirm_validation: { content_sha256: file.content_sha256! } }))
      await imports.runImport(file.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({
        status: 'imported',
        validation_confirmed_by: 'ana@example.com',
        validation_confirmed_sha256: file.content_sha256,
      })
      expect((await row('Relatório_2026.xlsx')).validation_confirmed_at).toBeInstanceOf(Date)
      expect(await prisma.ingestion.count()).toBe(1)
    })

    it('does not let the confirmation ride on a file edited after it was reviewed', async () => {
      const { imports, file, client } = await ready({ 'Relatório_2026.xlsx': withGap() })

      await imports.requestImport(file.id, request({ confirm_validation: { content_sha256: file.content_sha256! } }))
      // The file changes in the Drive between the click and the job: it is still incomplete, but it is not what was reviewed.
      client.edit(await idOf(client, 'Relatório_2026.xlsx'), xlsxBuffer([salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: daysOn(AUGUST, MON_TO_FRI, range(11, 24)) })]))
      await imports.runImport(file.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'error', error: expect.stringMatching(/changed since/) })
      expect(s3.uploadFile).not.toHaveBeenCalled()
      expect(await prisma.ingestion.count()).toBe(0)
    })

    it('does not need a confirmation for a complete file', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      await expect(imports.requestImport(file.id, request())).resolves.toEqual({ id: file.id, status: 'importing' })
    })
  })

  describe('replacing a period that is already ingested', () => {
    const ingested = (status: string) =>
      prisma.ingestion.create({
        data: { id: 'earlier-ingestion', file_type: 'sales', object_key: 'k', original_name: 'antigo.xlsx', period: AUGUST, status, uploaded_at: new Date('2026-09-05T12:00:00Z') },
      })

    it('shows what would be replaced and refuses until replacement is confirmed', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await ingested('completed')

      const refusal = await imports.requestImport(file.id, request()).catch(e => e)

      expect(refusal.response).toMatchObject({
        code: 'replace_confirmation_required',
        would_replace: { ingestion_id: 'earlier-ingestion', status: 'completed', ingested_at: '2026-09-05T12:00:00.000Z' },
      })
      expect(producer.enqueueImport).not.toHaveBeenCalled()
    })

    it('imports once replacement is confirmed', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await ingested('completed')

      await imports.requestImport(file.id, request({ confirm_replace: true }))
      await imports.runImport(file.id)

      expect(await prisma.ingestion.count()).toBe(2)
      expect((await row('Relatório_2026.xlsx')).status).toBe('imported')
    })

    it('does not count an ingestion that failed, or one for another period, as something to replace', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await ingested('failed')

      await expect(imports.requestImport(file.id, request())).resolves.toBeDefined()
    })
  })

  describe('duplicate imports', () => {
    it('lets exactly one of two simultaneous requests through', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      const results = await Promise.allSettled([imports.requestImport(file.id, request()), imports.requestImport(file.id, request())])

      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
      expect(rejected.reason.response).toMatchObject({ code: 'not_importable' })
      expect(producer.enqueueImport).toHaveBeenCalledTimes(1)
    })

    it('creates one ingestion when two files with identical content are imported at the same time: the index arbitrates', async () => {
      const bytes = xlsxBuffer([completeAugust()])
      const client = driveWith({ 'Relatório_2026.xlsx': bytes, 'Cópia de Relatório_2026.xlsx': bytes })
      const { imports, scan } = services(client)
      await scan()
      const original = await row('Relatório_2026.xlsx')
      const copy = await row('Cópia de Relatório_2026.xlsx')
      // Neither was validated, so neither is refused on stored findings: it comes down to the job.
      await imports.requestImport(original.id, request())
      await imports.requestImport(copy.id, request())

      await Promise.all([imports.runImport(original.id), imports.runImport(copy.id)])

      expect(await prisma.ingestion.count()).toBe(1)
      expect(s3.uploadFile).toHaveBeenCalledTimes(1)
      const statuses = [(await row('Relatório_2026.xlsx')).status, (await row('Cópia de Relatório_2026.xlsx')).status].sort()
      expect(statuses).toEqual(['error', 'imported'])
      const loser = (await prisma.driveFile.findMany({ where: { status: 'error' } }))[0]
      expect(loser.error).toMatch(/same content|identical/i)
    })

    it('blocks a copy once the original is imported, naming the earlier import', async () => {
      const bytes = xlsxBuffer([completeAugust()])
      const client = driveWith({ 'Relatório_2026.xlsx': bytes, 'Cópia de Relatório_2026.xlsx': bytes })
      const { imports, scan, validation } = services(client)
      await scan()
      const original = await row('Relatório_2026.xlsx')
      await validation.validate(original.id)
      await imports.requestImport(original.id, request())
      await imports.runImport(original.id)

      const copy = await row('Cópia de Relatório_2026.xlsx')
      const report = await validation.validate(copy.id)

      expect(report?.blocking[0]).toMatchObject({ code: 'duplicate', details: { of: original.id } })
      await expect(imports.requestImport(copy.id, request())).rejects.toMatchObject(refusedWith('blocked'))
    })

    it('does not propose an unchanged imported file again, and proposes an edited one as a replacement', async () => {
      const { imports, file, client, scan } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      await scan()
      expect((await row('Relatório_2026.xlsx')).status).toBe('imported')

      client.edit(await idOf(client, 'Relatório_2026.xlsx'), xlsxBuffer([salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: range(1, 31) })]))
      await scan()
      expect((await row('Relatório_2026.xlsx')).status).toBe('changed')
    })
  })

  describe('when the import fails, and retrying', () => {
    it('hands the slot back, records the reason and leaves no ingestion when the upload to storage fails', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      s3.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))

      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'error', error: 'storage unavailable', imported_sha256: null, import_file_type: null })
      expect(await prisma.ingestion.count()).toBe(0)
    })

    it('can be retried from error, and produces an ingestion the second time', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      s3.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))
      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'imported', error: null })
      expect(await prisma.ingestion.count()).toBe(1)
    })

    it('keeps what an earlier import recorded when a re-import of the same file fails', async () => {
      const { imports, file, client, scan, validation } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)
      const first = await row('Relatório_2026.xlsx')

      client.edit(await idOf(client, 'Relatório_2026.xlsx'), xlsxBuffer([salesSheetFor(AUGUST, { [ADM]: range(1, 31), [TAIPAS]: range(1, 31) })]))
      await scan()
      await validation.validate(first.id)
      s3.uploadFile.mockRejectedValueOnce(new Error('storage unavailable'))
      await imports.requestImport(first.id, request({ confirm_replace: true }))
      await imports.runImport(first.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({
        status: 'error',
        imported_sha256: first.imported_sha256,
        imported_ingestion_id: first.imported_ingestion_id,
        imported_period: AUGUST,
      })
    })

    it('can retry an import whose ingestion later failed', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)
      const imported = await row('Relatório_2026.xlsx')
      await prisma.ingestion.update({ where: { id: imported.imported_ingestion_id! }, data: { status: 'failed', error: 'parse failed' } })

      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      const after = await row('Relatório_2026.xlsx')
      expect(after.status).toBe('imported')
      expect(after.imported_ingestion_id).not.toBe(imported.imported_ingestion_id)
      expect(await prisma.ingestion.count()).toBe(2) // the failed one stays as history
    })

    it('cannot re-import a file whose ingestion did not fail', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await imports.requestImport(file.id, request())
      await imports.runImport(file.id)

      await expect(imports.requestImport(file.id, request({ confirm_replace: true }))).rejects.toMatchObject(refusedWith('not_importable'))
    })

    it('marks the file as failed, not stuck importing, when the job cannot be queued', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      producer.enqueueImport.mockRejectedValueOnce(new Error('redis down'))

      await expect(imports.requestImport(file.id, request())).rejects.toMatchObject({ status: 503, response: expect.objectContaining({ code: 'queue_unavailable' }) })

      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'error', import_file_type: null })
    })

    it('records a Drive failure during the import', async () => {
      const { imports, file, client } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await imports.requestImport(file.id, request())
      client.failDownload(await idOf(client, 'Relatório_2026.xlsx'), new Error('quota exceeded'))

      await imports.runImport(file.id)

      expect(await row('Relatório_2026.xlsx')).toMatchObject({ status: 'error', error: 'quota exceeded' })
      expect(s3.uploadFile).not.toHaveBeenCalled()
    })
  })

  describe('ignoring and restoring', () => {
    it('ignores a waiting file, and restores it as new', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })

      expect(await imports.setIgnored(file.id, true)).toEqual({ id: file.id, status: 'ignored' })
      expect(await imports.setIgnored(file.id, false)).toEqual({ id: file.id, status: 'new' })
    })

    it('restores a file that had an earlier import as changed', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await prisma.driveFile.update({ where: { id: file.id }, data: { status: 'ignored', imported_fingerprint: 'earlier' } })

      expect((await imports.setIgnored(file.id, false)).status).toBe('changed')
    })

    it('cannot ignore an imported file or one being imported, nor restore one that is not ignored', async () => {
      const { imports, file } = await ready({ 'Relatório_2026.xlsx': xlsxBuffer([completeAugust()]) })
      await prisma.driveFile.update({ where: { id: file.id }, data: { status: 'importing' } })

      await expect(imports.setIgnored(file.id, true)).rejects.toMatchObject(refusedWith('not_ignorable'))
      await expect(imports.setIgnored(file.id, false)).rejects.toMatchObject(refusedWith('not_ignored'))
    })
  })
})
