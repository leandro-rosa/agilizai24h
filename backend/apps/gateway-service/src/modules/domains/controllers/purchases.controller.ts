import { randomUUID } from 'node:crypto'
import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { S3Service } from '@app/aws'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { Caller } from '../../auth/guards/caller.decorator'
import { RequiresPermission } from '../../auth/guards/session.constants'
import type { AuthenticatedCaller } from '../../auth/services/session.service'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/**
 * The actor of every write is the logged-in user: it is set here from the session and overrides whatever the client put in the body,
 * so "who created, sent, invoiced or received" can never be typed by the person it is about.
 */
const asActor = (body: unknown, caller: AuthenticatedCaller) => ({ ...(typeof body === 'object' && body !== null ? body : {}), actor: caller.email })

const withQuery = (path: string, query: Record<string, string>) => {
  const search = new URLSearchParams(query).toString()

  return search ? `${path}?${search}` : path
}

/**
 * Purchases and weekly settlements (suppliers-service). Explicit routes, like every domain controller here: the permission each
 * one requires lives in this file, not in a pass-through. The system records what was bought, owed and paid; it never pays.
 */
@ApiTags('purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly domains: DomainClient,
    private readonly s3: S3Service,
  ) {}

  @Get()
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'List purchases' })
  async list(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: withQuery('/purchases', query), correlationId: correlationOf(request) })).data
  }

  @Get('summary')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'One month of purchases by SKU' })
  async summary(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: withQuery('/purchases/summary', query), correlationId: correlationOf(request) })).data
  }

  /**
   * Reads one NF-e and shows what it would record — nothing is recorded here. The raw XML is kept first (it is the evidence if the
   * purchase is questioned), then parsed by the ingestion service and resolved by purchasing; the operator confirms in the panel.
   */
  @Post('import')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import an NF-e XML: returns the resolved and unresolved lines for review (records nothing)' })
  async importInvoice(@Req() request: FastifyRequest) {
    const uploaded = await (request as unknown as { file: () => Promise<{ filename?: string; mimetype?: string; toBuffer: () => Promise<Buffer> } | undefined> }).file()
    if (!uploaded) throw new BadRequestException('No file was uploaded')

    const filename = uploaded.filename ?? 'nfe.xml'
    if (!filename.toLowerCase().endsWith('.xml')) throw new BadRequestException('Expected an NF-e XML file (.xml)')

    const body = await uploaded.toBuffer()
    const objectKey = `purchase-invoices/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${filename}`
    await this.s3.uploadFile(objectKey, body, uploaded.mimetype ?? 'application/xml')

    const correlationId = correlationOf(request)
    // 422 from the parser (not an NF-e) reaches the operator as the reason, via the gateway's upstream error mapping.
    const parsed = await this.domains.ingestion({ method: 'post', path: '/purchase-invoices/parse', payload: { xml: body.toString('utf8') }, correlationId })
    const preview = await this.domains.suppliers<Record<string, unknown>>({ method: 'post', path: '/purchases/import/preview', payload: parsed.data, correlationId })

    return { object_key: objectKey, ...preview.data }
  }

  @Post()
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Record a purchase' })
  async create(@Body() body: unknown, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: '/purchases', payload: asActor(body, caller), correlationId: correlationOf(request) })).data
  }

  /** Declared before `:id` so "payments" is not read as an id. */
  @Get('payments/pending')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'What is still to be paid, by due day' })
  async pendingPayments(@Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: '/purchases/payments/pending', correlationId: correlationOf(request) })).data
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Move an order to its next stage' })
  async transition(@Param('id') id: string, @Body() body: unknown, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: `/purchases/${encodeURIComponent(id)}/transition`, payload: asActor(body, caller), correlationId: correlationOf(request) })).data
  }

  @Patch(':id')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Delivery deadline, payment term and notes of an order' })
  async updateOrder(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'patch', path: `/purchases/${encodeURIComponent(id)}`, payload: body, correlationId: correlationOf(request) })).data
  }

  @Get(':id/history')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'The stage history of an order' })
  async history(@Param('id') id: string, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: `/purchases/${encodeURIComponent(id)}/history`, correlationId: correlationOf(request) })).data
  }

  @Get(':id/email-preview')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'Preview of the e-mail of an order (sends nothing)' })
  async emailPreview(@Param('id') id: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: withQuery(`/purchases/${encodeURIComponent(id)}/email-preview`, query), correlationId: correlationOf(request) })).data
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Send the order to the supplier by e-mail, after the operator confirmed the preview' })
  async send(@Param('id') id: string, @Body() body: unknown, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: `/purchases/${encodeURIComponent(id)}/send`, payload: asActor(body, caller), correlationId: correlationOf(request) })).data
  }

  @Get(':id/emails')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'Every send attempt of an order' })
  async emailLog(@Param('id') id: string, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: `/purchases/${encodeURIComponent(id)}/emails`, correlationId: correlationOf(request) })).data
  }

  @Patch('items/:itemId')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Change the condition or payment status of an item' })
  async updateItem(@Param('itemId') itemId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'patch', path: `/purchases/items/${encodeURIComponent(itemId)}`, payload: body, correlationId: correlationOf(request) })).data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'One purchase' })
  async get(@Param('id') id: string, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: `/purchases/${encodeURIComponent(id)}`, correlationId: correlationOf(request) })).data
  }
}

@ApiTags('settlements')
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'List settlements' })
  async list(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: withQuery('/settlements', query), correlationId: correlationOf(request) })).data
  }

  @Get('open-total')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'Confirmed-and-unpaid total and pending proposals' })
  async openTotal(@Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: '/settlements/open-total', correlationId: correlationOf(request) })).data
  }

  @Post('propose')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Compute the weekly settlement of a supplier as a proposal' })
  async propose(@Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: '/settlements/propose', payload: body, correlationId: correlationOf(request) })).data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'One settlement with its evidence' })
  async get(@Param('id') id: string, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: `/settlements/${encodeURIComponent(id)}`, correlationId: correlationOf(request) })).data
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Confirm a proposal' })
  async confirm(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: `/settlements/${encodeURIComponent(id)}/confirm`, payload: body ?? {}, correlationId: correlationOf(request) })).data
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Record that a confirmed settlement was paid' })
  async pay(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: `/settlements/${encodeURIComponent(id)}/pay`, payload: body ?? {}, correlationId: correlationOf(request) })).data
  }
}
