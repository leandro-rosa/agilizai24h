import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { describeVersions } from '../utils/describe-versions'
import { priceProvenance, type PriceVersionMeta } from '../utils/provenance'
import { NO_RANK, resolveByProduct, resolveVersionAsOf } from '../utils/resolve-version'

export interface ResolvedPrice {
  sku: string
  product_id: number
  price_cents: number
  effective_from: string
}

export interface UnresolvedPrice {
  sku: string
  reason: 'unknown_sku' | 'no_price_before_date'
}

/** O que gravar um preço devolve: a versão e se é a que vale para a data. */
export interface RecordedPrice extends ResolvedPrice {
  version_id: number
  source: string
  created: boolean
  in_force: boolean
}

export interface BulkPriceResult {
  resolved: ResolvedPrice[]
  unresolved: UnresolvedPrice[]
  complete: boolean
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Preço de venda datado. Espelha `CostService` de propósito: as duas pontas do
 * cálculo de margem precisam do mesmo contrato temporal, senão o preço de hoje
 * acaba comparado com o custo de seis meses atrás.
 *
 * Markup e margem não são armazenados em lugar nenhum — são derivados de
 * custo × preço **na mesma data**. Persistir os três garante que um dia
 * discordem, e a planilha já mostra isso acontecendo.
 */
@Injectable()
export class PriceService {
  constructor(private readonly prisma: PrismaClientService) {}

  /**
   * Grava um preço como NOVA versão. Nunca sobrescreve nem apaga outra, nem a de mesma data de vigência: uma correção é
   * uma versão posterior daquela data, e qual vale é decidido na leitura (a última gravada). Regravar o mesmo valor, data
   * e origem não faz nada; uma versão com chave de idempotência (`sourceRef`, ex.: a decisão de preço) nasce uma vez só.
   */
  async recordPrice(sku: string, effectiveFrom: Date, priceCents: number, meta?: PriceVersionMeta): Promise<RecordedPrice> {
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw new BadRequestException('price_cents must be a non-negative integer in minor units')
    }

    const provenance = priceProvenance(meta)
    const product = await this.prisma.product.findUnique({ where: { sku } })
    if (!product) throw new NotFoundException(`Unknown SKU ${sku}`)

    const existing = provenance.source_ref
      ? await this.prisma.priceVersion.findFirst({ where: { source: provenance.source, source_ref: provenance.source_ref } })
      : await this.prisma.priceVersion.findFirst({ where: { product_id: product.id, effective_from: effectiveFrom, price_cents: priceCents, source: provenance.source } })

    const version =
      existing ?? (await this.prisma.priceVersion.create({ data: { product_id: product.id, effective_from: effectiveFrom, price_cents: priceCents, ...provenance } }))

    const own = await this.prisma.priceVersion.findMany({ where: { product_id: product.id, effective_from: { lte: version.effective_from } } })
    const inForce = resolveVersionAsOf(own, version.effective_from, NO_RANK)

    return {
      sku,
      product_id: product.id,
      price_cents: version.price_cents,
      effective_from: toDateString(version.effective_from),
      version_id: version.id,
      source: version.source,
      created: existing === null,
      in_force: inForce?.id === version.id,
    }
  }

  /** Todas as versões do produto, da mais nova para a mais antiga, com o dia em que deixam de valer e se foram substituídas. */
  async listVersions(productId: number) {
    const rows = await this.prisma.priceVersion.findMany({ where: { product_id: productId }, orderBy: [{ effective_from: 'asc' }, { id: 'asc' }] })

    return describeVersions(rows, NO_RANK)
      .map(({ version, valid_to, superseded }) => ({ ...version, valid_to, superseded }))
      .reverse()
  }

  /**
   * Preços de um conjunto de SKUs numa data.
   *
   * Particionado, não mapa — mesma decisão do `BulkCostResult`: um mapa
   * convida a tratar preço ausente como zero, o que aqui inflaria a margem em
   * vez de deixar o buraco visível.
   */
  async bulkPriceAsOf(skus: string[], asOf: Date): Promise<BulkPriceResult> {
    const unique = [...new Set(skus)]
    const products = await this.prisma.product.findMany({ where: { sku: { in: unique } } })
    const byS = new Map(products.map(p => [p.sku, p]))
    const versions = products.length
      ? await this.prisma.priceVersion.findMany({ where: { product_id: { in: products.map(p => p.id) }, effective_from: { lte: asOf } } })
      : []
    const inForce = resolveByProduct(versions, asOf, NO_RANK)

    const resolved: ResolvedPrice[] = []
    const unresolved: UnresolvedPrice[] = []

    for (const sku of unique) {
      const product = byS.get(sku)
      if (!product) {
        unresolved.push({ sku, reason: 'unknown_sku' })
        continue
      }

      const version = inForce.get(product.id)
      if (!version) {
        unresolved.push({ sku, reason: 'no_price_before_date' })
        continue
      }

      resolved.push({
        sku,
        product_id: product.id,
        price_cents: version.price_cents,
        effective_from: toDateString(version.effective_from),
      })
    }

    return { resolved, unresolved, complete: unresolved.length === 0 }
  }

  async priceAsOf(sku: string, asOf: Date): Promise<ResolvedPrice> {
    const result = await this.bulkPriceAsOf([sku], asOf)

    if (result.resolved.length === 0) {
      const reason = result.unresolved[0]?.reason
      throw new NotFoundException(
        reason === 'unknown_sku' ? `Unknown SKU ${sku}` : `No price for ${sku} on or before ${toDateString(asOf)}`,
      )
    }

    return result.resolved[0]
  }
}
