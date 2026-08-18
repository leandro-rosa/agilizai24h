import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString } from 'class-validator'
import {
  STORE_STATUS_VALUES,
  STORE_TYPE_VALUES,
  type StoreStatus,
  type StoreType,
} from '../constants/store-vocabulary'

export class ListStoresDto {
  @ApiPropertyOptional({
    enum: STORE_STATUS_VALUES,
    isArray: true,
    description: 'Repeatable or comma-separated. Omitted means active only.',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsIn(STORE_STATUS_VALUES, { each: true })
  status?: StoreStatus[]

  @ApiPropertyOptional({ enum: STORE_TYPE_VALUES })
  @IsOptional()
  @IsIn(STORE_TYPE_VALUES)
  type?: StoreType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string
}
