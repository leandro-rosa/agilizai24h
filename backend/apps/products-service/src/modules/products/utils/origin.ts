import { BadRequestException } from '@nestjs/common'
import type { ProductOrigin } from '../constants/product-vocabulary'

export interface OriginInput {
  origin?: ProductOrigin
  invoiceNumber?: string
  supplierId?: number
  purchaseId?: number
  /** `YYYY-MM-DD`: the invoice date. */
  originOn?: string
  /** The session user; the gateway sets it, a browser value is never trusted. */
  actor?: string
}

/** What `product` stores for an origin. An invoice origin needs its evidence: without it the registry could not say where the product came from. */
export function resolveOrigin(input: OriginInput): { origin: 'manual' | 'invoice' | 'excel'; origin_invoice_number: string | null; origin_supplier_id: number | null; origin_purchase_id: number | null; origin_on: Date | null; origin_actor: string | null } {
  if (input.origin === 'legacy_import') throw new BadRequestException('legacy_import is only the initial load; it cannot be chosen')
  if (input.origin === 'excel') return { origin: 'excel', origin_invoice_number: null, origin_supplier_id: null, origin_purchase_id: null, origin_on: null, origin_actor: input.actor ?? null }
  if (input.origin !== 'invoice') return { origin: 'manual', origin_invoice_number: null, origin_supplier_id: null, origin_purchase_id: null, origin_on: null, origin_actor: input.actor ?? null }

  const missing = [!input.invoiceNumber?.trim() && 'invoiceNumber', !input.supplierId && 'supplierId', !input.originOn && 'originOn', !input.actor?.trim() && 'actor'].filter(Boolean)
  if (missing.length > 0) throw new BadRequestException(`A product created from an invoice needs: ${missing.join(', ')}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.originOn as string) || Number.isNaN(Date.parse(input.originOn as string))) throw new BadRequestException('originOn must be a real date, YYYY-MM-DD')

  return {
    origin: 'invoice',
    origin_invoice_number: (input.invoiceNumber as string).trim(),
    origin_supplier_id: input.supplierId as number,
    origin_purchase_id: input.purchaseId ?? null,
    origin_on: new Date(`${input.originOn}T00:00:00Z`),
    origin_actor: (input.actor as string).trim(),
  }
}
