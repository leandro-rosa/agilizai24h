import { reaches, validateSameLink, type LinkRow } from './sku-link'

const same = (a: string, b: string): LinkRow => ({ old_sku: a, new_sku: b, decision: 'same' })

describe('validateSameLink', () => {
  it('accepts a plain old → new link', () => expect(validateSameLink([], 'A', 'B')).toBeNull())
  it('rejects a SKU linked to itself', () => expect(validateSameLink([], 'A', 'A')).toMatch(/dele mesmo/))
  it('rejects a cycle', () => expect(validateSameLink([same('A', 'B'), same('B', 'C')], 'C', 'A')).toMatch(/ciclo/))
  it('rejects one old code becoming two products', () => expect(validateSameLink([same('A', 'B')], 'A', 'C')).toMatch(/já foi vinculado/))
  it('allows re-confirming the same pair', () => expect(validateSameLink([same('A', 'B')], 'A', 'B')).toBeNull())
  it('allows a chain A → B → C', () => expect(validateSameLink([same('A', 'B')], 'B', 'C')).toBeNull())
  it('"different" decisions never block or form links', () => {
    const rows: LinkRow[] = [{ old_sku: 'A', new_sku: 'B', decision: 'different' }]
    expect(validateSameLink(rows, 'A', 'C')).toBeNull()
    expect(reaches(rows, 'A', 'B')).toBe(false)
  })
})
