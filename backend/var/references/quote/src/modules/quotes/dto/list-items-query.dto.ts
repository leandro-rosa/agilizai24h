import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { MATCH_STATUS_VALUES, REVIEW_STATUS_VALUES } from '../constants/vocabulary'

export class ListItemsQueryDto {
  @IsOptional()
  @IsIn(REVIEW_STATUS_VALUES)
  status?: string

  @IsOptional()
  @IsIn(MATCH_STATUS_VALUES)
  match_status?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pending_only?: boolean

  @IsOptional()
  @IsIn(['match_score', '-match_score', 'row_number', '-row_number'])
  sort?: string

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
