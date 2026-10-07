import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, Min, ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator'
import { PRODUCT_CATEGORY_VALUES, PRODUCT_STATUSES, WRITABLE_EAN_SOURCES, WRITABLE_VERSION_SOURCES, type ProductCategory, type ProductStatus } from '../constants/product-vocabulary'

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

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() subcategory?: string

  @ApiPropertyOptional({ example: 'un', description: 'Unidade de venda.' }) @IsOptional() @IsString() @IsNotEmpty() saleUnit?: string

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() brand?: string

  @ApiPropertyOptional({ example: 'CX', description: 'Unidade em que o fornecedor vende.' }) @IsOptional() @IsString() @IsNotEmpty() purchaseUnit?: string

  @ApiPropertyOptional({ enum: ['manual', 'invoice', 'excel'], description: '`invoice` registra o produto a partir de uma linha de NF-e e exige invoiceNumber, supplierId, originOn e actor.' })
  @IsOptional()
  @IsIn(['manual', 'invoice', 'excel'])
  origin?: 'manual' | 'invoice' | 'excel'

  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) purchaseId?: number

  @ApiPropertyOptional({ example: '2026-10-10', description: 'Data da nota.' }) @IsOptional() @IsString() originOn?: string

  @ApiPropertyOptional({ description: 'Quem cadastrou. O gateway define pela sessão; nunca confie num valor do navegador.' }) @IsOptional() @IsString() actor?: string
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

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() subcategory?: string | null

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES, description: 'discontinued tira o produto de circulação sem apagar histórico.' })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus

  @ApiPropertyOptional({ example: 'un' }) @IsOptional() @IsString() @IsNotEmpty() saleUnit?: string

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() brand?: string | null

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() purchaseUnit?: string | null
}

export class RecordCostDto {
  @ApiProperty({ example: '2026-01-01', description: 'The date this cost takes effect.' })
  @IsISO8601()
  effective_from: string

  @ApiProperty({ example: 250, description: 'Integer minor units (centavos). Never a decimal.' })
  @IsInt()
  @Min(0)
  cost_cents: number

  @ApiPropertyOptional({ enum: WRITABLE_VERSION_SOURCES, description: 'Where this version came from. Default "other". A manual one needs `actor` and `reason`.' })
  @IsOptional()
  @IsIn(WRITABLE_VERSION_SOURCES)
  source?: string

  @ApiPropertyOptional({ description: 'Who entered it. The gateway sets this from the session; never trust a browser value.' })
  @IsOptional()
  @IsString()
  actor?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string

  @ApiPropertyOptional({ description: 'Idempotency key of the origin (purchase item, pricing decision): the same key creates the version once.' })
  @IsOptional()
  @IsString()
  source_ref?: string

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) supplier_id?: number
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) purchase_id?: number
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) purchase_item_id?: number
  @ApiPropertyOptional() @IsOptional() @IsString() invoice_number?: string
  @ApiPropertyOptional({ description: 'Units bought, as on the invoice.' }) @IsOptional() @IsInt() @Min(1) purchase_quantity?: number
  @ApiPropertyOptional({ description: 'Total paid for them, in centavos.' }) @IsOptional() @IsInt() @Min(1) purchase_total_cents?: number
  @ApiPropertyOptional({ description: 'Packages bought (boxes, bales).' }) @IsOptional() @IsInt() @Min(1) pack_quantity?: number
  @ApiPropertyOptional({ description: 'Units in each package.' }) @IsOptional() @IsInt() @Min(1) units_per_pack?: number
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

  @ApiPropertyOptional({ enum: WRITABLE_VERSION_SOURCES, description: 'Where this version came from. Default "other". A manual one needs `actor` and `reason`.' })
  @IsOptional()
  @IsIn(WRITABLE_VERSION_SOURCES)
  source?: string

  @ApiPropertyOptional({ description: 'Who entered it. The gateway sets this from the session; never trust a browser value.' })
  @IsOptional()
  @IsString()
  actor?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string

  @ApiPropertyOptional({ description: 'Idempotency key of the origin (purchase item, pricing decision): the same key creates the version once.' })
  @IsOptional()
  @IsString()
  source_ref?: string
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


export class AddEanDto {
  @ApiProperty({ example: '7891000107836', description: 'Só dígitos, de 8 a 14.' })
  @IsString()
  @Matches(/^\d{8,14}$/, { message: 'ean must be 8 to 14 digits' })
  ean: string

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Quando este EAN passa a ser o código de barras do produto.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  valid_from?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string

  @ApiPropertyOptional({ description: 'Torna este EAN o principal. Não mexe nos outros.' })
  @IsOptional()
  @IsBoolean()
  make_primary?: boolean

  @ApiPropertyOptional({ description: 'Torna este EAN o principal E inativa o principal atual (fica no histórico, com data de fim).' })
  @IsOptional()
  @IsBoolean()
  retire_current?: boolean

  @ApiPropertyOptional({ enum: WRITABLE_EAN_SOURCES })
  @IsOptional()
  @IsIn(WRITABLE_EAN_SOURCES)
  source?: string

  @ApiPropertyOptional({ description: 'O usuário da sessão; o gateway define, nunca confie num valor do navegador.' })
  @IsOptional()
  @IsString()
  actor?: string
}

export class UpdateEanDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'

  @ApiPropertyOptional({ example: '2026-10-09', description: 'Fim da validade ao inativar (hoje se omitido).' })
  @IsOptional()
  @IsISO8601({ strict: true })
  valid_to?: string

  @ApiPropertyOptional({ description: 'true torna este o EAN principal (tem de estar ativo); false tira a marca.' })
  @IsOptional()
  @IsBoolean()
  primary?: boolean

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null
}

export class ResolveEansDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eans: string[]
}

/** The mapped rows of an Excel import. Each row is plain data; the service validates every field and reports a problem per row instead of rejecting the file. */
export class CatalogueImportDto {
  @ApiProperty({ type: [Object], description: 'Linhas já mapeadas pelo operador: sku, name, category, subcategory, brand, ean, saleUnit, purchaseUnit, packageType, unitsPerPackage e `row` (a linha da planilha).' })
  @IsArray()
  @ArrayNotEmpty()
  rows: Record<string, unknown>[]

  @ApiPropertyOptional({ description: 'Quando ligado, uma célula vazia limpa o campo do produto existente. Desligado (padrão), célula vazia nunca apaga nada.' })
  @IsOptional()
  @IsBoolean()
  clearEmpty?: boolean

  @ApiPropertyOptional({ description: 'Quem importa. O gateway define pela sessão.' })
  @IsOptional()
  @IsString()
  actor?: string
}
