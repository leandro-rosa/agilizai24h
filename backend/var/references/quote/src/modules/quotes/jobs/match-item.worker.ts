import { Job } from 'bullmq'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { QUOTE_MATCH_ITEM_QUEUE, QuoteJobEnvelope } from './quote-job-envelope'
import { MatchItemPayload } from './match-item.producer'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { ColumnMappingTemplateRepository } from '../../db-client/repository/column-mapping-template.repository'
import { applyNormalization } from '../utils/normalization.util'
import { MATCHABLE_TARGET_FIELDS } from '../utils/candidate-scoring.util'
import { isMatchingConfig, parseMatchingConfig } from '../utils/matching-config.util'
import { OriginalFieldLike, toNormalizedSearchData, toSearchFields } from '../utils/search-fields.util'
import { SearchMatchRequestProducer } from './search-match-request.producer'

interface ColumnMappingEntry {
  spreadsheet_column: string
  target_field: string
  priority: number
  status: 'mapped' | 'ignored' | 'suggested' | 'empty'
}

/**
 * Prepares either quote origin for revision-aware matching. Spreadsheet rows
 * use configured mapping/normalization; partner rows use canonical submitted
 * fields. Candidate retrieval and scoring happen on the shared v2 path.
 */
const configuredConcurrency = Number(process.env.MATCH_ITEM_WORKER_CONCURRENCY ?? 10)

@HoldItProcessor(QUOTE_MATCH_ITEM_QUEUE, { concurrency: configuredConcurrency })
export class MatchItemWorker extends HoldItWorkerHost<QuoteJobEnvelope<MatchItemPayload>> {
  constructor(
    private readonly quoteRepository: QuoteRepository,
    private readonly quoteItemRepository: QuoteItemRepository,
    private readonly columnMappingTemplateRepository: ColumnMappingTemplateRepository,
    private readonly searchMatchRequestProducer: SearchMatchRequestProducer,
  ) {
    super()
  }

  async process(job: Job<QuoteJobEnvelope<MatchItemPayload>>): Promise<void> {
    const envelope = job.data

    if (envelope.schemaVersion !== 1) {
      throw new Error(`Unsupported quote.match-item schemaVersion: ${envelope.schemaVersion}`)
    }

    const quoteId = envelope.quoteId
    const itemId = envelope.payload.itemId

    const [quote, item] = await Promise.all([
      this.quoteRepository.findUnique({ where: { id: quoteId } } as any),
      this.quoteItemRepository.findUnique({ where: { id: itemId } } as any),
    ])

    if (!quote || !item) {
      this.logger.error({ quoteId, itemId }, 'QUOTE_MATCH_ITEM_NOT_FOUND')
      return
    }

    if (item.quote_id !== undefined && item.quote_id !== quoteId) {
      this.logger.error({ quoteId, itemId }, 'QUOTE_MATCH_ITEM_QUOTE_MISMATCH')
      return
    }

    if (item.review_status !== undefined && item.review_status !== 'pending') return

    const payloadRevision = envelope.payload.matchRevision
    if (payloadRevision !== undefined && payloadRevision !== (quote.matching_config_revision ?? 0)) {
      this.logger.log({ quoteId, itemId, matchRevision: payloadRevision }, 'QUOTE_MATCH_ITEM_STALE')
      return
    }

    const matchRevision = payloadRevision ?? item.match_revision ?? quote.matching_config_revision ?? 0
    if ((item.match_revision ?? 0) > matchRevision) {
      this.logger.log({ quoteId, itemId, matchRevision }, 'QUOTE_MATCH_ITEM_STALE')
      return
    }

    if (payloadRevision !== undefined && quote.matching_config != null && !isMatchingConfig(quote.matching_config)) {
      throw new Error('Invalid persisted matching config for revision-aware quote.match-item job')
    }
    const matchingConfig = parseMatchingConfig(quote.matching_config)
    const preparedSearchFields = quote.source === 'partner_api'
      ? toSearchFields((item.raw_input as unknown as OriginalFieldLike[]) ?? [])
      : await this.toSpreadsheetSearchFields(quote, item.raw_input as Record<string, unknown>)
    const seenSearchFields = new Set<string>()
    const searchFields = preparedSearchFields
      .filter(field => {
        if (field.value.length > 200) return false
        const identity = JSON.stringify([field.targetField, field.value])
        if (seenSearchFields.has(identity)) return false
        seenSearchFields.add(identity)
        return true
      })
      .slice(0, 7)

    const normalizedData = toNormalizedSearchData(searchFields)
    const revisionChanged = (item.match_revision ?? 0) !== matchRevision
    if (revisionChanged || JSON.stringify(item.normalized_data ?? null) !== JSON.stringify(normalizedData)) {
      await this.quoteItemRepository.update(itemId, {
        normalized_data: normalizedData,
        ...(revisionChanged ? { match_revision: matchRevision } : {}),
      } as any)
    }

    await this.searchMatchRequestProducer.enqueueV2(quoteId, {
      itemId,
      matchRevision,
      ...(envelope.payload.attemptId ? { attemptId: envelope.payload.attemptId } : {}),
      searchFields,
      matchingConfig,
    })

    this.logger.log({ quoteId, itemId, matchRevision, searchFields: searchFields.length }, 'QUOTE_MATCH_ITEM_PREPARED')
  }

  private async toSpreadsheetSearchFields(
    quote: { column_mapping_id?: number | null; normalization_rules?: unknown },
    rawInput: Record<string, unknown>,
  ) {
    const mappingTemplate = quote.column_mapping_id
      ? await this.columnMappingTemplateRepository.findUnique({ where: { id: quote.column_mapping_id } } as any)
      : null
    const mappings: ColumnMappingEntry[] = (mappingTemplate?.mappings as any) ?? []
    const normalizationRules: string[] = (quote.normalization_rules as string[]) ?? []

    return mappings
      .filter(mapping => mapping.status === 'mapped' && MATCHABLE_TARGET_FIELDS.includes(mapping.target_field))
      .map(mapping => ({
        targetField: mapping.target_field,
        value: applyNormalization(String(rawInput?.[mapping.spreadsheet_column] ?? ''), normalizationRules),
        priority: mapping.priority,
      }))
      .filter(field => field.value)
      .sort((left, right) => left.priority - right.priority)
  }
}
