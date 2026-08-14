import type { Prisma, QuoteItem as PrismaQuoteItem } from '../generated/prisma/client'
import type { Equal, Expect } from './prisma-compatibility'

export interface QuoteItem {
  id: number
  quote_id: number
  row_number: number
  raw_input: Prisma.JsonValue
  normalized_data: Prisma.JsonValue | null
  candidates: Prisma.JsonValue
  match_score: number | null
  match_reasons: string[]
  match_status: string
  match_revision: number
  selected_candidate_id: string | null
  review_status: string
  review_decision: string | null
  reviewed_by: string | null
  reviewed_at: Date | null
  notes: string
  created_at: Date
  updated_at: Date
}

type _QuoteItemMatchesPrisma = Expect<Equal<QuoteItem, PrismaQuoteItem>>
