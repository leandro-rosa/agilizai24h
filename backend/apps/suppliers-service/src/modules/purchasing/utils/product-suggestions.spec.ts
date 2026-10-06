import { measureOf, suggestProducts, wordsOf } from './product-suggestions'

const catalogue = [
  { sku: 'M1', name: 'Monster Energy 473ml' },
  { sku: 'M2', name: 'Monster Mango Loco 473ml' },
  { sku: 'M3', name: 'Monster Energy 269ml' },
  { sku: 'L1', name: 'Matte Leão Limão 290ml' },
  { sku: 'C1', name: 'Coca-Cola 350ml' },
]

describe('measureOf', () => {
  it('normalises volume and weight', () => {
    expect(measureOf('Suco 1,5 L')).toBe('1500ml')
    expect(measureOf('Suco 1500ml')).toBe('1500ml')
    expect(measureOf('Biscoito 200g')).toBe('200g')
    expect(measureOf('Sem medida')).toBeNull()
  })
})

describe('wordsOf', () => {
  it('drops measures, pack markers and filler, keeps what identifies the product', () => {
    expect(wordsOf('Monster Energy LT 473ml 6P F. LISO CP')).toEqual(['monster', 'energy', 'liso'])
  })
})

describe('suggestProducts', () => {
  it('ranks by common words and puts a candidate with the same measure before one with another', () => {
    const result = suggestProducts('Monster Energy LT 473ml 6P F. LISO CP', catalogue)

    expect(result[0]).toMatchObject({ sku: 'M1', measure_differs: false })
    expect(result.find(s => s.sku === 'M3')).toMatchObject({ measure_differs: true })
    expect(result.findIndex(s => s.sku === 'M3')).toBeGreaterThan(result.findIndex(s => s.sku === 'M1'))
  })

  it('finds the match despite accents and the "LEAO LIMAO" spelling', () => {
    expect(suggestProducts('MATTE LEAO LIMAO CG LT290ML FI 6P CP', catalogue)[0]?.sku).toBe('L1')
  })

  it('offers nothing when no product looks like it, rather than a guess', () => {
    expect(suggestProducts('Cerveja Pilsen 350ml', catalogue)).toEqual([])
  })

  it('offers at most three', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ sku: `S${i}`, name: 'Monster Energy 473ml' }))
    expect(suggestProducts('Monster Energy 473ml', many)).toHaveLength(3)
  })
})
