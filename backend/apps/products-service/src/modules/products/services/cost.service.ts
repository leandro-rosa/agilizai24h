import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CostVersionRepository } from '../../db-client/repositories/cost-version.repository'
import { ProductRepository } from '../../db-client/repositories/product.repository'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { UNRESOLVED_REASONS } from '../constants/product-vocabulary'
import { describeVersions } from '../utils/describe-versions'
import { costProvenance, type CostVersionMeta } from '../utils/provenance'
import { COST_RANK, resolveByProduct, resolveVersionAsOf } from '../utils/resolve-version'

// The response shape lives in the shared contracts package, so finance and
// supply consume the same types rather than restating a lookalike. In
// particular BulkCostResult is partitioned, not a map — see that package.
export type { BulkCostResult, ResolvedCost, UnresolvedCost } from '@app/products-contracts'
import type { BulkCostResult, ResolvedCost, UnresolvedCost } from '@app/products-contracts'

/** What recording a cost reports: the version, and whether it is the one in force for its date. */
export interface RecordedCost extends ResolvedCost {
  version_id: number
  source: string
  /** False when the same version already existed and nothing was written. */
  created: boolean
  in_force: boolean
}

@Injectable()
export class CostService {
  constructor(
    private readonly products: ProductRepository,
    private readonly costs: CostVersionRepository,
    private readonly prisma: PrismaClientService,
  ) {}

  /**
   * Records a cost effective from a date as a NEW version. It never overwrites or removes another one, not even one of
   * the same effective date: a correction is a later version of that date, and which of them is in force is decided at
   * read time. Recording the very same value, date and source again is a no-op (re-applying a sheet adds nothing), and a
   * version carrying an idempotency key (`sourceRef`) is created only once.
   */
  async recordCost(sku: string, effectiveFrom: Date, costCents: number, meta?: CostVersionMeta): Promise<RecordedCost> {
    if (!Number.isInteger(costCents) || costCents < 0) {
      throw new BadRequestException('cost_cents must be a non-negative integer in minor units')
    }

    const provenance = costProvenance(meta)
    const product = await this.prisma.product.findUnique({ where: { sku } })
    if (!product) throw new NotFoundException(`Unknown SKU ${sku}`)

    const existing = provenance.source_ref
      ? await this.prisma.costVersion.findFirst({ where: { source: provenance.source, source_ref: provenance.source_ref } })
      : await this.prisma.costVersion.findFirst({ where: { product_id: product.id, effective_from: effectiveFrom, cost_cents: costCents, source: provenance.source } })

    const version =
      existing ?? (await this.prisma.costVersion.create({ data: { product_id: product.id, effective_from: effectiveFrom, cost_cents: costCents, ...provenance } }))

    const own = await this.prisma.costVersion.findMany({ where: { product_id: product.id, effective_from: { lte: version.effective_from } } })
    const inForce = resolveVersionAsOf(own, version.effective_from, COST_RANK)

    return {
      sku,
      product_id: product.id,
      cost_cents: version.cost_cents,
      effective_from: toDateString(version.effective_from),
      version_id: version.id,
      source: version.source,
      created: existing === null,
      // False when another version of the same date outranks this one (an invoice over a manual entry).
      in_force: inForce?.id === version.id,
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

    const versions = products.length ? await this.costs.findUpTo(products.map(product => product.id), asOf) : []
    const byProduct = resolveByProduct(versions, asOf, COST_RANK)

    for (const sku of requested) {
      const product = bySku.get(sku)

      if (!product) {
        unresolved.push({ sku, reason: UNRESOLVED_REASONS.UNKNOWN_SKU })
        continue
      }

      const version = byProduct.get(product.id) ?? null

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

  /** Every version of a product, oldest first, with the day it stops being in force and whether it was superseded. */
  async listVersions(productId: number) {
    const rows = await this.costs.findAllForProduct(productId)

    return describeVersions(rows, COST_RANK).map(({ version, valid_to, superseded }) => ({ ...version, valid_to, superseded }))
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}
