import { nextSku } from './next-sku'

describe('nextSku', () => {
  it('suggests the number after the highest six-digit SKU, ignoring other shapes', () => {
    expect(nextSku(['110022', '110023', 'REF-GUA-350', '99', '1234567', '110001'])).toEqual({ suggested: '110024', highest: '110023', suggestion: true })
  })

  it('keeps the leading zeros', () => {
    expect(nextSku(['000099'])).toMatchObject({ suggested: '000100', highest: '000099' })
  })

  it('gives no suggestion without a six-digit SKU, or after 999999', () => {
    expect(nextSku(['REF-1', '12'])).toEqual({ suggested: null, highest: null, suggestion: true })
    expect(nextSku(['999999'])).toMatchObject({ suggested: null, highest: '999999' })
  })
})
