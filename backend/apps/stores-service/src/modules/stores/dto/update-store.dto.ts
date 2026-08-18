import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import {
  STORE_STATUS_VALUES,
  STORE_TYPE_VALUES,
  type StoreStatus,
  type StoreType,
} from '../constants/store-vocabulary'

/** Deliberately has no `id`: the internal identifier is immutable. */
export class UpdateStoreDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string

  @ApiPropertyOptional({ enum: STORE_TYPE_VALUES })
  @IsOptional()
  @IsIn(STORE_TYPE_VALUES)
  type?: StoreType

  @ApiPropertyOptional({ enum: STORE_STATUS_VALUES })
  @IsOptional()
  @IsIn(STORE_STATUS_VALUES)
  status?: StoreStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  external_code?: string
}
