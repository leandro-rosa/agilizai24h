import { BadRequestException } from '@nestjs/common'
import { WRITABLE_VERSION_SOURCES, type VersionSource } from '../constants/product-vocabulary'

/** What a caller may say about where a cost came from. Every field is optional except where the source demands it. */
export interface CostVersionMeta {
  source?: string
  actor?: string | null
  reason?: string | null
  sourceRef?: string | null
  supplierId?: number | null
  purchaseId?: number | null
  purchaseItemId?: number | null
  invoiceNumber?: string | null
  purchaseQuantity?: number | null
  purchaseTotalCents?: number | null
  packQuantity?: number | null
  unitsPerPack?: number | null
}

export interface PriceVersionMeta {
  source?: string
  actor?: string | null
  reason?: string | null
  sourceRef?: string | null
}

export interface CostProvenance {
  source: VersionSource
  actor: string | null
  reason: string | null
  source_ref: string | null
  supplier_id: number | null
  purchase_id: number | null
  purchase_item_id: number | null
  invoice_number: string | null
  purchase_quantity: number | null
  purchase_total_cents: number | null
  pack_quantity: number | null
  units_per_pack: number | null
}

export interface PriceProvenance {
  source: VersionSource
  actor: string | null
  reason: string | null
  source_ref: string | null
}

const text = (value: unknown, name: string, max: number): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new BadRequestException(`${name} is too long (max ${max})`)

  return trimmed === '' ? null : trimmed
}

const positiveInt = (value: unknown, name: string): number | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new BadRequestException(`${name} must be a positive whole number`)

  return value
}

function commonFields(meta: { source?: string; actor?: string | null; reason?: string | null; sourceRef?: string | null } | undefined) {
  const source = (meta?.source ?? 'other') as VersionSource
  if (!(WRITABLE_VERSION_SOURCES as readonly string[]).includes(source)) {
    throw new BadRequestException(`source must be one of: ${WRITABLE_VERSION_SOURCES.join(', ')}`)
  }

  const actor = text(meta?.actor, 'actor', 200)
  const reason = text(meta?.reason, 'reason', 500)
  const sourceRef = text(meta?.sourceRef, 'sourceRef', 120)

  // A person's change must say who and why: that is what makes the history worth reading later.
  if (source === 'manual' && (!actor || !reason)) throw new BadRequestException('A manual version needs the user and a reason')

  return { source, actor, reason, source_ref: sourceRef }
}

/** Validates the provenance of a cost version. Purchase fields are only accepted from an invoice. */
export function costProvenance(meta?: CostVersionMeta): CostProvenance {
  const common = commonFields(meta)
  const purchase = {
    supplier_id: positiveInt(meta?.supplierId, 'supplierId'),
    purchase_id: positiveInt(meta?.purchaseId, 'purchaseId'),
    purchase_item_id: positiveInt(meta?.purchaseItemId, 'purchaseItemId'),
    invoice_number: text(meta?.invoiceNumber, 'invoiceNumber', 60),
    purchase_quantity: positiveInt(meta?.purchaseQuantity, 'purchaseQuantity'),
    purchase_total_cents: positiveInt(meta?.purchaseTotalCents, 'purchaseTotalCents'),
    pack_quantity: positiveInt(meta?.packQuantity, 'packQuantity'),
    units_per_pack: positiveInt(meta?.unitsPerPack, 'unitsPerPack'),
  }

  const hasPurchaseData = Object.values(purchase).some(value => value !== null)
  if (common.source !== 'invoice' && hasPurchaseData) throw new BadRequestException('Purchase data is only accepted with source "invoice"')

  if (common.source === 'invoice') {
    if (!purchase.supplier_id || !purchase.purchase_id || !purchase.purchase_item_id || !common.source_ref) {
      throw new BadRequestException('An invoice cost needs supplierId, purchaseId, purchaseItemId and sourceRef')
    }
  }

  return { ...common, ...purchase }
}

/** Validates the provenance of a price version. */
export function priceProvenance(meta?: PriceVersionMeta): PriceProvenance {
  const common = commonFields(meta)
  if (common.source === 'invoice') throw new BadRequestException('A sale price cannot come from an invoice')
  if (common.source === 'pricing_intelligence' && (!common.actor || !common.source_ref)) {
    throw new BadRequestException('A price from the pricing recommendation needs the approving user and the decision id (sourceRef)')
  }

  return common
}
