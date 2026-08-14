import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { QUOTE_SOURCE_VALUES, QUOTE_STATUS_VALUES } from '../constants/vocabulary'

export class ListQuotesQueryDto {
  @IsOptional()
  @IsIn(QUOTE_STATUS_VALUES)
  status?: string

  @IsOptional()
  @IsIn(QUOTE_SOURCE_VALUES)
  source?: string

  @IsOptional()
  @IsISO8601()
  from?: string

  @IsOptional()
  @IsISO8601()
  to?: string

  @IsOptional()
  @IsString()
  created_by?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20
}
