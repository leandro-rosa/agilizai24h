import type { Prisma, QuoteExport as PrismaQuoteExport } from '../generated/prisma/client'
import type { Equal, Expect } from './prisma-compatibility'

export interface QuoteExport {
  id: number
  quote_id: number
  status: string
  format: string
  selected_fields: Prisma.JsonValue
  custom_attribute_fields: Prisma.JsonValue | null
  file_s3_key: string | null
  created_at: Date
  created_by: string | null
  expires_at: Date | null
}

type _QuoteExportMatchesPrisma = Expect<Equal<QuoteExport, PrismaQuoteExport>>
