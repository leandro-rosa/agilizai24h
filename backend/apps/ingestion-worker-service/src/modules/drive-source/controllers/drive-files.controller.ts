import { Body, ConflictException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Query, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { DRIVE_CONFIG, type DriveConfig } from '../config/drive.config'
import type { DriveImportableFileType } from '../constants/drive.constants'
import { IgnoreDriveFileDto, ImportDriveFileDto, ListDriveFilesQueryDto, ValidateDriveFileDto } from '../dto/drive-files.dto'
import { DriveFilesQueryService } from '../services/drive-files-query.service'
import { DriveImportService } from '../services/drive-import.service'
import { DriveValidationService } from '../services/drive-validation.service'
import { DriveProducer } from '../services/drive.producer'
import { DriveRepository } from '../services/drive.repository'
import type { ImportDriveFileRequest } from '../types/drive-file.types'

const notConfigured = () =>
  new ConflictException({ code: 'not_configured', message: 'The Google Drive source is not configured' })

/**
 * The Drive source's HTTP surface, reached only through the gateway.
 *
 * Nothing here does the work: a scan, a validation and an import are queued and
 * answer 202, because none of them may run on the request path. The exception is
 * a re-validation for a different type or period of a file whose content was
 * already summarised — that is evaluated at once from the stored aggregates, no
 * download, which is what lets the admin show the new result as the person edits.
 */
@ApiTags('drive-files')
@Controller('drive-files')
export class DriveFilesController {
  constructor(
    @Inject(DRIVE_CONFIG) private readonly config: DriveConfig,
    private readonly query: DriveFilesQueryService,
    private readonly imports: DriveImportService,
    private readonly validation: DriveValidationService,
    private readonly producer: DriveProducer,
    private readonly repository: DriveRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Files tracked in the Drive, with their validation result and what an import would replace' })
  list(@Query() query: ListDriveFilesQueryDto) {
    return this.query.list(this.query.parseStatuses(query.status))
  }

  // Declared before any `:id` route so "status" is never read as an id.
  @Get('status')
  @ApiOperation({ summary: 'Whether the Drive source is configured, and how the last scan went' })
  status() {
    return this.query.status()
  }

  @Post('scan')
  @HttpCode(202)
  @ApiOperation({ summary: '"Sincronizar agora": queue a scan of the Drive folder', description: 'Two requests in a row collapse into one scan.' })
  async scan(@Headers('x-correlation-id') correlationId?: string) {
    if (!this.config.enabled) throw notConfigured()

    return { status: await this.producer.enqueueScan({ trigger: 'manual' }, correlationId) }
  }

  @Post(':id/validate')
  @ApiOperation({
    summary: 'Validate a file, or re-evaluate it for another type or period',
    description:
      'Answers 200 with the result when the file was already summarised (no download). Otherwise queues the validation and answers 202.',
  })
  async validate(
    @Param('id') id: string,
    @Body() body: ValidateDriveFileDto,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (!this.config.enabled) throw notConfigured()

    const file = await this.repository.findById(id)
    if (!file) throw new NotFoundException({ code: 'not_found', message: 'No such Drive file' })
    if (file.status === 'importing' || file.status === 'missing') {
      throw new ConflictException({ code: 'not_validatable', message: `A file that is ${file.status} cannot be validated now` })
    }

    const override = { fileType: body.file_type as DriveImportableFileType | undefined, period: body.period }

    const report = await this.validation.reevaluate(id, override)
    if (report) {
      void reply.status(200)
      return { id, status: 'evaluated', validation_status: report.outcome, validation: report }
    }

    await this.producer.enqueueValidation({ fileId: id, ...override }, correlationId)
    void reply.status(202)
    return { id, status: 'queued' }
  }

  @Post(':id/import')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Import a file the person confirmed',
    description:
      'Refused with a coded body when it is blocked, would replace an ingested period, or has inconsistencies not yet confirmed. Nothing is imported by a scan or a validation.',
  })
  import(@Param('id') id: string, @Body() body: ImportDriveFileDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.imports.requestImport(id, body as ImportDriveFileRequest, correlationId)
  }

  @Post(':id/ignore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ignore a file, or bring an ignored one back (`{ "ignored": false }`)' })
  ignore(@Param('id') id: string, @Body() body: IgnoreDriveFileDto) {
    return this.imports.setIgnored(id, body.ignored ?? true)
  }
}
