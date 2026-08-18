import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { StoresService } from '../src/modules/stores/services/stores.service'

/** Runs against the Postgres from this service's docker-compose. */
describe('stores integration', () => {
  let app: TestingModule
  let stores: StoresService
  let prisma: PrismaClientService

  const createdIds: number[] = []

  const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const createStore = async (overrides: Partial<Parameters<StoresService['create']>[0]> = {}) => {
    const store = await stores.create({
      name: unique('Loja'),
      address: 'Rua Teste, 100',
      city: 'São Paulo',
      type: 'company',
      ...overrides,
    })
    createdIds.push(store.id)
    return store
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    stores = app.get(StoresService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.store.deleteMany({ where: { id: { in: createdIds } } })
    await app?.close()
  }, 30000)

  describe('store record', () => {
    it('persists a new store as active with a stable identifier', async () => {
      const store = await createStore()

      expect(store.id).toEqual(expect.any(Number))
      expect(store.status).toBe('active')
    })

    it('allows two stores to share a display name at different addresses', async () => {
      const name = unique('Mesmo Nome')
      const first = await createStore({ name, address: 'Rua A, 1' })
      const second = await createStore({ name, address: 'Rua B, 2' })

      expect(first.id).not.toBe(second.id)
      expect(second.name).toBe(first.name)
    })
  })

  describe('external code', () => {
    it('resolves an uploaded report to exactly one store', async () => {
      const code = unique('TP')
      const created = await createStore({ external_code: code })

      await expect(stores.findByExternalCode(code)).resolves.toMatchObject({ id: created.id })
    })

    it('rejects a duplicate code and leaves both stores unchanged', async () => {
      const code = unique('DUP')
      const owner = await createStore({ external_code: code })

      await expect(createStore({ external_code: code })).rejects.toThrow(/already used/)
      await expect(stores.findByExternalCode(code)).resolves.toMatchObject({ id: owner.id })
    })

    it('reports an unknown code rather than guessing from the display name', async () => {
      const store = await createStore({ name: 'Padaria Central' })

      // The store's name exists, but the code does not — this must not resolve.
      await expect(stores.findByExternalCode('Padaria Central')).rejects.toThrow(/No store matches/)
      expect(store.external_code).toBeNull()
    })

    it('lets a store exist before its code is known, then assigns one', async () => {
      const store = await createStore()
      expect(store.external_code).toBeNull()

      const code = unique('LATER')
      await stores.update(store.id, { external_code: code })

      await expect(stores.findByExternalCode(code)).resolves.toMatchObject({ id: store.id })
    })

    it('lets a store keep its own code on an unrelated update', async () => {
      const code = unique('KEEP')
      const store = await createStore({ external_code: code })

      // Re-sending the same code must not trip the duplicate check against itself.
      await expect(stores.update(store.id, { external_code: code, city: 'Campinas' })).resolves.toMatchObject({
        city: 'Campinas',
      })
    })
  })

  describe('lifecycle', () => {
    it('drops a deactivated store from the default listing but keeps it retrievable', async () => {
      const store = await createStore()
      await stores.setStatus(store.id, 'inactive')

      const listed = await stores.list()
      expect(listed.some(s => s.id === store.id)).toBe(false)

      await expect(stores.findById(store.id)).resolves.toMatchObject({ id: store.id, status: 'inactive' })
    })

    it('keeps an inactive store resolvable by external code for historical records', async () => {
      const code = unique('HIST')
      const store = await createStore({ external_code: code })
      await stores.setStatus(store.id, 'inactive')

      await expect(stores.findByExternalCode(code)).resolves.toMatchObject({ id: store.id })
    })

    it('refuses deletion and points at deactivation instead', () => {
      expect(() => stores.delete()).toThrow(/never deleted/)
    })
  })

  describe('listing', () => {
    it('returns only active stores by default', async () => {
      const active = await createStore()
      const inactive = await createStore()
      await stores.setStatus(inactive.id, 'inactive')

      const listed = await stores.list()

      expect(listed.some(s => s.id === active.id)).toBe(true)
      expect(listed.some(s => s.id === inactive.id)).toBe(false)
    })

    it('returns every status when all are named explicitly', async () => {
      const store = await createStore()
      await stores.setStatus(store.id, 'maintenance')

      const listed = await stores.list({ status: ['active', 'maintenance', 'inactive'] })

      expect(listed.some(s => s.id === store.id)).toBe(true)
    })

    it('filters by type and city', async () => {
      const city = unique('Cidade')
      const condo = await createStore({ type: 'condo', city })
      await createStore({ type: 'company', city })

      const listed = await stores.list({ type: 'condo', city })

      expect(listed.map(s => s.id)).toEqual([condo.id])
    })

    it('returns a stable order across identical requests', async () => {
      await createStore({ name: 'AAA Loja' })
      await createStore({ name: 'AAA Loja' })

      const first = await stores.list()
      const second = await stores.list()

      expect(first.map(s => s.id)).toEqual(second.map(s => s.id))
    })

    it('reports a store that does not exist as not found', async () => {
      await expect(stores.findById(999_999_999)).rejects.toThrow(/not found/)
    })
  })

  describe('updating', () => {
    it('persists mutable attributes without changing the identifier', async () => {
      const store = await createStore()

      const updated = await stores.update(store.id, { name: 'Novo Nome', address: 'Rua Nova, 9' })

      expect(updated.id).toBe(store.id)
      expect(updated.name).toBe('Novo Nome')
      expect(updated.address).toBe('Rua Nova, 9')
    })

    it('rejects an update to a store that does not exist', async () => {
      await expect(stores.update(999_999_999, { city: 'X' })).rejects.toThrow(/not found/)
    })
  })
})
