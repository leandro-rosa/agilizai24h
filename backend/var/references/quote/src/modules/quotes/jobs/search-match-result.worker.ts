import { Job } from 'bullmq'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import {
  SEARCH_MATCH_RESULT_QUEUE,
  SearchMatchCandidate,
  SearchMatchCandidateV2,
  SearchMatchJobEnvelope,
  SearchMatchJobEnvelopeV2,
  SearchMatchResultPayload,
  SearchMatchResultPayloadV2,
} from '@app/quote-search-match'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { Prisma } from '../../db-client/generated/prisma/client'
import { MATCHABLE_TARGET_FIELDS, scoreCandidate } from '../utils/candidate-scoring.util'
import { deriveMatchStatus } from '../utils/match-status.util'
import { toNormalizedSearchData, toSearchFields, OriginalFieldLike } from '../utils/search-fields.util'
import { deriveQuoteStatusOnReviewProgress } from '../utils/quote-progress.util'
import { ProductCatalogDocument } from '../../product-catalog-seed/product-catalog-document'
import { createDefaultMatchingConfig, isMatchingConfig, MatchingConfig, parseMatchingConfig } from '../utils/matching-config.util'

/**
 * Sentinel `reviewedBy` value for a decision this worker made on its own —
 * `reviewedBy` is a free-text actor string (no auth system exists, see
 * apps/quote/CLAUDE.md), so a `system:` prefix keeps an automatic decision
 * visibly distinguishable from a real `x-demo-actor` value without a
 * schema change.
 */
const AUTO_MATCH_ACTOR = 'system:auto-match'
const MATCHED_STATUSES = new Set(['exact', 'strong', 'approximate', 'multiple'])
const RESULT_CANDIDATE_KEYS = ['productId', 'name', 'brand', 'sku', 'ean', 'mainCode', 'category', 'image', 'stock', 'evidence']
const RESULT_EVIDENCE_KINDS = new Set(['exact', 'text', 'synonym', 'fuzzy'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every(key => allowedKeys.includes(key))
}

function boundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength
}

function parseResultCandidates(
  value: unknown,
  searchFieldCount: number,
  maximumCandidates: number,
  withEvidence: boolean,
): Array<SearchMatchCandidate | SearchMatchCandidateV2> {
  if (!Array.isArray(value) || value.length > maximumCandidates) throw new Error('Invalid search match candidates')

  return value.map(candidateValue => {
    if (!isRecord(candidateValue) || !hasOnlyKeys(candidateValue, RESULT_CANDIDATE_KEYS)) {
      throw new Error('Invalid search match candidate fields')
    }
    if (!boundedString(candidateValue.productId, 200) || !boundedString(candidateValue.name, 500)
      || !boundedString(candidateValue.brand, 200) || !boundedString(candidateValue.sku, 200)
      || !boundedString(candidateValue.ean, 200) || !boundedString(candidateValue.mainCode, 200)
      || !boundedString(candidateValue.category, 500) || typeof candidateValue.stock !== 'number'
      || !Number.isFinite(candidateValue.stock)) {
      throw new Error('Invalid search match candidate values')
    }

    let image: string | undefined
    if (candidateValue.image !== undefined) {
      if (!boundedString(candidateValue.image, 2048)) throw new Error('Invalid search match candidate image')
      const imageUrl = new URL(candidateValue.image)
      if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') throw new Error('Invalid search match candidate image')
      image = imageUrl.toString()
    }

    const candidate: SearchMatchCandidate = {
      productId: candidateValue.productId,
      name: candidateValue.name,
      brand: candidateValue.brand,
      sku: candidateValue.sku,
      ean: candidateValue.ean,
      mainCode: candidateValue.mainCode,
      category: candidateValue.category,
      ...(image ? { image } : {}),
      stock: candidateValue.stock,
    }
    if (!withEvidence) {
      if (candidateValue.evidence !== undefined) throw new Error('Invalid legacy search match candidate evidence')
      return candidate
    }

    if (!Array.isArray(candidateValue.evidence) || candidateValue.evidence.length > searchFieldCount * 4) {
      throw new Error('Invalid search match candidate evidence')
    }
    const evidence = candidateValue.evidence.map(evidenceValue => {
      if (!isRecord(evidenceValue) || !hasOnlyKeys(evidenceValue, ['targetField', 'kind', 'searchFieldIndex'])
        || typeof evidenceValue.targetField !== 'string' || !MATCHABLE_TARGET_FIELDS.includes(evidenceValue.targetField)
        || typeof evidenceValue.kind !== 'string' || !RESULT_EVIDENCE_KINDS.has(evidenceValue.kind)
        || !Number.isInteger(evidenceValue.searchFieldIndex) || Number(evidenceValue.searchFieldIndex) < 0
        || Number(evidenceValue.searchFieldIndex) >= searchFieldCount) {
        throw new Error('Invalid search match candidate evidence')
      }
      return {
        targetField: evidenceValue.targetField as SearchMatchCandidateV2['evidence'][number]['targetField'],
        kind: evidenceValue.kind as SearchMatchCandidateV2['evidence'][number]['kind'],
        searchFieldIndex: Number(evidenceValue.searchFieldIndex),
      }
    })
    return { ...candidate, evidence }
  })
}

