import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { PRODUCT_CATEGORY_VALUES, type ProductCategory } from '../constants/product-vocabulary'
import {
  BulkCostDto,
  CreateOverrideDto,
  CreateProductDto,
  RecordCostDto,
  ResolveNamesDto,
  UpdateProductDto,
} from '../dto/product.dto'
import { CostService } from '../services/cost.service'
import { ProductsService } from '../services/products.service'

@ApiTags('products')
@Controller()
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly costs: CostService,
  ) {}

  @Get('products')
  @ApiOperation({ summary: 'List catalogue products' })
  @ApiQuery({ name: 'category', required: false, enum: PRODUCT_CATEGORY_VALUES })
  list(@Query('category') category?: ProductCategory) {
    return this.products.list(category)
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Retrieve one product' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.products.findById(id)
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a product' })
  @ApiResponse({ status: 409, description: 'SKU already exists' })
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto.sku, dto.name, dto.category)
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto)
  }

  @Post('products/:sku/costs')
  @ApiOperation({
    summary: 'Record a cost effective from a date',
    description:
      'Never overwrites earlier versions. Re-recording for an effective date that already exists replaces that one version only.',
  })
  recordCost(@Param('sku') sku: string, @Body() dto: RecordCostDto) {
    return this.costs.recordCost(sku, new Date(dto.effective_from), dto.cost_cents)
  }

  @Get('products/:id/costs')
  @ApiOperation({ summary: 'List a product cost history' })
  listCosts(@Param('id', ParseIntPipe) id: number) {
    return this.costs.listVersions(id)
  }

  @Get('costs')
  @ApiOperation({
    summary: 'Cost of one SKU as of a date',
    description: 'There is deliberately no lookup that returns a "current" cost without a date.',
  })
  @ApiQuery({ name: 'sku', required: true })
  @ApiQuery({ name: 'as_of', required: true, example: '2026-03-31' })
  costAsOf(@Query('sku') sku: string, @Query('as_of') asOf: string) {
    return this.costs.costAsOf(sku, new Date(asOf))
  }

  @Post('costs/bulk')
  @ApiOperation({
    summary: 'Costs for a set of SKUs as of a date',
    description:
      'Returns a partitioned result — `resolved` and `unresolved` with a reason each, plus `complete`. Deliberately not a map: a map invites treating a missing cost as zero, which understates COGS and loss.',
  })
  bulkCost(@Body() dto: BulkCostDto) {
    return this.costs.bulkCostAsOf(dto.skus, new Date(dto.as_of))
  }

  @Post('names/resolve')
  @ApiOperation({
    summary: 'Resolve POS product names to catalogue products',
    description:
      'Normalisation (case, accents, whitespace) then a curated override, which wins. Ambiguous and unknown names are reported, never guessed — there is no fuzzy matching.',
  })
  resolveNames(@Body() dto: ResolveNamesDto) {
    return this.products.resolveNames(dto.names)
  }

  @Get('names/overrides')
  @ApiOperation({ summary: 'List curated name overrides' })
  listOverrides() {
    return this.products.listOverrides()
  }

  @Post('names/overrides')
  @ApiOperation({
    summary: 'Add or replace a curated name override',
    description: 'Lets a real mismatch be fixed without a deploy.',
  })
  addOverride(@Body() dto: CreateOverrideDto) {
    return this.products.addOverride(dto.source_name, dto.sku)
  }

  @Delete('names/overrides/:id')
  @ApiOperation({ summary: 'Remove a curated name override' })
  removeOverride(@Param('id', ParseIntPipe) id: number) {
    return this.products.removeOverride(id)
  }
}
