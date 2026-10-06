import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CreatePurchaseDto, UpdatePurchaseItemDto } from '../dto/purchase.dto'
import { PurchaseImportService, type InvoiceInput } from '../services/purchase-import.service'
import { PurchasesService } from '../services/purchases.service'

@ApiTags('purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly importer: PurchaseImportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List purchases (newest first), optionally by supplier and dates; `invoices_only=true` lists only those with an invoice' })
  list(@Query('supplier_id') supplierId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('invoices_only') invoicesOnly?: string) {
    return this.purchases.list({ supplierId: supplierId ? Number(supplierId) : undefined, from, to, invoicesOnly: invoicesOnly === 'true' })
  }

  /** Declared before `:id` so "summary" is not read as an id. */
  @Get('summary')
  @ApiOperation({ summary: 'One month of purchases by SKU (units and cents by condition) and the first month with any purchase' })
  summary(@Query('month') month: string) {
    return this.purchases.summary(month)
  }

  @Post('import/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a parsed NF-e to the registry (supplier by tax id, lines by barcode then SKU). Records nothing.' })
  preview(@Body() invoice: InvoiceInput, @Headers('x-correlation-id') correlationId?: string) {
    return this.importer.preview(invoice, correlationId)
  }

  @Post()
  @ApiOperation({ summary: 'Record a purchase (manual or from an invoice)', description: 'Refuses an unknown supplier or product, and a repeated invoice number of the same supplier.' })
  create(@Body() dto: CreatePurchaseDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.purchases.create(dto, correlationId)
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Change the condition (until settled) or the payment status of an item' })
  updateItem(@Param('itemId', ParseIntPipe) itemId: number, @Body() dto: UpdatePurchaseItemDto) {
    return this.purchases.updateItem(itemId, dto)
  }

  @Get(':id')
  @ApiOperation({ summary: 'One purchase with its items' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.purchases.findById(id)
  }
}
