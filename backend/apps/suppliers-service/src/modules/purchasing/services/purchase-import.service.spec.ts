import { PurchaseImportService, type InvoiceInput } from './purchase-import.service'

const invoice = (over: Partial<InvoiceInput['items'][number]>[] = [{}]): InvoiceInput => ({
  key: 'K',
  number: '1234',
  issuedOn: '2026-10-05',
  issuer: { taxId: '35.370.333/0001-00', name: 'Quinoa Ltda' },
  items: over.map((o, i) => ({ line: i + 1, code: 'QW-01', ean: '7891234567895', description: 'Wrap', unit: 'UN', quantity: 100, quantityIsWhole: true, unitCostCents: 800, totalCents: 80000, ...o })),
})

const make = (existing: { id: number } | null = null) => {
  const prisma = {
    supplier: { findMany: async () => [{ id: 75, name: 'Quinoa', tax_id: '35.370.333/0001-00' }, { id: 1, name: 'Outro', tax_id: '11111111000111' }] },
    purchase: { findFirst: async () => existing },
  }
  const products = { products: async () => [{ id: 1, sku: 'Q1', name: 'Wrap', ean: '7891234567895', units_per_package: null }, { id: 2, sku: 'B2', name: 'Barra', ean: null, units_per_package: 24 }, { id: 3, sku: 'C3', name: 'Cola', ean: null, units_per_package: null }] }

  return new PurchaseImportService(prisma as never, products as never)
}

describe('PurchaseImportService.preview', () => {
  it('matches the supplier by tax id (digits only) and the line by barcode', async () => {
    const preview = await make().preview(invoice())

    expect(preview.supplier).toEqual({ id: 75, name: 'Quinoa' })
    expect(preview.items[0]).toMatchObject({ sku: 'Q1', product_name: 'Wrap', quantity: 100, unit_cost_cents: 800, unresolved_reason: null, conversion: null })
    expect(preview.duplicate_of).toBeNull()
  })

  it('falls back to the product code equal to a SKU, never fuzzy', async () => {
    const preview = await make().preview(invoice([{ ean: null, code: 'C3', description: 'cola' }, { ean: null, code: 'ZZ', description: 'Wrap quinoa' }]))

    expect(preview.items[0].sku).toBe('C3')
    expect(preview.items[1]).toMatchObject({ sku: null, unresolved_reason: 'no_match' })
  })

  it('has no supplier when the tax id is unknown, and reports a duplicate invoice', async () => {
    const unknown = await make().preview({ ...invoice(), issuer: { taxId: '99999999000199', name: 'Novo' } })
    expect(unknown.supplier).toBeNull()

    expect((await make({ id: 42 }).preview(invoice())).duplicate_of).toBe(42)
  })

  it('converts a package to units with units_per_package and asks when it is unknown', async () => {
    const preview = await make().preview(invoice([{ code: 'B2', ean: null, unit: 'CX', quantity: 10, unitCostCents: 7200, totalCents: 72000 }, { code: 'C3', ean: null, unit: 'CX', quantity: 5 }]))

    expect(preview.items[0]).toMatchObject({ sku: 'B2', quantity: 240, unit_cost_cents: 300, conversion: '10 CX × 24 = 240 un.', unresolved_reason: null })
    expect(preview.items[1]).toMatchObject({ sku: 'C3', unresolved_reason: 'package_unknown' })
  })

  it('does not round a fractional quantity into units', async () => {
    const preview = await make().preview(invoice([{ quantity: 2.5, quantityIsWhole: false }]))

    expect(preview.items[0]).toMatchObject({ sku: null, unresolved_reason: 'fractional_quantity' })
  })
})
