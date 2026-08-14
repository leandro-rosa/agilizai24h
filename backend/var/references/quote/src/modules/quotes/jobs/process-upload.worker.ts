import { Injectable } from '@nestjs/common'
import { Job } from 'bullmq'
import * as XLSX from 'xlsx'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { QUOTE_PROCESS_UPLOAD_QUEUE, QuoteJobEnvelope } from './quote-job-envelope'
import { ProcessUploadPayload } from './process-upload.producer'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { QuoteActivityService } from '../services/quote-activity.service'

/**
 * Parses the uploaded spreadsheet (fetched from S3 via the Quote's stored
 * original_file_s3_key) into QuoteItems. Always reads the first sheet with row
 * 1 as the header row — the auto-detected `selected_sheet`/`header_row` are
 * written back onto the Quote for transparency, but re-parsing on a later
 * user override (PATCH :id/mapping) is not implemented in this pass; see
 * backend/apps/quote/CLAUDE.md.
 *
 * Uses the `xlsx` (SheetJS) package directly on the in-memory buffer rather
 * than common/nest-libs/sheeter's SheeterProcessorService.smartChunk —
 * smartChunk is built to fan a huge file out into a downstream queue
 * (another producer/worker hop), which is unnecessary overhead at this
 * app's demo scale; a synchronous in-worker parse is simpler and just as
 * correct here.
 */
@Injectable()
@HoldItProcessor(QUOTE_PROCESS_UPLOAD_QUEUE)
export class ProcessUploadWorker extends HoldItWorkerHost<QuoteJobEnvelope<ProcessUploadPayload>> {
  constructor(
    private readonly s3Service: S3Service,
    private readonly quoteRepository: QuoteRepository,
    private readonly quoteItemRepository: QuoteItemRepository,
    private readonly activityService: QuoteActivityService,
  ) {
    super()
  }

  async process(job: Job<QuoteJobEnvelope<ProcessUploadPayload>>): Promise<void> {
    const envelope = job.data

    if (envelope.schemaVersion !== 1) {
      throw new Error(`Unsupported quote.process-upload schemaVersion: ${envelope.schemaVersion}`)
    }

    const quoteId = envelope.quoteId
    const quote = await this.quoteRepository.findUnique({ where: { id: quoteId } } as any)
    if (!quote) {
      this.logger.error({ quoteId }, 'QUOTE_PROCESS_UPLOAD_QUOTE_NOT_FOUND')
      return
    }
    if (!quote.original_file_s3_key) {
      await this.fail(quoteId, 'Cotação sem arquivo associado')
      return
    }

    try {
      const { body } = await this.s3Service.getFile(quote.original_file_s3_key)
      const workbook = XLSX.read(body, { type: 'buffer', cellDates: true })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) {
        await this.fail(quoteId, 'Planilha sem abas legíveis')
        return
      }

      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })

      if (!rows.length) {
        await this.fail(quoteId, 'Planilha vazia ou sem cabeçalho reconhecível')
        return
      }

      await Promise.all(
        rows.map((row, index) =>
          this.quoteItemRepository.create({
            quote_id: quoteId,
            row_number: index + 1,
            raw_input: row as any,
            match_status: 'pending',
            review_status: 'pending',
          } as any),
        ),
      )

      await this.quoteRepository.update(quoteId, {
        status: 'draft',
        total_rows: rows.length,
        selected_sheet: sheetName,
        header_row: 1,
      } as any)

      await this.activityService.record(
        quoteId,
        'processing_started',
        `Planilha lida: ${rows.length} linha(s) na aba "${sheetName}"`,
      )

      this.logger.log({ quoteId, rows: rows.length, sheet: sheetName }, 'QUOTE_PROCESS_UPLOAD_PARSED')
    } catch (error) {
      this.logger.error({ quoteId, error }, 'QUOTE_PROCESS_UPLOAD_PARSE_FAILED')
      await this.fail(quoteId, error instanceof Error ? error.message : 'Falha ao processar planilha')
    }
  }

  private async fail(quoteId: number, reason: string): Promise<void> {
    await this.quoteRepository.update(quoteId, { status: 'failed' } as any)
    await this.activityService.record(quoteId, 'processing_failed', reason)
  }
}
