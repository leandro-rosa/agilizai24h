import { matchStoreForFilename } from './store-matcher'

const STORES = [
  { id: 1, name: 'Ascenty - ADM' }, { id: 2, name: 'Ascenty - CPS01' }, { id: 3, name: 'Ascenty - HTL01' },
  { id: 4, name: 'Ascenty - HTL05' }, { id: 9, name: 'Ascenty - SP03' }, { id: 22, name: 'Ascenty - SP03 2' },
  { id: 10, name: 'Ascenty - SP03 Copa' }, { id: 16, name: 'Plena Saude - ADM Taipas' }, { id: 24, name: 'Plena Saude - ADM' },
]

describe('matchStoreForFilename', () => {
  it('matches the longest store name that appears as a substring of the normalized filename', () => {
    expect(matchStoreForFilename('Relatório_estoque Ascenty - SP03 - Osasco.xlsx', STORES)).toEqual({ storeId: 9, storeName: 'Ascenty - SP03' })
  })

  it('prefers the longer, more specific name when a shorter one is also a substring', () => {
    expect(matchStoreForFilename('Relatório_estoque  Plena Saude - ADM Taipas - Taipas.xlsx', STORES)).toEqual({ storeId: 16, storeName: 'Plena Saude - ADM Taipas' })
  })

  it('normalizes repeated internal whitespace before matching', () => {
    expect(matchStoreForFilename('Relatório_estoque   Ascenty - HTL01   - Hortolândia.xlsx', STORES)).toEqual({ storeId: 3, storeName: 'Ascenty - HTL01' })
  })

  it('returns null when no store name is found in the filename', () => {
    expect(matchStoreForFilename('Relatório_estoque HTL05 - Hortolândia.xlsx', STORES)).toBeNull()
  })

  it('returns null for a completely unrelated filename', () => {
    expect(matchStoreForFilename('planilha qualquer.xlsx', STORES)).toBeNull()
  })
})
