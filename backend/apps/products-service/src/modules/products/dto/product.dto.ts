import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Min, ArrayNotEmpty, IsArray } from 'class-validator'
import { PRODUCT_CATEGORY_VALUES, type ProductCategory } from '../constants/product-vocabulary'

export class CreateProductDto {
  @ApiProperty({ example: 'REF-GUA-350' })
  @IsString()
  @IsNotEmpty()
  sku: string

  @ApiProperty({ example: 'Refrigerante Guaraná 350ml' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ enum: PRODUCT_CATEGORY_VALUES })
  @IsIn(PRODUCT_CATEGORY_VALUES)
  category: ProductCategory
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string

  @ApiPropertyOptional({ enum: PRODUCT_CATEGORY_VALUES })
  @IsOptional()
  @IsIn(PRODUCT_CATEGORY_VALUES)
  category?: ProductCategory
}

export class RecordCostDto {
  @ApiProperty({ example: '2026-01-01', description: 'The date this cost takes effect.' })
  @IsISO8601()
  effective_from: string

  @ApiProperty({ example: 250, description: 'Integer minor units (centavos). Never a decimal.' })
  @IsInt()
  @Min(0)
  cost_cents: number
}

export class BulkCostDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  skus: string[]

  @ApiProperty({
    example: '2026-03-31',
    description: 'Costs are always resolved as of a date — there is no "current cost" lookup.',
  })
  @IsISO8601()
  as_of: string
}

export class RecordPriceDto {
  @ApiProperty({ example: '2026-01-01', description: 'The date this sale price takes effect.' })
  @IsISO8601()
  effective_from: string

  @ApiProperty({ example: 2699, description: 'Integer minor units (centavos). Never a decimal.' })
  @IsInt()
  @Min(0)
  price_cents: number
}

export class BulkPriceDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  skus: string[]

  @ApiProperty({
    example: '2026-03-31',
    description: 'Prices are always resolved as of a date — there is no "current price" lookup, for the same reason there is no "current cost" one.',
  })
  @IsISO8601()
  as_of: string
}

export class ResolveNamesDto {
  @ApiProperty({ type: [String], example: ['REFRIGERANTE GUARANA  350ML'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  names: string[]
}

export class ResolveSkusDto {
  @ApiProperty({ type: [String], example: ['1070', '5026'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  skus: string[]
}

export class CreateOverrideDto {
  @ApiProperty({ example: 'Guaraná lata 350' })
  @IsString()
  @IsNotEmpty()
  source_name: string

  @ApiProperty({ example: 'REF-GUA-350' })
  @IsString()
  @IsNotEmpty()
  sku: string
}
