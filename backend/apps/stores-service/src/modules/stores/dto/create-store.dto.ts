import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { STORE_TYPE_VALUES, type StoreType } from '../constants/store-vocabulary'

export class CreateStoreDto {
  @ApiProperty({ example: 'Agiliz TechPark' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  address: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  city: string

  @ApiProperty({ enum: STORE_TYPE_VALUES })
  @IsIn(STORE_TYPE_VALUES)
  type: StoreType

  @ApiPropertyOptional({
    description: 'The code the POS uses for this store. May be assigned later.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  external_code?: string
}
