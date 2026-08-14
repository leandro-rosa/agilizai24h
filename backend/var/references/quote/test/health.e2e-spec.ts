import { INestApplication } from '@nestjs/common'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'

describe('AppModule (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  }, 30000)

  afterAll(async () => {
    await app.close()
  })

  it('GET /health responds with a well-formed Terminus health report', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/health' })

    expect([200, 503]).toContain(response.statusCode)
    const body = JSON.parse(response.body)
    expect(body).toHaveProperty('info')
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('details')
    expect(body.details).toHaveProperty('POSTGRES')
  })
})
