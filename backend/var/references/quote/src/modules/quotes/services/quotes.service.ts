import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { ColumnMappingTemplateRepository } from '../../db-client/repository/column-mapping-template.repository'
import { Quote } from '../../db-client/entities/quote.entity'
import { CreateQuoteDto } from '../dto/create-quote.dto'
import { ListQuotesQueryDto } from '../dto/list-quotes-query.dto'
import { SubmitMappingDto } from '../dto/submit-mapping.dto'
import { QuoteActivityService } from './quote-activity.service'
import { ProcessUploadProducer } from '../jobs/process-upload.producer'
import { MatchItemProducer } from '../jobs/match-item.producer'
import { CATALOG_FIELDS, EXPORT_FIELDS, NORMALIZATION_RULES } from '../constants/quote-config'
import { S3Service } from '@app/aws'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { Prisma } from '../../db-client/generated/prisma/client'
import {
  isMatchingConfig,
  MatchingConfig,
  parseMatchingConfig,
} from '../utils/matching-config.util'

export interface UploadedSpreadsheet {
  fileName: string
  fileSizeBytes: number
  contentType: string
  buffer: Buffer
}

export type QuoteDetail = Omit<Partial<Quote>, 'matching_config'> & { matching_config: MatchingConfig }

export interface ReprocessPendingResult {
  matching_config_revision: number
  reprocessed_count: number
  enqueue_status: 'enqueued'
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly quoteRepository: QuoteRepository,
    private readonly quoteItemRepository: QuoteItemRepository,
    private readonly columnMappingTemplateRepository: ColumnMappingTemplateRepository,
    private readonly activityService: QuoteActivityService,
    private readonly processUploadProducer: ProcessUploadProducer,
    private readonly matchItemProducer: MatchItemProducer,
    private readonly s3Service: S3Service,
    private readonly prisma: PrismaClientService,
  ) {}

  /** Legacy direct-create path (no upload) — kept for the partner-intake flow to build on. */
  async create(dto: CreateQuoteDto & { source?: Quote['source']; created_by?: string | null }): Promise<Partial<Quote>> {
    return this.quoteRepository.create({
      name: dto.name,
      status: dto.status ?? 'draft',
      source: dto.source ?? 'spreadsheet',
      created_by: dto.created_by ?? null,
    } as Partial<Quote>)
  }

  async createFromUpload(name: string, actor: string | null, file: UploadedSpreadsheet): Promise<Partial<Quote>> {
    const quote = await this.quoteRepository.create({
      name,
      status: 'uploading',
      source: 'spreadsheet',
      created_by: actor,
      original_file_name: file.fileName,
      original_file_size_b: file.fileSizeBytes,
    } as Partial<Quote>)

    const s3Key = `quotes/${quote.id}/original/${file.fileName}`
    await this.s3Service.uploadFile(s3Key, file.buffer, file.contentType)

    const updated = await this.quoteRepository.update(quote.id as number, {
      original_file_s3_key: s3Key,
    } as Partial<Quote>)

    await this.activityService.record(quote.id as number, 'created', `Cotação "${name}" criada`, actor)
    await this.activityService.record(
      quote.id as number,
      'file_uploaded',
      `Arquivo "${file.fileName}" enviado`,
      actor,
    )

    await this.processUploadProducer.enqueue(quote.id as number, { sourceFileName: file.fileName })

    return updated ?? quote
  }

  async list(
    query: ListQuotesQueryDto,
  ): Promise<{ items: Partial<Quote>[]; next_cursor: number | null; page_size: number }> {
    const where: Record<string, unknown> = {}
    if (query.status) where.status = query.status
    if (query.source) where.source = query.source
    if (query.created_by) where.created_by = query.created_by
    if (query.from || query.to) {
      where.created_at = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }

    const pageSize = query.page_size ?? 20
    const rows = await this.quoteRepository.findAll({
      where,
      orderBy: { id: 'desc' },
      take: pageSize + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    } as any)
    const hasNextPage = rows.length > pageSize
    const items = hasNextPage ? rows.slice(0, pageSize) : rows

    return {
      items,
      next_cursor: hasNextPage ? (items.at(-1)?.id as number) : null,
      page_size: pageSize,
    }
  }

  async findById(id: number): Promise<QuoteDetail> {
    const quote = await this.quoteRepository.findUnique({
      where: { id },
      include: { column_mapping: true },
    } as any)

    if (!quote) {
      throw new NotFoundException(`Quote ${id} not found`)
    }

    return { ...quote, matching_config: parseMatchingConfig(quote.matching_config) }
  }

  async saveMatchingConfig(
    id: number,
    config: MatchingConfig,
    expectedRevision: number,
    actor: string | null,
  ): Promise<QuoteDetail> {
    if (!isMatchingConfig(config)) {
      throw new BadRequestException('Invalid matching configuration')
    }
    const persistedConfig: Prisma.InputJsonObject = {
      version: config.version,
      field_weights: { ...config.field_weights },
      synonyms: config.synonyms.map(group => ({ field: group.field, terms: [...group.terms] })),
      precision: config.precision,
      typo_tolerance: config.typo_tolerance,
      max_candidates: config.max_candidates,
      minimum_score: config.minimum_score,
      auto_approve: config.auto_approve,
      auto_approve_threshold: config.auto_approve_threshold,
    }

    return this.prisma.$transaction(async transaction => {
      await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${id})`)
      const updateResult = await transaction.quote.updateMany({
        where: { id, matching_config_revision: expectedRevision },
        data: {
          matching_config: persistedConfig,
          matching_config_revision: { increment: 1 },
        },
      })

      if (updateResult.count === 0) {
        const current = await transaction.quote.findUnique({
          where: { id },
          select: { id: true, matching_config_revision: true },
        })
        if (!current) throw new NotFoundException(`Quote ${id} not found`)
        throw new ConflictException(`Quote ${id} matching configuration changed from revision ${expectedRevision}`)
      }

      const updated = await transaction.quote.findUnique({ where: { id } })
      if (!updated) throw new NotFoundException(`Quote ${id} not found`)

      await transaction.quoteActivityEvent.create({
        data: {
          quote_id: id,
          kind: 'config_changed',
          message: `Configuração de matching atualizada para revisão ${updated.matching_config_revision}`,
          actor,
          metadata: { revision: updated.matching_config_revision },
        },
      })

      return { ...updated, matching_config: parseMatchingConfig(updated.matching_config) }
    })
  }

  async reprocessPending(id: number, actor: string | null): Promise<ReprocessPendingResult> {
    const prepared = await this.prisma.$transaction(async transaction => {
      await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${id})`)
      const quote = await transaction.quote.findUnique({
        where: { id },
        select: { id: true, matching_config_revision: true },
      })
      if (!quote) {
        throw new NotFoundException(`Quote ${id} not found`)
      }

      await transaction.quoteItem.updateManyAndReturn({
        where: { quote_id: id, review_status: 'pending', match_revision: { lt: quote.matching_config_revision } },
        data: {
          normalized_data: Prisma.DbNull,
          candidates: [],
          match_score: null,
          match_reasons: [],
          match_status: 'pending',
          selected_candidate_id: null,
          match_revision: quote.matching_config_revision,
        },
        select: { id: true },
      })
      const pendingItems = await transaction.quoteItem.findMany({
        where: {
          quote_id: id,
          review_status: 'pending',
          match_status: 'pending',
          match_revision: quote.matching_config_revision,
        },
        select: { id: true },
      })
      if (pendingItems.length === 0) {
        throw new ConflictException(`Quote ${id} has no pending items eligible for reprocessing`)
      }

      const totalRows = await transaction.quoteItem.count({ where: { quote_id: id } })
      const processedRows = await transaction.quoteItem.count({
        where: { quote_id: id, match_status: { not: 'pending' } },
      })
      const reviewedRows = await transaction.quoteItem.count({ where: { quote_id: id, review_status: 'reviewed' } })
      const matchedRows = await transaction.quoteItem.count({
        where: { quote_id: id, match_status: { in: ['exact', 'strong', 'approximate', 'multiple'] } },
      })
      const unmatchedRows = await transaction.quoteItem.count({ where: { quote_id: id, match_status: 'not_found' } })
      const ambiguousRows = await transaction.quoteItem.count({ where: { quote_id: id, match_status: 'multiple' } })
      const invalidRows = await transaction.quoteItem.count({ where: { quote_id: id, match_status: 'invalid' } })
      const duplicateRows = await transaction.quoteItem.count({ where: { quote_id: id, match_status: 'duplicate' } })

      await transaction.quote.update({
        where: { id },
        data: {
          status: 'processing',
          total_rows: totalRows,
          processed_rows: processedRows,
          reviewed_rows: reviewedRows,
          matched_rows: matchedRows,
          unmatched_rows: unmatchedRows,
          ambiguous_rows: ambiguousRows,
          invalid_rows: invalidRows,
          duplicate_rows: duplicateRows,
        },
      })

      await transaction.quoteActivityEvent.create({
        data: {
          quote_id: id,
          kind: 'pending_items_reprocessed',
          message: `${pendingItems.length} item(ns) pendente(s) preparado(s) para reprocessamento na revisão ${quote.matching_config_revision}`,
          actor,
          metadata: { revision: quote.matching_config_revision, item_count: pendingItems.length },
        },
      })

      return {
        matching_config_revision: quote.matching_config_revision,
        reprocessed_count: pendingItems.length,
        eligible_items: pendingItems,
        enqueue_status: 'enqueued' as const,
      }
    })

    await this.matchItemProducer.enqueueMany(
      id,
      prepared.eligible_items.map(item => ({ itemId: item.id, matchRevision: prepared.matching_config_revision })),
      { attemptId: randomUUID() },
    )
    return {
      matching_config_revision: prepared.matching_config_revision,
      reprocessed_count: prepared.reprocessed_count,
      enqueue_status: prepared.enqueue_status,
    }
  }

  async getStatus(id: number): Promise<Partial<Quote>> {
    const quote = await this.quoteRepository.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        total_rows: true,
        processed_rows: true,
        reviewed_rows: true,
        matched_rows: true,
        unmatched_rows: true,
        ambiguous_rows: true,
        invalid_rows: true,
        duplicate_rows: true,
        updated_at: true,
      },
    } as any)

    if (!quote) {
      throw new NotFoundException(`Quote ${id} not found`)
    }

    return quote
  }

  async submitMapping(id: number, dto: SubmitMappingDto, actor: string | null): Promise<Partial<Quote>> {
    await this.requireQuote(id)

    let columnMappingId: number | undefined
    if (dto.template_id) {
      const template = await this.columnMappingTemplateRepository.findUnique({ where: { id: dto.template_id } } as any)
      if (!template) {
        throw new NotFoundException(`ColumnMappingTemplate ${dto.template_id} not found`)
      }
      columnMappingId = dto.template_id
    } else if (dto.save_as_template) {
      const template = await this.columnMappingTemplateRepository.create({
        name: dto.template_name ?? `Modelo ${new Date().toISOString()}`,
        mappings: dto.mappings as any,
        created_at: new Date(),
        created_by: actor,
      } as any)
      columnMappingId = template.id as number
    } else {
      const template = await this.columnMappingTemplateRepository.create({
        name: `Mapeamento inline — cotação ${id}`,
        mappings: dto.mappings as any,
        created_at: new Date(),
        created_by: actor,
      } as any)
      columnMappingId = template.id as number
    }

    const updated = await this.quoteRepository.update(id, {
      column_mapping_id: columnMappingId,
      normalization_rules: dto.normalization_rules ?? [],
      ...(dto.selected_sheet ? { selected_sheet: dto.selected_sheet } : {}),
      ...(dto.header_row !== undefined ? { header_row: dto.header_row } : {}),
    } as Partial<Quote>)

    await this.activityService.record(id, 'config_changed', 'Mapeamento de colunas configurado', actor)

    return updated as Partial<Quote>
  }

  async startProcessing(id: number, actor: string | null): Promise<Partial<Quote>> {
    const quote = await this.requireQuote(id)

    if (quote.status !== 'draft') {
      throw new ConflictException(`Quote ${id} cannot start processing from status "${quote.status}"`)
    }
    if (quote.source !== 'partner_api' && !quote.column_mapping_id) {
      throw new BadRequestException(`Quote ${id} has no column mapping configured — call PATCH :id/mapping first`)
    }

    const items = await this.quoteItemRepository.findAll({ where: { quote_id: id } } as any)
    if (!items.length) {
      throw new BadRequestException(`Quote ${id} has no items to process`)
    }

    const updated = await this.quoteRepository.update(id, { status: 'processing' } as Partial<Quote>)
    await this.activityService.record(id, 'processing_started', 'Busca de peças iniciada', actor)

    await this.matchItemProducer.enqueueMany(
      id,
      items.map(item => ({ itemId: item.id as number, matchRevision: quote.matching_config_revision ?? 0 })),
    )

    return updated as Partial<Quote>
  }

  async completeReview(id: number, actor: string | null): Promise<Partial<Quote>> {
    const quote = await this.requireQuote(id)

    const pendingCount = await this.quoteItemRepository.count({
      where: { quote_id: id, review_status: 'pending' },
    } as any)

    if (pendingCount > 0) {
      throw new ConflictException(`Quote ${id} still has ${pendingCount} item(s) pending review`)
    }

    const updated = await this.quoteRepository.update(id, { status: 'completed' } as Partial<Quote>)
    await this.activityService.record(id, 'review_completed', 'Revisão concluída', actor)

    void quote
    return updated as Partial<Quote>
  }

  getConfig() {
    return { catalog_fields: CATALOG_FIELDS, normalization_rules: NORMALIZATION_RULES, export_fields: EXPORT_FIELDS }
  }

  async getOriginalFile(id: number): Promise<{ fileName: string; buffer: Buffer; contentType: string }> {
    const quote = await this.requireQuote(id)
    if (!quote.original_file_s3_key) {
      throw new NotFoundException(`Quote ${id} has no original file`)
    }
    const { body, contentType } = await this.s3Service.getFile(quote.original_file_s3_key as string)
    return {
      fileName: (quote.original_file_name as string) ?? 'planilha',
      buffer: body,
      contentType: contentType ?? 'application/octet-stream',
    }
  }

  private async requireQuote(id: number): Promise<Partial<Quote>> {
    const quote = await this.quoteRepository.findUnique({ where: { id } } as any)
    if (!quote) {
      throw new NotFoundException(`Quote ${id} not found`)
    }
    return quote
  }

}
