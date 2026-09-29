import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { InMemoryDriveClient } from '../src/modules/drive-source/testing/in-memory-drive.client'
import { xlsxBuffer } from '../src/modules/drive-source/testing/workbook-fixtures'
import { TreasuryDriveFilesController } from '../src/modules/treasury-drive-source/controllers/treasury-drive-files.controller'
import { TREASURY_DRIVE_CONFIG, loadTreasuryDriveConfig, type TreasuryDriveConfig } from '../src/modules/treasury-drive-source/config/treasury-drive.config'
import { TreasuryDriveProducer } from '../src/modules/treasury-drive-source/services/treasury-drive.producer'
import { TreasuryDriveRepository } from '../src/modules/treasury-drive-source/services/treasury-drive.repository'
import { TreasuryDriveScanService } from '../src/modules/treasury-drive-source/services/treasury-drive-scan.service'
import type { SheetRows } from '../src/modules/ingestion/utils/read-workbook-rows'

const AUGUST = '2026-08'
const SECRET_KEY = 'PRIVATE-KEY-MATERIAL-THAT-MUST-NEVER-BE-RETURNED'

/**
 * A real native Google Sheet, exported by the real GoogleDriveClient as genuine xlsx — built
 * with xlsxBuffer() rather than a raw CSV/text string, same reasoning as
 * treasury-drive-scan.integration-spec.ts and treasury-drive-import.integration-spec.ts (Tasks
 * 8-9): InMemoryDriveClient.fromTree writes this verbatim, and a raw string would route through
 * a different (CSV-autodetect) reading path the real Drive export never takes.
 */
const c6StatementSheet = (): SheetRows => ({
  sheetName: 'Sheet1',
  rows: [
    ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe'],
    ['2026-08-03', '2026-08-03', 'Pix recebido', 'Pix recebido de ALELO S.A.', 445.93, 0, null, null],
  ],
})

const credential = () =>
  Buffer.from(JSON.stringify({ client_email: 'reader@project.iam.gserviceaccount.com', private_key: SECRET_KEY })).toString('base64')

const enabledConfig = (): TreasuryDriveConfig =>
  loadTreasuryDriveConfig({
    TREASURY_DRIVE_ROOT_FOLDER_ID: 'root',
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: credential(),
    TREASURY_DRIVE_MONTH_FOLDERS: 'agosto',
  })

const disabledConfig = (): TreasuryDriveConfig => loadTreasuryDriveConfig({})

/**
 * The controller over the real repository and the real dev Postgres (DATABASE_URL, port 5438)
 * via DbClientModule/PrismaClientService — same pattern treasury-drive-scan.integration-spec.ts
 * and treasury-drive-import.integration-spec.ts (Tasks 8-9) use, reached through real HTTP
 * handling (mirrors drive-files-api.throwaway-db-spec.ts's own controller-level style, but
 * against the shared dev DB rather than a throwaway container, matching this test's own
 * `test:integration` tier). The producer is mocked, same as that sibling spec does — this test
 * is about the controller/repository/DTO wiring, not the real BullMQ broker.
 */
