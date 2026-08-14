import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import {
  CANONICAL_MATCHING_FIELDS,
  CanonicalMatchingField,
  MATCHING_CONFIG_VERSION,
  MAX_SYNONYM_GROUPS,
  MAX_SYNONYM_TERMS,
  MAX_SYNONYM_TERM_LENGTH,
  MatchingConfig,
  MatchingPrecision,
} from '../utils/matching-config.util'

export class MatchingFieldWeightsDto {
  @IsInt()
  @Min(0)
  @Max(100)
  sku!: number

  @IsInt()
  @Min(0)
  @Max(100)
  ean!: number

  @IsInt()
  @Min(0)
  @Max(100)
  main_code!: number

  @IsInt()
  @Min(0)
  @Max(100)
  oem!: number

  @IsInt()
  @Min(0)
  @Max(100)
  trade_number!: number

  @IsInt()
  @Min(0)
  @Max(100)
  name!: number

  @IsInt()
  @Min(0)
  @Max(100)
  brand!: number
}

export class MatchingSynonymGroupDto {
  @IsIn(CANONICAL_MATCHING_FIELDS)
  field!: CanonicalMatchingField

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_SYNONYM_TERMS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(MAX_SYNONYM_TERM_LENGTH, { each: true })
  terms!: string[]
}

export class MatchingConfigDto implements MatchingConfig {
  @IsInt()
  @Min(0)
  expected_revision!: number

  @IsIn([MATCHING_CONFIG_VERSION])
  version!: typeof MATCHING_CONFIG_VERSION

  @ValidateNested()
  @Type(() => MatchingFieldWeightsDto)
  field_weights!: MatchingFieldWeightsDto

  @IsArray()
  @ArrayMaxSize(MAX_SYNONYM_GROUPS)
  @ValidateNested({ each: true })
  @Type(() => MatchingSynonymGroupDto)
  synonyms!: MatchingSynonymGroupDto[]

  @IsIn(['strict', 'balanced', 'broad'])
  precision!: MatchingPrecision

  @IsBoolean()
  typo_tolerance!: boolean

  @IsInt()
  @Min(1)
  @Max(10)
  max_candidates!: number

  @IsInt()
  @Min(0)
  @Max(100)
  minimum_score!: number

  @IsBoolean()
  auto_approve!: boolean

  @IsInt()
  @Min(0)
  @Max(100)
  auto_approve_threshold!: number
}
