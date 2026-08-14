import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Patch,
  Query,
  Req,
  Res,
  Sse,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import { FastifyReply, FastifyRequest } from 'fastify'
import { interval, Observable } from 'rxjs'
import { map, switchMap, takeWhile } from 'rxjs/operators'
import { QuotesService, UploadedSpreadsheet } from '../services/quotes.service'
import { QuoteItemsService } from '../services/quote-items.service'
import { QuoteProductsService } from '../services/quote-products.service'
import { QuoteExportsService } from '../services/quote-exports.service'
import { QuoteActivityService } from '../services/quote-activity.service'
import { PartnerIntakeService } from '../services/partner-intake.service'
import { ListQuotesQueryDto } from '../dto/list-quotes-query.dto'
import { SubmitMappingDto } from '../dto/submit-mapping.dto'
import { ListItemsQueryDto } from '../dto/list-items-query.dto'
import { ItemDecisionDto } from '../dto/item-decision.dto'
import { BatchDecisionDto } from '../dto/batch-decision.dto'
import { CreateExportDto } from '../dto/create-export.dto'
import { PartnerIntakeDto } from '../dto/partner-intake.dto'
import { AddQuoteItemDto } from '../dto/add-quote-item.dto'
import { ListActivityQueryDto } from '../dto/list-activity-query.dto'
import { Actor } from '../decorators/actor.decorator'
import { MatchingConfigDto } from '../dto/matching-config.dto'

const TERMINAL_STATUSES = new Set(['awaiting_review', 'partially_reviewed', 'reviewed', 'completed', 'failed', 'cancelled'])

