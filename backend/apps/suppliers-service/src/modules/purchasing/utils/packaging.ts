import { BadRequestException } from '@nestjs/common'

/** What the operator confirmed for an item bought in packages: the invoice as it came and the conversion to units. */
export interface PackagingInput {
  /** Packages bought, as on the invoice. */
  pack_quantity?: number | null
  /** Price of ONE package, in centavos, as on the invoice. */
  pack_unit_price_cents?: number | null
  /** Units in each package. */
  units_per_pack?: number | null
  /** The unit of measure on the invoice ("UN", "CX", "FD"). */
  purchase_unit?: string | null
}

export interface Packaging {
  pack_quantity: number | null
  pack_unit_price_cents: number | null
  units_per_pack: number | null
  purchase_unit: string | null
}

const MAX_UNIT = 20

/**
 * The original of a package purchase is kept so the unit cost can always be audited. The three numbers go together (all or
 * none), and they must AGREE with what the purchase records: units = packages × units per package, and the unit cost is the
 * package price divided by the units per package, rounded to the centavo. A record that disagrees with its own original would
 * make the audit trail lie, so it is refused instead of stored.
 */
export function checkPackaging(input: PackagingInput, units: number, unitCostCents: number): Packaging {
  const numbers = [input.pack_quantity, input.pack_unit_price_cents, input.units_per_pack]
  const given = numbers.filter(value => value !== undefined && value !== null)
  const unit = input.purchase_unit?.trim() ? input.purchase_unit.trim().slice(0, MAX_UNIT) : null

  if (given.length === 0) return { pack_quantity: null, pack_unit_price_cents: null, units_per_pack: null, purchase_unit: unit }
  if (given.length !== 3) throw new BadRequestException('A embalagem de origem precisa de pack_quantity, pack_unit_price_cents e units_per_pack juntos')

  const [packs, packPrice, perPack] = numbers as number[]
  for (const [name, value] of [['pack_quantity', packs], ['pack_unit_price_cents', packPrice], ['units_per_pack', perPack]] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new BadRequestException(`${name} must be a positive whole number`)
  }

  if (packs * perPack !== units) throw new BadRequestException(`A quantidade não bate com a embalagem: ${packs} × ${perPack} = ${packs * perPack}, não ${units}`)

  // One centavo of slack: the unit cost is the package price over the units, rounded.
  if (Math.abs(Math.round(packPrice / perPack) - unitCostCents) > 1) {
    throw new BadRequestException(`O custo unitário não bate com a embalagem: ${packPrice} ÷ ${perPack} ≈ ${Math.round(packPrice / perPack)}, não ${unitCostCents}`)
  }

  return { pack_quantity: packs, pack_unit_price_cents: packPrice, units_per_pack: perPack, purchase_unit: unit }
}
