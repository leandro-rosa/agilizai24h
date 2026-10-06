import { Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { normalizeAlias } from '../../suppliers/constants/supplier-vocabulary'
import { ProductsClient, type CatalogueProduct } from '../clients/products.client'

/** What the ingestion service read from an NF-e (see `ParsedInvoice` there). */
export interface InvoiceInput {
  key: string | null
  number: string
  issuedOn: string
  issuer: { taxId: string; name: string }
  items: { line: number; code: string; ean: string | null; description: string; unit: string | null; quantity: number; quantityIsWhole: boolean; unitCostCents: number; totalCents: number }[]
}

export type UnresolvedReason = 'no_match' | 'fractional_quantity' | 'package_unknown'

export interface PreviewItem {
  line: number
  code: string
  description: string
  /** Units, after converting a box/pack with `units_per_package`. */
  quantity: number
  unit_cost_cents: number
  total_cents: number
  sku: string | null
  product_name: string | null
  unresolved_reason: UnresolvedReason | null
  /** Set when a package was converted: "10 CX × 24 = 240 un.". The operator confirms it. */
  conversion: string | null
}

export interface InvoicePreview {
  number: string
  key: string | null
  issued_on: string
  issuer: { tax_id: string; name: string }
  supplier: { id: number; name: string } | null
  /** How the supplier was found: the exact tax id, the issuer's name registered as an alias (a de-para the operator made), or the same company root (filial). */
  matched_by: 'tax_id' | 'alias' | 'cnpj_root' | null
  /// The invoice was already recorded for this supplier.
  duplicate_of: number | null
  items: PreviewItem[]
}

const PACKAGE_UNITS = new Set(['CX', 'CAIXA', 'FD', 'FARDO', 'PCT', 'PACOTE'])
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')

/**
 * Resolves an invoice to the registry — never by fuzzy matching (the same rule as product names): the supplier by tax id, each line
 * by barcode, then by the supplier's product code equal to a SKU. Lines that do not resolve stay in the list with the reason, so the
 * operator decides; nothing is recorded here.
 */
@Injectable()
export class PurchaseImportService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly products: ProductsClient,
  ) {}

  async preview(invoice: InvoiceInput, correlationId?: string): Promise<InvoicePreview> {
    const suppliers = await this.prisma.supplier.findMany({ where: { tax_id: { not: null } }, select: { id: true, name: true, tax_id: true } })
    const { supplier, matchedBy } = await this.findSupplier(invoice, suppliers)
    const duplicate = supplier ? await this.prisma.purchase.findFirst({ where: { supplier_id: supplier.id, invoice_number: invoice.number } }) : null

    const catalogue = await this.products.products(correlationId)
    const byEan = new Map(catalogue.filter(p => p.ean).map(p => [p.ean as string, p]))
    const bySku = new Map(catalogue.map(p => [p.sku, p]))

    return {
      number: invoice.number,
      key: invoice.key,
      issued_on: invoice.issuedOn,
      issuer: { tax_id: digits(invoice.issuer.taxId), name: invoice.issuer.name },
      supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      matched_by: matchedBy,
      duplicate_of: duplicate?.id ?? null,
      items: invoice.items.map(item => resolveItem(item, (item.ean && byEan.get(item.ean)) || bySku.get(item.code))),
    }
  }

  /** Which supplier issued the invoice, by what is certain: the exact tax id, then the name registered as an alias, then the same company (CNPJ root) when only one registered supplier has it. */
  private async findSupplier(invoice: InvoiceInput, withTaxId: { id: number; name: string; tax_id: string | null }[]): Promise<{ supplier: { id: number; name: string } | null; matchedBy: InvoicePreview['matched_by'] }> {
    const taxId = digits(invoice.issuer.taxId)
    const exact = withTaxId.find(s => digits(s.tax_id) === taxId)
    if (exact) return { supplier: exact, matchedBy: 'tax_id' }

    // The operator's own de-para: "SPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A" registered as an alias of a supplier.
    const alias = await this.prisma.supplierAlias.findUnique({ where: { normalized_alias: normalizeAlias(invoice.issuer.name) }, include: { supplier: true } })
    if (alias) return { supplier: { id: alias.supplier.id, name: alias.supplier.name }, matchedBy: 'alias' }

    // Filiais of one company share the first 8 digits. Only a single match counts: two suppliers with one root is ambiguous, not a guess.
    if (taxId.length === 14) {
      const sameRoot = withTaxId.filter(s => digits(s.tax_id).length === 14 && digits(s.tax_id).slice(0, 8) === taxId.slice(0, 8))
      if (sameRoot.length === 1) return { supplier: sameRoot[0], matchedBy: 'cnpj_root' }
    }

    return { supplier: null, matchedBy: null }
  }
}

function resolveItem(item: InvoiceInput['items'][number], product: CatalogueProduct | undefined): PreviewItem {
  const base = { line: item.line, code: item.code, description: item.description, total_cents: item.totalCents }
  const unresolved = (reason: UnresolvedReason): PreviewItem => ({ ...base, quantity: item.quantity, unit_cost_cents: item.unitCostCents, sku: null, product_name: null, unresolved_reason: reason, conversion: null })

  if (!product) return unresolved('no_match')
  if (!item.quantityIsWhole) return unresolved('fractional_quantity')

  const packaged = PACKAGE_UNITS.has((item.unit ?? '').toUpperCase())
  if (!packaged) return { ...base, quantity: item.quantity, unit_cost_cents: item.unitCostCents, sku: product.sku, product_name: product.name, unresolved_reason: null, conversion: null }

  const perPackage = product.units_per_package
  if (!perPackage || perPackage < 1) return { ...unresolved('package_unknown'), sku: product.sku, product_name: product.name }

  // The invoice prices the package; the purchase records units, so the unit cost is the package cost spread over its units.
  return {
    ...base,
    quantity: item.quantity * perPackage,
    unit_cost_cents: Math.round(item.unitCostCents / perPackage),
    sku: product.sku,
    product_name: product.name,
    unresolved_reason: null,
    conversion: `${item.quantity} ${item.unit} × ${perPackage} = ${item.quantity * perPackage} un.`,
  }
}
