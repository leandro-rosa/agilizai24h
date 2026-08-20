import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/**
 * Explicit routes, not a transparent proxy — same reason as every other
 * domain controller here: a pass-through would make each endpoint implicitly
 * public the moment it is written, and the permission a route requires would
 * live nowhere.
 */
@ApiTags('suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'List suppliers' })
  async get(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.suppliers({
      method: 'get',
      path: `/suppliers${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('resolve')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'Resolve statement spellings to suppliers' })
  async postResolve(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.suppliers({
      method: 'post',
      path: '/suppliers/resolve',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post()
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Create a supplier' })
  async post(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.suppliers({
      method: 'post',
      path: '/suppliers',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'Retrieve one supplier with its aliases' })
  async getById(@Param('id') id: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.suppliers({
      method: 'get',
      path: `/suppliers/${encodeURIComponent(id)}${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch(':id')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Update a supplier' })
  async patchById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.suppliers({
      method: 'patch',
      path: `/suppliers/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':id/aliases')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Register another spelling' })
  async postByIdAliases(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.suppliers({
      method: 'post',
      path: `/suppliers/${encodeURIComponent(id)}/aliases`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Delete(':id/aliases/:aliasId')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Drop a spelling' })
  async deleteByIdAliasesByAliasid(@Param('id') id: string, @Param('aliasId') aliasId: string, @Req() request: FastifyRequest) {
    const result = await this.domains.suppliers({
      method: 'delete',
      path: `/suppliers/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}