function parseResultSearchFields(value: unknown): SearchMatchResultPayloadV2['searchFields'] {
  if (!Array.isArray(value) || value.length > 7) throw new Error('Invalid search match result fields')
  return value.map(field => {
    if (!isRecord(field) || !hasOnlyKeys(field, ['targetField', 'value', 'priority'])
      || typeof field.targetField !== 'string' || !MATCHABLE_TARGET_FIELDS.includes(field.targetField)
      || !boundedString(field.value, 200) || !field.value.trim()
      || !Number.isInteger(field.priority) || Number(field.priority) < 0) {
      throw new Error('Invalid search match result field')
    }
    return { targetField: field.targetField, value: field.value, priority: Number(field.priority) }
  })
}

function matchesPersistedSearchFields(
  searchFields: SearchMatchResultPayloadV2['searchFields'],
  normalizedData: unknown,
): boolean {
  if (!isRecord(normalizedData)) return false
  const expected = toNormalizedSearchData(searchFields)
  if (Object.keys(normalizedData).length !== Object.keys(expected).length) return false

  for (const [targetField, expectedValue] of Object.entries(expected)) {
    const persistedValue = normalizedData[targetField]
    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(persistedValue)
        || persistedValue.length !== expectedValue.length
        || persistedValue.some((value, index) => value !== expectedValue[index])) return false
    } else if (persistedValue !== expectedValue) {
      return false
    }
  }
  return true
}

interface ScoredCandidate extends SearchMatchCandidate {
  oemCodes: string[]
  tradeNumbers: string[]
  matchScore: number
  matchReasons: string[]
}

type ResultEnvelope =
  | SearchMatchJobEnvelope<SearchMatchResultPayload>
  | SearchMatchJobEnvelopeV2<SearchMatchResultPayloadV2>

interface MatchResultInput {
  itemId: number
  matchRevision: number
  searchFields?: SearchMatchResultPayloadV2['searchFields']
  matchingConfig: MatchingConfig
  candidates: Array<SearchMatchCandidate | SearchMatchCandidateV2>
  legacy: boolean
}

/**
 * SearchMatchCandidate is already ProductCatalogDocument's shape minus
 * oemCodes/tradeNumbers (apps/search's public API doesn't expose them —
 * see @app/quote-search-match's CLAUDE.md) — those two always score zero
 * weight here, never invented.
 */
function toProductCatalogDocument(candidate: SearchMatchCandidate): ProductCatalogDocument {
  return { ...candidate, oemCodes: [], tradeNumbers: [] }
}

/**
 * Consumes SEARCH_MATCH_RESULT_QUEUE (apps/search's ProductMatchWorker,
 * one job per quote item) and scores each returned candidate with the
 * revision's field weights and safe evidence. It either auto-approves above
 * the configured threshold or leaves the item `pending` for manual review
 * (QuoteItemsService.decideItem/decideItemsBatch). See design.md's
 * "Scoring authority stays in apps/quote" and "Auto-accept threshold"
 * decisions. Item transition, denormalized counter increments, quote status,
 * and auto-match activity are committed together. The conditional
 * `match_status: pending` write makes BullMQ retries and concurrent workers
 * idempotent without per-item aggregate scans.
 */
