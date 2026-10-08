import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { CatalogueImportService } from '../src/modules/products/services/catalogue-import.service'
import { TaxonomyService } from '../src/modules/products/services/taxonomy.service'
import { CatalogueSyncService } from '../src/modules/products/services/catalogue-sync.service'
import { CostService } from '../src/modules/products/services/cost.service'
import { EanService } from '../src/modules/products/services/ean.service'
import { ProductsService } from '../src/modules/products/services/products.service'

describe('products integration', () => {
  let app: TestingModule
  let products: ProductsService
  let costs: CostService
  let eans: EanService
  let importer: CatalogueImportService
  let taxonomy: TaxonomyService
  let sync: CatalogueSyncService
  let prisma: PrismaClientService

  const createdSkus: string[] = []
  const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const createProduct = async (name: string) => {
    const sku = unique('SKU')
    createdSkus.push(sku)
    return products.create({ sku, name, category: 'beverage' })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    products = app.get(ProductsService)
    costs = app.get(CostService)
    eans = app.get(EanService)
    importer = app.get(CatalogueImportService)
    taxonomy = app.get(TaxonomyService)
    sync = app.get(CatalogueSyncService)
    // A fresh database has no subcategories (the migration seeds them from existing products), a copy of the dev one does: make both the same.
    const beverage = (await taxonomy.list()).find(c => c.key === 'beverage')
    for (const [name, keywords] of [['Energéticos', ['energetico', 'energy', 'monster']], ['Chás', ['cha', 'mate']]] as const) {
      if (!beverage?.subcategories.some(sub => sub.name === name)) await taxonomy.createSubcategory(beverage?.id as number, { name, keywords: [...keywords] })
    }
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

      await expect(products.create({ sku: product.sku, name: 'Outro', category: 'snack' })).rejects.toThrow(/already exists/)
      await expect(products.findById(product.id)).resolves.toMatchObject({ name: 'Coca 350ml' })
    })
  })

  describe('packaging fields', () => {
    it('create accepts and returns packaging fields', async () => {
      const sku = unique('SKU')
      createdSkus.push(sku)
      const product = await products.create({
        sku,
        name: 'Produto embalado',
        category: 'snack',
        unitsPerPackage: 24,
        packageType: 'caixa',
        fractionable: true,
      })
      expect(product.units_per_package).toBe(24)
      expect(product.package_type).toBe('caixa')
      expect(product.fractionable).toBe(true)
    })

    it('create omits packaging fields as null when not provided', async () => {
      const product = await createProduct(unique('Produto'))
      expect(product.units_per_package).toBeNull()
      expect(product.package_type).toBeNull()
      expect(product.fractionable).toBeNull()
    })

    it('update sets packaging fields on an existing product without touching name/category', async () => {
      const product = await createProduct('Produto original')
      const updated = await products.update(product.id, { unitsPerPackage: 12, packageType: 'fardo', fractionable: false })
      expect(updated.name).toBe('Produto original')
      expect(updated.category).toBe('beverage')
      expect(updated.units_per_package).toBe(12)
      expect(updated.package_type).toBe('fardo')
      expect(updated.fractionable).toBe(false)
    })

    it('update links and unlinks the declared supplier, leaving other fields alone', async () => {
      const product = await createProduct('Produto com fornecedor')
      expect(product.supplier_id).toBeNull()

      const linked = await products.update(product.id, { supplierId: 7 })
      expect(linked.supplier_id).toBe(7)
      expect(linked.name).toBe('Produto com fornecedor')

      const untouched = await products.update(product.id, { packageType: 'caixa' })
      expect(untouched.supplier_id).toBe(7)

      const unlinked = await products.update(product.id, { supplierId: null })
      expect(unlinked.supplier_id).toBeNull()
    })

    it('list and findById also return packaging fields', async () => {
      const sku = unique('SKU')
      createdSkus.push(sku)
      const created = await products.create({
        sku,
        name: 'Outro produto',
        category: 'meal',
        unitsPerPackage: 6,
        packageType: 'pacote',
        fractionable: true,
      })
      const found = await products.findById(created.id)
      expect(found.units_per_package).toBe(6)
      const listed = (await products.list('meal')).find(p => p.sku === sku)
      expect(listed?.package_type).toBe('pacote')
    })
  })

  describe('shelf_life_days', () => {
    // Not accepted by create()/update() — populated by the ingestion pipeline
    // via a different write path — so this sets it directly on the record,
    // the way a real perishable product actually gets it.
    it('findById and list return shelf_life_days once set on the record', async () => {
      const product = await createProduct('Produto perecível')
      await prisma.product.update({ where: { id: product.id }, data: { shelf_life_days: 5 } })

      const found = await products.findById(product.id)
      expect(found.shelf_life_days).toBe(5)

      const listed = (await products.list()).find(p => p.id === product.id)
      expect(listed?.shelf_life_days).toBe(5)
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

    it('adds a corrective version when re-recording the same effective date, keeping the earlier one', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-06-01'), 300)
      await costs.recordCost(product.sku, new Date('2026-06-01'), 320, { source: 'manual', actor: 'ana@agiliz.ai', reason: 'correção' })

      const versions = await costs.listVersions(product.id)
      expect(versions.map(v => v.cost_cents)).toEqual([300, 320])
      expect((await costs.costAsOf(product.sku, new Date('2026-06-15'))).cost_cents).toBe(320)
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

  describe('several EANs per product', () => {
    /** 13 digits, unique per call: real barcodes would collide between runs. */
    const newEan = () => String(1_000_000_000_000 + Math.floor(Math.random() * 8_999_999_999_999))
    const productWith = async (ean?: string) => {
      const sku = unique('SKU')
      createdSkus.push(sku)
      return products.create({ sku, name: unique('Suflair'), category: 'snack', ean })
    }
    const statusOf = async (productId: number) => Object.fromEntries((await eans.list(productId)).map(link => [link.ean, link]))

    it('registers a product with one EAN, which is active and the principal', async () => {
      const ean = newEan()
      const product = await productWith(ean)

      expect(product.ean).toBe(ean)
      expect(product.eans).toHaveLength(1)
      expect(product.eans[0]).toMatchObject({ ean, status: 'active', is_primary: true })
    })

    it('adds a second EAN to the same product: both are listed and it is still one product', async () => {
      const [oldEan, newer] = [newEan(), newEan()]
      const product = await productWith(oldEan)
      await eans.add(product.id, { ean: newer, source: 'manual', actor: 'ana@agiliz.ai', note: 'embalagem nova' })

      const view = await products.findById(product.id)
      expect(view.eans.map(link => link.ean).sort()).toEqual([oldEan, newer].sort())
      expect(view.sku).toBe(product.sku)
      // Adding a second EAN does not take the principal away from the first unless asked.
      expect(view.ean).toBe(oldEan)
    })

    it('retiring the old EAN keeps it in the history, inactive with an end date, and the new one becomes the principal', async () => {
      const [oldEan, newer] = [newEan(), newEan()]
      const product = await productWith(oldEan)
      await eans.add(product.id, { ean: newer, retireCurrent: true, validFrom: '2026-10-10', source: 'manual', actor: 'ana@agiliz.ai' })

      const links = await statusOf(product.id)
      expect(links[oldEan]).toMatchObject({ status: 'inactive', is_primary: false, valid_to: '2026-10-09' })
      expect(links[newer]).toMatchObject({ status: 'active', is_primary: true, valid_from: '2026-10-10' })
      expect((await products.findById(product.id)).ean).toBe(newer)
    })

    it('an inactive EAN is marked inactive with an end date and is never deleted', async () => {
      const [first, second] = [newEan(), newEan()]
      const product = await productWith(first)
      await eans.add(product.id, { ean: second, source: 'manual', actor: 'ana@agiliz.ai' })
      const link = (await statusOf(product.id))[first]

      await eans.update(product.id, link.id, { status: 'inactive', validTo: '2026-10-09' })

      const after = await statusOf(product.id)
      expect(after[first]).toMatchObject({ status: 'inactive', is_primary: false, valid_to: '2026-10-09' })
      expect(Object.keys(after)).toHaveLength(2)
    })

    it('resolves both the old and the new EAN to the same SKU, the old one marked as historical', async () => {
      const [oldEan, newer] = [newEan(), newEan()]
      const product = await productWith(oldEan)
      await eans.add(product.id, { ean: newer, retireCurrent: true, source: 'manual', actor: 'ana@agiliz.ai' })

      const result = await eans.resolve([oldEan, newer])

      expect(result.unresolved).toEqual([])
      expect(result.resolved.map(r => [r.ean, r.match, r.product.sku])).toEqual([
        [oldEan, 'historical', product.sku],
        [newer, 'active', product.sku],
      ])
    })

    it('an old invoice (old EAN) and a new one (new EAN) feed the same SKU, so the history stays one', async () => {
      const [oldEan, newer] = [newEan(), newEan()]
      const product = await productWith(oldEan)
      await eans.add(product.id, { ean: newer, retireCurrent: true, source: 'manual', actor: 'ana@agiliz.ai' })

      const bySku = async (ean: string) => (await eans.resolve([ean])).resolved[0].product.sku
      await costs.recordCost(await bySku(oldEan), new Date('2026-08-01'), 570, { source: 'catalogue_sync' })
      await costs.recordCost(await bySku(newer), new Date('2026-10-10'), 620, { source: 'catalogue_sync' })

      const versions = await costs.listVersions(product.id)
      expect(versions.map(v => v.cost_cents)).toEqual([570, 620])
    })

    it('an EAN no product has is "not identified" and no product is created', async () => {
      const before = await prisma.product.count()
      const unknown = newEan()

      const result = await eans.resolve([unknown])

      expect(result.resolved).toEqual([])
      expect(result.unresolved).toEqual([{ ean: unknown, unresolved: 'ean_not_identified' }])
      expect(await prisma.product.count()).toBe(before)
    })

    it('an invalid EAN is reported as invalid, not as unknown', async () => {
      expect((await eans.resolve(['7.89856E+12'])).unresolved).toEqual([{ ean: '7.89856E+12', unresolved: 'ean_invalid' }])
    })

    it('refuses an EAN that is active on another product, naming it', async () => {
      const ean = newEan()
      const owner = await productWith(ean)
      const other = await productWith()

      await expect(eans.add(other.id, { ean, source: 'manual', actor: 'ana@agiliz.ai' })).rejects.toThrow(new RegExp(owner.sku))
      expect((await products.findById(other.id)).eans).toEqual([])
    })

    it('refuses to create a product with an EAN that is linked to another one, active or historical', async () => {
      const [oldEan, newer] = [newEan(), newEan()]
      const owner = await productWith(oldEan)
      await expect(products.create({ sku: unique('SKU'), name: 'Outro', category: 'snack', ean: oldEan })).rejects.toThrow(/pertence/)

      await eans.add(owner.id, { ean: newer, retireCurrent: true, source: 'manual', actor: 'ana@agiliz.ai' })
      await expect(products.create({ sku: unique('SKU'), name: 'Outro', category: 'snack', ean: oldEan })).rejects.toThrow(/já pertenceu/)
    })

    it('an EAN that is historical on two products is ambiguous and is not resolved', async () => {
      const ean = newEan()
      const [a, b] = [await productWith(ean), await productWith(newEan())]
      // Reached directly: the API never lets an active EAN move, so a historical clash comes from old data.
      await prisma.productEan.update({ where: { product_id_ean: { product_id: a.id, ean } }, data: { status: 'inactive', is_primary: false } })
      await prisma.productEan.create({ data: { product_id: b.id, ean, status: 'inactive', is_primary: false, source: 'other' } })

      const result = await eans.resolve([ean])

      expect(result.resolved).toEqual([])
      expect(result.unresolved[0]).toMatchObject({ ean, unresolved: 'ean_ambiguous' })
      expect([...(result.unresolved[0] as { candidates: string[] }).candidates].sort()).toEqual([a.sku, b.sku].sort())
    })

    it('one principal per product: changing it keeps the others active and linked', async () => {
      const [first, second] = [newEan(), newEan()]
      const product = await productWith(first)
      await eans.add(product.id, { ean: second, source: 'manual', actor: 'ana@agiliz.ai' })
      const links = await statusOf(product.id)

      await eans.update(product.id, links[second].id, { primary: true })

      const after = await statusOf(product.id)
      expect(after[second].is_primary).toBe(true)
      expect(after[first]).toMatchObject({ is_primary: false, status: 'active' })
    })

    it('an inactive EAN cannot be the principal, and can be reactivated unless it is active elsewhere', async () => {
      const [first, second] = [newEan(), newEan()]
      const product = await productWith(first)
      await eans.add(product.id, { ean: second, retireCurrent: true, source: 'manual', actor: 'ana@agiliz.ai' })
      const retired = (await statusOf(product.id))[first]

      await expect(eans.update(product.id, retired.id, { primary: true })).rejects.toThrow(/ativo/)
      await eans.update(product.id, retired.id, { status: 'active' })
      expect((await statusOf(product.id))[first]).toMatchObject({ status: 'active', valid_to: null })
    })

    it('the database itself refuses two active links of one EAN, two principals, and an inactive principal', async () => {
      const ean = newEan()
      const [a, b] = [await productWith(ean), await productWith()]

      await expect(prisma.productEan.create({ data: { product_id: b.id, ean, status: 'active', is_primary: false, source: 'other' } })).rejects.toThrow()
      const extra = newEan()
      await expect(prisma.productEan.create({ data: { product_id: a.id, ean: extra, status: 'active', is_primary: true, source: 'other' } })).rejects.toThrow()
      await expect(prisma.productEan.create({ data: { product_id: a.id, ean: newEan(), status: 'inactive', is_primary: true, source: 'other' } })).rejects.toThrow()
    })

    it('a manual EAN needs the user, an invalid EAN is refused, and nothing is written', async () => {
      const product = await productWith()

      await expect(eans.add(product.id, { ean: newEan(), source: 'manual' })).rejects.toThrow(/user/)
      await expect(eans.add(product.id, { ean: '123' })).rejects.toThrow(/EAN inválido/)
      expect((await products.findById(product.id)).eans).toEqual([])
    })
  })

  describe('the last received purchase by source (real SQL)', () => {
    const received = (item: number, invoiceNumber: string | null) => ({ source: 'invoice', supplierId: 5, purchaseId: 70 + item, purchaseItemId: item, sourceRef: `it-last-purchase:${unique(String(item))}`, ...(invoiceNumber ? { invoiceNumber } : {}), purchaseQuantity: 10, purchaseTotalCents: 10 * 600 })
    const manual = { source: 'manual', actor: 'teste', reason: 'Correção de teste' }
    const asOf = new Date('2026-10-31')

    it('a received purchase with an invoice and one without are both purchases: the last one, by the day it was received, wins', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-09-01'), 500, received(1, '13021'))
      await costs.recordCost(product.sku, new Date('2026-10-05'), 600, received(2, null))

      const purchase = (await costs.bulkCostAsOf([product.sku], asOf, ['invoice'])).resolved[0]

      expect(purchase).toMatchObject({ cost_cents: 600, effective_from: '2026-10-05', source: 'invoice', invoice_number: null })
    })

    it('a manual cost without a purchase is the cost in force, but never the last purchase', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-09-01'), 500, received(3, '13022'))
      await costs.recordCost(product.sku, new Date('2026-10-10'), 700, manual)

      const inForce = (await costs.bulkCostAsOf([product.sku], asOf)).resolved[0]
      const purchase = (await costs.bulkCostAsOf([product.sku], asOf, ['invoice'])).resolved[0]

      expect(inForce).toMatchObject({ cost_cents: 700, source: 'manual' })
      expect(purchase).toMatchObject({ cost_cents: 500, effective_from: '2026-09-01', source: 'invoice' })
    })

    it('a product that only has a manual cost has no last purchase: no fall back to the manual one', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-09-01'), 700, manual)

      const result = await costs.bulkCostAsOf([product.sku], asOf, ['invoice'])

      expect(result.resolved).toEqual([])
      expect(result.unresolved).toEqual([{ sku: product.sku, reason: 'no_cost_for_date' }])
    })

    it('an old purchase registered later does not become the last purchase: the day it was received decides', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-10-05'), 600, received(4, '13030'))
      // Registered afterwards, but received in August.
      await costs.recordCost(product.sku, new Date('2026-08-10'), 450, received(5, '13031'))

      const purchase = (await costs.bulkCostAsOf([product.sku], asOf, ['invoice'])).resolved[0]
      const august = (await costs.bulkCostAsOf([product.sku], new Date('2026-08-31'), ['invoice'])).resolved[0]

      expect(purchase).toMatchObject({ cost_cents: 600, effective_from: '2026-10-05' })
      expect(august).toMatchObject({ cost_cents: 450, effective_from: '2026-08-10' })
    })

    it('without sources the answer is the same as before: every origin competes', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-09-01'), 500, received(6, '13040'))
      await costs.recordCost(product.sku, new Date('2026-10-10'), 700, manual)

      expect((await costs.bulkCostAsOf([product.sku], asOf)).resolved[0].cost_cents).toBe(700)
      expect((await costs.bulkCostAsOf([product.sku], asOf, [])).resolved[0].cost_cents).toBe(700)
    })
  })

  describe('invoice costs (real SQL)', () => {
    const invoiceMeta = (item: number) => ({ source: 'invoice', supplierId: 5, purchaseId: 9, purchaseItemId: item, sourceRef: `it-purchase-item:${unique(String(item))}`, invoiceNumber: '13021', purchaseQuantity: 150, purchaseTotalCents: 93000 })

    it('a rise creates the version with its provenance and reports the cost it replaced; the same cost afterwards creates nothing', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-08-01'), 570, { source: 'catalogue_sync' })

      const rise = await costs.recordCost(product.sku, new Date('2026-10-10'), 620, invoiceMeta(1))
      expect(rise).toMatchObject({ created: true, unchanged: false, previous_cost_cents: 570, cost_cents: 620 })

      const same = await costs.recordCost(product.sku, new Date('2026-10-20'), 620, invoiceMeta(2))
      expect(same).toMatchObject({ created: false, unchanged: true })

      const versions = await costs.listVersions(product.id)
      expect(versions.map(v => [v.cost_cents, v.source, v.valid_to])).toEqual([
        [570, 'catalogue_sync', '2026-10-09'],
        [620, 'invoice', null],
      ])
      expect(versions[1]).toMatchObject({ supplier_id: 5, purchase_id: 9, invoice_number: '13021', purchase_quantity: 150, purchase_total_cents: 93000 })
    })

    it('the same idempotency key creates the version once, even when sent twice', async () => {
      const product = await createProduct(unique('Produto'))
      const meta = invoiceMeta(7)
      await costs.recordCost(product.sku, new Date('2026-10-10'), 850, meta)
      const again = await costs.recordCost(product.sku, new Date('2026-10-10'), 850, meta)

      expect(again.created).toBe(false)
      expect(await prisma.costVersion.count({ where: { product_id: product.id } })).toBe(1)
    })

    it('the history of a product keeps August at the August cost after the October invoice (acceptance case, real SQL)', async () => {
      const product = await createProduct(unique('Produto'))
      await costs.recordCost(product.sku, new Date('2026-08-01'), 570, { source: 'catalogue_sync' })
      const august = await costs.costAsOf(product.sku, new Date('2026-08-31'))
      await costs.recordCost(product.sku, new Date('2026-10-10'), 620, invoiceMeta(3))

      expect(await costs.costAsOf(product.sku, new Date('2026-08-31'))).toEqual(august)
      expect((await costs.costAsOf(product.sku, new Date('2026-10-31'))).cost_cents).toBe(620)
    })
  })

  describe('registration from an invoice line (real SQL)', () => {
    const fromInvoice = (sku: string, over: Record<string, unknown> = {}) => ({
      sku, name: 'Novo sabor de marmita', category: 'beverage' as const, ean: String(7890000000000 + Math.floor(Math.random() * 1e9)),
      origin: 'invoice' as const, invoiceNumber: '13021', supplierId: 5, purchaseId: 9, originOn: '2026-10-10', actor: 'ana@agiliz.ai', saleUnit: 'un', subcategory: 'Energéticos', ...over,
    })

    it('creates the product with its origin, the invoice EAN as active principal, and shows it like any other product', async () => {
      const sku = unique('NF')
      createdSkus.push(sku)
      const created = await products.create(fromInvoice(sku, { ean: '7891000100103' }))

      expect(created.origin).toEqual({ type: 'invoice', invoice_number: '13021', supplier_id: 5, purchase_id: 9, on: '2026-10-10', actor: 'ana@agiliz.ai' })
      expect(created).toMatchObject({ ean: '7891000100103', supplier_id: 5, sale_unit: 'un' })
      expect(created.eans).toHaveLength(1)
      expect(created.eans[0]).toMatchObject({ status: 'active', is_primary: true, source: 'invoice_import', actor: 'ana@agiliz.ai', valid_from: '2026-10-10' })

      const listed = (await products.list()).find(p => p.sku === sku)
      expect(listed?.origin.type).toBe('invoice')
    })

    it('refuses a duplicate SKU and creates nothing', async () => {
      const sku = unique('NF')
      createdSkus.push(sku)
      await products.create(fromInvoice(sku))

      await expect(products.create(fromInvoice(sku))).rejects.toThrow(/already exists/)
      expect(await prisma.product.count({ where: { sku } })).toBe(1)
    })

    it('refuses an EAN that already belongs to another product, naming it, and creates no product', async () => {
      const owner = await createProduct('Dono do EAN')
      await eans.add(owner.id, { ean: '7891000200207', source: 'manual', actor: 'ana@agiliz.ai' })
      const sku = unique('NF')

      await expect(products.create(fromInvoice(sku, { ean: '7891000200207' }))).rejects.toThrow(new RegExp(owner.sku))
      expect(await prisma.product.count({ where: { sku } })).toBe(0)
    })

    it('an invoice origin without its evidence is refused, and the database refuses it too', async () => {
      const sku = unique('NF')
      await expect(products.create(fromInvoice(sku, { invoiceNumber: undefined }))).rejects.toThrow(/invoiceNumber/)
      await expect(prisma.product.create({ data: { sku, name: 'x', normalized_name: 'x', category: 'meal', origin: 'invoice' } })).rejects.toThrow()
    })

    it('the products loaded before keep an origin that says so', async () => {
      const manual = await createProduct('Manual')
      expect(manual.origin.type).toBe('manual')
    })

    it('suggests the next number after the highest six-digit SKU, as a suggestion', async () => {
      createdSkus.push('918001', '918007')
      await products.create({ sku: '918001', name: 'a', category: 'meal' })
      await products.create({ sku: '918007', name: 'b', category: 'meal' })

      const suggestion = await products.nextSku()
      expect(suggestion.suggestion).toBe(true)
      expect(Number(suggestion.suggested)).toBe(Number(suggestion.highest) + 1)
      expect(Number(suggestion.highest)).toBeGreaterThanOrEqual(918007)
    })
  })

  describe('editing a product (real SQL)', () => {
    it('reads status and subcategory, and edits status, subcategory and sale unit without touching anything else', async () => {
      const product = await createProduct('Para editar')
      expect(product).toMatchObject({ status: 'active', subcategory: null, sale_unit: 'un' })

      const edited = await products.update(product.id, { subcategory: 'Chás', status: 'discontinued', saleUnit: 'porção' })

      expect(edited).toMatchObject({ status: 'discontinued', subcategory: 'Chás', sale_unit: 'porção', name: 'Para editar', sku: product.sku })
      expect((await products.findById(product.id)).status).toBe('discontinued')
      expect(edited.origin.type).toBe('manual')

      expect((await products.update(product.id, { subcategory: null })).subcategory).toBeNull()
    })
  })

  describe('Excel import (real SQL)', () => {
    const rowOf = (over: Record<string, unknown>) => ({ row: 2, category: 'Bebida', ...over })
    const track = (...skus: string[]) => createdSkus.push(...skus)

    it('previews without writing, applies creating with the excel origin, and a second run finds everything unchanged', async () => {
      const sku = unique('IMP')
      const ean = String(7893000000000 + Math.floor(Math.random() * 1e8))
      track(sku)
      const rows = [rowOf({ sku, name: 'Importado', brand: 'Marca X', purchaseUnit: 'CX', unitsPerPackage: 12, packageType: 'caixa', ean })]

      const preview = await importer.preview(rows)
      expect(preview.summary).toEqual({ create: 1, update: 0, unchanged: 0, conflict: 0 })
      expect(await prisma.product.count({ where: { sku } })).toBe(0)

      const applied = await importer.apply(rows, {}, 'ana@agiliz.ai')
      expect(applied.results).toEqual([{ row: 2, sku, action: 'create', ok: true }])
      const created = await prisma.product.findUniqueOrThrow({ where: { sku }, include: { eans: true } })
      expect(created).toMatchObject({ name: 'Importado', brand: 'Marca X', purchase_unit: 'CX', units_per_package: 12, package_type: 'caixa', origin: 'excel', origin_actor: 'ana@agiliz.ai' })
      expect(created.eans).toHaveLength(1)

      const again = await importer.apply(rows, {}, 'ana@agiliz.ai')
      expect(again.summary).toEqual({ create: 0, update: 0, unchanged: 1, conflict: 0 })
      expect(await prisma.product.count({ where: { sku } })).toBe(1)
    })

    it('an empty cell keeps the value; only the clearing option clears it; an EAN of another product is a conflict and nothing moves', async () => {
      const owner = await createProduct('Dono')
      await eans.add(owner.id, { ean: '7893111111111', source: 'other', actor: 'ana@agiliz.ai' })
      const sku = unique('IMP')
      track(sku)
      await products.create({ sku, name: 'Com marca', category: 'beverage', brand: 'Marca Y', subcategory: 'Chás' })

      const keep = await importer.apply([rowOf({ sku, name: 'Com marca', brand: '', subcategory: '' })], {}, 'ana@agiliz.ai')
      expect(keep.summary.unchanged).toBe(1)
      expect(await prisma.product.findUniqueOrThrow({ where: { sku } })).toMatchObject({ brand: 'Marca Y', subcategory: 'Chás' })

      const clear = await importer.apply([rowOf({ sku, name: 'Com marca', brand: '', subcategory: '' })], { clearEmpty: true }, 'ana@agiliz.ai')
      expect(clear.summary.update).toBe(1)
      expect(await prisma.product.findUniqueOrThrow({ where: { sku } })).toMatchObject({ brand: null, subcategory: null })

      const conflict = await importer.apply([rowOf({ sku, ean: '7893111111111' })], {}, 'ana@agiliz.ai')
      expect(conflict.summary.conflict).toBe(1)
      expect(conflict.results[0]).toMatchObject({ ok: false })
      expect(await prisma.productEan.count({ where: { ean: '7893111111111' } })).toBe(1)
    })

    it('adds a new EAN to an existing product as an additional code, and the search by that EAN finds the same product', async () => {
      const sku = unique('IMP')
      track(sku)
      const product = await products.create({ sku, name: 'Dois códigos', category: 'beverage', ean: '7893222222222' })

      await importer.apply([rowOf({ sku, ean: '7893222222333' })], {}, 'ana@agiliz.ai')

      const links = await prisma.productEan.findMany({ where: { product_id: product.id }, orderBy: { id: 'asc' } })
      expect(links.map(l => [l.ean, l.is_primary, l.status])).toEqual([['7893222222222', true, 'active'], ['7893222222333', false, 'active']])
    })

    it('never deletes: a product that is not in the file stays', async () => {
      const other = await createProduct('Fora da planilha')
      await importer.apply([rowOf({ sku: unique('IMP'), name: 'Outro' })], {}, 'ana@agiliz.ai').catch(() => undefined)

      expect(await prisma.product.count({ where: { id: other.id } })).toBe(1)
    })
  })

  describe('last change and the new fields (real SQL)', () => {
    it('reports the latest time a cost or a product was recorded', async () => {
      const before = await products.lastChange()
      const product = await createProduct('Muda')
      await costs.recordCost(product.sku, new Date('2026-10-01'), 500, { source: 'catalogue_sync' })
      const after = await products.lastChange()

      expect(after.latest && before.latest ? after.latest >= before.latest : true).toBe(true)
      expect(after.cost_changed_at).not.toBeNull()
      expect(after.product_changed_at).not.toBeNull()
    })

    it('edits brand and purchase unit, and clears them with null', async () => {
      const product = await createProduct('Marca')
      const edited = await products.update(product.id, { brand: 'Monster', purchaseUnit: 'FD', unitsPerPackage: 6, packageType: 'fardo' })
      expect(edited).toMatchObject({ brand: 'Monster', purchase_unit: 'FD', units_per_package: 6, package_type: 'fardo' })

      const cleared = await products.update(product.id, { brand: null, purchaseUnit: null, unitsPerPackage: null, packageType: null })
      expect(cleared).toMatchObject({ brand: null, purchase_unit: null, units_per_package: null, package_type: null })
    })
  })

  describe('taxonomy (real SQL)', () => {
    const made: number[] = []
    afterAll(async () => {
      // Test categories only; the seeded ones are never touched.
      await prisma.subcategory.deleteMany({ where: { category_id: { in: made } } })
      await prisma.category.deleteMany({ where: { id: { in: made } } })
    })

    it('starts from what already exists: the four category keys, active, with their products counted', async () => {
      const list = await taxonomy.list()

      expect(list.map(c => c.key)).toEqual(expect.arrayContaining(['meal', 'snack', 'beverage', 'essential']))
      expect(list.filter(c => ['meal', 'snack', 'beverage', 'essential'].includes(c.key)).every(c => c.status === 'active')).toBe(true)
    })

    it('creates a category with a generated key, refuses a duplicate name ignoring case and accents, and never deletes', async () => {
      const name = unique('Congelados')
      const created = await taxonomy.createCategory({ name, keywords: ['sorvete', 'Sorvete', ' picolé '] })
      made.push(created.id)

      expect(created.key).toMatch(/^congelados-/)
      expect(created.keywords).toEqual(['sorvete', 'picolé'])
      await expect(taxonomy.createCategory({ name: name.toUpperCase() })).rejects.toThrow(/Já existe a categoria/)
      await expect(taxonomy.createCategory({ name: '   ' })).rejects.toThrow(/obrigatório/)
      // The database refuses the same name in another case too (not only the service).
      await expect(prisma.category.create({ data: { key: unique('x'), name: name.toLowerCase() } })).rejects.toThrow()
    })

    it('a subcategory belongs to one category, its name is unique within that category only, and a product can only take its own category\'s subcategories', async () => {
      const a = await taxonomy.createCategory({ name: unique('CatA') })
      const b = await taxonomy.createCategory({ name: unique('CatB') })
      made.push(a.id, b.id)

      await taxonomy.createSubcategory(a.id, { name: 'Gelados' })
      await expect(taxonomy.createSubcategory(a.id, { name: 'gelados' })).rejects.toThrow(/já tem a subcategoria/)
      await taxonomy.createSubcategory(b.id, { name: 'Gelados' })

      const sku = unique('TAX')
      createdSkus.push(sku)
      const ok = await products.create({ sku, name: 'Sorvete', category: a.key, subcategory: 'gelados' })
      expect(ok).toMatchObject({ category: a.key, subcategory: 'Gelados' })
      await expect(products.create({ sku: unique('TAX'), name: 'X', category: 'beverage', subcategory: 'Gelados' })).rejects.toThrow(/não pertence à categoria/)
      await expect(products.create({ sku: unique('TAX'), name: 'X', category: 'categoria-que-nao-existe' })).rejects.toThrow(/não existe no cadastro de categorias/)
    })

    it('renaming a subcategory renames it on its products; keywords and status are editable', async () => {
      const cat = await taxonomy.createCategory({ name: unique('CatR') })
      made.push(cat.id)
      const withSub = await taxonomy.createSubcategory(cat.id, { name: 'Antigo' })
      const sub = withSub.subcategories[0]
      const sku = unique('TAX')
      createdSkus.push(sku)
      await products.create({ sku, name: 'P', category: cat.key, subcategory: 'Antigo' })

      const renamed = await taxonomy.updateSubcategory(sub.id, { name: 'Novo nome', keywords: ['novo'] })

      expect(renamed.subcategories[0]).toMatchObject({ name: 'Novo nome', keywords: ['novo'], products: 1 })
      expect((await prisma.product.findUniqueOrThrow({ where: { sku } })).subcategory).toBe('Novo nome')
    })

    it('inactivating a used category keeps its products and history, stops offering it for new products, and a product keeps working', async () => {
      const cat = await taxonomy.createCategory({ name: unique('CatI') })
      made.push(cat.id)
      const sku = unique('TAX')
      createdSkus.push(sku)
      const product = await products.create({ sku, name: 'Antes de inativar', category: cat.key })

      const inactive = await taxonomy.updateCategory(cat.id, { status: 'inactive' })
      expect(inactive).toMatchObject({ status: 'inactive', products: 1 })
      await expect(products.create({ sku: unique('TAX'), name: 'Depois', category: cat.key })).rejects.toThrow(/inativa/)
      // The existing product is untouched and still editable without touching its category.
      expect((await products.update(product.id, { name: 'Renomeado' })).category).toBe(cat.key)
      expect(await prisma.product.count({ where: { sku } })).toBe(1)
    })

    it('there is no way to delete: the tables have no delete path in the service', () => {
      expect((taxonomy as unknown as Record<string, unknown>).deleteCategory).toBeUndefined()
      expect((taxonomy as unknown as Record<string, unknown>).deleteSubcategory).toBeUndefined()
    })

    it('a confirmed classification is marked when a person saves it, and an unconfirmed one is not', async () => {
      const a = unique('TAX')
      const b = unique('TAX')
      createdSkus.push(a, b)
      await products.create({ sku: a, name: 'Salvo pelo formulário', category: 'beverage', classificationConfirmed: true })
      await products.create({ sku: b, name: 'Vindo de importação', category: 'beverage' })

      expect((await prisma.product.findUniqueOrThrow({ where: { sku: a } })).classification_confirmed).toBe(true)
      expect((await prisma.product.findUniqueOrThrow({ where: { sku: b } })).classification_confirmed).toBe(false)
      const edited = await products.findById((await prisma.product.findUniqueOrThrow({ where: { sku: b } })).id)
      expect((await products.update(edited.id, { subcategory: null })).sku).toBe(b)
      expect((await prisma.product.findUniqueOrThrow({ where: { sku: b } })).classification_confirmed).toBe(true)
    })
  })

  describe('classification (real SQL)', () => {
    it('suggests from the name over the seeded taxonomy: a clear match, an alternative list when ambiguous, nothing otherwise, and never a new category', async () => {
      const before = (await taxonomy.list()).length
      const energy = await taxonomy.suggest('Monster Energy 269 ml')
      const none = await taxonomy.suggest('Cadeira de praia azul')

      expect(energy.confidence).toBe('clear')
      expect(energy.best).toMatchObject({ categoryKey: 'beverage', subcategory: 'Energéticos' })
      expect(none).toEqual({ confidence: 'none', best: null, alternatives: [] })
      expect((await taxonomy.list()).length).toBe(before)
    })

    it('the review proposes without applying, and apply changes only the selected items and confirms them', async () => {
      const sku = unique('REV')
      const other = unique('REV')
      createdSkus.push(sku, other)
      await products.create({ sku, name: 'Monster Energy Mango', category: 'beverage' })
      await products.create({ sku: other, name: 'Monster Energy Ultra', category: 'beverage' })

      const review = await taxonomy.review()
      const item = review.find(r => r.sku === sku)
      expect(item).toMatchObject({ proposed: { category: 'beverage', subcategory: 'Energéticos' }, current: { subcategory: null } })
      expect((await prisma.product.findUniqueOrThrow({ where: { sku } })).subcategory).toBeNull()

      const applied = await taxonomy.apply([{ sku, category: 'beverage', subcategory: 'Energéticos' }], 'ana@agiliz.ai')

      expect(applied.applied).toBe(1)
      expect(await prisma.product.findUniqueOrThrow({ where: { sku } })).toMatchObject({ subcategory: 'Energéticos', classification_confirmed: true })
      expect((await prisma.product.findUniqueOrThrow({ where: { sku: other } })).subcategory).toBeNull()
      const refused = await taxonomy.apply([{ sku: other, category: 'snack', subcategory: 'Energéticos' }], 'ana@agiliz.ai')
      expect(refused.results[0]).toMatchObject({ ok: false })
    })
  })

  describe('pricing-sheet sync respects the taxonomy (real SQL)', () => {
    const row = (sku: string, subcategory: string | null) => ({ row: 2, sku, name: `Planilha ${sku}`, category: 'Bebidas', subcategory, ean: null, supplier: null, cost_cents: 500, cost_error: false, price_cents: 1000, package_type: null })

    it('creates a product whose subcategory exists in its category, in the canonical spelling, and refuses one the taxonomy does not know', async () => {
      const good = unique('SYN')
      const bad = unique('SYN')
      createdSkus.push(good, bad)

      const results = await sync.apply([row(good, 'energeticos'), row(bad, 'Subcategoria que não existe')], { create: [good, bad], costs: [], prices: [] }, '2026-10-01', '2026-10-01')

      expect(results.find(r => r.sku === good)).toMatchObject({ ok: true })
      expect((await prisma.product.findUniqueOrThrow({ where: { sku: good } })).subcategory).toBe('Energéticos')
      expect(results.find(r => r.sku === bad)).toMatchObject({ ok: false, error: expect.stringContaining('não pertence à categoria') })
      expect(await prisma.product.count({ where: { sku: bad } })).toBe(0)
    })
  })
})
