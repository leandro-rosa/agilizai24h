import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Caller } from '../auth/guards/caller.decorator'
import { RequiresPermission } from '../auth/guards/session.constants'
import type { AuthenticatedCaller } from '../auth/services/session.service'
import { correlationOf } from '../domains/controllers/stores.controller'
import { DomainClient } from '../upstream/domain.client'
import { UpstreamStatusError, type UpstreamResponse } from '../upstream/upstream.client'

/**
 * The Google Drive source's surface for the admin. It holds no logic: the routes,
 * their permissions and the identity of who confirmed an import are all it adds.
 *
 * It is mounted at `/drive-files`, NOT under `/ingestions`, because
 * `GET /ingestions/:id` would swallow `/ingestions/drive-files` as an id.
 *
 * The gateway's global upstream filter forwards only a status and a message, which
 * would drop the `code` and details these refusals carry — `would_replace` for a
 * replacement to confirm, the inconsistencies and hash to review — and without
 * them the admin cannot show the person what they are confirming. So this
 * controller relays the worker's error body as it came.
 */
@ApiTags('drive-files')
@Controller('drive-files')
export class DriveFilesController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.INGESTION_READ)
  @ApiOperation({ summary: 'Files tracked in the Drive, with their validation result' })
  async list(@Query('status') status: string | undefined, @Req() request: FastifyRequest) {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''

    return (await this.relay(this.domains.ingestion({ method: 'get', path: `/drive-files${query}`, correlationId: correlationOf(request) }))).data
  }

  // Declared before the `:id` routes so "status" is never read as an id.
  @Get('status')
  @RequiresPermission(PERMISSIONS.INGESTION_READ)
  @ApiOperation({ summary: 'Whether the Drive source is configured, and how the last scan went' })
  async status(@Req() request: FastifyRequest) {
    return (await this.relay(this.domains.ingestion({ method: 'get', path: '/drive-files/status', correlationId: correlationOf(request) }))).data
  }

  @Post('scan')
  @HttpCode(202)
  @RequiresPermission(PERMISSIONS.INGESTION_UPLOAD)
  @ApiOperation({ summary: '"Sincronizar agora": queue a scan of the Drive folder' })
  async scan(@Req() request: FastifyRequest) {
    return (await this.relay(this.domains.ingestion({ method: 'post', path: '/drive-files/scan', correlationId: correlationOf(request) }))).data
  }

  @Post(':id/validate')
  @RequiresPermission(PERMISSIONS.INGESTION_UPLOAD)
  @ApiOperation({ summary: 'Validate a file, or re-evaluate it for another type or period' })
  async validate(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.relay(
      this.domains.ingestion({
        method: 'post',
        path: `/drive-files/${encodeURIComponent(id)}/validate`,
        payload: body ?? {},
        correlationId: correlationOf(request),
      }),
    )

    // 200 when the worker answered from what it already knew, 202 when it queued the work.
    void reply.status(result.status)
    return result.data
  }

  @Post(':id/import')
  @HttpCode(202)
  @RequiresPermission(PERMISSIONS.INGESTION_UPLOAD)
  @ApiOperation({ summary: 'Import a file the person confirmed', description: 'Nothing is imported by a scan or a validation.' })
  async import(@Param('id') id: string, @Body() body: unknown, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (
      await this.relay(
        this.domains.ingestion({
          method: 'post',
          path: `/drive-files/${encodeURIComponent(id)}/import`,
          // Who confirmed is the session, never something a browser can claim: it overrides anything sent.
          payload: { ...(typeof body === 'object' && body !== null ? body : {}), confirmed_by: caller.email },
          correlationId: correlationOf(request),
        }),
      )
    ).data
  }

  @Post(':id/ignore')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.INGESTION_UPLOAD)
  @ApiOperation({ summary: 'Ignore a file, or bring an ignored one back' })
  async ignore(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (
      await this.relay(
        this.domains.ingestion({
          method: 'post',
          path: `/drive-files/${encodeURIComponent(id)}/ignore`,
          payload: body ?? {},
          correlationId: correlationOf(request),
        }),
      )
    ).data
  }

  /** Re-throws a worker refusal with its own body, so a `code` and its details reach the admin intact. */
  private async relay<T>(call: Promise<UpstreamResponse<T>>): Promise<UpstreamResponse<T>> {
    try {
      return await call
    } catch (error) {
      if (error instanceof UpstreamStatusError && typeof error.body === 'object' && error.body !== null) {
        throw new HttpException(error.body as Record<string, unknown>, error.status)
      }
      throw error
    }
  }
}
