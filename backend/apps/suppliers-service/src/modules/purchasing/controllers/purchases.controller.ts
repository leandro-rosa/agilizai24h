import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { STAGES, type Stage } from '../constants/purchase-vocabulary'
import { CreatePurchaseDto, SendOrderEmailDto, TransitionDto, UpdateOrderDto, UpdatePurchaseItemDto } from '../dto/purchase.dto'
import { OrderEmailService } from '../mail/order-email.service'
import { PurchaseImportService, type InvoiceInput } from '../services/purchase-import.service'
import { PurchasesService } from '../services/purchases.service'

@ApiTags('purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly importer: PurchaseImportService,
    private readonly emails: OrderEmailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List purchases (newest first), optionally by supplier and dates; `invoices_only=true` lists only those with an invoice' })
  list(
    @Query('supplier_id') supplierId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('invoices_only') invoicesOnly?: string,
    @Query('status') status?: string,
    @Query('open_only') openOnly?: string,
  ) {
    if (status && !(STAGES as readonly string[]).includes(status)) throw new BadRequestException(`status must be one of: ${STAGES.join(', ')}`)

    return this.purchases.list({ supplierId: supplierId ? Number(supplierId) : undefined, from, to, invoicesOnly: invoicesOnly === 'true', status: status as Stage | undefined, openOnly: openOnly === 'true' })
  }

  /** Declared before `:id` so "summary" is not read as an id. */
  @Get('summary')
  @ApiOperation({ summary: 'One month of purchases by SKU (units and cents by condition) and the first month with any purchase' })
  summary(@Query('month') month: string) {
    return this.purchases.summary(month)
  }

  /** Declared before `:id`. */
  @Get('payments/pending')
  @ApiOperation({ summary: 'What is still to be paid, by due day (paid-condition items of orders already sent); on-sale items are paid by the weekly settlement' })
  pendingPayments() {
    return this.purchases.pendingPayments()
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

  @Post(':id/transition')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move an order to the next stage', description: 'One stage at a time; invoicing needs a number, an NF-e or "no invoice"; receiving records the quantity received per item. The gateway sets `actor` from the session.' })
  transition(@Param('id', ParseIntPipe) id: number, @Body() dto: TransitionDto) {
    return this.purchases.transition(id, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an order: dates, supplier (before receipt), invoice, terms, notes and the item list' })
  updateOrder(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.purchases.updateOrder(id, dto, correlationId)
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a purchase (refused once a confirmed settlement counted its items)' })
  remove(@Param('id', ParseIntPipe) id: number, @Query('actor') actor?: string) {
    return this.purchases.remove(id, actor)
  }

  @Get(':id/email-preview')
  @ApiOperation({ summary: 'Preview of the e-mail of an order: recipient, subject, body, whether it was already sent. Sends nothing.' })
  emailPreview(@Param('id', ParseIntPipe) id: number, @Query('message') message?: string) {
    return this.emails.preview(id, message)
  }

  @Post(':id/send')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send the order to the supplier by e-mail (after the operator confirmed the preview)',
    description: 'Refused when already sent unless `resend`. A failure keeps the stage and is logged. The first successful send of a requisition moves it to awaiting_invoice.',
  })
  send(@Param('id', ParseIntPipe) id: number, @Body() dto: SendOrderEmailDto) {
    return this.emails.send(id, dto)
  }

  @Get(':id/emails')
  @ApiOperation({ summary: 'Every send attempt of an order, with the result' })
  emailLog(@Param('id', ParseIntPipe) id: number) {
    return this.emails.log(id)
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'The stage history of an order (who, when)' })
  history(@Param('id', ParseIntPipe) id: number) {
    return this.purchases.history(id)
  }

  @Get(':id')
  @ApiOperation({ summary: 'One purchase with its items' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.purchases.findById(id)
  }
}
