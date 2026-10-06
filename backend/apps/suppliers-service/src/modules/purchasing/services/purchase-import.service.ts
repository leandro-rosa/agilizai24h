import { Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { normalizeAlias } from '../../suppliers/constants/supplier-vocabulary'
import { ProductsClient, type CatalogueProduct } from '../clients/products.client'
import { suggestProducts, type Suggestion } from '../utils/product-suggestions'

/** What the ingestion service read from an NF-e (see `ParsedInvoice` there). */
export interface InvoiceInput {
  key: string | null
  number: string
  issuedOn: string
  issuer: { taxId: string; name: string }
  items: { line: number; code: string; ean: string | null; description: string; unit: string | null; quantity: number; quantityIsWhole: boolean; unitCostCents: number; totalCents: number }[]
}

export type UnresolvedReason = 'no_match'

export interface PreviewItem {
  line: number
  code: string
  description: string
  /** As invoiced: the unit of measure is often a pack ("6P", "12UN", a fardo), and the price is the pack's. */
  quantity: number
  unit_cost_cents: number
  total_cents: number
  /** The unit of measure on the invoice (`uCom`), for reference. */
  unit: string | null
  sku: string | null
  product_name: string | null
  unresolved_reason: UnresolvedReason | null
  /** How the line found its product: the barcode, the supplier's code the operator linked before, or the code equal to a SKU. */
  matched_by: 'ean' | 'supplier_code' | 'sku' | null
  /** For a line with no product: catalogue products that look like it, to be accepted by the operator. Never applied by themselves. */
  suggestions: Suggestion[]
  /**
   * Units in one invoiced unit, as a SUGGESTION: the catalogue's `units_per_package`, else read from the description ("6P", "12UN").
   * The operator confirms or corrects it per line; the purchase records units and the cost of ONE unit.
   */
  pack_size_suggested: number | null
  pack_source: 'catalogue' | 'description' | null
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

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')

/**
 * Resolves an invoice to the registry — never by fuzzy matching (the same rule as product names): the supplier by tax id, each line
 * by barcode, then by a code the operator linked for this supplier, then by the supplier's product code equal to a SKU. Lines left over get SUGGESTIONS by name (`suggestProducts`), which the operator must accept. Lines that do not resolve stay in the list with the reason, so the
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
    // The operator's own links: this supplier's code → a product, made when they picked a product for an unmatched line.
    const linked = new Map((supplier ? await this.prisma.supplierProductCode.findMany({ where: { supplier_id: supplier.id } }) : []).map(link => [link.code, link.sku]))

    return {
      number: invoice.number,
      key: invoice.key,
      issued_on: invoice.issuedOn,
      issuer: { tax_id: digits(invoice.issuer.taxId), name: invoice.issuer.name },
      supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      matched_by: matchedBy,
      duplicate_of: duplicate?.id ?? null,
      items: invoice.items.map(item => {
        const linkedSku = linked.get(item.code)
        const found: [CatalogueProduct | undefined, PreviewItem['matched_by']] =
          item.ean && byEan.get(item.ean) ? [byEan.get(item.ean), 'ean'] : linkedSku && bySku.get(linkedSku) ? [bySku.get(linkedSku), 'supplier_code'] : bySku.get(item.code) ? [bySku.get(item.code), 'sku'] : [undefined, null]

        return resolveItem(item, found[0], found[1], found[0] ? [] : suggestProducts(item.description, catalogue))
      }),
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

/**
 * A pack size written in a product description: "6P", "6Pack", "12UN", "06UN", "C/12". A hint, never applied by itself — the
 * operator confirms it, because "12UN" can also be a single 12-unit product and the invoice's unit of measure does not say.
 */
export function packHintFromDescription(description: string): number | null {
  const match = /\b(?:C\/|CX\s?|FD\s?)?0?(\d{1,3})\s?(?:UN|UND|UNID|P|PACK|PK)\b/i.exec(description) ?? /\bC\/\s?0?(\d{1,3})\b/i.exec(description)
  const size = match ? Number(match[1]) : null

  return size !== null && size >= 2 ? size : null
}

function resolveItem(item: InvoiceInput['items'][number], product: CatalogueProduct | undefined, matchedBy: PreviewItem['matched_by'], suggestions: Suggestion[]): PreviewItem {
  const hint = packHintFromDescription(item.description)
  const catalogue = product?.units_per_package && product.units_per_package >= 2 ? product.units_per_package : null

  return {
    line: item.line,
    code: item.code,
    description: item.description,
    quantity: item.quantity,
    unit_cost_cents: item.unitCostCents,
    total_cents: item.totalCents,
    unit: item.unit,
    sku: product?.sku ?? null,
    product_name: product?.name ?? null,
    unresolved_reason: product ? null : 'no_match',
    matched_by: matchedBy,
    suggestions,
    pack_size_suggested: catalogue ?? hint,
    pack_source: catalogue ? 'catalogue' : hint ? 'description' : null,
  }
}
