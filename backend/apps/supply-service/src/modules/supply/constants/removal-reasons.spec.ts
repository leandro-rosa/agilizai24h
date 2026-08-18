import { LOSS_COUNTING_KEYS, NON_LOSS_KEYS, REMOVAL_REASONS } from './removal-reasons'

describe('removal reasons', () => {
  it('splits exactly three-and-three, as validated against production data', () => {
    expect(LOSS_COUNTING_KEYS).toEqual(['expired', 'damaged_product', 'other_reason'])
    expect(NON_LOSS_KEYS).toEqual(['return', 'transfer', 'internal_use'])
  })

  it('classifies every reason explicitly — none is left to a default', () => {
    for (const reason of REMOVAL_REASONS) {
      expect(typeof reason.countsAsLoss).toBe('boolean')
    }
  })

  it('uses the glossary labels the operators actually see', () => {
    const labels = Object.fromEntries(REMOVAL_REASONS.map(r => [r.key, r.label]))

    expect(labels).toEqual({
      expired: 'Validade vencida',
      damaged_product: 'Produto danificado',
      other_reason: 'Outro motivo',
      return: 'Devolução',
      transfer: 'Transferência',
      internal_use: 'Uso e consumo',
    })
  })

  it('has no duplicate keys', () => {
    expect(new Set(REMOVAL_REASONS.map(r => r.key)).size).toBe(REMOVAL_REASONS.length)
  })
})
