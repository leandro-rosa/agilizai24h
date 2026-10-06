import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import fastifyCookie from '@fastify/cookie'
import request from 'supertest'
import { PERMISSIONS } from '@app/iam-contracts'
import { UpstreamStub } from './upstream-stub'

/**
 * Integration tests for accounting compute route query string forwarding.
 */
describe('accounting compute route', () => {
  let app: NestFastifyApplication
  let stub: UpstreamStub
  let base: string

  const SESSION = 'agiliz_session'
  const validSession = {
    valid: true,
    id: 1,
    email: 'admin@agiliz.ai',
    name: 'Admin',
    roles: ['administrator'],
    permissions: [PERMISSIONS.ACCOUNTING_WRITE],
  }

  beforeAll(async () => {
    stub = new UpstreamStub()
    const port = await stub.start()
    base = `http://127.0.0.1:${port}`

    process.env.IAM_SERVICE_URL = base
    process.env.STORES_SERVICE_URL = base
    process.env.PRODUCTS_SERVICE_URL = base
    process.env.FINANCE_SERVICE_URL = base
    process.env.SALES_SERVICE_URL = base
    process.env.SUPPLY_SERVICE_URL = base
    process.env.INVENTORY_SERVICE_URL = base
    process.env.INGESTION_SERVICE_URL = base
    process.env.SUPPLIERS_SERVICE_URL = base
    process.env.TREASURY_SERVICE_URL = base
    process.env.ACCOUNTING_SERVICE_URL = base
    process.env.BILLING_SERVICE_URL = base
    process.env.CAPEX_SERVICE_URL = base
    process.env.INTELLIGENCE_SERVICE_URL = base
    process.env.ADMIN_ORIGIN = 'http://localhost:3000'
    process.env.AWS_REGION = 'us-east-1'
    process.env.AWS_ACCESS_KEY_ID = 'test'
    process.env.AWS_SECRET_ACCESS_KEY = 'test'
    process.env.AWS_S3_BUCKET = 'test-bucket'
    process.env.UPSTREAM_TIMEOUT_MS = '800'
    process.env.UPSTREAM_DEADLINE_MS = '1200'

    const { AppModule } = await import('../src/app.module')

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.register(fastifyCookie as unknown as Parameters<typeof app.register>[0])
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  }, 60000)

  afterAll(async () => {
    await app?.close()
    await stub?.stop()
  }, 30000)

  beforeEach(() => {
    stub.resetCalls()
    stub.on('POST', '/auth/introspect', { status: 200, body: validSession })
  })

  const server = () => app.getHttpServer()

  describe('POST /accounting/pnl/:period/compute', () => {
    it('forwards query string (store_count, close) to accounting-service', async () => {
      // Register a handler that will receive the query string
      stub.on('POST', '/accounting/pnl/2026-09/compute', { status: 201, body: { result: 'computed' } })

      await request(server())
        .post('/accounting/pnl/2026-09/compute?store_count=20&close=true')
        .set('Cookie', `${SESSION}=good`)
        .send({})
        .expect(201)

      expect(stub.calledWithQuery('POST', '/accounting/pnl/2026-09/compute?store_count=20&close=true')).toBe(true)
    })
  })
})
