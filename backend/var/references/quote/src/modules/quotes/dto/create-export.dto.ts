import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

/**
 * A reviewer-typed row for a dynamic `mapped_attributes` column — see
 * openspec/changes/quote-export-custom-mapped-attributes/design.md for
 * why these can't be part of the hand-curated `PRODUCT_EXPORT_FIELDS`
 * catalog `selected_fields` draws from.
 */
export class CustomAttributeFieldDto {
  /** Export column header. */
  @IsString()
  label!: string

  /** `mapped_attributes` key to read for the column's value. */
  @IsString()
  attribute_key!: string

  /** Optional `mapped_attributes` key to read for a unit, appended to the value. */
  @IsOptional()
  @IsString()
  unit_attribute_key?: string
}

export class CreateExportDto {
  @IsIn(['xlsx', 'csv'])
  format!: 'xlsx' | 'csv'

  /**
   * Ordered field ids — order in this array is the exported column order.
   * May be empty when at least one `custom_attribute_fields` row is given
   * (see QuoteExportsService.createExport's cross-field check — class-
   * validator has no clean built-in for "at least one of two arrays").
   */
  @IsArray()
  @IsString({ each: true })
  selected_fields!: string[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomAttributeFieldDto)
  custom_attribute_fields?: CustomAttributeFieldDto[]
}
