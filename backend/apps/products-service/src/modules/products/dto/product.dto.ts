import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, Min, ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator'
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

  @ApiPropertyOptional({ description: 'Unidades por embalagem de compra (ex.: caixa de 24).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerPackage?: number

  @ApiPropertyOptional({ example: 'caixa' })
  @IsOptional()
  @IsString()
  packageType?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fractionable?: boolean

  @ApiPropertyOptional({ example: '7891234567895', description: 'Código de barras (8 a 14 dígitos). Único.' })
  @IsOptional()
  @Matches(/^\d{8,14}$/, { message: 'ean must be 8 to 14 digits' })
  ean?: string

  @ApiPropertyOptional({ description: 'Fornecedor declarado (id no suppliers-service).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierId?: number
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

  @ApiPropertyOptional({ description: 'Unidades por embalagem de compra (ex.: caixa de 24).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerPackage?: number

  @ApiPropertyOptional({ example: 'caixa' })
  @IsOptional()
  @IsString()
  packageType?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fractionable?: boolean

  @ApiPropertyOptional({ nullable: true, description: 'Id do fornecedor no suppliers-service; null desvincula.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierId?: number | null
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

export class DecideSkuLinkDto {
  @ApiProperty({ example: '7891234000012', description: 'SKU antigo (o que parou de vender)' })
  @IsString()
  @IsNotEmpty()
  old_sku: string

  @ApiProperty({ example: '7891234000999', description: 'SKU novo (o que apareceu)' })
  @IsString()
  @IsNotEmpty()
  new_sku: string

  @ApiProperty({ enum: ['same', 'different'] })
  @IsIn(['same', 'different'])
  decision: 'same' | 'different'
}

export class SheetRowDto {
  @ApiProperty() @IsInt() @Min(1) row: number
  @ApiProperty() @IsString() sku: string
  @ApiProperty() @IsString() name: string
  @ApiPropertyOptional({ nullable: true }) @IsOptional() category: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() subcategory: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() ean: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() supplier: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() cost_cents: number | null
  @ApiProperty() @IsBoolean() cost_error: boolean
  @ApiPropertyOptional({ nullable: true }) @IsOptional() price_cents: number | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() package_type: string | null
}

export class SyncPreviewDto {
  @ApiProperty({ type: [SheetRowDto] })
  @IsArray()
  @Type(() => SheetRowDto)
  @ValidateNested({ each: true })
  rows: SheetRowDto[]
}

export class SyncSelectionDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) create: string[]
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) costs: string[]
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) prices: string[]
}

export class SyncApplyDto extends SyncPreviewDto {
  @ApiProperty() @ValidateNested() @Type(() => SyncSelectionDto) selection: SyncSelectionDto
  @ApiProperty({ example: '2026-09-01', description: 'Início de vigência do custo/preço de produtos NOVOS' })
  @IsString() new_products_from: string
  @ApiProperty({ example: '2026-10-06', description: 'Início de vigência de MUDANÇAS em produtos existentes' })
  @IsString() changes_from: string
}
