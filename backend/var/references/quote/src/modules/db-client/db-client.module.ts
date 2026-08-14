import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { POSTGRES_HEALTH_CLIENT } from '@app/health'
import { PrismaClientService } from './prisma-client.service'
import { QuoteRepository } from './repository/quote.repository'
import { QuoteItemRepository } from './repository/quote-item.repository'
import { ColumnMappingTemplateRepository } from './repository/column-mapping-template.repository'
import { QuoteExportRepository } from './repository/quote-export.repository'
import { QuoteActivityEventRepository } from './repository/quote-activity-event.repository'

/**
 * Owns everything database-specific for quote: the Prisma schema/migrations
 * (./prisma), the generated client (./generated, gitignored — run
 * `pnpm prisma:generate`), the concrete PrismaClientService, and one
 * repository per table under ./repository. common/nest-libs/prisma-db-client
 * only supplies the generic, schema-agnostic PrismaRepository base class and
 * search-criteria types — it has no knowledge of Quote/QuoteItem.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaPg,
      useFactory: async (configService: ConfigService) => {
        const connectionString = configService.get<string>('DATABASE_URL')
        return new PrismaPg({ connectionString })
      },
      inject: [ConfigService],
    },
    PrismaClientService,
    QuoteRepository,
    QuoteItemRepository,
    ColumnMappingTemplateRepository,
    QuoteExportRepository,
    QuoteActivityEventRepository,
    {
      provide: POSTGRES_HEALTH_CLIENT,
      useExisting: PrismaClientService,
    },
  ],
  exports: [
    PrismaClientService,
    QuoteRepository,
    QuoteItemRepository,
    ColumnMappingTemplateRepository,
    QuoteExportRepository,
    QuoteActivityEventRepository,
    POSTGRES_HEALTH_CLIENT,
  ],
})
export class DbClientModule {}
