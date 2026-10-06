import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { normalizeName } from '../utils/normalize-name'
import { planSync, type CatalogueEntry, type SheetRow, type SyncPlan } from '../utils/catalogue-sync'

export interface SyncSelection {
  create: string[]
  costs: string[]
  prices: string[]
}

export interface SyncApplyResult {
  sku: string
  action: 'create' | 'cost' | 'price'
  ok: boolean
  error?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

@Injectable()
export class CatalogueSyncService {
  constructor(private readonly prisma: PrismaClientService) {}

  /** Estado atual: cada produto com o custo e o preço vigentes HOJE (últimas versões com início ≤ hoje). */
  private async currentCatalogue(): Promise<CatalogueEntry[]> {
    const today = new Date(new Date().toISOString().slice(0, 10))
    const [products, costs, prices] = await Promise.all([
      this.prisma.product.findMany({ select: { id: true, sku: true, name: true, ean: true } }),
      this.prisma.costVersion.findMany({
        where: { effective_from: { lte: today } },
        orderBy: [{ product_id: 'asc' }, { effective_from: 'desc' }],
        distinct: ['product_id'],
      }),
      this.prisma.priceVersion.findMany({
        where: { effective_from: { lte: today } },
        orderBy: [{ product_id: 'asc' }, { effective_from: 'desc' }],
        distinct: ['product_id'],
      }),
    ])
    const cost = new Map(costs.map(c => [c.product_id, c.cost_cents]))
    const price = new Map(prices.map(p => [p.product_id, p.price_cents]))
    return products.map(p => ({ sku: p.sku, name: p.name, ean: p.ean, cost_cents: cost.get(p.id) ?? null, price_cents: price.get(p.id) ?? null }))
  }

  /** Só calcula e devolve o plano — não grava nada. */
  async preview(rows: SheetRow[]): Promise<SyncPlan> {
    return planSync(rows, await this.currentCatalogue())
  }

  /**
   * Aplica só o que o operador marcou. O plano é recalculado aqui a partir das
   * linhas (nunca se confia no plano que veio do navegador) e cada item é
   * gravado separadamente: um erro num SKU não desfaz nem impede os outros.
   *
   * `newProductsFrom`: início de vigência do custo/preço de produto NOVO (o
   * produto passou a existir em setembro, não em janeiro). `changesFrom`: início
   * de vigência das MUDANÇAS em produtos existentes (nunca retroativas por
   * padrão — reprecificaria o histórico).
   */
  async apply(rows: SheetRow[], selection: SyncSelection, newProductsFrom: string, changesFrom: string): Promise<SyncApplyResult[]> {
    if (!DATE.test(newProductsFrom) || !DATE.test(changesFrom)) throw new BadRequestException('As datas devem ser YYYY-MM-DD')
    const plan = planSync(rows, await this.currentCatalogue())
    const results: SyncApplyResult[] = []
    const newDate = new Date(newProductsFrom)
    const changeDate = new Date(changesFrom)

    const recordCost = (productId: number, date: Date, cents: number) =>
      this.prisma.costVersion.upsert({
        where: { product_id_effective_from: { product_id: productId, effective_from: date } },
        create: { product_id: productId, effective_from: date, cost_cents: cents },
        update: { cost_cents: cents },
      })
    const recordPrice = (productId: number, date: Date, cents: number) =>
      this.prisma.priceVersion.upsert({
        where: { product_id_effective_from: { product_id: productId, effective_from: date } },
        create: { product_id: productId, effective_from: date, price_cents: cents },
        update: { price_cents: cents },
      })

    for (const item of plan.create.filter(c => selection.create.includes(c.sku))) {
      try {
        if (await this.prisma.product.findUnique({ where: { sku: item.sku } })) throw new Error('SKU já existe no catálogo')
        const product = await this.prisma.product.create({
          data: {
            sku: item.sku,
            name: item.name,
            category: item.category,
            normalized_name: normalizeName(item.name),
            subcategory: item.subcategory,
            ean: item.ean,
            package_type: item.package_type,
          },
        })
        if (item.cost_cents !== null) await recordCost(product.id, newDate, item.cost_cents)
        if (item.price_cents !== null) await recordPrice(product.id, newDate, item.price_cents)
        results.push({ sku: item.sku, action: 'create', ok: true })
      } catch (e) {
        results.push({ sku: item.sku, action: 'create', ok: false, error: (e as Error).message })
      }
    }

    const byId = async (sku: string) => this.prisma.product.findUnique({ where: { sku }, select: { id: true } })
    for (const item of plan.costs.filter(c => selection.costs.includes(c.sku))) {
      try {
        const p = await byId(item.sku)
        if (!p) throw new Error('SKU não encontrado')
        await recordCost(p.id, changeDate, item.new_cents)
        results.push({ sku: item.sku, action: 'cost', ok: true })
      } catch (e) {
        results.push({ sku: item.sku, action: 'cost', ok: false, error: (e as Error).message })
      }
    }
    for (const item of plan.prices.filter(c => selection.prices.includes(c.sku))) {
      try {
        const p = await byId(item.sku)
        if (!p) throw new Error('SKU não encontrado')
        await recordPrice(p.id, changeDate, item.new_cents)
        results.push({ sku: item.sku, action: 'price', ok: true })
      } catch (e) {
        results.push({ sku: item.sku, action: 'price', ok: false, error: (e as Error).message })
      }
    }
    return results
  }
}
