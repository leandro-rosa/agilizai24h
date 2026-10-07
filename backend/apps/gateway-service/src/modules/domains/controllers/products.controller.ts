import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { Caller } from '../../auth/guards/caller.decorator'
import { RequiresPermission } from '../../auth/guards/session.constants'
import type { AuthenticatedCaller } from '../../auth/services/session.service'
import { DomainClient } from '../../upstream/domain.client'
import { eanChange, importBody, invoiceProduct, manualProduct, manualCost, manualEan, manualPrice } from './manual-version'
import { correlationOf } from './stores.controller'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List catalogue products' })
  async list(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.products({
      method: 'get',
      path: `/products${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  /** Declared before `:id` so "next-sku" is not read as an id. */
  @Get('next-sku')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Suggest the SKU for a new product (the next after the highest six-digit one); a suggestion, not a reservation' })
  async nextSku(@Req() request: FastifyRequest) {
    return (await this.domains.products({ method: 'get', path: '/products/next-sku', correlationId: correlationOf(request) })).data
  }

  @Post('from-invoice')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Register a product from an invoice line', description: 'The origin is always "invoice" and the user is the session user. The EAN of the line becomes the principal EAN. A duplicate SKU, or an EAN that belongs to another product, is refused (409).' })
  async createFromInvoice(@Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (await this.domains.products({ method: 'post', path: '/products', payload: invoiceProduct(body, caller.email), correlationId: correlationOf(request) })).data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Retrieve one product' })
  async findById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'get',
      path: `/products/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post()
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a product by hand (origin manual, user = the session user)' })
  async create(@Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: '/products',
      payload: manualProduct(body, caller.email),
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch(':id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Update a product' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'patch',
      path: `/products/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':sku/costs')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({
    summary: 'Record a cost by hand, as a new version',
    description: 'Needs a reason. The source is always `manual` and the user is the logged-in one; nothing already recorded is overwritten.',
  })
  async recordCost(@Param('sku') sku: string, @Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: `/products/${encodeURIComponent(sku)}/costs`,
      payload: manualCost(body, caller.email),
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':sku/prices')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({
    summary: 'Record a sale price by hand, as a new version',
    description: 'Needs a reason. The source is always `manual` and the user is the logged-in one. A price from the pricing recommendation goes through `POST /pricing/decisions/apply`, not here.',
  })
  async recordPrice(@Param('sku') sku: string, @Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: `/products/${encodeURIComponent(sku)}/prices`,
      payload: manualPrice(body, caller.email),
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':id/prices')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'A product sale-price history, with the end of each validity and the origin' })
  async listPrices(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'get', path: `/products/${encodeURIComponent(id)}/prices`, correlationId: correlationOf(request) })

    return result.data
  }

  @Post('prices/bulk')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Sale prices for a set of SKUs as of a date', description: 'Partitioned: a missing price is reported, never read as zero.' })
  async bulkPrices(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'post', path: '/prices/bulk', payload: body, correlationId: correlationOf(request) })

    return result.data
  }

  @Get(':id/timeline')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Every change of cost and price of a product, with its origin, newest first' })
  async timeline(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'get', path: `/products/${encodeURIComponent(id)}/timeline`, correlationId: correlationOf(request) })

    return result.data
  }

  @Get(':id/price-margins')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'The product margin over time, split at every change of cost or price' })
  async priceMargins(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'get', path: `/products/${encodeURIComponent(id)}/price-margins`, correlationId: correlationOf(request) })

    return result.data
  }

  @Get(':id/eans')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Every EAN the product has or ever had, with status and validity' })
  async listEans(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'get', path: `/products/${encodeURIComponent(id)}/eans`, correlationId: correlationOf(request) })

    return result.data
  }

  @Post(':id/eans')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({
    summary: 'Link another EAN to the product',
    description: 'A product can have several EANs. 409 when the EAN is active on another product. `retire_current` makes it the principal and retires the old one, which stays in the history. The source is `manual` and the user is the logged-in one.',
  })
  async addEan(@Param('id') id: string, @Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: `/products/${encodeURIComponent(id)}/eans`,
      payload: manualEan(body, caller.email),
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch(':id/eans/:eanId')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Inactivate or reactivate an EAN, change the principal or edit its note. There is no delete.' })
  async updateEan(@Param('id') id: string, @Param('eanId') eanId: string, @Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'patch',
      path: `/products/${encodeURIComponent(id)}/eans/${encodeURIComponent(eanId)}`,
      payload: eanChange(body),
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('eans/resolve')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Find the SKU of EANs, active or historical; an unknown EAN is reported, never turned into a product' })
  async resolveEans(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'post', path: '/eans/resolve', payload: body, correlationId: correlationOf(request) })

    return result.data
  }

  @Get(':id/costs')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'A product cost history' })
  async listCosts(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'get',
      path: `/products/${encodeURIComponent(id)}/costs`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('costs/bulk')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({
    summary: 'Costs for a set of SKUs as of a date',
    description: 'There is deliberately no lookup that returns a "current" cost without a date.',
  })
  async bulkCosts(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: '/costs/bulk',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

/**
 * Decisões do operador sobre pares de SKU (troca de código de barras). Rota
 * própria (`/sku-links`) para não colidir com `products/:id`.
 */
@ApiTags('products')
@Controller('sku-links')
export class SkuLinksController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Operator decisions on SKU pairs' })
  async list(@Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'get', path: '/sku-links', correlationId: correlationOf(request) })

    return result.data
  }

  @Put()
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Confirm or reject that a new SKU is the same product as an old one' })
  async decide(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'put', path: '/sku-links', payload: body, correlationId: correlationOf(request) })

    return result.data
  }

  @Delete(':id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Undo a decision' })
  async remove(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'delete', path: `/sku-links/${encodeURIComponent(id)}`, correlationId: correlationOf(request) })

    return result.data
  }
}

/** Sincronização do catálogo com a planilha de precificação: pré-visualizar (leitura) e aplicar (escrita). */
@ApiTags('products')
@Controller('catalogue-sync')
export class CatalogueSyncController {
  constructor(private readonly domains: DomainClient) {}

  @Post('preview')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Plan the pricing-sheet sync (writes nothing)' })
  async preview(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'post', path: '/catalogue-sync/preview', payload: body, correlationId: correlationOf(request) })

    return result.data
  }

  @Post('apply')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Apply the selected items of the pricing-sheet sync' })
  async apply(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'post', path: '/catalogue-sync/apply', payload: body, correlationId: correlationOf(request) })

    return result.data
  }
}

/** Excel import of the catalogue. The preview writes nothing; the user who applies is the session user, never one typed in the body. */
@ApiTags('products')
@Controller('catalogue-import')
export class CatalogueImportController {
  constructor(private readonly domains: DomainClient) {}

  @Post('preview')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Preview an Excel import of the catalogue: new, updates, unchanged and conflicts (writes nothing)' })
  async preview(@Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    return (await this.domains.products({ method: 'post', path: '/catalogue-import/preview', payload: importBody(body), correlationId: correlationOf(request) })).data
  }

  @Post('apply')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Apply an Excel import: creates and updates, never deletes' })
  async apply(@Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (await this.domains.products({ method: 'post', path: '/catalogue-import/apply', payload: { ...importBody(body), actor: caller.email }, correlationId: correlationOf(request) })).data
  }
}

/** When a product, a cost or a price was last recorded: Pricing uses it to say its stored report may be out of date. */
@ApiTags('products')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly domains: DomainClient) {}

  @Get('last-change')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'The latest time a product, a cost or a price was recorded' })
  async lastChange(@Req() request: FastifyRequest) {
    return (await this.domains.products({ method: 'get', path: '/catalogue/last-change', correlationId: correlationOf(request) })).data
  }
}

/** The managed categories and subcategories. Reading is open to whoever reads products; changing needs the product write permission. There is no delete route. */
@ApiTags('products')
@Controller()
export class TaxonomyController {
  constructor(private readonly domains: DomainClient) {}

  private async call(method: 'get' | 'post' | 'patch', path: string, request: FastifyRequest, payload?: unknown) {
    return (await this.domains.products({ method, path, payload, correlationId: correlationOf(request) })).data
  }

  @Get('categories')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Categories with subcategories, keywords, status and the number of products using each' })
  async categories(@Req() request: FastifyRequest) {
    return this.call('get', '/categories', request)
  }

  @Post('categories')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a category' })
  async createCategory(@Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    return this.call('post', '/categories', request, { name: body?.name, keywords: body?.keywords })
  }

  @Patch('categories/:id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Rename, set keywords or inactivate a category (never deleted)' })
  async updateCategory(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    return this.call('patch', `/categories/${encodeURIComponent(id)}`, request, { name: body?.name, keywords: body?.keywords, status: body?.status })
  }

  @Post('categories/:id/subcategories')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a subcategory under a category' })
  async createSubcategory(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    return this.call('post', `/categories/${encodeURIComponent(id)}/subcategories`, request, { name: body?.name, keywords: body?.keywords })
  }

  @Patch('subcategories/:id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Rename, set keywords or inactivate a subcategory (never deleted)' })
  async updateSubcategory(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    return this.call('patch', `/subcategories/${encodeURIComponent(id)}`, request, { name: body?.name, keywords: body?.keywords, status: body?.status })
  }

  @Post('classification/suggest')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Suggest a category and subcategory from a product name (applies nothing)' })
  async suggest(@Body() body: Record<string, unknown>, @Req() request: FastifyRequest) {
    return this.call('post', '/classification/suggest', request, { name: body?.name })
  }

  @Get('classification/review')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Proposed classifications for products without a subcategory or with an unconfirmed one (applies nothing)' })
  async review(@Req() request: FastifyRequest) {
    return this.call('get', '/classification/review', request)
  }

  @Post('classification/apply')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Apply only the selected proposals; the user is the session user' })
  async apply(@Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return this.call('post', '/classification/apply', request, { items: body?.items, actor: caller.email })
  }
}
