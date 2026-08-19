import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { CostService } from '../src/modules/products/services/cost.service'
import { ProductsService } from '../src/modules/products/services/products.service'

describe('products integration', () => {
  let app: TestingModule
  let products: ProductsService
  let costs: CostService
  let prisma: PrismaClientService

  const createdSkus: string[] = []
  const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const createProduct = async (name: string) => {
    const sku = unique('SKU')
    createdSkus.push(sku)
    return products.create(sku, name, 'beverage')
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    products = app.get(ProductsService)
    costs = app.get(CostService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.product.deleteMany({ where: { sku: { in: createdSkus } } })
    await app?.close()
  }, 30000)

  describe('product record', () => {
    it('persists a product with a stable identifier', async () => {
      const product = await createProduct('Guaraná 350ml')
      expect(product.id).toEqual(expect.any(Number))
    })

    it('rejects a duplicate SKU and leaves the original unchanged', async () => {
      const product = await createProduct('Coca 350ml')

      await expect(products.create(product.sku, 'Outro', 'snack')).rejects.toThrow(/already exists/)
      await expect(products.findById(product.id)).resolves.toMatchObject({ name: 'Coca 350ml' })
    })
  })

  describe('dated cost versions', () => {
    it('keeps the old version when a new one is recorded', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-01-01'), 250)
      await costs.recordCost(product.sku, new Date('2026-06-01'), 300)

      const versions = await costs.listVersions(product.id)
      expect(versions).toHaveLength(2)
    })

    it('replaces in place when re-recording the same effective date', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-06-01'), 300)
      await costs.recordCost(product.sku, new Date('2026-06-01'), 320)

      const versions = await costs.listVersions(product.id)
      expect(versions).toHaveLength(1)
      expect(versions[0].cost_cents).toBe(320)
    })

    it('rejects a non-integer or negative cost', async () => {
      const product = await createProduct(unique('Produto'))

      await expect(costs.recordCost(product.sku, new Date('2026-01-01'), 2.5)).rejects.toThrow(/minor units/)
      await expect(costs.recordCost(product.sku, new Date('2026-01-01'), -1)).rejects.toThrow(/minor units/)
    })
  })

  describe('as-of resolution', () => {
    it('values a historical month with that month cost, not the latest', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-01-01'), 250)
      await costs.recordCost(product.sku, new Date('2026-06-01'), 300)

      const march = await costs.costAsOf(product.sku, new Date('2026-03-15'))
      expect(march.cost_cents).toBe(250)
    })

    /**
     * The regression test the design named explicitly: a wrong as-of
     * implementation still produces plausible totals, so nothing else catches
     * it. Value a period, record a later higher cost, re-value, expect no
     * change.
     */
    it('leaves a historical valuation unchanged when a later cost is recorded', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-01-01'), 250)

      const before = await costs.costAsOf(product.sku, new Date('2026-03-31'))

      await costs.recordCost(product.sku, new Date('2026-09-01'), 999)
      const after = await costs.costAsOf(product.sku, new Date('2026-03-31'))

      expect(after.cost_cents).toBe(before.cost_cents)
      expect(after.effective_from).toBe(before.effective_from)
    })

    it('reports no cost when the date precedes every version, without falling back', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-06-01'), 300)

      await expect(costs.costAsOf(product.sku, new Date('2026-01-01'))).rejects.toThrow(/No cost known/)
    })
  })

  describe('bulk lookup', () => {
    it('partitions resolved from unresolved, each with a reason', async () => {
      const priced = await createProduct(unique('Produto'))
      const unpriced = await createProduct(unique('Produto'))
      await costs.recordCost(priced.sku, new Date('2026-01-01'), 250)

      const result = await costs.bulkCostAsOf([priced.sku, unpriced.sku, 'NAO-EXISTE'], new Date('2026-03-31'))

      expect(result.resolved.map(r => r.sku)).toEqual([priced.sku])
      expect(result.unresolved).toEqual(
        expect.arrayContaining([
          { sku: unpriced.sku, reason: 'no_cost_for_date' },
          { sku: 'NAO-EXISTE', reason: 'unknown_sku' },
        ]),
      )
    })

    it('marks a result incomplete when anything is unresolved', async () => {
      const product = await createProduct(unique('Produto'))

      const result = await costs.bulkCostAsOf([product.sku], new Date('2026-03-31'))
      expect(result.complete).toBe(false)
    })

    it('marks a result complete only when everything resolved', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-01-01'), 250)

      const result = await costs.bulkCostAsOf([product.sku], new Date('2026-03-31'))
      expect(result.complete).toBe(true)
    })

    it('distinguishes a recorded zero cost from no cost at all', async () => {
      const free = await createProduct(unique('Produto'))
      const missing = await createProduct(unique('Produto'))
      await costs.recordCost(free.sku, new Date('2026-01-01'), 0)

      const result = await costs.bulkCostAsOf([free.sku, missing.sku], new Date('2026-03-31'))

      expect(result.resolved).toEqual([expect.objectContaining({ sku: free.sku, cost_cents: 0 })])
      expect(result.unresolved).toEqual([{ sku: missing.sku, reason: 'no_cost_for_date' }])
    })

    it('records which cost version was used, so a figure is traceable', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-01-01'), 250)

      const result = await costs.bulkCostAsOf([product.sku], new Date('2026-03-31'))

      expect(result.as_of).toBe('2026-03-31')
      expect(result.resolved[0].effective_from).toBe('2026-01-01')
    })
  })

  describe('code matching', () => {
    // The primary resolution path (design D3): sku is the identifier shared
    // across the sales report, the restocking report and the price list.
    it('matches a product by its own sku, exactly', async () => {
      const product = await createProduct(unique('Produto'))

      const result = await products.resolveSkus([product.sku])

      expect(result.matched).toEqual([expect.objectContaining({ id: product.id, sku: product.sku })])
    })

    it('reports an unknown sku with the original code, never a guess from a name', async () => {
      const result = await products.resolveSkus(['NAO-EXISTE-999'])

      expect(result.unmatched).toEqual([{ sku: 'NAO-EXISTE-999', reason: 'unknown_sku' }])
    })

    it('resolves several codes in one call, matched and unmatched together', async () => {
      const product = await createProduct(unique('Produto'))

      const result = await products.resolveSkus([product.sku, 'FANTASMA-1'])

      expect(result.matched.map(p => p.sku)).toEqual([product.sku])
      expect(result.unmatched).toEqual([{ sku: 'FANTASMA-1', reason: 'unknown_sku' }])
    })
  })

  describe('name matching', () => {
    it('matches a name differing only by case, accents and spacing', async () => {
      const name = `Refrigerante Guaraná ${unique('X')}`
      const product = await createProduct(name)

      const result = await products.resolveNames([name.toUpperCase().replace(' ', '  ')])

      expect(result.matched).toEqual([
        expect.objectContaining({ product: expect.objectContaining({ id: product.id }), matched_by: 'normalization' }),
      ])
    })

    it('resolves via a curated override a normalisation cannot', async () => {
      const product = await createProduct(unique('Produto'))
      const sourceName = `Guaraná lata ${unique('Y')}`

      await products.addOverride(sourceName, product.sku)
      const result = await products.resolveNames([sourceName])

      expect(result.matched[0]).toMatchObject({
        product: expect.objectContaining({ id: product.id }),
        matched_by: 'override',
      })
    })

    it('lets an override win over a normalised match', async () => {
      const sharedName = `Produto Ambiguo ${unique('Z')}`
      await createProduct(sharedName)
      const preferred = await createProduct(unique('Preferido'))

      // The name normalises to the first product, but the override says otherwise.
      await products.addOverride(sharedName, preferred.sku)
      const result = await products.resolveNames([sharedName])

      expect(result.matched[0].product.id).toBe(preferred.id)
      expect(result.matched[0].matched_by).toBe('override')
    })

    it('reports an ambiguous name instead of picking a candidate', async () => {
      const sharedName = `Duplicado ${unique('W')}`
      await createProduct(sharedName)
      await createProduct(sharedName)

      const result = await products.resolveNames([sharedName])

      expect(result.matched).toHaveLength(0)
      expect(result.unmatched).toEqual([{ source_name: sharedName, reason: 'ambiguous_name' }])
    })

    it('reports an unknown name with the original string', async () => {
      const result = await products.resolveNames(['Produto Que Nao Existe'])

      expect(result.unmatched).toEqual([{ source_name: 'Produto Que Nao Existe', reason: 'unknown_name' }])
    })

    it('lets an override be replaced and removed without a deploy', async () => {
      const first = await createProduct(unique('Produto'))
      const second = await createProduct(unique('Produto'))
      const sourceName = `Sobrescrito ${unique('V')}`

      await products.addOverride(sourceName, first.sku)
      await products.addOverride(sourceName, second.sku)
      expect((await products.resolveNames([sourceName])).matched[0].product.id).toBe(second.id)

      const listed = await products.listOverrides()
      const entry = listed.find(o => o.source_name === sourceName)!
      await products.removeOverride(entry.id)

      expect((await products.resolveNames([sourceName])).unmatched).toHaveLength(1)
    })
  })
})
