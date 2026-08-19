import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Store } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

/**
 * Folds a name for tolerant comparison: case, accents and surrounding
 * whitespace should not make two names disagree. The real restocking export
 * carries exactly this drift — `Plena Saude - Mogi ` has a trailing space,
 * and the register-time code may not match the export's casing exactly.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

@Injectable()
export class StoreRepository extends PrismaRepository<Store, Store> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.store, 'Store')
  }

  /** Never falls back to name matching — only ever matches against the registered code. */
  async findByExternalCode(externalCode: string): Promise<Store | null> {
    const exact = await this.prismaClient.store.findUnique({ where: { external_code: externalCode } })
    if (exact) return exact

    // A store count in the tens to low hundreds, so a full scan folding both
    // sides in application code is simpler and safer than adding a Postgres
    // extension (unaccent/citext) just for this one comparison.
    const target = fold(externalCode)
    const candidates = await this.prismaClient.store.findMany({ where: { external_code: { not: null } } })

    return candidates.find(store => store.external_code !== null && fold(store.external_code) === target) ?? null
  }
}
