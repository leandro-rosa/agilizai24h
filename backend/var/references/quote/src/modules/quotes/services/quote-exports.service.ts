import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { S3Service } from '@app/aws'
import { QuoteExportRepository } from '../../db-client/repository/quote-export.repository'
import { QuoteExport } from '../../db-client/entities/quote-export.entity'
import { CreateExportDto } from '../dto/create-export.dto'
import { GenerateExportProducer } from '../jobs/generate-export.producer'
import { QuoteActivityService } from './quote-activity.service'

@Injectable()
export class QuoteExportsService {
  constructor(
    private readonly quoteExportRepository: QuoteExportRepository,
    private readonly generateExportProducer: GenerateExportProducer,
    private readonly activityService: QuoteActivityService,
    private readonly s3Service: S3Service,
  ) {}

  async createExport(quoteId: number, dto: CreateExportDto, actor: string | null): Promise<Partial<QuoteExport>> {
    if (dto.selected_fields.length === 0 && !dto.custom_attribute_fields?.length) {
      throw new BadRequestException('At least one field or custom attribute must be selected for an export')
    }

    const exportRecord = await this.quoteExportRepository.create({
      quote_id: quoteId,
      status: 'preparing',
      format: dto.format,
      selected_fields: dto.selected_fields as any,
      custom_attribute_fields: (dto.custom_attribute_fields ?? null) as any,
      created_by: actor,
    } as Partial<QuoteExport>)

    await this.generateExportProducer.enqueue(quoteId, { exportId: exportRecord.id as number })
    await this.activityService.record(quoteId, 'export_generated', `Exportação (${dto.format}) solicitada`, actor)

    return exportRecord
  }

  async listExports(quoteId: number): Promise<Partial<QuoteExport>[]> {
    return this.quoteExportRepository.findAll({
      where: { quote_id: quoteId },
      orderBy: { created_at: 'desc' },
    } as any)
  }

  async getExport(quoteId: number, exportId: number): Promise<Partial<QuoteExport>> {
    const exportRecord = await this.quoteExportRepository.findUnique({ where: { id: exportId } } as any)
    if (!exportRecord || exportRecord.quote_id !== quoteId) {
      throw new NotFoundException(`Export ${exportId} not found in quote ${quoteId}`)
    }
    return exportRecord
  }

  async getExportFile(quoteId: number, exportId: number): Promise<{ fileName: string; buffer: Buffer; contentType: string }> {
    const exportRecord = await this.getExport(quoteId, exportId)
    if (exportRecord.status !== 'completed' || !exportRecord.file_s3_key) {
      throw new BadRequestException(`Export ${exportId} is not ready for download (status: ${exportRecord.status})`)
    }
    const { body } = await this.s3Service.getFile(exportRecord.file_s3_key)
    const format = exportRecord.format as string
    return {
      fileName: `cotacao-${quoteId}-export.${format}`,
      buffer: body,
      contentType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
  }
}
