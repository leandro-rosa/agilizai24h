import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'

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

  async recordPrice(sku: string, effectiveFrom: Date, priceCents: number): Promise<ResolvedPrice> {
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw new BadRequestException('price_cents must be a non-negative integer in minor units')
    }

    const product = await this.prisma.product.findUnique({ where: { sku } })
    if (!product) throw new NotFoundException(`Unknown SKU ${sku}`)

    const version = await this.prisma.priceVersion.upsert({
      where: { product_id_effective_from: { product_id: product.id, effective_from: effectiveFrom } },
      create: { product_id: product.id, effective_from: effectiveFrom, price_cents: priceCents },
      update: { price_cents: priceCents },
    })

    return {
      sku,
      product_id: product.id,
      price_cents: version.price_cents,
      effective_from: toDateString(version.effective_from),
    }
  }

  listVersions(productId: number) {
    return this.prisma.priceVersion.findMany({
      where: { product_id: productId },
      orderBy: { effective_from: 'desc' },
    })
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
    const products = await this.prisma.product.findMany({
      where: { sku: { in: unique } },
      include: {
        price_versions: {
          where: { effective_from: { lte: asOf } },
          orderBy: { effective_from: 'desc' },
          take: 1,
        },
      },
    })

    const byS = new Map(products.map(p => [p.sku, p]))
    const resolved: ResolvedPrice[] = []
    const unresolved: UnresolvedPrice[] = []

    for (const sku of unique) {
      const product = byS.get(sku)
      if (!product) {
        unresolved.push({ sku, reason: 'unknown_sku' })
        continue
      }

      const version = product.price_versions[0]
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
