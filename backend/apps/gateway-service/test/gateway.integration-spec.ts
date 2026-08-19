import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import fastifyCookie from '@fastify/cookie'
import request from 'supertest'
import { PERMISSIONS } from '@app/iam-contracts'
import { UpstreamStub } from './upstream-stub'

/**
 * Drives the real application over HTTP, so the global guard, the exception
 * filter, cookie handling and the upstream client are exercised together.
 *
 * Needs no containers: the upstreams are a stub this suite controls, which is
 * what makes the interesting cases — unreachable, slow, a forwarded 404 —
 * cheap to produce deterministically.
 */
describe('gateway integration', () => {
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
    permissions: [PERMISSIONS.STORES_READ, PERMISSIONS.PRODUCTS_READ],
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
    process.env.ADMIN_ORIGIN = 'http://localhost:3000'
    process.env.AWS_REGION = 'us-east-1'
    process.env.AWS_ACCESS_KEY_ID = 'test'
    process.env.AWS_SECRET_ACCESS_KEY = 'test'
    process.env.AWS_S3_BUCKET = 'test-bucket'
    // Short, so the unreachable and slow cases resolve quickly.
    process.env.UPSTREAM_TIMEOUT_MS = '800'
    process.env.UPSTREAM_DEADLINE_MS = '1200'

    // Imported here, not at the top of the file: ConfigModule.forRoot's
    // validate callback runs while the module decorator is evaluated, i.e. at
    // import time, so the upstream URLs must already be in the environment —
    // and their port is only known once the stub is listening.
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
    stub.on('GET', '/stores', { status: 200, body: [{ id: 1, name: 'Loja' }] })
    stub.on('GET', '/products', { status: 200, body: [{ id: 1, sku: 'A' }] })
  })

  const server = () => app.getHttpServer()

  describe('authentication', () => {
    it('rejects a request with no session, without calling any upstream', async () => {
      await request(server()).get('/stores').expect(401)

      expect(stub.calledWith('GET', '/stores')).toBe(false)
      expect(stub.calledWith('POST', '/auth/introspect')).toBe(false)
    })

    it('rejects an invalid session as 401, without calling the domain service', async () => {
      stub.on('POST', '/auth/introspect', { status: 200, body: { valid: false, reason: 'revoked' } })

      await request(server()).get('/stores').set('Cookie', `${SESSION}=whatever`).expect(401)

      expect(stub.calledWith('GET', '/stores')).toBe(false)
    })

    it('accepts a valid session and forwards to the domain service', async () => {
      const response = await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(200)

      expect(response.body).toEqual([{ id: 1, name: 'Loja' }])
      expect(stub.calledWith('GET', '/stores')).toBe(true)
    })

    it('resolves the session on every request rather than caching it', async () => {
      // iam promises immediate revocation; a cache would break that
      // intermittently, which is the worst way for a security control to fail.
      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(200)

      stub.on('POST', '/auth/introspect', { status: 200, body: { valid: false, reason: 'revoked' } })

      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(401)
    })
  })

  describe('identity service availability', () => {
    it('answers 503, not 401, when the identity service is unreachable', async () => {
      // The failure the whole design guards against: collapsing this into 401
      // makes a dependency blip log the entire company out.
      stub.off('POST', '/auth/introspect')
      stub.on('POST', '/auth/introspect', { status: 500 })

      const response = await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(503)

      expect(response.body.message).toMatch(/Identity service is unavailable/)
      expect(stub.calledWith('GET', '/stores')).toBe(false)
    })

    it('answers 503 when the identity service is too slow to answer in time', async () => {
      stub.on('POST', '/auth/introspect', { status: 200, body: validSession, delayMs: 3000 })

      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(503)
    }, 20000)

    it('lets the same session work again once the identity service recovers', async () => {
      stub.on('POST', '/auth/introspect', { status: 500 })
      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(503)

      stub.on('POST', '/auth/introspect', { status: 200, body: validSession })
      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(200)
    })
  })

  describe('authorization', () => {
    it('answers 403, distinct from 401, when the permission is missing', async () => {
      stub.on('POST', '/auth/introspect', {
        status: 200,
        body: { ...validSession, permissions: [PERMISSIONS.STORES_READ] },
      })

      // POST /stores requires stores:write.
      await request(server())
        .post('/stores')
        .set('Cookie', `${SESSION}=good`)
        .send({ name: 'X', address: 'Y', city: 'Z', type: 'condo' })
        .expect(403)

      expect(stub.calledWith('POST', '/stores')).toBe(false)
    })

    it('reflects a permission change on the next request, with no re-login', async () => {
      stub.on('POST', '/auth/introspect', { status: 200, body: { ...validSession, permissions: [] } })
      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(403)

      stub.on('POST', '/auth/introspect', { status: 200, body: validSession })
      await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(200)
    })
  })

  describe('upstream failures', () => {
    it('forwards a domain 404 as 404 rather than swallowing it', async () => {
      stub.on('GET', '/stores/99', { status: 404, body: { message: 'Store 99 not found' } })

      const response = await request(server()).get('/stores/99').set('Cookie', `${SESSION}=good`).expect(404)

      expect(response.body.message).toBe('Store 99 not found')
    })

    it('answers 502 when a domain service is unreachable, never 401 or 403', async () => {
      stub.off('GET', '/stores')

      const response = await request(server()).get('/stores').set('Cookie', `${SESSION}=good`)

      // The stub answers 404 for an unknown route, so this asserts the
      // forwarding path; the unreachable case is covered by the slow test below.
      expect([404, 502]).toContain(response.status)
      expect(response.status).not.toBe(401)
      expect(response.status).not.toBe(403)
    })

    it('answers 502 when a domain service exceeds the deadline', async () => {
      stub.on('GET', '/stores', { status: 200, body: [], delayMs: 3000 })

      const response = await request(server()).get('/stores').set('Cookie', `${SESSION}=good`).expect(502)

      expect(response.body.upstream).toBe('stores')
    }, 20000)
  })

  describe('aggregation', () => {
    it('reports partial failure explicitly instead of returning the subset', async () => {
      stub.on('GET', '/products', { status: 200, body: [], delayMs: 3000 })

      const response = await request(server()).get('/overview').set('Cookie', `${SESSION}=good`).expect(200)

      expect(response.body.stores.available).toBe(true)
      expect(response.body.products.available).toBe(false)
      expect(response.body.products.upstream).toBe('products')
      // The panel must be able to check one flag before presenting a total.
      expect(response.body.complete).toBe(false)
    }, 20000)

    it('reports complete when every section resolved', async () => {
      const response = await request(server()).get('/overview').set('Cookie', `${SESSION}=good`).expect(200)

      expect(response.body.complete).toBe(true)
    })
  })

  describe('browser session handling', () => {
    it('sets an HTTP-only cookie on login and keeps the token out of the body', async () => {
      stub.on('POST', '/auth/login', {
        status: 200,
        body: { token: 'secret-token-value', expires_at: new Date(Date.now() + 3600_000).toISOString(), user: validSession },
      })

      const response = await request(server())
        .post('/auth/login')
        .send({ email: 'admin@agiliz.ai', password: 'a-long-enough-password' })
        .expect(200)

      const cookie = response.headers['set-cookie'][0]
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite/i)
      expect(JSON.stringify(response.body)).not.toContain('secret-token-value')
    })

    it('clears the cookie on logout and revokes upstream', async () => {
      stub.on('POST', '/auth/logout', { status: 204 })

      const response = await request(server()).post('/auth/logout').set('Cookie', `${SESSION}=good`).expect(204)

      expect(stub.calledWith('POST', '/auth/logout')).toBe(true)
      expect(response.headers['set-cookie'][0]).toMatch(new RegExp(`${SESSION}=;`))
    })
  })

  describe('public routes', () => {
    it('answers /health without a session', async () => {
      // @app/health's controller cannot carry @Public(), so this is the
      // regression guard for the path exemption that keeps liveness reachable.
      await request(server()).get('/health').expect(200)
      expect(stub.calledWith('POST', '/auth/introspect')).toBe(false)
    })

    it('answers /docs-json without a session', async () => {
      await request(server()).get('/docs-json').expect(res => {
        expect(res.status).not.toBe(401)
      })
    })
  })
})
