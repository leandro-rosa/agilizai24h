/**
 * Mirrors frontend/src/domain/model.ts's QuoteStatus/MatchStatus/ReviewDecision
 * unions exactly. Validated here at the DTO layer (class-validator @IsIn),
 * not in the Prisma schema — see backend/apps/quote/CLAUDE.md, "Decisões
 * pendentes (resolvidas)": status columns stay plain `String` so the
 * vocabulary can evolve without a migration. Keep in sync with model.ts by
 * hand until/unless that contract is formally frozen (see open question in
 * frontend/docs/api-contracts.md).
 */
export const QUOTE_STATUS_VALUES = [
  'draft',
  'uploading',
  'processing',
  'awaiting_review',
  'partially_reviewed',
  'reviewed',
  'completed',
  'failed',
  'cancelled',
] as const

export const QUOTE_SOURCE_VALUES = ['spreadsheet', 'partner_api'] as const

export const MATCH_STATUS_VALUES = [
  'exact',
  'strong',
  'approximate',
  'multiple',
  'not_found',
  'insufficient',
  'invalid',
  'duplicate',
  'pending',
  'reviewed',
] as const

export const REVIEW_DECISION_VALUES = ['approved', 'changed', 'not_found', 'ignored', 'rejected'] as const

export const REVIEW_STATUS_VALUES = ['pending', 'reviewed'] as const