const configuredConcurrency = Number(process.env.SEARCH_MATCH_RESULT_WORKER_CONCURRENCY ?? 10)

@HoldItProcessor(SEARCH_MATCH_RESULT_QUEUE, { concurrency: configuredConcurrency })
export class SearchMatchResultWorker extends HoldItWorkerHost<ResultEnvelope> {
  constructor(private readonly prisma: PrismaClientService) {
    super()
  }

  async process(job: Job<ResultEnvelope>): Promise<void> {
    const envelope = job.data
    const schemaVersion: number = envelope.schemaVersion

    if (schemaVersion !== 1 && schemaVersion !== 2) {
      throw new Error(`Unsupported quote.match-item-result schemaVersion: ${schemaVersion}`)
    }

    if (envelope.schemaVersion === 2 && !isMatchingConfig(envelope.payload.matchingConfig)) {
      throw new Error('Invalid matching config in quote.match-item-result schemaVersion 2')
    }

    const quoteId = envelope.quoteId
    const input: MatchResultInput = envelope.schemaVersion === 1
      ? {
          itemId: envelope.payload.itemId,
          matchRevision: 0,
          matchingConfig: createDefaultMatchingConfig(),
          candidates: parseResultCandidates(envelope.payload.candidates, 0, 5, false),
          legacy: true,
        }
      : {
          itemId: envelope.payload.itemId,
          matchRevision: envelope.payload.matchRevision,
          searchFields: parseResultSearchFields(envelope.payload.searchFields),
          matchingConfig: parseMatchingConfig(envelope.payload.matchingConfig),
          candidates: parseResultCandidates(
            envelope.payload.candidates,
            envelope.payload.searchFields.length,
            envelope.payload.matchingConfig.max_candidates,
            true,
          ),
          legacy: false,
        }
    const { itemId, matchRevision, candidates } = input

    const outcome = await this.prisma.$transaction(async transaction => {
      await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${quoteId})`)
      const quoteRevision = await transaction.quote.findUnique({
        where: { id: quoteId },
        select: { matching_config_revision: true, matching_config: true },
      })
      if (!quoteRevision) {
        return { state: 'missing' } as const
      }
      if (quoteRevision.matching_config_revision !== matchRevision) {
        return { state: 'stale' } as const
      }

      const item = await transaction.quoteItem.findUnique({ where: { id: itemId } })
      if (!item || item.quote_id !== quoteId) {
        return { state: 'missing' } as const
      }
      if ((item.match_revision ?? 0) !== matchRevision) {
        return { state: 'stale' } as const
      }

      let matchingConfig = input.matchingConfig
      if (!input.legacy) {
        if (matchRevision > 0 && !isMatchingConfig(quoteRevision.matching_config)) {
          throw new Error('Invalid persisted matching config for active result revision')
        }
        const persistedMatchingConfig = parseMatchingConfig(quoteRevision.matching_config)
        if (JSON.stringify(persistedMatchingConfig) !== JSON.stringify(input.matchingConfig)) {
          throw new Error('Search result differs from persisted matching config')
        }
        if (!matchesPersistedSearchFields(input.searchFields ?? [], item.normalized_data)) {
          throw new Error('Search result differs from persisted request snapshot')
        }
        matchingConfig = persistedMatchingConfig
      }

      const originalFields = (item.raw_input as unknown as OriginalFieldLike[]) ?? []
      const searchFields = input.searchFields ?? toSearchFields(originalFields)

      const scored: ScoredCandidate[] = candidates
        .map(candidate => {
          const { score, reasons } = scoreCandidate(searchFields, toProductCatalogDocument(candidate), {
            fieldWeights: matchingConfig.field_weights,
            synonymGroups: matchingConfig.synonyms,
            evidence: 'evidence' in candidate ? candidate.evidence : [],
          })
          return { ...candidate, oemCodes: [], tradeNumbers: [], matchScore: score, matchReasons: reasons }
        })
        .filter(candidate => input.legacy ? candidate.matchScore > 0 : candidate.matchScore >= matchingConfig.minimum_score)
        .sort((a, b) => b.matchScore - a.matchScore)

      const matchStatus = searchFields.length ? deriveMatchStatus(scored) : 'insufficient'
      const best = scored[0]
      const canAutoAccept = matchingConfig.auto_approve
        && best !== undefined
        && best.matchScore > matchingConfig.auto_approve_threshold
      const matchUpdate = {
        candidates: scored as unknown as Prisma.InputJsonValue,
        match_score: best?.matchScore ?? null,
        match_reasons: best?.matchReasons ?? [],
        match_status: matchStatus,
      }

      let autoAccepted = false
      let updatedCount = 0

      if (canAutoAccept) {
        const autoUpdate = await transaction.quoteItem.updateMany({
          where: {
            id: itemId,
            quote_id: quoteId,
            match_status: 'pending',
            review_status: 'pending',
            match_revision: matchRevision,
          },
          data: {
            ...matchUpdate,
            selected_candidate_id: best.productId,
            review_status: 'reviewed',
            review_decision: 'approved',
            reviewed_by: AUTO_MATCH_ACTOR,
            reviewed_at: new Date(),
          },
        })
        autoAccepted = autoUpdate.count === 1
        updatedCount = autoUpdate.count
      }

      // A manual decision may win the review-state race; preserve its candidate and decision.
      if (updatedCount === 0) {
        const matchOnlyUpdate = await transaction.quoteItem.updateMany({
          where: {
            id: itemId,
            quote_id: quoteId,
            match_status: 'pending',
            review_status: 'pending',
            match_revision: matchRevision,
          },
          data: matchUpdate,
        })
        updatedCount = matchOnlyUpdate.count
      }

      if (updatedCount === 0) {
        return { state: 'already_processed' } as const
      }

      const quote = await transaction.quote.update({
        where: { id: quoteId },
        data: {
          processed_rows: { increment: 1 },
          ...(MATCHED_STATUSES.has(matchStatus) ? { matched_rows: { increment: 1 } } : {}),
          ...(matchStatus === 'not_found' ? { unmatched_rows: { increment: 1 } } : {}),
          ...(matchStatus === 'multiple' ? { ambiguous_rows: { increment: 1 } } : {}),
          ...(autoAccepted ? { reviewed_rows: { increment: 1 } } : {}),
        },
        select: { status: true, processed_rows: true, reviewed_rows: true, total_rows: true },
      })

      const nextStatus = deriveQuoteStatusOnReviewProgress(quote.status, quote.reviewed_rows, quote.total_rows)
      if (nextStatus && nextStatus !== quote.status) {
        await transaction.quote.update({ where: { id: quoteId }, data: { status: nextStatus } })
      } else if (quote.status === 'processing' && quote.processed_rows >= quote.total_rows) {
        const completedStatus = quote.reviewed_rows >= quote.total_rows
          ? 'reviewed'
          : quote.reviewed_rows > 0
            ? 'partially_reviewed'
            : 'awaiting_review'
        await transaction.quote.update({ where: { id: quoteId }, data: { status: completedStatus } })
      }

      if (autoAccepted) {
        await transaction.quoteActivityEvent.create({
          data: {
            quote_id: quoteId,
            kind: 'item_auto_matched',
            message: `Linha ${item.row_number}: aprovada automaticamente (score ${best!.matchScore})`,
            metadata: { item_id: itemId, match_score: best!.matchScore },
          },
        })
      }

      return { state: 'processed', matchStatus, autoAccepted, candidateCount: scored.length } as const
    })

    if (outcome.state === 'missing') {
      this.logger.error({ quoteId, itemId }, 'SEARCH_MATCH_RESULT_ITEM_NOT_FOUND')
      return
    }

    if (outcome.state === 'already_processed') {
      this.logger.log({ quoteId, itemId }, 'SEARCH_MATCH_RESULT_ALREADY_PROCESSED')
      return
    }

    if (outcome.state === 'stale') {
      this.logger.log({ quoteId, itemId, matchRevision }, 'SEARCH_MATCH_RESULT_STALE')
      return
    }

    this.logger.log(
      {
        quoteId,
        itemId,
        matchRevision,
        matchStatus: outcome.matchStatus,
        autoAccepted: outcome.autoAccepted,
        candidates: outcome.candidateCount,
      },
      'SEARCH_MATCH_RESULT_COMPLETE',
    )
  }
}
