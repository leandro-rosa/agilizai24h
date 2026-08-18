import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'

/**
 * Explicit routes, not a transparent proxy. A pass-through would make every
 * domain endpoint implicitly public the moment it is written, and the
 * permission a route requires would live nowhere.
 */
@ApiTags('stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.STORES_READ)
  @ApiOperation({ summary: 'List stores' })
  async list(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.stores({
      method: 'get',
      path: `/stores${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.STORES_READ)
  @ApiOperation({ summary: 'Retrieve one store' })
  async findById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.stores({
      method: 'get',
      path: `/stores/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post()
  @RequiresPermission(PERMISSIONS.STORES_WRITE)
  @ApiOperation({ summary: 'Create a store' })
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.stores({
      method: 'post',
      path: '/stores',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch(':id')
  @RequiresPermission(PERMISSIONS.STORES_WRITE)
  @ApiOperation({ summary: 'Update a store' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.stores({
      method: 'patch',
      path: `/stores/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

export function correlationOf(request: FastifyRequest): string | undefined {
  return (request as { correlationId?: string }).correlationId
}
