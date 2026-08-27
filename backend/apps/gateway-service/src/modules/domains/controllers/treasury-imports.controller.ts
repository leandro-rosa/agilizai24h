import { randomUUID } from 'node:crypto'
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { S3Service } from '@app/aws'
import { PERMISSIONS } from '@app/iam-contracts'
import { TREASURY_SOURCES, type TreasurySource } from '@app/treasury-ingestion-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

interface CollectedFile {
  source: TreasurySource
  filename: string
  mimetype: string
  buffer: Buffer
}

/**
 * The batch-upload surface add-treasury-review-ui's screen calls, and the
 * pass-through to treasury-service's review-gate endpoints
 * (add-treasury-statement-ingestion). A separate controller from
 * `TreasuryController` on purpose — this is a different resource
 * (imports/staging, not the confirmed ledger) with its own review-only
 * permission shape, not because the routes share a prefix.
 */
@ApiTags('treasury-imports')
@Controller('treasury/imports')
export class TreasuryImportsController {
  constructor(
    private readonly domains: DomainClient,
    private readonly s3: S3Service,
  ) {}

  /**
   * Accepts any subset of the seven monthly sources in one submission — each
   * file field is named after its source (e.g. `pagbank_statement`), paired
   * with a `<source>_account_id` field naming which BankAccount it belongs
   * to, plus one shared `period` field. Every provided file is stored, then
   * handed to ingestion-worker-service one at a time; a failure on one
   * source does not prevent the others from being queued.
   */
  @Post('upload')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload any subset of the seven monthly treasury sources',
    description: 'Accepts, stores and queues each file for parsing without waiting for it to be read.',
  })
  @ApiResponse({ status: 400, description: 'No files provided, or a required account_id/period is missing' })
  async upload(@Req() request: FastifyRequest): Promise<{ queued: { source: TreasurySource }[] }> {
    const parts = (request as unknown as { parts: () => AsyncIterableIterator<MultipartPart> }).parts()

    const files: CollectedFile[] = []
    const fields: Record<string, string> = {}

    for await (const part of parts) {
      if (part.type === 'file') {
        if (!TREASURY_SOURCES.includes(part.fieldname as TreasurySource)) {
          // Draining, not just skipping: @fastify/multipart's parser blocks
          // the whole request — hangs forever, no response ever sent —
          // if a file part's stream is never consumed, even when its
          // content is unwanted. `.file.resume()` discards it without
          // buffering. Found live: an unrecognised field name (a stale
          // build not yet knowing a newly added source) hung every
          // subsequent request on the connection, not just this one.
          part.file.resume()
          continue
        }
        files.push({
          source: part.fieldname as TreasurySource,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        })
      } else {
        fields[part.fieldname] = String(part.value ?? '')
      }
    }

    if (files.length === 0) throw new BadRequestException('No files were uploaded')

    const period = fields.period
    if (!period || !PERIOD_PATTERN.test(period)) throw new BadRequestException('period is required, as YYYY-MM')

    const correlationId = correlationOf(request)
    const queued: { source: TreasurySource }[] = []

    for (const file of files) {
      const accountIdRaw = fields[`${file.source}_account_id`]
      const accountId = Number(accountIdRaw)
      if (!accountIdRaw || Number.isNaN(accountId)) {
        throw new BadRequestException(`${file.source}_account_id is required and must be a number`)
      }

      const objectKey = `treasury-imports/${period}/${file.source}/${randomUUID()}-${file.filename}`
      // The raw file goes to object storage before anything is queued — same
      // reason as every other upload in this gateway: it is the evidence,
      // and it keeps the queue payload a reference rather than a blob.
      await this.s3.uploadFile(objectKey, file.buffer, file.mimetype || 'application/octet-stream')

      await this.domains.ingestion({
        method: 'post',
        path: '/treasury-imports',
        payload: {
          source: file.source,
          object_key: objectKey,
          account_id: accountId,
          period,
          correlation_id: correlationId,
        },
        correlationId,
      })

      queued.push({ source: file.source })
    }

    return { queued }
  }

  @Get()
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'List staged/confirmed/rejected imports' })
  async list(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/imports${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'One import, with its pending transactions and rejections' })
  async getById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/imports/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch(':id/transactions/:transactionId')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: "Correct a pending line's suggested classification before confirming" })
  async updateTransaction(
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.treasury({
      method: 'patch',
      path: `/treasury/imports/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  /**
   * The Itaú SISPAG resolution path: the comprovante image is uploaded here
   * (same S3 pattern as the source files), and only the resulting object
   * key is forwarded to treasury-service — that service never receives a
   * file body, same division of labour as every other upload in this
   * gateway.
   */
  @Post(':id/transactions/:transactionId/proof')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a comprovante and resolve a payee the statement did not name' })
  async attachProof(
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
    @Req() request: FastifyRequest,
  ) {
    const uploaded = await (request as unknown as { file: () => Promise<MultipartFile | undefined> }).file()
    if (!uploaded) throw new BadRequestException('No image was uploaded')

    const fields = uploaded.fields as Record<string, { value?: string } | undefined>
    const counterpartyRaw = fields.counterparty_raw?.value

    const body = await uploaded.toBuffer()
    const objectKey = `treasury-imports/proofs/${id}-${transactionId}-${randomUUID()}-${uploaded.filename ?? 'comprovante'}`
    await this.s3.uploadFile(objectKey, body, uploaded.mimetype ?? 'application/octet-stream')

    const correlationId = correlationOf(request)
    const result = await this.domains.treasury({
      method: 'patch',
      path: `/treasury/imports/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}/proof`,
      payload: { proof_object_key: objectKey, ...(counterpartyRaw ? { counterparty_raw: counterpartyRaw } : {}) },
      correlationId,
    })

    return result.data
  }

  @Post(':id/confirm')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Convert every pending transaction into a real transaction, in one batch' })
  async confirm(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: `/treasury/imports/${encodeURIComponent(id)}/confirm`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':id/reject')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Discard the pending transactions; keeps the import record and raw file for audit' })
  async reject(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: `/treasury/imports/${encodeURIComponent(id)}/reject`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

interface MultipartPart {
  type: 'file' | 'field'
  fieldname: string
  value?: unknown
  filename: string
  mimetype: string
  toBuffer: () => Promise<Buffer>
  /** Only present when `type === 'file'` — the underlying readable stream `@fastify/multipart`
   * requires every file part to consume before it can parse the next part or finish the request. */
  file: { resume: () => void }
}

interface MultipartFile {
  filename?: string
  mimetype?: string
  fields: unknown
  toBuffer: () => Promise<Buffer>
}
