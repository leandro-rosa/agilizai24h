import { resolveOrigin } from './origin'

describe('resolveOrigin', () => {
  const invoice = { origin: 'invoice' as const, invoiceNumber: '13021', supplierId: 5, originOn: '2026-10-10', actor: 'ana@agiliz.ai', purchaseId: 9 }

  it('a manual registration records no invoice evidence', () => {
    expect(resolveOrigin({ actor: 'ana@agiliz.ai' })).toMatchObject({ origin: 'manual', origin_invoice_number: null, origin_supplier_id: null, origin_actor: 'ana@agiliz.ai' })
  })

  it('an invoice origin keeps the number, supplier, purchase, day and user', () => {
    expect(resolveOrigin(invoice)).toEqual({ origin: 'invoice', origin_invoice_number: '13021', origin_supplier_id: 5, origin_purchase_id: 9, origin_on: new Date('2026-10-10T00:00:00Z'), origin_actor: 'ana@agiliz.ai' })
  })

  it.each(['invoiceNumber', 'supplierId', 'originOn', 'actor'] as const)('an invoice origin without %s is refused', field => {
    expect(() => resolveOrigin({ ...invoice, [field]: undefined })).toThrow(field)
  })

  it('refuses an impossible date and the legacy origin', () => {
    expect(() => resolveOrigin({ ...invoice, originOn: '2026-13-40' })).toThrow('real date')
    expect(() => resolveOrigin({ origin: 'legacy_import' })).toThrow('initial load')
  })
})
