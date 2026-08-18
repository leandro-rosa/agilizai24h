import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Documents the response shape for the OpenAPI document the panel reads from.
 *
 * Every monetary field states its unit in its own description rather than
 * relying on the `_cents` suffix. The suffix is a convention a reader has to
 * already know; these figures get compared against an operator's spreadsheet in
 * reais, and a consumer that divides by 100 once too few or once too many
 * produces a number that is wrong by two orders of magnitude while still
 * looking like money.
 *
 * The wording follows the glossary in `openspec/project.md` — COGS, real loss,
 * remaining stock, restocked, reason — so the same term means the same thing in
 * the spec, the API and the screen.
 */
export class LossByReasonDto {
  @ApiProperty({ description: 'Reason key, as classified by supply-service', example: 'expired' })
  reason: string

  @ApiProperty({ description: 'Units removed for this reason', example: 4 })
  quantity: number

  @ApiProperty({ description: 'Real loss for this reason, in centavos (integer minor units)', example: 1200 })
  value_cents: number
}

export class LossBySkuDto {
  @ApiProperty({ example: 'FIN-A' })
  sku: string

  @ApiProperty({ description: 'Units lost for this product', example: 4 })
  quantity: number

  @ApiProperty({ description: 'Real loss for this product, in centavos (integer minor units)', example: 1200 })
  value_cents: number
}

export class UnvaluedSkuDto {
  @ApiProperty({ example: 'FIN-A' })
  sku: string

  @ApiProperty({ description: 'Why it could not be valued', example: 'no_cost_for_date' })
  reason: string

  @ApiProperty({ description: 'Units restocked, still counted even though unvalued', example: 100 })
  restocked: number

  @ApiProperty({ example: 90 })
  sold: number

  @ApiProperty({ description: 'Remaining stock in units', example: 10 })
  remaining: number

  @ApiProperty({ description: 'Units of real loss', example: 0 })
  loss_quantity: number
}

export class ReconciliationResponseDto {
  @ApiProperty({ example: 22 })
  store_id: number

  @ApiProperty({ description: 'The month being reconciled, as YYYY-MM', example: '2026-11' })
  period: string

  @ApiProperty({
    description: 'Restocked value: units restocked × cost, in centavos (integer minor units)',
    example: 72000,
  })
  restocked_value_cents: number

  @ApiProperty({
    description: 'COGS (cost of goods sold): units sold × cost, in centavos (integer minor units)',
    example: 37500,
  })
  cogs_cents: number

  @ApiProperty({
    description: 'Remaining stock value: closing units × cost, in centavos (integer minor units)',
    example: 29250,
  })
  remaining_value_cents: number

  @ApiProperty({
    description:
      'Real loss: only removals whose reason counts as loss, × cost, in centavos (integer minor units). ' +
      'Returns and transfers are removals but not loss.',
    example: 3450,
  })
  loss_value_cents: number

  @ApiProperty({ description: 'Units of real loss — a count, not money', example: 9 })
  loss_quantity: number

  @ApiProperty({
    description: 'The date costs were resolved at — the last day of the month, recorded so the valuation is reproducible',
    example: '2026-11-30',
  })
  valuation_date: string

  @ApiProperty({
    description:
      'Whether these figures can be acted on. False when any SKU could not be priced or its stock was inconsistent — ' +
      '`unvalued` and `inconsistent_stock` say which and why.',
    example: true,
  })
  complete: boolean

  @ApiProperty({
    description: 'SKUs whose remaining balance inventory-service flagged as inconsistent (a negative stock)',
    type: [String],
    example: [],
  })
  inconsistent_stock: string[]

  @ApiProperty({ description: 'When these figures were computed' })
  computed_at: Date

  @ApiPropertyOptional({
    description:
      'When the inputs these were computed from last changed. Null for a manual recompute. ' +
      'Figures computed before their inputs last changed are stale.',
    nullable: true,
  })
  inputs_changed_at: Date | null

  @ApiProperty({ type: [LossByReasonDto], description: 'Real loss broken down by reason; sums to loss_value_cents' })
  loss_by_reason: LossByReasonDto[]

  @ApiProperty({ type: [LossBySkuDto], description: 'Real loss broken down by product; sums to loss_value_cents' })
  loss_by_sku: LossBySkuDto[]

  @ApiProperty({
    type: [UnvaluedSkuDto],
    description: 'SKUs with movement that could not be valued. They contribute nothing to any total — never zero.',
  })
  unvalued: UnvaluedSkuDto[]
}

export class RollupResponseDto {
  @ApiProperty({ example: '2026-11' })
  period: string

  @ApiProperty({ description: 'Restocked value across the network, in centavos (integer minor units)' })
  restocked_value_cents: number

  @ApiProperty({ description: 'COGS across the network, in centavos (integer minor units)' })
  cogs_cents: number

  @ApiProperty({ description: 'Remaining stock value across the network, in centavos (integer minor units)' })
  remaining_value_cents: number

  @ApiProperty({ description: 'Real loss across the network, in centavos (integer minor units)' })
  loss_value_cents: number

  @ApiProperty({ description: 'How many stores contributed' })
  store_count: number

  @ApiProperty({ description: 'False when ANY contributing store is incomplete — the total is then not actionable' })
  complete: boolean

  @ApiProperty({ description: 'The stores responsible for the incompleteness, so the gap can be closed', type: [Number] })
  incomplete_stores: number[]
}
