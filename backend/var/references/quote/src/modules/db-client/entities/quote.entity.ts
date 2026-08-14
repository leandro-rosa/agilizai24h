import type { Prisma, Quote as PrismaQuote } from '../generated/prisma/client'
import type { Equal, Expect } from './prisma-compatibility'

export interface Quote {
  id: number
  source: 'spreadsheet' | 'partner_api'
  name: string
  status: string
  created_at: Date
  updated_at: Date
  created_by: string | null
  original_file_name: string | null
  original_file_size_b: number | null
  original_file_s3_key: string | null
  selected_sheet: string | null
  header_row: number | null
  column_mapping_id: number | null
  normalization_rules: string[]
  partner_name: string | null
  external_id: string | null
  matching_config: Prisma.JsonValue | null
  matching_config_revision: number
  total_rows: number
  processed_rows: number
  reviewed_rows: number
  matched_rows: number
  unmatched_rows: number
  ambiguous_rows: number
  invalid_rows: number
  duplicate_rows: number
}

type _QuoteMatchesPrisma = Expect<Equal<Quote, PrismaQuote>>
