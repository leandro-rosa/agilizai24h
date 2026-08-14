import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client/repositories/prisma'
import { PrismaClientService } from '../prisma-client.service'
import { Quote } from '../entities/quote.entity'

@Injectable()
export class QuoteRepository extends PrismaRepository<Quote, Quote> {
  constructor(prisma: PrismaClientService) {
    super(prisma, prisma.quote, 'Quote')
  }
}
