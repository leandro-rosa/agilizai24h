import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import { S3Service } from '@app/aws'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../auth/guards/session.constants'
import { DomainClient } from '../upstream/domain.client'

const FILE_TYPES = ['sales', 'supply', 'cost'] as const
type FileType = (typeof FILE_TYPES)[number]

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

@ApiTags('ingestions')
@Controller('ingestions')
export class IngestionController {
  constructor(
    private readonly domains: DomainClient,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @RequiresPermission(PERMISSIONS.INGESTION_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an operational spreadsheet',
    description:
      'Accepts the file, stores it, and returns an ingestion identifier without parsing it. Store and period are stated by the uploader rather than inferred from the file.',
  })
  @ApiResponse({ status: 400, description: 'Missing fields, unsupported format, or a lock file' })
  async upload(@Req() request: FastifyRequest) {
    const uploaded = await (request as unknown as { file: () => Promise<MultipartFile | undefined> }).file()

    if (!uploaded) throw new BadRequestException('No file was uploaded')

    const fields = uploaded.fields as Record<string, { value?: string } | undefined>
    const fileType = fields.file_type?.value as FileType | undefined
    const storeId = fields.store_id?.value
    const period = fields.period?.value

    // Period is required rather than guessed: neither report carries a
    // reliable machine-readable one, and inferring it would silently
    // attribute March's data to April.
    //
    // Store is required for sales and cost, which carry no store identity of
    // their own — but NOT for supply (restocking): that workbook covers every
    // store in the month, one operation per sheet, each naming its own store
    // via Cliente (design D2 of align-ingestion-with-real-reports). Requiring
    // one here would attribute every other store's rows to whichever one was
    // picked.
    if (!fileType || !FILE_TYPES.includes(fileType)) {
      throw new BadRequestException(`file_type must be one of: ${FILE_TYPES.join(', ')}`)
    }
    if (fileType !== 'supply' && (!storeId || Number.isNaN(Number(storeId)))) {
      throw new BadRequestException('store_id is required')
    }
    if (!period || !PERIOD_PATTERN.test(period)) throw new BadRequestException('period is required, as YYYY-MM')

    const filename = uploaded.filename ?? 'upload.xlsx'

    // Excel writes these alongside an open workbook; they are not readable
    // spreadsheets and would fail deep inside the parser instead of here.
    if (filename.startsWith('~$')) {
      throw new BadRequestException('That is an Excel lock file, not a spreadsheet')
    }
    if (!ALLOWED_EXTENSIONS.some(extension => filename.toLowerCase().endsWith(extension))) {
      throw new BadRequestException(`Unsupported format. Expected one of: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    const body = await uploaded.toBuffer()
    const ingestionId = randomUUID()
    const objectKey = `ingestions/${period}/${storeId ?? 'network'}/${ingestionId}-${filename}`

    // The raw file goes to object storage before anything is queued: it is the
    // evidence when a figure is later disputed, and it keeps the job payload a
    // reference rather than a blob.
    await this.s3.uploadFile(objectKey, body, uploaded.mimetype ?? 'application/octet-stream')

    const correlationId = (request as { correlationId?: string }).correlationId

    const result = await this.domains.ingestion({
      method: 'post',
      path: '/ingestions',
      payload: {
        id: ingestionId,
        file_type: fileType,
        object_key: objectKey,
        original_name: filename,
        // Absent for supply — the store comes from the file itself (design D2).
        store_id: storeId ? Number(storeId) : undefined,
        period,
        correlation_id: correlationId,
      },
      correlationId,
    })

    return result.data
  }

  @Get()
  @RequiresPermission(PERMISSIONS.INGESTION_READ)
  @ApiOperation({ summary: 'Recent ingestions and their status' })
  async list(@Query('limit') limit: string | undefined, @Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'get',
      path: `/ingestions${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`,
      correlationId: (request as { correlationId?: string }).correlationId,
    })

    return result.data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.INGESTION_READ)
  @ApiOperation({
    summary: 'One ingestion status, with the rows it rejected',
    description: 'A partially completed import is reported as such, never as completed.',
  })
  async findById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.ingestion({
      method: 'get',
      path: `/ingestions/${encodeURIComponent(id)}`,
      correlationId: (request as { correlationId?: string }).correlationId,
    })

    return result.data
  }
}

interface MultipartFile {
  filename?: string
  mimetype?: string
  fields: unknown
  toBuffer: () => Promise<Buffer>
}
