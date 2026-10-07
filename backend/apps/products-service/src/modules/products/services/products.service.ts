import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { NameOverrideRepository } from '../../db-client/repositories/name-override.repository'
import { ProductRepository } from '../../db-client/repositories/product.repository'
import { UNRESOLVED_REASONS, type ProductCategory, type UnresolvedReason } from '../constants/product-vocabulary'
import type { ProductOrigin, ProductStatus } from '../constants/product-vocabulary'
import { cleanEan } from '../utils/ean'
import { nextSku, type NextSku } from '../utils/next-sku'
import { resolveOrigin } from '../utils/origin'
import { normalizeName } from '../utils/normalize-name'
import { toProductView, type ProductView } from '../utils/product-view'

export type { ProductView }

/** Every product read carries ALL its EAN links, so `ean` and `eans` always agree. */
const WITH_EANS = { eans: { orderBy: [{ is_primary: 'desc' as const }, { status: 'asc' as const }, { id: 'asc' as const }] } }

export interface CreateProductInput {
  sku: string
  name: string
  category: ProductCategory
  unitsPerPackage?: number
  packageType?: string
  fractionable?: boolean
  /** Barcode: unique, because the PDV resolves a sale by it. */
  ean?: string
  /** Declared supplier, when the product is registered from a purchase. */
  supplierId?: number
  subcategory?: string
  saleUnit?: string
  /** `invoice` = registered from an NF-e line (needs invoiceNumber, supplierId, originOn and actor). */
  origin?: ProductOrigin
  invoiceNumber?: string
  purchaseId?: number
  originOn?: string
  actor?: string
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

  /** The SKU the registration form proposes (the next after the highest six-digit one). Nothing is reserved: a duplicate is refused at create. */
  async nextSku(): Promise<NextSku> {
    const rows = await this.prisma.$queryRaw<{ sku: string }[]>`SELECT sku FROM product WHERE sku ~ '^[0-9]{6}$' ORDER BY sku DESC LIMIT 1`

    return nextSku(rows.map(r => r.sku))
  }

  async create(input: CreateProductInput): Promise<ProductView> {
    const origin = resolveOrigin(input)
    // Checked explicitly: PrismaRepository discards Prisma's error code, so
    // branching on a unique-constraint violation is not available. The database
    // constraint stays as the backstop for the race this leaves.
    const existing = await this.prisma.product.findUnique({ where: { sku: input.sku } })
    if (existing) throw new ConflictException(`A product with SKU ${input.sku} already exists`)

    const ean = input.ean === undefined || input.ean === null ? null : cleanEan(input.ean)
    if (input.ean && !ean) throw new BadRequestException('EAN inválido: use só dígitos, de 8 a 14')
    if (ean) {
      // The EAN may belong to another product today or only historically; either way a new SKU must not take it:
      // a barcode already tied to a product is a link to add to THAT product, not a reason for a second one.
      const linked = await this.prisma.productEan.findFirst({ where: { ean }, include: { product: { select: { sku: true } } }, orderBy: { status: 'asc' } })
      if (linked) {
        throw new ConflictException({
          message: `O EAN ${ean} ${linked.status === 'active' ? 'pertence' : 'já pertenceu'} ao produto ${linked.product.sku}; vincule-o a ele em vez de criar outro produto`,
          code: 'ean_linked',
          sku: linked.product.sku,
          ean_status: linked.status,
        })
      }
    }

    const created = await this.prisma.product.create({
      data: {
        sku: input.sku,
        supplier_id: input.supplierId ?? null,
        name: input.name,
        category: input.category,
        normalized_name: normalizeName(input.name),
        units_per_package: input.unitsPerPackage ?? null,
        package_type: input.packageType ?? null,
        fractionable: input.fractionable ?? null,
        ...(input.subcategory ? { subcategory: input.subcategory } : {}),
        ...(input.saleUnit ? { sale_unit: input.saleUnit } : {}),
        ...origin,
        ...(ean
          ? { eans: { create: { ean, status: 'active', is_primary: true, source: origin.origin === 'invoice' ? 'invoice_import' : 'other', actor: origin.origin_actor, valid_from: origin.origin_on } } }
          : {}),
      },
      include: WITH_EANS,
    })

    return toProductView(created)
  }

  async update(
    id: number,
    changes: { name?: string; category?: ProductCategory; unitsPerPackage?: number; packageType?: string; fractionable?: boolean; supplierId?: number | null; subcategory?: string | null; status?: ProductStatus; saleUnit?: string },
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
        ...(changes.supplierId !== undefined ? { supplier_id: changes.supplierId } : {}),
        ...(changes.subcategory !== undefined ? { subcategory: changes.subcategory } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.saleUnit !== undefined ? { sale_unit: changes.saleUnit } : {}),
      },
      include: WITH_EANS,
    })

    return toProductView(updated)
  }

  async findById(id: number): Promise<ProductView> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: WITH_EANS })
    if (!product) throw new NotFoundException(`Product ${id} not found`)

    return toProductView(product)
  }

  async list(category?: ProductCategory): Promise<ProductView[]> {
    const products = await this.prisma.product.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ sku: 'asc' }],
      include: WITH_EANS,
    })

    return products.map(toProductView)
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
    const found = await this.prisma.product.findMany({ where: { sku: { in: requested } }, include: WITH_EANS })
    const foundBySku = new Map(found.map(product => [product.sku, product]))

    const matched: ProductView[] = []
    const unmatched: SkuMismatch[] = []

    for (const sku of requested) {
      const product = foundBySku.get(sku)
      if (product) matched.push(toProductView(product))
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
        matched.push({ source_name: sourceName, product: toProductView(override), matched_by: 'override' })
        continue
      }

      const candidates = await this.products.findByNormalizedNameWithEans(normalized)

      if (candidates.length === 1) {
        matched.push({ source_name: sourceName, product: toProductView(candidates[0]), matched_by: 'normalization' })
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
    const product = await this.prisma.product.findUnique({ where: { sku }, include: WITH_EANS })
    if (!product) throw new NotFoundException(`Unknown SKU ${sku}`)

    const normalized = normalizeName(sourceName)

    await this.prisma.productNameOverride.upsert({
      where: { source_normalized_name: normalized },
      create: { source_normalized_name: normalized, source_name: sourceName, product_id: product.id },
      update: { source_name: sourceName, product_id: product.id },
    })

    return { source_name: sourceName, product: toProductView(product), matched_by: 'override' }
  }

  async listOverrides() {
    const rows = await this.prisma.productNameOverride.findMany({
      include: { product: { include: WITH_EANS } },
      orderBy: { source_normalized_name: 'asc' },
    })

    return rows.map(row => ({
      id: row.id,
      source_name: row.source_name,
      source_normalized_name: row.source_normalized_name,
      product: toProductView(row.product),
    }))
  }

  async removeOverride(id: number): Promise<void> {
    const existing = await this.prisma.productNameOverride.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Override ${id} not found`)

    await this.prisma.productNameOverride.delete({ where: { id } })
  }
}
