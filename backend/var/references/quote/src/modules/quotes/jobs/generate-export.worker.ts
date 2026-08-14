import { Injectable } from '@nestjs/common'
import { Job } from 'bullmq'
import * as XLSX from 'xlsx'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { FetchedCatalogProduct, PRODUCT_EXPORT_FIELDS } from '@app/quote-search-match'
import { QUOTE_GENERATE_EXPORT_QUEUE, QuoteJobEnvelope } from './quote-job-envelope'
import { GenerateExportPayload } from './generate-export.producer'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { QuoteExportRepository } from '../../db-client/repository/quote-export.repository'
import { QuoteActivityService } from '../services/quote-activity.service'
import { SearchCatalogService } from '../services/search-catalog.service'
import { extractMappedAttributeValue, extractProductExportValue } from '../utils/export-field-extraction.util'

/** Mirrors CustomAttributeFieldDto's shape — the worker takes plain data, not the DTO class. */
export interface CustomAttributeField {
  label: string
  attribute_key: string
  unit_attribute_key?: string
}

interface CandidateSnapshot {
  productId?: string
  name?: string
  brand?: string
  category?: string
  sku?: string
  ean?: string
  mainCode?: string
  oemCodes?: string[]
  tradeNumbers?: string[]
  image?: string
  stock?: number
}

const SOURCE_FIELD_BY_ID = new Map(PRODUCT_EXPORT_FIELDS.map(field => [field.id, field.sourceField]))

/**
 * Degraded fallback when the fresh catalog fetch fails for a given item —
 * only fields with a real snapshot equivalent are covered; the rest
 * (normalized_sku, image, applications) come back blank rather than
 * guessed. This path exists so one unreachable/failed lookup never fails
 * the whole export (see design.md's "Export-time data source" decision).
 */
const CATALOG_FIELD_SNAPSHOT_FALLBACK: Partial<Record<string, keyof CandidateSnapshot>> = {
  product_name: 'name',
  brand_name: 'brand',
  product_sku: 'sku',
  ean: 'ean',
  main_code: 'mainCode',
  stock_total: 'stock',
}

const REVIEW_RESULT_FIELD_IDS = new Set(['match_score', 'review_status', 'review_decision', 'reviewed_by', 'reviewed_at'])

/** Normalizes rawInput's two possible shapes (see QuoteDetailPage.tsx's identical frontend concern) into one flat row of original columns. */
export function rawInputToRow(rawInput: unknown): Record<string, unknown> {
  if (Array.isArray(rawInput)) {
    return Object.fromEntries((rawInput as { key: string; value: string }[]).map(({ key, value }) => [key, value]))
  }
  return (rawInput as Record<string, unknown>) ?? {}
}

function selectedCandidate(item: { candidates: unknown; selected_candidate_id: string | null }): CandidateSnapshot | undefined {
  const candidates = (item.candidates as CandidateSnapshot[]) ?? []
  return candidates.find(c => c.productId === item.selected_candidate_id) ?? candidates[0]
}

/**
 * Adds selected product-field columns after the original spreadsheet
 * columns (brief: "adicionar os dados encontrados ao final das colunas
 * existentes... não sobrescrever o arquivo original") — never mutates the
 * original upload, always writes a new object under the export's own S3
 * key.
 */
export function buildExportRow(
  item: {
    raw_input: unknown
    match_score: number | null
    review_status: string
    review_decision: string | null
    reviewed_by: string | null
    reviewed_at: Date | null
    candidates: unknown
    selected_candidate_id: string | null
  },
  selectedFields: string[],
  fetchedProduct: FetchedCatalogProduct | undefined,
  customAttributeFields: CustomAttributeField[] = [],
): Record<string, unknown> {
  const snapshot = selectedCandidate(item)

  const reviewFieldValue: Record<string, unknown> = {
    match_score: item.match_score ?? '',
    review_status: item.review_status,
    review_decision: item.review_decision ?? '',
    reviewed_by: item.reviewed_by ?? '',
    reviewed_at: item.reviewed_at ? new Date(item.reviewed_at).toISOString() : '',
  }

  const row: Record<string, unknown> = rawInputToRow(item.raw_input)

  for (const fieldId of selectedFields) {
    if (REVIEW_RESULT_FIELD_IDS.has(fieldId)) {
      row[fieldId] = reviewFieldValue[fieldId]
      continue
    }

    const sourceField = SOURCE_FIELD_BY_ID.get(fieldId)
    if (!sourceField) {
      // Not a recognized field id (e.g. a stale id from before EXPORT_FIELDS
      // changed) — skip rather than write an undefined/garbage column.
      continue
    }

    if (fetchedProduct) {
      row[fieldId] = extractProductExportValue(fetchedProduct, sourceField)
    } else {
      const fallbackKey = CATALOG_FIELD_SNAPSHOT_FALLBACK[fieldId]
      row[fieldId] = (fallbackKey && snapshot?.[fallbackKey]) ?? ''
    }
  }

  // Keyed by label (two rows sharing a label collide, last one wins — the
  // reviewer controls both, so this is a self-inflicted, visible mistake,
  // not silent data loss from an unrelated cause). No snapshot fallback:
  // the match-time candidate snapshot never carried mapped_attributes —
  // see design.md's "No snapshot fallback for custom attributes".
  for (const customField of customAttributeFields) {
    row[customField.label] = fetchedProduct
      ? extractMappedAttributeValue(fetchedProduct, customField.attribute_key, customField.unit_attribute_key)
      : ''
  }

  return row
}

