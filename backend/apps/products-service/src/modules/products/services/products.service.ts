import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { NameOverrideRepository } from '../../db-client/repositories/name-override.repository'
import { ProductRepository } from '../../db-client/repositories/product.repository'
import { UNRESOLVED_REASONS, type ProductCategory, type UnresolvedReason } from '../constants/product-vocabulary'
import { normalizeName } from '../utils/normalize-name'

export interface ProductView {
  id: number
  sku: string
  name: string
  category: string
  units_per_package: number | null
  package_type: string | null
  fractionable: boolean | null
  /** Populated by the ingestion pipeline, not by create()/update() here — read-only from this API. */
  shelf_life_days: number | null
}

export interface CreateProductInput {
  sku: string
  name: string
  category: ProductCategory
  unitsPerPackage?: number
  packageType?: string
  fractionable?: boolean
}

export interface NameMatch {
  source_name: string
  product: ProductView
  /** How it matched, so an operator can see whether an override was involved. */
  matched_by: 'override' | 'normalization'
}

export interface NameMismatch {
  source_name: string
  reason: UnresolvedReason
}

export interface NameResolutionResult {
  matched: NameMatch[]
  unmatched: NameMismatch[]
}

export interface SkuMismatch {
  sku: string
  reason: UnresolvedReason
}

export interface SkuResolutionResult {
  matched: ProductView[]
  unmatched: SkuMismatch[]
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductRepository,
    private readonly overrides: NameOverrideRepository,
    private readonly prisma: PrismaClientService,
  ) {}

  async create(input: CreateProductInput): Promise<ProductView> {
    // Checked explicitly: PrismaRepository discards Prisma's error code, so
    // branching on a unique-constraint violation is not available. The database
    // constraint stays as the backstop for the race this leaves.
    const existing = await this.prisma.product.findUnique({ where: { sku: input.sku } })
    if (existing) throw new ConflictException(`A product with SKU ${input.sku} already exists`)

    const created = await this.prisma.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        category: input.category,
        normalized_name: normalizeName(input.name),
        units_per_package: input.unitsPerPackage ?? null,
        package_type: input.packageType ?? null,
        fractionable: input.fractionable ?? null,
      },
    })

    return toView(created)
  }

  async update(
    id: number,
    changes: { name?: string; category?: ProductCategory; unitsPerPackage?: number; packageType?: string; fractionable?: boolean },
  ): Promise<ProductView> {
    const existing = await this.prisma.product.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Product ${id} not found`)

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(changes.name !== undefined ? { name: changes.name, normalized_name: normalizeName(changes.name) } : {}),
        ...(changes.category !== undefined ? { category: changes.category } : {}),
        ...(changes.unitsPerPackage !== undefined ? { units_per_package: changes.unitsPerPackage } : {}),
        ...(changes.packageType !== undefined ? { package_type: changes.packageType } : {}),
        ...(changes.fractionable !== undefined ? { fractionable: changes.fractionable } : {}),
      },
    })

    return toView(updated)
  }

  async findById(id: number): Promise<ProductView> {
    const product = await this.prisma.product.findUnique({ where: { id } })
    if (!product) throw new NotFoundException(`Product ${id} not found`)

    return toView(product)
  }

  async list(category?: ProductCategory): Promise<ProductView[]> {
    const products = await this.prisma.product.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ sku: 'asc' }],
    })

    return products.map(toView)
  }

  /**
   * Resolves externally supplied product codes directly against the catalogue
   * SKU — no normalisation, no override, no ambiguity to arbitrate. The code
   * is the same identifier across the sales report, the restocking report and
   * the price list (design D3 of align-ingestion-with-real-reports), so this
   * is the primary resolution path; `resolveNames` is the fallback for a row
   * that carries no code at all.
   */
  async resolveSkus(skus: string[]): Promise<SkuResolutionResult> {
    const requested = [...new Set(skus)]
    const found = await this.prisma.product.findMany({ where: { sku: { in: requested } } })
    const foundBySku = new Map(found.map(product => [product.sku, product]))

    const matched: ProductView[] = []
    const unmatched: SkuMismatch[] = []

    for (const sku of requested) {
      const product = foundBySku.get(sku)
      if (product) matched.push(toView(product))
      else unmatched.push({ sku, reason: UNRESOLVED_REASONS.UNKNOWN_SKU })
    }

    return { matched, unmatched }
  }

  /**
   * Resolves externally supplied product names.
   *
   * Order matters: a curated override wins over a normalised match, because an
   * override exists precisely because a human looked at a real mismatch and
   * decided the answer — so it must also be able to *correct* a wrong
   * normalised match, not merely fill a gap.
   *
   * There is no fuzzy or similarity matching anywhere in this path, by design.
   */
  async resolveNames(sourceNames: string[]): Promise<NameResolutionResult> {
    const requested = [...new Set(sourceNames)]
    const normalizedBySource = new Map(requested.map(name => [name, normalizeName(name)]))

    const overrideRows = await this.overrides.findByNormalizedNames([...new Set(normalizedBySource.values())])
    const overrideByNormalized = new Map(overrideRows.map(row => [row.source_normalized_name, row.product]))

    const matched: NameMatch[] = []
    const unmatched: NameMismatch[] = []

    for (const sourceName of requested) {
      const normalized = normalizedBySource.get(sourceName)!

      const override = overrideByNormalized.get(normalized)
      if (override) {
        matched.push({ source_name: sourceName, product: toView(override), matched_by: 'override' })
        continue
      }

      const candidates = await this.products.findByNormalizedName(normalized)

      if (candidates.length === 1) {
        matched.push({ source_name: sourceName, product: toView(candidates[0]), matched_by: 'normalization' })
        continue
      }

      unmatched.push({
        source_name: sourceName,
        // More than one candidate is reported as ambiguous rather than resolved
        // arbitrarily: picking one silently binds a figure to the wrong product.
        reason: candidates.length > 1 ? UNRESOLVED_REASONS.AMBIGUOUS_NAME : UNRESOLVED_REASONS.UNKNOWN_NAME,
      })
    }

    return { matched, unmatched }
  }

  async addOverride(sourceName: string, sku: string): Promise<NameMatch> {
    const product = await this.prisma.product.findUnique({ where: { sku } })
    if (!product) throw new NotFoundException(`Unknown SKU ${sku}`)

    const normalized = normalizeName(sourceName)

    await this.prisma.productNameOverride.upsert({
      where: { source_normalized_name: normalized },
      create: { source_normalized_name: normalized, source_name: sourceName, product_id: product.id },
      update: { source_name: sourceName, product_id: product.id },
    })

    return { source_name: sourceName, product: toView(product), matched_by: 'override' }
  }

  async listOverrides() {
    const rows = await this.prisma.productNameOverride.findMany({
      include: { product: true },
      orderBy: { source_normalized_name: 'asc' },
    })

    return rows.map(row => ({
      id: row.id,
      source_name: row.source_name,
      source_normalized_name: row.source_normalized_name,
      product: toView(row.product),
    }))
  }

  async removeOverride(id: number): Promise<void> {
    const existing = await this.prisma.productNameOverride.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Override ${id} not found`)

    await this.prisma.productNameOverride.delete({ where: { id } })
  }
}

function toView(product: {
  id: number
  sku: string
  name: string
  category: string
  units_per_package: number | null
  package_type: string | null
  fractionable: boolean | null
  shelf_life_days: number | null
}): ProductView {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    units_per_package: product.units_per_package,
    shelf_life_days: product.shelf_life_days,
    package_type: product.package_type,
    fractionable: product.fractionable,
  }
}
