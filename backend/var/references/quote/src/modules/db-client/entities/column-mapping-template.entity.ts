import type { ColumnMappingTemplate as PrismaColumnMappingTemplate, Prisma } from '../generated/prisma/client'
import type { Equal, Expect } from './prisma-compatibility'

export interface ColumnMappingTemplate {
  id: number
  name: string
  mappings: Prisma.JsonValue
  created_at: Date
  created_by: string | null
}

type _ColumnMappingTemplateMatchesPrisma = Expect<Equal<ColumnMappingTemplate, PrismaColumnMappingTemplate>>
