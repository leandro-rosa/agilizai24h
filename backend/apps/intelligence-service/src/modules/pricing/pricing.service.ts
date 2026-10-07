import { Injectable, NotFoundException } from '@nestjs/common'
import { isSynthetic } from '../../common/synthetic'
import { FactsLoader, lastDayOf } from '../analysis/analysis.facts'
import { PurchaseSource } from '../analysis/purchase-source'
import { monthsBetween, shiftMonth } from '../refresh/months'
import { AccountingClient } from '../sources/accounting.client'
import { ProductsClient } from '../sources/products.client'
import { SalesClient } from '../sources/sales.client'
import { StoresClient } from '../sources/stores.client'
import { SuppliersClient } from '../sources/suppliers.client'
import { SupplyClient } from '../sources/supply.client'
import { TreasuryClient } from '../sources/treasury.client'
import { chooseLoss, type LossObservation } from './loss'
import { operatingShare, type OperatingShare } from './operating-share'
import { paymentCost, type FeeRate, type MixRow } from './payment-cost'
import { computePrice, type PriceInput, type PriceResult } from './price'
import { PricingParametersService } from './pricing-parameters.service'
import { suggestNewProduct, type NewProductSuggestion } from './new-product'
import { ENGINE_VERSION, type PaymentCost } from './pricing.types'
import { byCategory, summarise, type CategorySummary, type PricingSummary } from './summary'

export interface PricingQuery {
  /** Last month of the window, `YYYY-MM`. Defaults to the last closed month. */
  period?: string
  storeId?: number
  skus?: string[]
}

export interface PricingReport {
  meta: {
    engineVersion: string
    parameterVersion: number
    /** The months read and the day costs and prices were resolved as of. */
    months: string[]
    asOf: string
    storeId: number | null
    /** Explains how the shared components were built, so no number is read as more certain than it is. */
    payment: Pick<PaymentCost, 'voucherShare' | 'voucherBasis' | 'unresolvedShare' | 'complete' | 'notes' | 'components'> & { rate: number } | null
    paymentMixMonthsWithoutTransactions: string[]
    operating: Pick<OperatingShare, 'share' | 'months' | 'accounts'> | null
    notes: string[]
  }
  summary: PricingSummary
  categories: CategorySummary[]
  products: PriceResult[]
}

const DAY_MS = 86_400_000
const currentMonth = () => new Date().toISOString().slice(0, 7)
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS))

interface SkuFacts {
  sold: number
  restocked: number
  lost: number
  revenueCents: number
  soldByMonth: number[]
}

/**
 * Assembles what the price engine needs from the services that own it — cost
 * and price (products), loss and volume (supply and sales), the payment mix
 * and fees (sales and treasury), the operating allocation (accounting) — and
 * runs the pure engine. Read-only: nothing here writes to any service, and no
 * price is ever changed.
 */
@Injectable()
export class PricingService {
  private readonly loader: FactsLoader

  constructor(
    supply: SupplyClient,
    private readonly sales: SalesClient,
    private readonly products: ProductsClient,
    private readonly stores: StoresClient,
    private readonly treasury: TreasuryClient,
    private readonly accounting: AccountingClient,
    private readonly suppliers: SuppliersClient,
    private readonly purchases: PurchaseSource,
    private readonly parameters: PricingParametersService,
  ) {
    this.loader = new FactsLoader(supply, sales)
  }

  async report(query: PricingQuery, correlationId?: string): Promise<PricingReport> {
    const c = await this.collect(query, correlationId)
    const results = c.inputs.map(computePrice)
    const revenueBySku = c.revenueBySku
    const { version, params, months, asOf, fees, mix, payment, operating } = c

    const notes: string[] = []
    if (params.taxRateBps === null) notes.push('A alíquota de imposto não está configurada: nenhum produto recebe recomendação até o dono confirmá-la.')
    if (fees.rates.length === 0) notes.push('Nenhuma taxa de pagamento cadastrada.')
    if (fees.methods_without_rate.length > 0 && fees.rates.length > 0) notes.push(`Métodos sem taxa cadastrada: ${fees.methods_without_rate.join(', ')}.`)
    if (mix.periods_without_transactions.length > 0) notes.push(`Meses sem detalhe de vendas por meio de pagamento: ${mix.periods_without_transactions.join(', ')}.`)
    if (!operating) notes.push('Sem DRE com receita de lojas no período: rateio operacional indisponível.')

    return {
      meta: {
        engineVersion: ENGINE_VERSION,
        parameterVersion: version.id,
        months,
        asOf,
        storeId: query.storeId ?? null,
        payment: payment ? { rate: payment.rate, voucherShare: payment.voucherShare, voucherBasis: payment.voucherBasis, unresolvedShare: payment.unresolvedShare, complete: payment.complete, notes: payment.notes, components: payment.components } : null,
        paymentMixMonthsWithoutTransactions: mix.periods_without_transactions,
        operating: operating ? { share: operating.share, months: operating.months, accounts: operating.accounts } : null,
        notes,
      },
      summary: summarise(results, params.margin.targetBps / 10_000, revenueBySku),
      categories: byCategory(results, revenueBySku),
      products: results,
    }
  }

