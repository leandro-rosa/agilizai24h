import { BadRequestException } from '@nestjs/common'
import { eanChange, importBody, invoiceProduct, manualCost, manualEan, manualPrice } from './manual-version'

describe('manual versions from the browser', () => {
  it('forces the source to manual and the actor to the session user, whatever the client sent', () => {
    const payload = manualCost({ effective_from: '2026-10-10', cost_cents: 620, reason: 'fornecedor reajustou', source: 'invoice', actor: 'outra@pessoa.com', supplier_id: 5, purchase_id: 9, source_ref: 'x' }, 'barbara@agiliz.ai')

    expect(payload).toEqual({ effective_from: '2026-10-10', cost_cents: 620, source: 'manual', actor: 'barbara@agiliz.ai', reason: 'fornecedor reajustou' })
  })

  it('refuses a cost or a price without a reason', () => {
    expect(() => manualCost({ effective_from: '2026-10-10', cost_cents: 620 }, 'a@b.c')).toThrow(BadRequestException)
    expect(() => manualPrice({ effective_from: '2026-10-10', price_cents: 1250, reason: '   ' }, 'a@b.c')).toThrow(BadRequestException)
  })

  it('a price cannot be made to look like a pricing decision or an invoice', () => {
    expect(manualPrice({ effective_from: '2026-10-10', price_cents: 1250, reason: 'concorrência', source: 'pricing_intelligence', source_ref: 'd1' }, 'a@b.c')).toEqual({
      effective_from: '2026-10-10',
      price_cents: 1250,
      source: 'manual',
      actor: 'a@b.c',
      reason: 'concorrência',
    })
  })

  it('an EAN keeps only its own fields and the actor comes from the session', () => {
    expect(manualEan({ ean: '7891000000002', valid_from: '2026-10-01', note: 'nova', make_primary: true, retire_current: true, source: 'invoice_import', actor: 'x' }, 'a@b.c')).toEqual({
      ean: '7891000000002',
      valid_from: '2026-10-01',
      note: 'nova',
      make_primary: true,
      retire_current: true,
      source: 'manual',
      actor: 'a@b.c',
    })
  })

  it('changing an EAN passes only status, end of validity, principal and note', () => {
    expect(eanChange({ status: 'inactive', valid_to: '2026-10-09', primary: false, note: 'x', ean: '999', product_id: 3, delete: true })).toEqual({ status: 'inactive', valid_to: '2026-10-09', primary: false, note: 'x' })
  })

  it('a product from an invoice line always has the invoice origin and the session user, and keeps only the form fields', () => {
    const result = invoiceProduct({ sku: '110024', name: 'Marmita', category: 'meal', ean: '7891000100103', supplierId: 5, invoiceNumber: '13021', originOn: '2026-10-10', origin: 'manual', actor: 'forjado@x', legacy: true }, 'ana@agiliz.ai')

    expect(result).toMatchObject({ sku: '110024', origin: 'invoice', actor: 'ana@agiliz.ai', invoiceNumber: '13021', ean: '7891000100103' })
    expect(result).not.toHaveProperty('legacy')
  })

  it('an import keeps only the rows and the clearing flag, which is off unless exactly true; the user comes from the session', () => {
    expect(importBody({ rows: [{ sku: 'A' }], clearEmpty: 'yes', actor: 'forjado@x' })).toEqual({ rows: [{ sku: 'A' }], clearEmpty: false })
    expect(importBody({ rows: [], clearEmpty: true })).toEqual({ rows: [], clearEmpty: true })
  })

  it('the brand and the purchase unit pass from the invoice registration form', () => {
    expect(invoiceProduct({ sku: '1', brand: 'Monster', purchaseUnit: 'FD' }, 'ana@agiliz.ai')).toMatchObject({ brand: 'Monster', purchaseUnit: 'FD' })
  })
})
