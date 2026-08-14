import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client/repositories/prisma'
import { PrismaClientService } from '../prisma-client.service'
import { QuoteItem } from '../entities/quote-item.entity'

@Injectable()
export class QuoteItemRepository extends PrismaRepository<QuoteItem, QuoteItem> {
  constructor(prisma: PrismaClientService) {
    super(prisma, prisma.quoteItem, 'QuoteItem')
  }
}
