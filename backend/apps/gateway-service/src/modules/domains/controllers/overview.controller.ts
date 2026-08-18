import { Controller, Get, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { describeUpstreamFailure } from '../../upstream/upstream.client'
import { correlationOf } from './stores.controller'

interface SectionOk<T> {
  available: true
  data: T
}

interface SectionFailed {
  available: false
  /** Named so the panel can say which figure is missing, not just that one is. */
  upstream: string
  reason: 'unreachable' | 'error'
}

type Section<T> = SectionOk<T> | SectionFailed

/**
 * The one route that fans out to more than one service.
 *
 * Partial failure is explicit per section rather than returning whatever
 * resolved. The same principle as products-service's partitioned cost result:
 * a partial result that looks complete produces a confidently wrong dashboard,
 * and the panel must be able to render "this is unavailable" instead of a
 * smaller number.
 */
@ApiTags('overview')
@Controller('overview')
export class OverviewController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.STORES_READ)
  @ApiOperation({
    summary: 'Dashboard overview',
    description:
      'Combines stores and products. Each section reports its own availability; a failing upstream never makes the response look complete.',
  })
  async overview(@Req() request: FastifyRequest) {
    const correlationId = correlationOf(request)

    const [stores, products] = await Promise.all([
      this.section('stores', () => this.domains.stores<unknown[]>({ method: 'get', path: '/stores', correlationId })),
      this.section('products', () =>
        this.domains.products<unknown[]>({ method: 'get', path: '/products', correlationId }),
      ),
    ])

    return {
      stores,
      products,
      // A single flag the panel can check before presenting any total.
      complete: stores.available && products.available,
    }
  }

  private async section<T>(upstream: string, load: () => Promise<{ data: T }>): Promise<Section<T>> {
    try {
      const result = await load()
      return { available: true, data: result.data }
    } catch (error) {
      const described = describeUpstreamFailure(error)
      return { available: false, upstream, reason: described.unreachable ? 'unreachable' : 'error' }
    }
  }
}
