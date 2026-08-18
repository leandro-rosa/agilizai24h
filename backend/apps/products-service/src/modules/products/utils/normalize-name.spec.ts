import { normalizeName } from './normalize-name'

describe('normalizeName', () => {
  it('folds case', () => {
    expect(normalizeName('REFRIGERANTE')).toBe(normalizeName('refrigerante'))
  })

  it('strips accents', () => {
    expect(normalizeName('Guaraná')).toBe('guarana')
    expect(normalizeName('Açúcar Mascavo')).toBe('acucar mascavo')
  })

  it('collapses repeated and surrounding whitespace', () => {
    expect(normalizeName('  Guaraná   350ml  ')).toBe('guarana 350ml')
  })

  it('matches the spec example end to end', () => {
    // "Refrigerante Guaraná 350ml" vs "REFRIGERANTE GUARANA  350ML"
    expect(normalizeName('REFRIGERANTE GUARANA  350ML')).toBe(normalizeName('Refrigerante Guaraná 350ml'))
  })

  it('does NOT conflate different volumes', () => {
    // The whole reason fuzzy matching is prohibited: 350 and 600 are different
    // products, and a near-match between them is a plausible, wrong cost.
    expect(normalizeName('Guaraná 350ml')).not.toBe(normalizeName('Guaraná 600ml'))
  })
})
