import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'

/** Mirrors frontend/src/domain/model.ts's ColumnMapping. */
export class ColumnMappingEntryDto {
  @IsString()
  spreadsheet_column!: string

  @IsArray()
  @IsString({ each: true })
  examples!: string[]

  @IsString()
  target_field!: string

  @IsInt()
  @Min(0)
  priority!: number

  @IsArray()
  @IsString({ each: true })
  normalization!: string[]

  @IsIn(['mapped', 'ignored', 'suggested', 'empty'])
  status!: 'mapped' | 'ignored' | 'suggested' | 'empty'
}

export class SubmitMappingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ColumnMappingEntryDto)
  mappings!: ColumnMappingEntryDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  normalization_rules?: string[]

  /** Etapa 1's sheet/header-row selection, confirmable together with the mapping. */
  @IsOptional()
  @IsString()
  selected_sheet?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  header_row?: number

  /** Reuse an existing ColumnMappingTemplate instead of the inline mappings above. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  template_id?: number

  @IsOptional()
  save_as_template?: boolean

  @IsOptional()
  @IsString()
  template_name?: string
}
