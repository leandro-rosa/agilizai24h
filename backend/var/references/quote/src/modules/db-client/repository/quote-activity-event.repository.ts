import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client/repositories/prisma'
import { PrismaClientService } from '../prisma-client.service'
import { QuoteActivityEvent } from '../entities/quote-activity-event.entity'

@Injectable()
export class QuoteActivityEventRepository extends PrismaRepository<QuoteActivityEvent, QuoteActivityEvent> {
  constructor(prisma: PrismaClientService) {
    super(prisma, prisma.quoteActivityEvent, 'QuoteActivityEvent')
  }
}
