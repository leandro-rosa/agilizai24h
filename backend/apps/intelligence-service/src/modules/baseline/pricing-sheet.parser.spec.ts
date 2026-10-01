import { normalizeSku, parsePricingSheet, type SheetRow } from './pricing-sheet.parser'

const row = (sku: unknown, quantity: unknown, measure: unknown, product = 'Produto'): SheetRow => ({
  SKU: sku,
  'qtd itens por loja': quantity,
  Medida: measure,
  Produto: product,
})

describe('normalizeSku', () => {
  it.each([
    [6024, '6024'],
    [6024.0, '6024'],
    ['6024', '6024'],
    [' 6024.0 ', '6024'],
    ['0100075', '100075'],
  ])('reads %p as %p', (input, expected) => expect(normalizeSku(input)).toBe(expected))

  it.each([[null], [undefined], [''], ['abc'], [12.5], [0], [-3], ['12a']])('rejects %p', input => expect(normalizeSku(input)).toBeNull())
})

describe('parsePricingSheet', () => {
  it('accepts a clean row, reading a float SKU the way a spreadsheet writes it', () => {
    const result = parsePricingSheet([row(5012.0, 21, 'caixa', 'Trident Menta')])

    expect(result.accepted).toEqual([{ sku: '5012', quantity: 21, measure: 'caixa', product: 'Trident Menta' }])
    expect(result.rejected).toEqual([])
  })

  it('normalises the measure regardless of case and accents', () => {
    const result = parsePricingSheet([row(1, 12, ' FARDO '), row(2, 5, 'Unidade')])

    expect(result.accepted.map(item => item.measure)).toEqual(['fardo', 'unidade'])
  })

  it('collapses a SKU repeated with identical values — no conflict', () => {
    const result = parsePricingSheet([row(9987, 16, 'caixa'), row(9987, 16, 'caixa')])

    expect(result.accepted).toHaveLength(1)
    expect(result.conflicts).toEqual([])
    expect(result.collapsedDuplicates).toEqual(['9987'])
  })

  it('reports a SKU repeated with different values as a conflict and does NOT import it', () => {
    const result = parsePricingSheet([row(6024, 10, 'caixa', 'M&Ms Cookies 35g'), row(6024, 10, 'unidade', 'M&Ms Cookies 35g')])

    expect(result.accepted).toEqual([])
    expect(result.conflicts).toEqual([
      {
        sku: '6024',
        product: 'M&Ms Cookies 35g',
        rows: [
          { row: 1, quantity: 10, measure: 'caixa' },
          { row: 2, quantity: 10, measure: 'unidade' },
        ],
      },
    ])
  })

  it("imports a conflict only when the owner's explicit resolution picks one of the values present", () => {
    const rows = [row(6024, 10, 'caixa'), row(6024, 10, 'unidade')]

    const result = parsePricingSheet(rows, { '6024': { measure: 'unidade' } })

    expect(result.conflicts).toEqual([])
    expect(result.accepted).toEqual([{ sku: '6024', quantity: 10, measure: 'unidade', product: 'Produto' }])
    expect(result.resolved).toEqual([
      {
        sku: '6024',
        chosen: { quantity: 10, measure: 'unidade' },
        rows: [
          { row: 1, quantity: 10, measure: 'caixa' },
          { row: 2, quantity: 10, measure: 'unidade' },
        ],
      },
    ])
  })

  it('refuses a resolution that is not one of the values in the rows — a choice, not a free edit', () => {
    const rows = [row(6024, 10, 'caixa'), row(6024, 10, 'unidade')]

    const result = parsePricingSheet(rows, { '6024': { measure: 'fardo' } })

    expect(result.accepted).toEqual([])
    expect(result.conflicts).toHaveLength(1)
  })

  it('keeps a conflict open when the resolution does not cover the field that differs', () => {
    const rows = [row(7, 10, 'caixa'), row(7, 12, 'caixa')]

    const result = parsePricingSheet(rows, { '7': { measure: 'caixa' } })

    expect(result.conflicts).toHaveLength(1)
    expect(result.accepted).toEqual([])
  })

  it('rejects a baseline of zero, a non-integer or a missing quantity, with its reason', () => {
    const result = parsePricingSheet([row(1, 0, 'caixa'), row(2, 2.5, 'caixa'), row(3, null, 'caixa'), row(4, '12', 'caixa')])

    expect(result.rejected.map(r => [r.sku, r.reason])).toEqual([
      ['1', 'invalid_quantity'],
      ['2', 'invalid_quantity'],
      ['3', 'invalid_quantity'],
    ])
    expect(result.accepted.map(item => item.sku)).toEqual(['4'])
  })

  it('rejects an unknown measure instead of guessing', () => {
    const result = parsePricingSheet([row(1, 5, 'pallet')])

    expect(result.rejected).toEqual([expect.objectContaining({ sku: '1', reason: 'unknown_measure' })])
  })

  it('rejects an unreadable SKU, naming it', () => {
    const result = parsePricingSheet([row('A-12', 5, 'caixa')])

    expect(result.rejected).toEqual([expect.objectContaining({ row: 1, sku: null, reason: 'invalid_sku' })])
  })

  it('counts rows with no SKU (filler at the end of a sheet) instead of rejecting them', () => {
    const result = parsePricingSheet([row(1, 5, 'caixa'), row(null, '#ERROR!', null), row('', null, null)])

    expect(result.ignoredBlank).toBe(2)
    expect(result.rejected).toEqual([])
    expect(result.accepted).toHaveLength(1)
  })

  it('never drops a row silently: accepted + rejected + conflicts + blanks account for every row', () => {
    const rows = [row(1, 5, 'caixa'), row(2, 0, 'caixa'), row(3, 5, 'caixa'), row(3, 6, 'caixa'), row(null, null, null), row(4, 5, 'caixa'), row(4, 5, 'caixa')]

    const result = parsePricingSheet(rows)
    const rowsAccepted = 1 + 2 // sku 1, and the two identical rows of sku 4
    const rowsConflicting = 2
    const accountedFor = rowsAccepted + result.rejected.length + rowsConflicting + result.ignoredBlank

    expect(accountedFor).toBe(rows.length)
  })
})
