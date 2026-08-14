import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client/repositories/prisma'
import { PrismaClientService } from '../prisma-client.service'
import { QuoteExport } from '../entities/quote-export.entity'

@Injectable()
export class QuoteExportRepository extends PrismaRepository<QuoteExport, QuoteExport> {
  constructor(prisma: PrismaClientService) {
    super(prisma, prisma.quoteExport, 'QuoteExport')
  }
}
