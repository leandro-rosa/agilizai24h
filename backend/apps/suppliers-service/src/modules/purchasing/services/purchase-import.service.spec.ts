import { packHintFromDescription, PurchaseImportService, type InvoiceInput } from './purchase-import.service'

const invoice = (over: Partial<InvoiceInput['items'][number]>[] = [{}]): InvoiceInput => ({
  key: 'K',
  number: '1234',
  issuedOn: '2026-10-05',
  issuer: { taxId: '35.370.333/0001-00', name: 'Quinoa Ltda' },
  items: over.map((o, i) => ({ line: i + 1, code: 'QW-01', ean: '7891234567895', description: 'Wrap', unit: 'UN', quantity: 100, quantityIsWhole: true, unitCostCents: 800, totalCents: 80000, ...o })),
})

/** The rule products-service applies (`lookupEan`): an active link wins, a historical EAN on ONE product still resolves, on several it is ambiguous, none is unknown. */
const fakeEanResolver = (catalogue: { sku: string }[], links: { ean: string; sku: string; status: 'active' | 'inactive' }[]) => async (eans: string[]) => {
  const resolved: { ean: string; match: 'active' | 'historical'; product: (typeof catalogue)[number] }[] = []
  const unresolved: { ean: string; unresolved: 'ean_not_identified' | 'ean_ambiguous'; candidates?: string[] }[] = []

  for (const ean of eans) {
    const own = links.filter(link => link.ean === ean)
    const active = own.find(link => link.status === 'active')
    const skus = [...new Set(own.map(link => link.sku))]
    const product = (sku: string) => catalogue.find(p => p.sku === sku) as (typeof catalogue)[number]

    if (active) resolved.push({ ean, match: 'active', product: product(active.sku) })
    else if (skus.length === 1) resolved.push({ ean, match: 'historical', product: product(skus[0]) })
    else if (skus.length > 1) unresolved.push({ ean, unresolved: 'ean_ambiguous', candidates: skus })
    else unresolved.push({ ean, unresolved: 'ean_not_identified' })
  }

  return { resolved, unresolved }
}

const make = (existing: { id: number } | null = null, options: { eanLinks?: { ean: string; sku: string; status: 'active' | 'inactive' }[]; links?: { code: string; sku: string }[]; alias?: { id: number; name: string } | null; suppliers?: { id: number; name: string; tax_id: string }[] } = {}) => {
  const prisma = {
    supplier: { findMany: async () => options.suppliers ?? [{ id: 75, name: 'Quinoa', tax_id: '35.370.333/0001-00' }, { id: 1, name: 'Outro', tax_id: '11111111000111' }] },
    supplierAlias: { findUnique: async () => (options.alias ? { supplier: options.alias } : null) },
    purchase: { findFirst: async () => existing },
    supplierProductCode: { findMany: async () => options.links ?? [] },
  }
  const catalogue = [{ id: 1, sku: 'Q1', name: 'Wrap', ean: '7891234567895', units_per_package: null }, { id: 2, sku: 'B2', name: 'Barra', ean: null, units_per_package: 24 }, { id: 3, sku: 'C3', name: 'Cola', ean: null, units_per_package: null }]
  const products = { products: async () => catalogue, resolveEans: async (eans: string[]) => fakeEanResolver(catalogue, options.eanLinks ?? [{ ean: '7891234567895', sku: 'Q1', status: 'active' }])(eans) }

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

describe('PurchaseImportService.preview — lines without a barcode match', () => {
  const line = (over: Partial<InvoiceInput['items'][number]>) => invoice([{ ean: null, ...over }])

  it('uses the code the operator linked for this supplier, ahead of a SKU that happens to be equal', async () => {
    const preview = await make(null, { links: [{ code: '118463', sku: 'C3' }] }).preview(line({ code: '118463', description: 'Cola 2L' }))

    expect(preview.items[0]).toMatchObject({ sku: 'C3', matched_by: 'supplier_code', suggestions: [] })
  })

  it('suggests by name, without choosing: the line stays unresolved', async () => {
    const preview = await make().preview(line({ code: '999', description: 'BARRA LT 30G CP' }))

    expect(preview.items[0].sku).toBeNull()
    expect(preview.items[0].unresolved_reason).toBe('no_match')
    expect(preview.items[0].suggestions.map(s => s.sku)).toContain('B2')
  })

  it('marks which rule found the product', async () => {
    expect((await make().preview(invoice())).items[0].matched_by).toBe('ean')
    expect((await make().preview(line({ code: 'Q1' }))).items[0].matched_by).toBe('sku')
  })
})

describe('PurchaseImportService.preview — several EANs per product', () => {
  const oldAndNew = [
    { ean: '7891000000001', sku: 'Q1', status: 'inactive' as const },
    { ean: '7891000000002', sku: 'Q1', status: 'active' as const },
  ]

  it('a line with the old EAN, now inactive, still resolves to the same SKU, marked as a historical EAN', async () => {
    const preview = await make(null, { eanLinks: oldAndNew }).preview(invoice([{ ean: '7891000000001', code: 'X' }]))

    expect(preview.items[0]).toMatchObject({ sku: 'Q1', matched_by: 'ean_historical', unresolved_reason: null })
  })

  it('an old invoice with the old EAN and a new one with the new EAN both feed the same SKU', async () => {
    const service = make(null, { eanLinks: oldAndNew })
    const oldInvoice = await service.preview(invoice([{ ean: '7891000000001', code: 'X' }]))
    const newInvoice = await service.preview(invoice([{ ean: '7891000000002', code: 'Y' }]))

    expect(oldInvoice.items[0].sku).toBe('Q1')
    expect(newInvoice.items[0]).toMatchObject({ sku: 'Q1', matched_by: 'ean' })
  })

  it('an EAN no product has is "not identified", resolves to nothing and no product is created', async () => {
    const preview = await make(null, { eanLinks: [] }).preview(invoice([{ ean: '7891000009999', code: 'ZZ', description: 'Produto sem cadastro' }]))

    expect(preview.items[0]).toMatchObject({ sku: null, product_name: null, matched_by: null, unresolved_reason: 'ean_not_identified', ean: '7891000009999' })
  })

  it('an EAN that is historical on several products is ambiguous: it is not resolved and the candidates are shown', async () => {
    const links = [{ ean: '7891000000007', sku: 'Q1', status: 'inactive' as const }, { ean: '7891000000007', sku: 'B2', status: 'inactive' as const }]
    const preview = await make(null, { eanLinks: links }).preview(invoice([{ ean: '7891000000007', code: 'AMB' }]))

    expect(preview.items[0]).toMatchObject({ sku: null, unresolved_reason: 'ean_ambiguous' })
    expect([...preview.items[0].ean_candidates].sort()).toEqual(['B2', 'Q1'])
  })

  it('a line with no EAN and no other match stays a plain no_match', async () => {
    const preview = await make(null, { eanLinks: [] }).preview(invoice([{ ean: null, code: 'NOPE' }]))

    expect(preview.items[0]).toMatchObject({ sku: null, unresolved_reason: 'no_match', ean: null })
  })

  it('the supplier code the operator linked still finds the product when the EAN is unknown', async () => {
    const preview = await make(null, { eanLinks: [], links: [{ code: 'QW-01', sku: 'Q1' }] }).preview(invoice([{ ean: '7891000009999' }]))

    expect(preview.items[0]).toMatchObject({ sku: 'Q1', matched_by: 'supplier_code' })
  })
})
