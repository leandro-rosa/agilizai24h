import { BadRequestException } from '@nestjs/common'
import { costProvenance, priceProvenance } from './provenance'

describe('costProvenance', () => {
  it('defaults to "other" with nothing invented', () => {
    expect(costProvenance()).toMatchObject({ source: 'other', actor: null, reason: null, source_ref: null, supplier_id: null, purchase_id: null })
  })

  it('a manual cost needs the user and a reason', () => {
    expect(() => costProvenance({ source: 'manual' })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'manual', actor: 'ana@x.com' })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'manual', actor: 'ana@x.com', reason: '   ' })).toThrow(BadRequestException)
    expect(costProvenance({ source: 'manual', actor: ' ana@x.com ', reason: 'fornecedor reajustou' })).toMatchObject({ source: 'manual', actor: 'ana@x.com', reason: 'fornecedor reajustou' })
  })

  it('an invoice cost needs the supplier, the purchase, the item and the idempotency key', () => {
    const full = { source: 'invoice', supplierId: 5, purchaseId: 9, purchaseItemId: 31, sourceRef: 'purchase-item:31', invoiceNumber: '13021', purchaseQuantity: 150, purchaseTotalCents: 93000 }

    expect(costProvenance(full)).toMatchObject({ supplier_id: 5, purchase_id: 9, purchase_item_id: 31, invoice_number: '13021', purchase_quantity: 150, purchase_total_cents: 93000, source_ref: 'purchase-item:31' })
    expect(() => costProvenance({ ...full, sourceRef: undefined })).toThrow(BadRequestException)
    expect(() => costProvenance({ ...full, supplierId: undefined })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'invoice' })).toThrow(BadRequestException)
  })

  it('purchase data is refused from any other source', () => {
    expect(() => costProvenance({ source: 'manual', actor: 'a', reason: 'b', supplierId: 5 })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'other', purchaseId: 9 })).toThrow(BadRequestException)
  })

  it('legacy_import is reserved for the migration, and an unknown source is refused', () => {
    expect(() => costProvenance({ source: 'legacy_import' })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'whatever' })).toThrow(BadRequestException)
  })

  it('rejects numbers that are not positive whole numbers and texts that are too long', () => {
    expect(() => costProvenance({ source: 'invoice', supplierId: 0, purchaseId: 9, purchaseItemId: 31, sourceRef: 'x' })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'invoice', supplierId: 5, purchaseId: 9, purchaseItemId: 31, sourceRef: 'x', purchaseQuantity: 1.5 })).toThrow(BadRequestException)
    expect(() => costProvenance({ source: 'manual', actor: 'a', reason: 'x'.repeat(501) })).toThrow(BadRequestException)
  })
})

describe('priceProvenance', () => {
  it('a manual price needs the user and a reason', () => {
    expect(() => priceProvenance({ source: 'manual' })).toThrow(BadRequestException)
    expect(priceProvenance({ source: 'manual', actor: 'ana@x.com', reason: 'concorrência' })).toMatchObject({ source: 'manual' })
  })

  it('a price from the pricing recommendation needs the approving user and the decision id', () => {
    expect(() => priceProvenance({ source: 'pricing_intelligence', actor: 'ana@x.com' })).toThrow(BadRequestException)
    expect(() => priceProvenance({ source: 'pricing_intelligence', sourceRef: 'd1' })).toThrow(BadRequestException)
    expect(priceProvenance({ source: 'pricing_intelligence', actor: 'ana@x.com', sourceRef: 'd1' })).toMatchObject({ source_ref: 'd1' })
  })

  it('a price can never come from an invoice, and defaults to "other"', () => {
    expect(() => priceProvenance({ source: 'invoice' })).toThrow(BadRequestException)
    expect(priceProvenance().source).toBe('other')
  })
})
