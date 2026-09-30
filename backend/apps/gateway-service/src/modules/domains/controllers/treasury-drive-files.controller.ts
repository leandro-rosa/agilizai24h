import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/**
 * The treasury Drive source's surface for the admin — mirrors `DriveFilesController`
 * (the sibling sales/abastecimento Drive source, `../../ingestion/drive-files.controller.ts`)
 * at `/treasury-drive-files`, forwarding to the same ingestion-worker-service
 * (`TreasuryDriveFilesController`, Task 10) via `INGESTION_SERVICE_URL`.
 *
 * Gated by `treasury:read`/`treasury:write`, not `ingestion:*`: these files feed the
 * treasury import screen, not the sales/supply one, so the permission that controls
 * them is the same one that already controls every other treasury route (accounts,
 * mappings, transactions, the manual-upload imports).
 *
 * A dedicated controller, not new methods on `TreasuryController` — that controller's
 * `@Controller('treasury')` prefix would turn these into `/treasury/treasury-drive-files`,
 * but the worker's own routes (and Task 13's frontend) are fixed at the top-level
 * `/treasury-drive-files` path, mirroring why `/drive-files` itself is top-level (see
 * that controller's own doc comment: avoiding a collision with a `:id` route). Same
 * reasoning as `TreasuryImportsController` being its own file rather than living inside
 * `TreasuryController`: a different resource, not a shared prefix.
 *
 * No error-body relay here (unlike `DriveFilesController.relay()`): the treasury Drive
 * source's refusals (`not_configured`, `not_found`) carry a `code` the same way the
 * sales/supply source's do, but neither Task 13's API layer nor Task 14's UI reads that
 * `code` for this source — the global `UpstreamExceptionFilter`'s forwarded `message` is
 * enough for now. Revisit if a later task needs the `code`.
 */
@ApiTags('treasury-drive-files')
@Controller('treasury-drive-files')
export class TreasuryDriveFilesController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'Bank statement/invoice files tracked from the treasury Drive folders' })
  async list(@Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'get',
      path: '/treasury-drive-files',
      correlationId: correlationOf(request),
    })

    return result.data
  }

  // Declared before the `:id` routes so "status" is never read as an id.
  @Get('status')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'Whether the treasury Drive source is configured' })
  async status(@Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'get',
      path: '/treasury-drive-files/status',
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('scan')
  @HttpCode(202)
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: '"Sincronizar agora": queue a scan of the treasury Drive folders' })
  async scan(@Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'post',
      path: '/treasury-drive-files/scan',
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':id/import')
  @HttpCode(202)
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Import a confirmed treasury Drive file', description: 'Body: { accountId, period }.' })
  async import(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'post',
      path: `/treasury-drive-files/${encodeURIComponent(id)}/import`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':id/ignore')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Ignore a file, or bring an ignored one back (`{ "ignored": false }`)' })
  async ignore(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'post',
      path: `/treasury-drive-files/${encodeURIComponent(id)}/ignore`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}