@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly quoteItemsService: QuoteItemsService,
    private readonly quoteProductsService: QuoteProductsService,
    private readonly quoteExportsService: QuoteExportsService,
    private readonly activityService: QuoteActivityService,
    private readonly partnerIntakeService: PartnerIntakeService,
  ) {}

  @Get('config')
  getConfig() {
    return this.quotesService.getConfig()
  }

  @Get('products/search')
  searchProducts(@Query('q') term: string, @Query('fields') fields?: string) {
    return this.quoteProductsService.search(term ?? '', fields ? fields.split(',') : undefined)
  }

  @Get('products')
  getProducts(@Query('ids') ids: string) {
    return this.quoteProductsService.getByIds(ids ? ids.split(',') : [])
  }

  @Post('partner-intake')
  partnerIntake(@Body() dto: PartnerIntakeDto, @Actor() actor: string | null) {
    return this.partnerIntakeService.intake(dto, actor)
  }

  /**
   * Adds one line item to an already-existing `source: partner_api` quote
   * — same raw-field shape as partner-intake's `lines[]`. 400 if the quote
   * isn't partner-API-sourced (spreadsheet quotes add rows via upload/
   * mapping, not this endpoint).
   */
  @Post(':id/items')
  addItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddQuoteItemDto, @Actor() actor: string | null) {
    return this.partnerIntakeService.addItem(id, dto, actor)
  }

  @Get()
  list(@Query() query: ListQuotesQueryDto) {
    return this.quotesService.list(query)
  }

  /**
   * Multipart upload — Fastify parses the request as an async iterator of
   * parts (see main.ts's `@fastify/multipart` registration). No ValidationPipe
   * binding here since the body isn't JSON; `name` and the file part are
   * checked by hand, mirroring CreateQuoteDto's documented contract.
   */
  @Post()
  async create(@Req() request: FastifyRequest, @Actor() actor: string | null) {
    let name: string | undefined
    let file: UploadedSpreadsheet | undefined

    for await (const part of (request as any).parts()) {
      if (part.type === 'field' && part.fieldname === 'name') {
        name = String(part.value)
      }
      if (part.type === 'file' && part.fieldname === 'file') {
        const buffer = await part.toBuffer()
        file = {
          fileName: part.filename,
          fileSizeBytes: buffer.byteLength,
          contentType: part.mimetype,
          buffer,
        }
      }
    }

    if (!name) {
      throw new BadRequestException('Missing "name" field')
    }
    if (!file) {
      throw new BadRequestException('Missing "file" part')
    }

    return this.quotesService.createFromUpload(name, actor, file)
  }

  /** Returns quote header/config only; use GET :id/items for paginated lines. */
  @Get(':id')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.quotesService.findById(id)
  }

  @Get(':id/status')
  getStatus(@Param('id', ParseIntPipe) id: number) {
    return this.quotesService.getStatus(id)
  }

  @Get(':id/file')
  async downloadOriginalFile(@Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const { fileName, buffer, contentType } = await this.quotesService.getOriginalFile(id)
    reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
      .send(buffer)
  }

  /**
   * Additive to polling (GET :id/status), same payload shape. Re-queries
   * status every 2s and completes the stream once the quote reaches a
   * terminal status (the last, terminal value is still emitted before
   * closing). Simpler than a Redis pub/sub fan-out — acceptable at this
   * scope since polling stays the baseline that always works regardless.
   */
  @Sse(':id/events')
  events(@Param('id', ParseIntPipe) id: number): Observable<MessageEvent> {
    return interval(2000).pipe(
      switchMap(() => this.quotesService.getStatus(id)),
      takeWhile(status => !TERMINAL_STATUSES.has(status.status as string), true),
      map(status => ({ data: status }) as MessageEvent),
    )
  }

  @Patch(':id/mapping')
  submitMapping(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitMappingDto, @Actor() actor: string | null) {
    return this.quotesService.submitMapping(id, dto, actor)
  }

  @Patch(':id/matching-config')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  saveMatchingConfig(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MatchingConfigDto,
    @Actor() actor: string | null,
  ) {
    const { expected_revision: expectedRevision, ...config } = dto
    return this.quotesService.saveMatchingConfig(id, config, expectedRevision, actor)
  }

  @Post(':id/reprocess-pending')
  reprocessPending(@Param('id', ParseIntPipe) id: number, @Actor() actor: string | null) {
    return this.quotesService.reprocessPending(id, actor)
  }

  @Post(':id/start')
  start(@Param('id', ParseIntPipe) id: number, @Actor() actor: string | null) {
    return this.quotesService.startProcessing(id, actor)
  }

  @Post(':id/complete')
  complete(@Param('id', ParseIntPipe) id: number, @Actor() actor: string | null) {
    return this.quotesService.completeReview(id, actor)
  }

  @Get(':id/items')
  listItems(@Param('id', ParseIntPipe) id: number, @Query() query: ListItemsQueryDto) {
    return this.quoteItemsService.listItems(id, query)
  }

  @Patch(':id/items/:itemId/decision')
  decideItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: ItemDecisionDto,
    @Actor() actor: string | null,
  ) {
    return this.quoteItemsService.decideItem(id, itemId, dto, actor)
  }

  @Post(':id/items/decisions:batch')
  decideBatch(@Param('id', ParseIntPipe) id: number, @Body() dto: BatchDecisionDto, @Actor() actor: string | null) {
    return this.quoteItemsService.decideItemsBatch(id, dto.item_ids, dto.decision, dto.notes, actor)
  }

  @Post(':id/exports')
  createExport(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateExportDto, @Actor() actor: string | null) {
    return this.quoteExportsService.createExport(id, dto, actor)
  }

  @Get(':id/exports')
  listExports(@Param('id', ParseIntPipe) id: number) {
    return this.quoteExportsService.listExports(id)
  }

  @Get(':id/exports/:exportId')
  getExport(@Param('id', ParseIntPipe) id: number, @Param('exportId', ParseIntPipe) exportId: number) {
    return this.quoteExportsService.getExport(id, exportId)
  }

  @Get(':id/exports/:exportId/file')
  async downloadExportFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('exportId', ParseIntPipe) exportId: number,
    @Res() reply: FastifyReply,
  ) {
    const { fileName, buffer, contentType } = await this.quoteExportsService.getExportFile(id, exportId)
    reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
      .send(buffer)
  }

  /** Newest-first activity page; cursor is the last returned event ID. */
  @Get(':id/activity')
  getActivity(@Param('id', ParseIntPipe) id: number, @Query() query: ListActivityQueryDto) {
    return this.activityService.listByQuote(id, query)
  }
}