@Injectable()
@HoldItProcessor(QUOTE_GENERATE_EXPORT_QUEUE)
export class GenerateExportWorker extends HoldItWorkerHost<QuoteJobEnvelope<GenerateExportPayload>> {
  constructor(
    private readonly quoteRepository: QuoteRepository,
    private readonly quoteItemRepository: QuoteItemRepository,
    private readonly quoteExportRepository: QuoteExportRepository,
    private readonly s3Service: S3Service,
    private readonly activityService: QuoteActivityService,
    private readonly searchCatalogService: SearchCatalogService,
  ) {
    super()
  }

  async process(job: Job<QuoteJobEnvelope<GenerateExportPayload>>): Promise<void> {
    const envelope = job.data
    if (envelope.schemaVersion !== 1) {
      throw new Error(`Unsupported quote.generate-export schemaVersion: ${envelope.schemaVersion}`)
    }

    const quoteId = envelope.quoteId
    const exportId = envelope.payload.exportId

    const exportRecord = await this.quoteExportRepository.findUnique({ where: { id: exportId } } as any)
    if (!exportRecord) {
      this.logger.error({ exportId }, 'QUOTE_GENERATE_EXPORT_NOT_FOUND')
      return
    }

    try {
      await this.quoteExportRepository.update(exportId, { status: 'processing' } as any)

      const items = await this.quoteItemRepository.findAll({
        where: { quote_id: quoteId },
        orderBy: { row_number: 'asc' },
      } as any)
      const selectedFields = exportRecord.selected_fields as string[]
      const customAttributeFields =
        (exportRecord.custom_attribute_fields as unknown as CustomAttributeField[] | null) ?? []

      const needsCatalogFetch = customAttributeFields.length > 0 || selectedFields.some(fieldId => SOURCE_FIELD_BY_ID.has(fieldId))
      const productsById = needsCatalogFetch ? await this.fetchSelectedProducts(items as any[]) : new Map<string, FetchedCatalogProduct>()

      const rows = items.map(item => {
        const snapshot = selectedCandidate(item as any)
        const fetchedProduct = snapshot?.productId ? productsById.get(snapshot.productId) : undefined
        return buildExportRow(item as any, selectedFields, fetchedProduct, customAttributeFields)
      })

      const worksheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Cotação')

      const format = exportRecord.format as string
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: format === 'csv' ? 'csv' : 'xlsx',
      })

      const s3Key = `quotes/${quoteId}/exports/${exportId}.${format}`
      const contentType = format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      await this.s3Service.uploadFile(s3Key, buffer, contentType)

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await this.quoteExportRepository.update(exportId, {
        status: 'completed',
        file_s3_key: s3Key,
        expires_at: expiresAt,
      } as any)

      await this.activityService.record(quoteId, 'export_generated', `Exportação ${format.toUpperCase()} concluída`)
      this.logger.log({ quoteId, exportId, rows: rows.length }, 'QUOTE_GENERATE_EXPORT_COMPLETE')
    } catch (error) {
      this.logger.error({ quoteId, exportId, error }, 'QUOTE_GENERATE_EXPORT_FAILED')
      await this.quoteExportRepository.update(exportId, { status: 'failed' } as any)
    }
  }

  /** One bulk fetch for every item's selected candidate, keyed by productId — never one call per item. */
  private async fetchSelectedProducts(
    items: { candidates: unknown; selected_candidate_id: string | null }[],
  ): Promise<Map<string, FetchedCatalogProduct>> {
    const productIds = items
      .map(item => selectedCandidate(item)?.productId)
      .filter((id): id is string => Boolean(id))

    const products = await this.searchCatalogService.getProductsByIds(productIds)
    return new Map(products.map(product => [String(product.id), product]))
  }
}
