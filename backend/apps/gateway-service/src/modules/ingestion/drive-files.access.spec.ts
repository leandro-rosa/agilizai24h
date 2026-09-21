import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { S3Service } from '@app/aws'
import { ConfigService } from '@nestjs/config'
import { SessionGuard } from '../auth/guards/session.guard'
import { SESSION_COOKIE } from '../auth/guards/session.constants'
import { DomainClient } from '../upstream/domain.client'
import { DriveFilesController } from './drive-files.controller'
import { IngestionController } from './ingestion.controller'

const readOnly = { id: 1, email: 'reader@agiliz.ai', name: 'Reader', roles: [], permissions: ['ingestion:read'] }
const uploader = { ...readOnly, email: 'uploader@agiliz.ai', permissions: ['ingestion:read', 'ingestion:upload'] }

/** The real guard, the real reflector and the real controller methods: the permissions declared are the permissions enforced. */
describe('Drive files access', () => {
  const guardFor = (caller: typeof readOnly) =>
    new SessionGuard({ resolve: jest.fn().mockResolvedValue(caller) } as never, new Reflector())

  const contextFor = (handler: (...args: never[]) => unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ url: '/drive-files', cookies: { [SESSION_COOKIE]: 'token' } }) }),
      getHandler: () => handler,
      getClass: () => DriveFilesController,
    }) as never

  const proto = DriveFilesController.prototype

  it.each([
    ['list', proto.list],
    ['status', proto.status],
  ])('lets a user with only ingestion:read use %s', async (_name, handler) => {
    await expect(guardFor(readOnly).canActivate(contextFor(handler as never))).resolves.toBe(true)
  })

  it.each([
    ['scan', proto.scan],
    ['validate', proto.validate],
    ['import', proto.import],
    ['ignore', proto.ignore],
  ])('refuses %s to a user with only ingestion:read, as forbidden and not as unauthenticated', async (_name, handler) => {
    const denied = guardFor(readOnly).canActivate(contextFor(handler as never))

    await expect(denied).rejects.toBeInstanceOf(ForbiddenException)
    await expect(denied).rejects.toThrow('Missing permission ingestion:upload')
  })

  it.each([
    ['scan', proto.scan],
    ['validate', proto.validate],
    ['import', proto.import],
    ['ignore', proto.ignore],
  ])('lets a user with ingestion:upload use %s', async (_name, handler) => {
    await expect(guardFor(uploader).canActivate(contextFor(handler as never))).resolves.toBe(true)
  })
})

describe('Drive files routes', () => {
  let app: NestFastifyApplication
  const domains = { ingestion: jest.fn() }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestionController, DriveFilesController],
      providers: [
        { provide: DomainClient, useValue: domains },
        { provide: S3Service, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  beforeEach(() => domains.ingestion.mockReset().mockResolvedValue({ status: 200, data: { from: 'worker' } }))

  afterAll(async () => {
    await app.close()
  })

  it('resolves /drive-files/status to the Drive status route, not to GET /ingestions/:id', async () => {
    const response = await app.inject({ method: 'GET', url: '/drive-files/status' })

    expect(response.statusCode).toBe(200)
    expect(domains.ingestion.mock.calls[0][0]).toMatchObject({ method: 'get', path: '/drive-files/status' })
  })

  it('still resolves /ingestions/:id as before, including an id that happens to be "status"', async () => {
    await app.inject({ method: 'GET', url: '/ingestions/status' })

    expect(domains.ingestion.mock.calls[0][0]).toMatchObject({ method: 'get', path: '/ingestions/status' })
  })

  it('does not treat /ingestions/drive-files as the Drive list: that path belongs to the ingestion id route', async () => {
    await app.inject({ method: 'GET', url: '/ingestions/drive-files' })

    expect(domains.ingestion.mock.calls[0][0]).toMatchObject({ path: '/ingestions/drive-files' })
  })

  it('serves the Drive list at /drive-files', async () => {
    await app.inject({ method: 'GET', url: '/drive-files?status=new' })

    expect(domains.ingestion.mock.calls[0][0]).toMatchObject({ path: '/drive-files?status=new' })
  })
})
