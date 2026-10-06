import { packHintFromDescription, PurchaseImportService, type InvoiceInput } from './purchase-import.service'

const invoice = (over: Partial<InvoiceInput['items'][number]>[] = [{}]): InvoiceInput => ({
  key: 'K',
  number: '1234',
  issuedOn: '2026-10-05',
  issuer: { taxId: '35.370.333/0001-00', name: 'Quinoa Ltda' },
  items: over.map((o, i) => ({ line: i + 1, code: 'QW-01', ean: '7891234567895', description: 'Wrap', unit: 'UN', quantity: 100, quantityIsWhole: true, unitCostCents: 800, totalCents: 80000, ...o })),
})

const make = (existing: { id: number } | null = null, options: { alias?: { id: number; name: string } | null; suppliers?: { id: number; name: string; tax_id: string }[] } = {}) => {
  const prisma = {
    supplier: { findMany: async () => options.suppliers ?? [{ id: 75, name: 'Quinoa', tax_id: '35.370.333/0001-00' }, { id: 1, name: 'Outro', tax_id: '11111111000111' }] },
    supplierAlias: { findUnique: async () => (options.alias ? { supplier: options.alias } : null) },
    purchase: { findFirst: async () => existing },
  }
  const products = { products: async () => [{ id: 1, sku: 'Q1', name: 'Wrap', ean: '7891234567895', units_per_package: null }, { id: 2, sku: 'B2', name: 'Barra', ean: null, units_per_package: 24 }, { id: 3, sku: 'C3', name: 'Cola', ean: null, units_per_package: null }] }

  return new PurchaseImportService(prisma as never, products as never)
}

describe('PurchaseImportService.preview — which supplier issued it', () => {
  const spal = { ...invoice(), issuer: { taxId: '61186888009220', name: 'SPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A' } }

  it('uses the issuer name registered as an alias (the operator\'s de-para), when the tax id is unknown', async () => {
    const preview = await make(null, { alias: { id: 130, name: 'Juntos+' } }).preview(spal)

    expect(preview.supplier).toEqual({ id: 130, name: 'Juntos+' })
    expect(preview.matched_by).toBe('alias')
  })

  it('recognises another branch of the same company by the CNPJ root, only when exactly one supplier has it', async () => {
    const root = [{ id: 130, name: 'Juntos+', tax_id: '61.186.888/0001-93' }]
    const one = await make(null, { suppliers: root }).preview(spal)
    expect(one).toMatchObject({ supplier: { id: 130, name: 'Juntos+' }, matched_by: 'cnpj_root' })

    const two = await make(null, { suppliers: [...root, { id: 131, name: 'Outra filial', tax_id: '61186888000250' }] }).preview(spal)
    expect(two).toMatchObject({ supplier: null, matched_by: null })
  })

  it('prefers the exact tax id over everything else', async () => {
    const preview = await make(null, { alias: { id: 999, name: 'Errado' } }).preview(invoice())

    expect(preview).toMatchObject({ supplier: { id: 75 }, matched_by: 'tax_id' })
  })

  it('leaves the supplier empty when nothing certain matches', async () => {
    expect(await make().preview(spal)).toMatchObject({ supplier: null, matched_by: null })
  })
})

describe('PurchaseImportService.preview', () => {
  it('matches the supplier by tax id (digits only) and the line by barcode', async () => {
    const preview = await make().preview(invoice())

    expect(preview.supplier).toEqual({ id: 75, name: 'Quinoa' })
    expect(preview.items[0]).toMatchObject({ sku: 'Q1', product_name: 'Wrap', quantity: 100, unit_cost_cents: 800, unresolved_reason: null, pack_size_suggested: null })
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

  it('keeps the invoiced quantity and price, and only SUGGESTS a pack size: the catalogue wins over the description', async () => {
    const preview = await make().preview(
      invoice([
        { code: 'B2', ean: null, description: 'Barra 12UN', unit: 'CX', quantity: 10, unitCostCents: 7200, totalCents: 72000 },
        { code: 'C3', ean: null, description: 'Cola 6P', unit: 'UN', quantity: 25, unitCostCents: 4349, totalCents: 108725 },
        { code: 'Q1', ean: '7891234567895', description: 'Wrap', quantity: 100 },
      ]),
    )

    // B2 is registered with 24 per package: the catalogue is the source, not the "12UN" in the text.
    expect(preview.items[0]).toMatchObject({ sku: 'B2', quantity: 10, unit_cost_cents: 7200, pack_size_suggested: 24, pack_source: 'catalogue' })
    // C3 has no registered package: the "6P" in the description is only a suggestion.
    expect(preview.items[1]).toMatchObject({ sku: 'C3', quantity: 25, unit_cost_cents: 4349, pack_size_suggested: 6, pack_source: 'description' })
    expect(preview.items[2]).toMatchObject({ pack_size_suggested: null, pack_source: null })
  })

  it('suggests a pack from the description even when the product is not resolved yet', async () => {
    const preview = await make().preview(invoice([{ ean: null, code: 'ZZ', description: 'CRYSTAL 500ML SEM GAS 12UN CP' }]))

    expect(preview.items[0]).toMatchObject({ sku: null, unresolved_reason: 'no_match', pack_size_suggested: 12, pack_source: 'description' })
  })
})

describe('packHintFromDescription', () => {
  it.each([
    ['Monster Energy LT 473ml 6P F. LISO CP', 6],
    ['MATTE LEAO LIMAO CG LT290ML FI 6P CP', 6],
    ['CRYSTAL 500ML SEM GAS 12UN CP', 12],
    ['Monster Mango Loco Lata 473ml 06UN CP', 6],
    ['Monster Ultra LT 473ml 6Pack FL CP', 6],
    ['Biscoito CX C/24', 24],
  ])('%s → %s', (description, expected) => expect(packHintFromDescription(description)).toBe(expected))

  it('does not read a volume or weight as a pack, nor a pack of one', () => {
    expect(packHintFromDescription('Água 500ML')).toBeNull()
    expect(packHintFromDescription('Suco 1L')).toBeNull()
    expect(packHintFromDescription('Barra 40g')).toBeNull()
    expect(packHintFromDescription('Produto 1UN')).toBeNull()
  })
})
