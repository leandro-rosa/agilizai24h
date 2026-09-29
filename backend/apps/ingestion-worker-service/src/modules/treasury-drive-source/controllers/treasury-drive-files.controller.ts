import { Body, ConflictException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { TREASURY_DRIVE_CONFIG, type TreasuryDriveConfig } from '../config/treasury-drive.config'
import { IgnoreTreasuryDriveFileDto, ImportTreasuryDriveFileDto } from '../dto/treasury-drive-files.dto'
import { TreasuryDriveProducer } from '../services/treasury-drive.producer'
import { TreasuryDriveRepository } from '../services/treasury-drive.repository'

const notConfigured = () =>
  new ConflictException({ code: 'not_configured', message: 'The treasury Drive source is not configured' })

const notFound = () => new NotFoundException({ code: 'not_found', message: 'No such treasury Drive file' })

/**
 * The treasury Drive source's HTTP surface, reached only through the gateway (Task 12's proxy) —
 * mirrors `DriveFilesController`'s shape (the sibling sales/abastecimento Drive source), with two
 * differences that follow from this source having a simpler design (see the spec's own
 * Non-goals): no `:id/validate` route — there is no separate async validation step to confirm or
 * re-evaluate, since a bank statement/invoice file has no coverage concept to validate against —
 * and `:id/import` is confirmed with `{ accountId, period }` rather than `{ file_type, period,
 * confirm_replace, confirm_validation }`, because the source is fixed per file (the detected
 * bank/kind) and there is no "would replace" or "needs re-confirmation" state to carry.
 *
 * Nothing here does the actual import: it enqueues and answers 202, same as "Sincronizar agora"
 * does for a scan — `TreasuryDriveImportService.import` (Task 9) runs inside
 * `TreasuryDriveImportWorker`, not on the request path, so a slow re-download/re-parse/S3-upload
 * never ties up an HTTP request.
 */
@ApiTags('treasury-drive-files')
@Controller('treasury-drive-files')
export class TreasuryDriveFilesController {
  constructor(
    @Inject(TREASURY_DRIVE_CONFIG) private readonly config: TreasuryDriveConfig,
    private readonly repository: TreasuryDriveRepository,
    private readonly producer: TreasuryDriveProducer,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Bank statement/invoice files tracked from the treasury Drive folders' })
  list() {
    return this.repository.list()
  }

  // Declared before any `:id` route so "status" is never read as an id.
  @Get('status')
  @ApiOperation({ summary: 'Whether the treasury Drive source is configured' })
  status() {
    return {
      configured: this.config.enabled,
      month_folders: this.config.monthFolders,
      scan_cron: this.config.scanCron,
    }
  }

  @Post('scan')
  @HttpCode(202)
  @ApiOperation({ summary: '"Sincronizar agora": queue a scan of the treasury Drive folders', description: 'Two requests in a row collapse into one scan.' })
  async scan(@Headers('x-correlation-id') correlationId?: string) {
    if (!this.config.enabled) throw notConfigured()

    return { status: await this.producer.enqueueScan({ trigger: 'manual' }, correlationId) }
  }

  @Post(':id/import')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Import a confirmed treasury Drive file',
    description: 'Queues the import against the confirmed account and period; the worker re-downloads and re-checks the file before writing anything.',
  })
  async import(@Param('id') id: string, @Body() body: ImportTreasuryDriveFileDto, @Headers('x-correlation-id') correlationId?: string) {
    const file = await this.repository.findById(id)
    if (!file) throw notFound()

    await this.producer.enqueueImport({ fileId: id, accountId: body.accountId, period: body.period }, correlationId)

    return { id, status: 'importing' }
  }

  @Post(':id/ignore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ignore a file, or bring an ignored one back (`{ "ignored": false }`)' })
  async ignore(@Param('id') id: string, @Body() body: IgnoreTreasuryDriveFileDto) {
    const file = await this.repository.findById(id)
    if (!file) throw notFound()

    const updated = await this.repository.setIgnored(id, body.ignored ?? true)
    return { id, status: updated.status }
  }
}
