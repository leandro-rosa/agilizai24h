import { BadRequestException } from '@nestjs/common'
import { checkPackaging } from './packaging'

describe('checkPackaging', () => {
  it('keeps the original of a box of 21: 10 boxes at R$ 63,00 is 210 units at R$ 3,00', () => {
    expect(checkPackaging({ pack_quantity: 10, pack_unit_price_cents: 6300, units_per_pack: 21, purchase_unit: 'CX' }, 210, 300)).toEqual({ pack_quantity: 10, pack_unit_price_cents: 6300, units_per_pack: 21, purchase_unit: 'CX' })
  })

  it('accepts the rounding of the unit cost (one centavo of slack): R$ 43,49 / 6 = 7,248 → 725', () => {
    expect(checkPackaging({ pack_quantity: 25, pack_unit_price_cents: 4349, units_per_pack: 6 }, 150, 725).units_per_pack).toBe(6)
    expect(() => checkPackaging({ pack_quantity: 25, pack_unit_price_cents: 4349, units_per_pack: 6 }, 150, 727)).toThrow(BadRequestException)
  })

  it('no packaging at all is fine and keeps only the unit, so a purchase recorded without it shows "not recorded"', () => {
    expect(checkPackaging({}, 10, 500)).toEqual({ pack_quantity: null, pack_unit_price_cents: null, units_per_pack: null, purchase_unit: null })
    expect(checkPackaging({ purchase_unit: ' UN ' }, 10, 500).purchase_unit).toBe('UN')
  })

  it('the three numbers go together', () => {
    expect(() => checkPackaging({ pack_quantity: 10 }, 10, 500)).toThrow(/juntos/)
    expect(() => checkPackaging({ pack_quantity: 10, pack_unit_price_cents: 6300 }, 210, 300)).toThrow(/juntos/)
  })

  it('refuses a record that disagrees with its own original, so the audit trail cannot lie', () => {
    expect(() => checkPackaging({ pack_quantity: 10, pack_unit_price_cents: 6300, units_per_pack: 21 }, 200, 300)).toThrow(/quantidade/)
    expect(() => checkPackaging({ pack_quantity: 10, pack_unit_price_cents: 6300, units_per_pack: 21 }, 210, 450)).toThrow(/custo unitário/)
  })

  it('refuses zero, negative and fractional numbers', () => {
    for (const bad of [0, -1, 1.5]) expect(() => checkPackaging({ pack_quantity: bad, pack_unit_price_cents: 6300, units_per_pack: 21 }, 210, 300)).toThrow(BadRequestException)
  })
})
