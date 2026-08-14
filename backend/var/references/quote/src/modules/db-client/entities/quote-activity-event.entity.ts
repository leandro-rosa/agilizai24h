import type { Prisma, QuoteActivityEvent as PrismaQuoteActivityEvent } from '../generated/prisma/client'
import type { Equal, Expect } from './prisma-compatibility'

export interface QuoteActivityEvent {
  id: number
  quote_id: number
  kind: string
  message: string
  actor: string | null
  metadata: Prisma.JsonValue | null
  created_at: Date
}

type _QuoteActivityEventMatchesPrisma = Expect<Equal<QuoteActivityEvent, PrismaQuoteActivityEvent>>