describe('Treasury Drive files HTTP API', () => {
  let app: NestFastifyApplication
  let prisma: PrismaClientService
  let repository: TreasuryDriveRepository
  const producer = { enqueueScan: jest.fn(), enqueueImport: jest.fn() }

  const http = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const response = await app.inject({ method, url, payload: payload as never })
    return { status: response.statusCode, body: response.body ? response.json() : undefined, raw: response.body }
  }

  const build = async (config: TreasuryDriveConfig) => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      controllers: [TreasuryDriveFilesController],
      providers: [
        TreasuryDriveRepository,
        { provide: TREASURY_DRIVE_CONFIG, useValue: config },
        { provide: TreasuryDriveProducer, useValue: producer },
      ],
    }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    prisma = app.get(PrismaClientService)
    repository = app.get(TreasuryDriveRepository)
  }

  /** Scans a fake Drive so a tracked row exists, and returns it. */
  const seedFile = async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: xlsxBuffer([c6StatementSheet()]) } } } })
    await new TreasuryDriveScanService(repository).scan(client, enabledConfig())
    const [file] = await repository.list()
    return file
  }

  beforeAll(async () => {
    await build(enabledConfig())
  }, 60000)

  beforeEach(() => {
    producer.enqueueScan.mockReset().mockResolvedValue('queued')
    producer.enqueueImport.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await prisma.treasuryDriveFile.deleteMany({})
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /treasury-drive-files', () => {
    it('is empty before any scan', async () => {
      expect(await http('GET', '/treasury-drive-files')).toMatchObject({ status: 200, body: [] })
    })

    it('lists a tracked file', async () => {
      const file = await seedFile()

      const { status, body } = await http('GET', '/treasury-drive-files')

      expect(status).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ id: file.id, bank_folder_name: 'c6', month_folder_name: 'agosto', detected_source: 'c6_statement', status: 'new' })
    })
  })

  describe('GET /treasury-drive-files/status', () => {
    it('returns configured: false when the source is not configured', async () => {
      await app.close()
      await build(disabledConfig())

      const { status, body } = await http('GET', '/treasury-drive-files/status')

      expect(status).toBe(200)
      expect(body).toMatchObject({ configured: false })

      await app.close()
      await build(enabledConfig())
    })

    it('returns configured: true and never any credential when the source is set up', async () => {
      const { status, body, raw } = await http('GET', '/treasury-drive-files/status')

      expect(status).toBe(200)
      expect(body).toMatchObject({ configured: true, month_folders: ['agosto'] })
      for (const secret of [SECRET_KEY, credential(), 'client_email', 'private_key', 'reader@project']) {
        expect(raw).not.toContain(secret)
      }
    })
  })

  describe('POST /treasury-drive-files/scan', () => {
    it('queues a scan and answers 202', async () => {
      expect(await http('POST', '/treasury-drive-files/scan')).toMatchObject({ status: 202, body: { status: 'queued' } })
      expect(producer.enqueueScan).toHaveBeenCalledWith({ trigger: 'manual' }, undefined)
    })

    it('says so when a scan is already running instead of queueing a second', async () => {
      producer.enqueueScan.mockResolvedValue('already_running')

      expect((await http('POST', '/treasury-drive-files/scan')).body).toEqual({ status: 'already_running' })
    })

    it('refuses with 409 when the source is not configured', async () => {
      await app.close()
      await build(disabledConfig())

      expect(await http('POST', '/treasury-drive-files/scan')).toMatchObject({ status: 409, body: { code: 'not_configured' } })

      await app.close()
      await build(enabledConfig())
    })
  })

  describe('POST /treasury-drive-files/:id/import', () => {
    it('accepts a confirmed import with 202 and queues the job', async () => {
      const file = await seedFile()

      const response = await http('POST', `/treasury-drive-files/${file.id}/import`, { accountId: 42, period: AUGUST })

      expect(response).toMatchObject({ status: 202, body: { id: file.id, status: 'importing' } })
      expect(producer.enqueueImport).toHaveBeenCalledWith({ fileId: file.id, accountId: 42, period: AUGUST }, undefined)
    })

    it('answers 404 for an unknown file', async () => {
      const response = await http('POST', '/treasury-drive-files/00000000-0000-0000-0000-000000000000/import', { accountId: 42, period: AUGUST })

      expect(response).toMatchObject({ status: 404, body: { code: 'not_found' } })
      expect(producer.enqueueImport).not.toHaveBeenCalled()
    })

    it('rejects a malformed period at the door, never reaching the producer', async () => {
      const file = await seedFile()

      const response = await http('POST', `/treasury-drive-files/${file.id}/import`, { accountId: 42, period: 'agosto-2026' })

      expect(response.status).toBe(400)
      expect(producer.enqueueImport).not.toHaveBeenCalled()
    })

    it('rejects a body missing accountId at the door', async () => {
      const file = await seedFile()

      expect((await http('POST', `/treasury-drive-files/${file.id}/import`, { period: AUGUST })).status).toBe(400)
    })
  })

  describe('POST /treasury-drive-files/:id/ignore', () => {
    it('ignores by default and restores with ignored: false', async () => {
      const file = await seedFile()

      expect(await http('POST', `/treasury-drive-files/${file.id}/ignore`, {})).toMatchObject({ status: 200, body: { id: file.id, status: 'ignored' } })
      expect(await http('POST', `/treasury-drive-files/${file.id}/ignore`, { ignored: false })).toMatchObject({ status: 200, body: { id: file.id, status: 'new' } })
    })

    it('answers 404 for an unknown file', async () => {
      expect((await http('POST', '/treasury-drive-files/00000000-0000-0000-0000-000000000000/ignore', {})).status).toBe(404)
    })
  })
})
