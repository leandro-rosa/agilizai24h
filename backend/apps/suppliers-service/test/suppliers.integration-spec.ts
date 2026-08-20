import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { SuppliersService } from '../src/modules/suppliers/services/suppliers.service'

/** Runs against the Postgres from this service's docker-compose. */
describe('suppliers integration', () => {
  let app: TestingModule
  let suppliers: SuppliersService
  let prisma: PrismaClientService

  const createdIds: number[] = []

  const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const createSupplier = async (overrides: Partial<Parameters<SuppliersService['create']>[0]> = {}) => {
    const supplier = await suppliers.create({
      name: unique('Fornecedor'),
      category: 'wholesale',
      ...overrides,
    })
    createdIds.push(supplier.id)
    return supplier
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    suppliers = app.get(SuppliersService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.supplier.deleteMany({ where: { id: { in: createdIds } } })
    await app?.close()
  }, 30000)

  describe('supplier record', () => {
    it('registers the supplier name as its first alias', async () => {
      const created = await createSupplier({ name: unique('Quinoa Indústria') })

      const detail = await suppliers.findById(created.id)

      expect(detail.aliases).toHaveLength(1)
      expect(detail.aliases[0].alias).toBe(created.name)
    })

    it('rejects a second supplier with the same tax id', async () => {
      const taxId = `35.370.333/${Date.now().toString().slice(-4)}-00`
      await createSupplier({ tax_id: taxId })

      await expect(createSupplier({ tax_id: taxId })).rejects.toThrow(/já pertence/)
    })

    it('never deletes — the operation is refused outright', () => {
      expect(() => suppliers.delete()).toThrow(/não são excluídos/)
    })
  })

  describe('alias resolution', () => {
    it('matches a statement spelling that differs in case and accent', async () => {
      const supplier = await createSupplier()
      await suppliers.addAlias(supplier.id, `ASSAÍ ATACADISTA ${supplier.id}`)

      const result = await suppliers.resolve([`assai  atacadista ${supplier.id}`])

      expect(result.unmatched).toHaveLength(0)
      expect(result.matched[0].supplier.id).toBe(supplier.id)
    })

    it('reports what did not resolve instead of dropping it', async () => {
      const supplier = await createSupplier()
      const known = `KNOWN ${supplier.id}`
      await suppliers.addAlias(supplier.id, known)

      const result = await suppliers.resolve([known, 'FORNECEDOR QUE NAO EXISTE 999'])

      expect(result.matched).toHaveLength(1)
      expect(result.unmatched).toEqual(['FORNECEDOR QUE NAO EXISTE 999'])
    })

    it('refuses an alias that already resolves to another supplier', async () => {
      const first = await createSupplier()
      const second = await createSupplier()
      const alias = `COMPARTILHADO ${first.id}`

      await suppliers.addAlias(first.id, alias)

      // Um alias apontando para dois fornecedores atribuiria a compra ao
      // fornecedor errado — a recusa é o comportamento correto.
      await expect(suppliers.addAlias(second.id, alias)).rejects.toThrow(/já resolve/)
    })

    it('resolves a batch in one pass, preserving input order', async () => {
      const supplier = await createSupplier()
      const alias = `LOTE ${supplier.id}`
      await suppliers.addAlias(supplier.id, alias)

      const result = await suppliers.resolve(['DESCONHECIDO A', alias, 'DESCONHECIDO B'])

      expect(result.unmatched).toEqual(['DESCONHECIDO A', 'DESCONHECIDO B'])
      expect(result.matched.map(m => m.name)).toEqual([alias])
    })
  })
})