  /**
   * A price suggestion for a product with no price (and usually no sales), from the same inputs and the same cost structure as the
   * report. The cost comes from the request when the invoice is not received yet (no cost version exists then), else from the product.
   * Read-only: it suggests, it never writes a price.
   */
  async newProduct(sku: string, options: { costCents?: number; costOrigin?: string; costNotReceived?: boolean; period?: string }, correlationId?: string): Promise<{ meta: Pick<PricingReport['meta'], 'engineVersion' | 'parameterVersion' | 'asOf' | 'months'>; suggestion: NewProductSuggestion }> {
    const c = await this.collect({ period: options.period, skus: [sku] }, correlationId)
    const input = c.inputs.find(candidate => candidate.sku === sku)
    if (!input) throw new NotFoundException(`Product ${sku} not found`)

    const fromRequest = options.costCents !== undefined
    const suggestion = suggestNewProduct({
      ...input,
      costCents: fromRequest ? options.costCents ?? null : input.costCents,
      costAgeDays: fromRequest ? 0 : input.costAgeDays,
      costFromPurchase: fromRequest ? true : input.costFromPurchase,
      costLabel: options.costOrigin ?? (fromRequest ? 'Nota fiscal' : 'Custo cadastrado'),
      costNotReceived: options.costNotReceived ?? false,
    })

    return { meta: { engineVersion: ENGINE_VERSION, parameterVersion: c.version.id, asOf: c.asOf, months: c.months }, suggestion }
  }

