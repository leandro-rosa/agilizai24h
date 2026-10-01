import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { ParametersModule } from '../src/modules/parameters/parameters.module'
import { ParametersService } from '../src/modules/parameters/parameters.service'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { ScheduleModule } from '../src/modules/schedule/schedule.module'
import { resetDisposableDb } from './support/reset-db'

/** The internal routes over real HTTP, on a disposable Postgres. */
describe('parameter and schedule routes', () => {
  let app: NestFastifyApplication
  const server = () => app.getHttpAdapter().getInstance().server

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule, ParametersModule, ScheduleModule],
    }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await resetDisposableDb(app.get(PrismaClientService))
    await app.get(ParametersService).ensureInitial()
    await app.getHttpAdapter().getInstance().ready()
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  it('GET /parameters/current returns the initial version, labelling what is provisional', async () => {
    const { body } = await request(server()).get('/parameters/current').expect(200)

    expect(body.values.tolerance).toMatchObject({ pct: 0.1, units: 3 })
    const pct = body.parameters.find((row: { path: string }) => row.path === 'tolerance.pct')
    const window = body.parameters.find((row: { path: string }) => row.path === 'tolerance.windowCounts')
    expect(pct.provisional).toBe(false)
    expect(window.provisional).toBe(true)
  })

  it('POST /parameters creates a new version and the old one stays readable', async () => {
    const before = (await request(server()).get('/parameters/current')).body

    const created = await request(server())
      .post('/parameters')
      .send({ values: { tolerance: { pct: 0.12 } }, note: 'owner recalibration' })
      .expect(201)

    expect(created.body.id).toBeGreaterThan(before.id)
    expect(created.body.values.tolerance.pct).toBe(0.12)

    const old = await request(server()).get(`/parameters/versions/${before.id}`).expect(200)
    expect(old.body.values.tolerance.pct).toBe(before.values.tolerance.pct)
  })

  it('POST /parameters rejects a nonsense document with every problem listed', async () => {
    const { body } = await request(server())
      .post('/parameters')
      .send({ values: { tolerance: { pct: 3, windowCounts: 1, minCounts: 4 } } })
      .expect(400)

    expect(body.problems.length).toBeGreaterThanOrEqual(2)
  })

  it('POST /parameters rejects an unknown parameter and a missing body', async () => {
    await request(server()).post('/parameters').send({ values: { tolerance: { nope: 1 } } }).expect(400)
    await request(server()).post('/parameters').send({}).expect(400)
  })

  it('GET /parameters/versions/:id answers 404 for a version that does not exist', async () => {
    await request(server()).get('/parameters/versions/99999').expect(404)
  })

  it('GET /schedules/:storeId defaults to Monday, Tuesday, Thursday, Friday; PUT overrides one store only', async () => {
    const base = await request(server()).get('/schedules/920001').expect(200)
    expect(base.body).toEqual({ storeId: 920001, weekdays: [1, 2, 4, 5], source: 'default' })

    const set = await request(server()).put('/schedules/920002').send({ weekdays: [5, 3] }).expect(200)
    expect(set.body).toEqual({ storeId: 920002, weekdays: [3, 5], source: 'override' })

    expect((await request(server()).get('/schedules/920001')).body.source).toBe('default')
  })

  it('PUT /schedules/:storeId rejects invalid weekdays', async () => {
    await request(server()).put('/schedules/920003').send({ weekdays: [0] }).expect(400)
  })
})
