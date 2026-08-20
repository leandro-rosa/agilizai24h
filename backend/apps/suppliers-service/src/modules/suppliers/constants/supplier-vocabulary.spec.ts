import { normalizeAlias } from './supplier-vocabulary'

describe('normalizeAlias', () => {
  it('folds case, accents and repeated whitespace', () => {
    expect(normalizeAlias('  Assaí   Atacadista  ')).toBe('ASSAI ATACADISTA')
  })

  it('treats the real spellings of one supplier as equal', () => {
    // As duas grafias vieram do extrato bancário real.
    expect(normalizeAlias('ASSAÍ ATACADISTA LJ49')).toBe(normalizeAlias('Assai Atacadista LJ49'))
  })

  it('keeps the branch suffix distinct — two branches may be two suppliers', () => {
    expect(normalizeAlias('ASSAÍ ATACADISTA LJ49')).not.toBe(normalizeAlias('ASSAÍ ATACADISTA LJ144'))
  })

  it('collapses punctuation to a single space rather than deleting it', () => {
    // "AMLabs-Ventures" e "AMLabs Ventures" sao o mesmo; colar viraria
    // "AMLABSVENTURES" e deixaria de casar com a grafia com espaco.
    expect(normalizeAlias('AMLabs-Ventures')).toBe('AMLABS VENTURES')
    expect(normalizeAlias('AMLabs Ventures')).toBe('AMLABS VENTURES')
  })

  it('returns empty for input that is only punctuation', () => {
    expect(normalizeAlias('--- ---')).toBe('')
  })
})