  /** Everything the engine needs for the scoped products, before the engine runs. */
  private async collect(query: PricingQuery, correlationId?: string) {
    const version = await this.parameters.current()
    const params = version.values
    const end = query.period ?? shiftMonth(currentMonth(), -1)
    const months = monthsBetween(shiftMonth(end, -(params.data.lookbackMonths - 1)), end)
    const asOf = lastDayOf(end)
    const beforeWindow = lastDayOf(shiftMonth(months[0], -1))

    const allStores = (await this.stores.stores(correlationId)).filter(store => !isSynthetic(store.name))
    const stores = query.storeId === undefined ? allStores : allStores.filter(store => store.id === query.storeId)
    if (query.storeId !== undefined && stores.length === 0) throw new NotFoundException(`Store ${query.storeId} not found`)

    const catalogue = (await this.products.products(correlationId)).filter(product => !isSynthetic(product.name))
    const wanted = query.skus?.length ? new Set(query.skus) : null
    const scoped = wanted ? catalogue.filter(product => wanted.has(product.sku)) : catalogue
    const skus = scoped.map(product => product.sku)

    const supplierNames = new Map((await this.suppliers.suppliers(correlationId)).map(supplier => [supplier.id, supplier.name]))

    const [facts, costsNow, costsLatest, costsBefore, pricesNow, pricesBefore, fees, mix, pnls, purchased] = await Promise.all([
      Promise.all(months.map(month => this.loader.month(month, stores, correlationId))),
      this.products.costsAsOf(skus, asOf, correlationId),
      // The cost in force TODAY, only to tell a cost newer than the period apart from the period's own cost.
      this.products.costsAsOf(skus, new Date().toISOString().slice(0, 10), correlationId),
      this.products.costsAsOf(skus, beforeWindow, correlationId),
      this.products.pricesAsOf(skus, asOf, correlationId),
      this.products.pricesAsOf(skus, beforeWindow, correlationId),
      this.treasury.feesInForce(asOf, correlationId),
      this.sales.paymentMix(months[0], end, query.storeId, correlationId),
      Promise.all(months.map(month => this.accounting.pnl(month, query.storeId, correlationId))),
      this.boughtSkus(skus, months),
    ])

    const category = new Map(catalogue.map(product => [product.sku, product.category ?? null]))
    const bySku = new Map<string, SkuFacts>()
    const byCat = new Map<string, LossObservation>()
    const scope: LossObservation = { lostUnits: 0, suppliedUnits: 0 }
    const monthsWithSales = facts.filter(month => month.storesMissingSales.length < Math.max(month.storeCount, 1)).length || 1

    facts.forEach((month, index) => {
      for (const cells of month.cells.values()) {
        for (const [sku, cell] of cells) {
          const entry = bySku.get(sku) ?? { sold: 0, restocked: 0, lost: 0, revenueCents: 0, soldByMonth: months.map(() => 0) }
          entry.sold += cell.sold
          entry.restocked += cell.restocked
          entry.lost += cell.lost
          entry.revenueCents += cell.revenueCents
          entry.soldByMonth[index] += cell.sold
          bySku.set(sku, entry)

          const group = category.get(sku)
          if (group) {
            const observed = byCat.get(group) ?? { lostUnits: 0, suppliedUnits: 0 }
            observed.lostUnits += cell.lost
            observed.suppliedUnits += cell.restocked
            byCat.set(group, observed)
          }
          scope.lostUnits += cell.lost
          scope.suppliedUnits += cell.restocked
        }
      }
    })

    const rates: FeeRate[] = fees.rates.map(rate => ({ acquirer: rate.acquirer, method: rate.payment_method, rateBps: rate.rate_bps, fixedCents: rate.fixed_cents ?? 0 }))
    const mixRows: MixRow[] = mix.rows.map(row => ({ method: row.method, acquirer: row.acquirer, cardBrand: row.card_brand, receiptLines: row.receipt_lines, amountCents: row.amount_paid_cents }))
    const payment = paymentCost(rates, mixRows, params.data.voucherMinReceiptLines, params.payment.brandAliases)
    const operating = operatingShare(pnls)

    const costNow = new Map(costsNow.resolved.map(cost => [cost.sku, cost]))
    const costLatest = new Map(costsLatest.resolved.map(cost => [cost.sku, cost]))
    const costBefore = new Map(costsBefore.resolved.map(cost => [cost.sku, cost.cost_cents]))
    const priceNow = new Map(pricesNow.resolved.map(price => [price.sku, price.price_cents]))
    const priceBefore = new Map(pricesBefore.resolved.map(price => [price.sku, price.price_cents]))

    const inputs = scoped.map((product): PriceInput => {
      const sku = product.sku
      const own = bySku.get(sku)
      const cost = costNow.get(sku)
      const units = own?.sold ?? 0
      const first = own?.soldByMonth[0] ?? 0
      const last = own?.soldByMonth[months.length - 1] ?? 0
      const priceRose = priceBefore.has(sku) && priceNow.has(sku) && (priceNow.get(sku) as number) > (priceBefore.get(sku) as number) * 1.005

      const input: PriceInput = {
        sku,
        name: product.name,
        category: product.category ?? null,
        subcategory: product.subcategory ?? null,
        ean: product.ean ?? null,
        supplierId: product.supplier_id ?? null,
        supplierName: product.supplier_id ? (supplierNames.get(product.supplier_id) ?? null) : null,
        // Registered from an invoice inside the window: a new product, whatever its sales so far.
        newProductOn: product.origin?.type === 'invoice' && product.origin.on && product.origin.on >= `${months[0]}-01` ? product.origin.on : null,
        costCents: cost?.cost_cents ?? null,
        costAgeDays: cost ? daysBetween(cost.effective_from, asOf) : null,
        costFromPurchase: purchased.has(sku),
        newerCost: ((): { costCents: number; effectiveFrom: string; source: string } | null => {
          const latest = costLatest.get(sku)
          return latest && latest.effective_from > asOf && latest.cost_cents !== cost?.cost_cents ? { costCents: latest.cost_cents, effectiveFrom: latest.effective_from, source: latest.source ?? 'other' } : null
        })(),
        costOrigin: cost?.source ? { source: cost.source, effectiveFrom: cost.effective_from, invoiceNumber: cost.invoice_number ?? null } : null,
        costFlaggedUnreliable: false,
        previousCostCents: costBefore.get(sku) ?? null,
        currentPriceCents: priceNow.get(sku) ?? null,
        monthlyUnits: units / monthsWithSales,
        monthlyRevenueCents: own ? own.revenueCents / monthsWithSales : null,
        volumeDroppedAfterPriceChange: priceRose && first > 0 && last < first * 0.8,
        loss: chooseLoss(
          {
            product: own ? { lostUnits: own.lost, suppliedUnits: own.restocked } : null,
            category: product.category ? byCat.get(product.category) : null,
            store: query.storeId !== undefined ? scope : null,
            network: query.storeId === undefined ? scope : null,
          },
          params.data.lossMinUnits,
        ),
        payment,
        operatingShare: operating?.share ?? null,
        params,
      }

      return input
    })

    const revenueBySku = new Map([...bySku].map(([sku, entry]) => [sku, entry.revenueCents]))

    return { version, params, months, asOf, fees, mix, payment, operating, inputs, revenueBySku }
  }

  /** One product, computed from the same inputs as the report. */
  async product(sku: string, query: Omit<PricingQuery, 'skus'>, correlationId?: string): Promise<{ meta: PricingReport['meta']; product: PriceResult }> {
    const report = await this.report({ ...query, skus: [sku] }, correlationId)
    const product = report.products.find(result => result.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    return { meta: report.meta, product }
  }

  /** SKUs bought in any month of the window — the cost of those comes from a real purchase. */
  private async boughtSkus(skus: string[], months: string[]): Promise<Set<string>> {
    const bought = new Set<string>()
    for (const month of months) {
      const rows = await this.purchases.month(skus, month)
      if (!rows) continue
      for (const [sku, row] of rows) if (row.cents > 0) bought.add(sku)
    }

    return bought
  }
}
