import { classifyName, type TaxonomyCategory } from './classify'

const taxonomy: TaxonomyCategory[] = [
  { key: 'beverage', name: 'Bebida', keywords: ['bebida', 'suco'], subcategories: [{ id: 1, name: 'Energéticos', keywords: ['energetico', 'energy', 'monster', 'red bull'] }, { id: 2, name: 'Refrigerantes', keywords: ['refrigerante', 'guarana', 'coca cola'] }, { id: 3, name: 'Chás', keywords: ['cha', 'mate'] }] },
  { key: 'snack', name: 'Lanche', keywords: ['lanche', 'doce', 'bolo'], subcategories: [{ id: 4, name: 'Chocolates', keywords: ['chocolate', 'bombom'] }, { id: 5, name: 'Bolinhos', keywords: ['ana maria', 'bolinho'] }] },
  { key: 'meal', name: 'Refeição', keywords: ['marmita', 'refeicao'], subcategories: [{ id: 6, name: 'Marmitas', keywords: ['arroz', 'feijao', 'marmita'] }] },
]

describe('classifyName', () => {
  it('a subcategory keyword fills both subcategory and its category', () => {
    const result = classifyName('Monster Energy 269 ml', taxonomy)

    expect(result.confidence).toBe('clear')
    expect(result.best).toMatchObject({ categoryKey: 'beverage', subcategory: 'Energéticos' })
    expect(result.best?.matched).toEqual(expect.arrayContaining(['energy', 'monster']))
  })

  it('ignores case, accents and measures', () => {
    expect(classifyName('GUARANÁ 2 L', taxonomy).best).toMatchObject({ categoryKey: 'beverage', subcategory: 'Refrigerantes' })
    expect(classifyName('Marmita  Arroz, couve e feijão', taxonomy).best).toMatchObject({ categoryKey: 'meal', subcategory: 'Marmitas' })
  })

  it('matches words, not pieces of words: "cha" is not inside "chocolate"', () => {
    const result = classifyName('Barra de chocolate 80g', taxonomy)

    expect(result.best).toMatchObject({ categoryKey: 'snack', subcategory: 'Chocolates' })
  })

  it('a phrase counts by its words and wins over a single shared word', () => {
    expect(classifyName('Ana Maria chocolate 70 g', taxonomy).best).toMatchObject({ categoryKey: 'snack', subcategory: 'Bolinhos' })
  })

  it('only the category matched: the category is filled and the subcategory stays pending', () => {
    const result = classifyName('Suco de uva integral', taxonomy)

    expect(result.confidence).toBe('clear')
    expect(result.best).toMatchObject({ categoryKey: 'beverage', subcategory: null })
  })

  it('a tie between different targets is ambiguous: the alternatives are returned and nothing is chosen', () => {
    const result = classifyName('Chá com chocolate', taxonomy)

    expect(result.confidence).toBe('ambiguous')
    expect(result.best).toBeNull()
    expect(result.alternatives.map(a => a.subcategory)).toEqual(expect.arrayContaining(['Chás', 'Chocolates']))
  })

  it('nothing matched is none, and an empty name is none', () => {
    expect(classifyName('Produto sem pista', taxonomy)).toEqual({ confidence: 'none', best: null, alternatives: [] })
    expect(classifyName('   ', taxonomy).confidence).toBe('none')
  })

  it('never invents a category: an unknown word does not produce one', () => {
    const result = classifyName('Cadeira de praia', taxonomy)

    expect(result.best).toBeNull()
  })

  it('inactive taxonomy simply is not given: an empty taxonomy never matches', () => {
    expect(classifyName('Monster', []).confidence).toBe('none')
  })
})
