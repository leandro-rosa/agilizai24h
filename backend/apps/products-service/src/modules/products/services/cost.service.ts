import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CostVersionRepository } from '../../db-client/repositories/cost-version.repository'
import { ProductRepository } from '../../db-client/repositories/product.repository'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { UNRESOLVED_REASONS } from '../constants/product-vocabulary'
import { resolveCostAsOf } from '../utils/resolve-cost'

// The response shape lives in the shared contracts package, so finance and
// supply consume the same types rather than restating a lookalike. In
// particular BulkCostResult is partitioned, not a map — see that package.
export type { BulkCostResult, ResolvedCost, UnresolvedCost } from '@app/products-contracts'
import type { BulkCostResult, ResolvedCost, UnresolvedCost } from '@app/products-contracts'

@Injectable()
export class CostService {
  constructor(
    private readonly products: ProductRepository,
    private readonly costs: CostVersionRepository,
    private readonly prisma: PrismaClientService,
  ) {}

  /**
   * Records a cost effective from a date. Re-recording for a date that already
   * has a version replaces that version; it never creates a second one, and it
   * never touches any other version.
   */
  async recordCost(sku: string, effectiveFrom: Date, costCents: number): Promise<ResolvedCost> {
    if (!Number.isInteger(costCents) || costCents < 0) {
      throw new BadRequestException('cost_cents must be a non-negative integer in minor units')
    }

    const product = await this.prisma.product.findUnique({ where: { sku } })
    if (!product) throw new NotFoundException(`Unknown SKU ${sku}`)

    const version = await this.prisma.costVersion.upsert({
      where: { product_id_effective_from: { product_id: product.id, effective_from: effectiveFrom } },
      create: { product_id: product.id, effective_from: effectiveFrom, cost_cents: costCents },
      update: { cost_cents: costCents },
    })

    return {
      sku,
      product_id: product.id,
      cost_cents: version.cost_cents,
      effective_from: toDateString(version.effective_from),
    }
  }

  /**
   * The cost in effect on a date. There is no operation returning a "current"
   * cost without a date: an implicit one would be right for the dashboard and
   * wrong for every historical read, with nothing in its signature to warn the
   * caller. Forcing the date to the call site makes the temporal question
   * visible where the decision is actually made.
   */
  async costAsOf(sku: string, asOf: Date): Promise<ResolvedCost> {
    const result = await this.bulkCostAsOf([sku], asOf)

    if (result.resolved.length === 0) {
      const reason = result.unresolved[0]?.reason
      throw new NotFoundException(
        reason === UNRESOLVED_REASONS.UNKNOWN_SKU
          ? `Unknown SKU ${sku}`
          : `No cost known for SKU ${sku} as of ${toDateString(asOf)}`,
      )
    }

    return result.resolved[0]
  }

  async bulkCostAsOf(skus: string[], asOf: Date): Promise<BulkCostResult> {
    const requested = [...new Set(skus)]
    const products = await this.products.findBySkus(requested)
    const bySku = new Map(products.map(product => [product.sku, product]))

    const resolved: ResolvedCost[] = []
    const unresolved: UnresolvedCost[] = []

    const versions = products.length
      ? await this.costs.findEffectiveForProducts(
          products.map(product => product.id),
          asOf,
        )
      : []
    const byProduct = new Map(versions.map(version => [version.product_id, version]))

    for (const sku of requested) {
      const product = bySku.get(sku)

      if (!product) {
        unresolved.push({ sku, reason: UNRESOLVED_REASONS.UNKNOWN_SKU })
        continue
      }

      // DISTINCT ON already narrowed to the effective version per product; the
      // pure helper re-applies the same rule so the two can be tested against
      // each other rather than trusting the query alone.
      const version = resolveCostAsOf(byProduct.get(product.id) ? [byProduct.get(product.id)!] : [], asOf)

      if (!version) {
        // Distinct from a recorded cost of zero, which resolves normally.
        unresolved.push({ sku, reason: UNRESOLVED_REASONS.NO_COST_FOR_DATE })
        continue
      }

      resolved.push({
        sku,
        product_id: product.id,
        cost_cents: version.cost_cents,
        effective_from: toDateString(version.effective_from),
      })
    }

    return {
      as_of: toDateString(asOf),
      resolved,
      unresolved,
      complete: unresolved.length === 0,
    }
  }

  listVersions(productId: number) {
    return this.costs.findAllForProduct(productId)
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}
