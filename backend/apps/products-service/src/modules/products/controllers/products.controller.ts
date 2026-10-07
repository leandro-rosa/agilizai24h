import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { PRODUCT_CATEGORY_VALUES, type ProductCategory } from '../constants/product-vocabulary'
import {
  AddEanDto,
  BulkCostDto,
  BulkPriceDto,
  CreateOverrideDto,
  CreateProductDto,
  DecideSkuLinkDto,
  SyncApplyDto,
  SyncPreviewDto,
  RecordCostDto,
  RecordPriceDto,
  ResolveEansDto,
  ResolveNamesDto,
  ResolveSkusDto,
  UpdateEanDto,
  UpdateProductDto,
} from '../dto/product.dto'
import { CatalogueSyncService } from '../services/catalogue-sync.service'
import { CostService } from '../services/cost.service'
import { EanService } from '../services/ean.service'
import { PriceService } from '../services/price.service'
import { ProductsService } from '../services/products.service'
import { SkuLinkService } from '../services/sku-link.service'

@ApiTags('products')
@Controller()
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly costs: CostService,
    private readonly eans: EanService,
    private readonly prices: PriceService,
    private readonly skuLinks: SkuLinkService,
    private readonly catalogueSync: CatalogueSyncService,
  ) {}

  @Post('catalogue-sync/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Plan what syncing the pricing sheet would create/change — writes nothing' })
  syncPreview(@Body() dto: SyncPreviewDto) {
    return this.catalogueSync.preview(dto.rows)
  }

  @Post('catalogue-sync/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply only the selected items of the pricing-sheet sync (creates products, records dated cost/price versions)' })
  syncApply(@Body() dto: SyncApplyDto) {
    return this.catalogueSync.apply(dto.rows, dto.selection, dto.new_products_from, dto.changes_from)
  }

  @Get('sku-links')
  @ApiOperation({ summary: 'Operator decisions on SKU pairs (same product with a changed barcode, or not)' })
  listSkuLinks() {
    return this.skuLinks.list()
  }

  @Put('sku-links')
  @ApiOperation({ summary: 'Confirm or reject that a new SKU is the same product as an old one' })
  decideSkuLink(@Body() dto: DecideSkuLinkDto) {
    return this.skuLinks.decide(dto.old_sku, dto.new_sku, dto.decision)
  }

  @Delete('sku-links/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Undo a decision' })
  removeSkuLink(@Param('id', ParseIntPipe) id: number) {
    return this.skuLinks.remove(id)
  }

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
    return this.products.create(dto)
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto)
  }

  @Get('products/:id/eans')
  @ApiOperation({ summary: 'Every EAN the product has or ever had, with status and validity' })
  listEans(@Param('id', ParseIntPipe) id: number) {
    return this.eans.list(id)
  }

  @Post('products/:id/eans')
  @ApiOperation({
    summary: 'Link another EAN to the product',
    description:
      'A product can have several EANs. 409 when the EAN is active on another product (naming it) or already linked here. `retire_current` makes it the principal and retires the old principal, which stays in the history. Nothing is ever deleted and no product is created.',
  })
  addEan(@Param('id', ParseIntPipe) id: number, @Body() dto: AddEanDto) {
    return this.eans.add(id, { ean: dto.ean, validFrom: dto.valid_from, note: dto.note, makePrimary: dto.make_primary, retireCurrent: dto.retire_current, source: dto.source, actor: dto.actor })
  }

  @Patch('products/:id/eans/:eanId')
  @ApiOperation({ summary: 'Inactivate or reactivate an EAN, change the principal, or edit its note. There is no delete.' })
  updateEan(@Param('id', ParseIntPipe) id: number, @Param('eanId', ParseIntPipe) eanId: number, @Body() dto: UpdateEanDto) {
    return this.eans.update(id, eanId, { status: dto.status, validTo: dto.valid_to, primary: dto.primary, note: dto.note })
  }

  @Post('eans/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Find the SKU of EANs, active or historical',
    description:
      'Partitioned: `resolved` (match active or historical) and `unresolved` with a reason (`ean_not_identified`, `ean_ambiguous`, `ean_invalid`). An unknown EAN never creates a product.',
  })
  resolveEans(@Body() dto: ResolveEansDto) {
    return this.eans.resolve(dto.eans)
  }

  @Post('products/:sku/costs')
  @ApiOperation({
    summary: 'Record a cost effective from a date, as a new version',
    description:
      'Append-only: never overwrites or removes a version, not even one of the same effective date (a correction is a later version of that date). Recording the same value, date and source again, or the same `source_ref`, writes nothing. The reply says whether the version is the one in force for its date.',
  })
  recordCost(@Param('sku') sku: string, @Body() dto: RecordCostDto) {
    return this.costs.recordCost(sku, new Date(dto.effective_from), dto.cost_cents, {
      source: dto.source,
      actor: dto.actor,
      reason: dto.reason,
      sourceRef: dto.source_ref,
      supplierId: dto.supplier_id,
      purchaseId: dto.purchase_id,
      purchaseItemId: dto.purchase_item_id,
      invoiceNumber: dto.invoice_number,
      purchaseQuantity: dto.purchase_quantity,
      purchaseTotalCents: dto.purchase_total_cents,
      packQuantity: dto.pack_quantity,
      unitsPerPack: dto.units_per_pack,
    })
  }

  @Get('products/:id/costs')
  @ApiOperation({ summary: 'List a product cost history, oldest first, with `valid_to` and `superseded` derived' })
  listCosts(@Param('id', ParseIntPipe) id: number) {
    return this.costs.listVersions(id)
  }

  @Post('products/:sku/prices')
  @ApiOperation({
    summary: 'Record a sale price effective from a date, as a new version',
    description:
      'Same contract as the cost endpoint: append-only, a same-date correction is a later version, the same `source_ref` (e.g. the pricing decision) writes once.',
  })
  recordPrice(@Param('sku') sku: string, @Body() dto: RecordPriceDto) {
    return this.prices.recordPrice(sku, new Date(dto.effective_from), dto.price_cents, { source: dto.source, actor: dto.actor, reason: dto.reason, sourceRef: dto.source_ref })
  }

  @Get('products/:id/prices')
  @ApiOperation({ summary: 'List a product sale-price history, newest first, with `valid_to` and `superseded` derived' })
  listPrices(@Param('id', ParseIntPipe) id: number) {
    return this.prices.listVersions(id)
  }

  @Post('prices/bulk')
  @ApiOperation({
    summary: 'Sale prices for a set of SKUs as of a date',
    description:
      'Partitioned like the cost equivalent — a map would invite treating a missing price as zero, which here inflates margin instead of leaving the hole visible.',
  })
  bulkPrice(@Body() dto: BulkPriceDto) {
    return this.prices.bulkPriceAsOf(dto.skus, new Date(dto.as_of))
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

  @Post('skus/resolve')
  @ApiOperation({
    summary: 'Resolve product codes directly against the catalogue SKU',
    description:
      'The primary resolution path (design D3 of align-ingestion-with-real-reports): the code is the same identifier ' +
      'across the sales report, the restocking report and the price list. No normalisation, no override — an exact ' +
      'match or a reported unknown_sku, never a guess from the name.',
  })
  resolveSkus(@Body() dto: ResolveSkusDto) {
    return this.products.resolveSkus(dto.skus)
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
