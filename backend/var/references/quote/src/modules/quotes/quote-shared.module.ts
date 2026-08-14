import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { QuoteActivityService } from './services/quote-activity.service'
import { QuoteProductsService } from './services/quote-products.service'
import { SearchCatalogService } from './services/search-catalog.service'
import { SearchMatchRequestProducer } from './jobs/search-match-request.producer'

/**
 * HoldItModule.registerWorker({ processors }) registers each processor as
 * a provider of a HoldItModule-identified dynamic module that does NOT
 * import QuotesModule — so a worker can only inject providers that are
 * either globally available or listed here. QuoteActivityService,
 * QuoteProductsService, and SearchCatalogService (consumed by
 * GenerateExportWorker, see quotes.module.ts) are — like
 * DbClientModule/AwsModule/ElasticsearchModule already do in this app —
 * wrapped in their own @Global() module instead of being plain
 * QuotesModule providers. HttpClientModule (@app/http-client) is itself
 * @Global() too; imported here since this is where its one consumer
 * (SearchCatalogService) lives.
 */
@Global()
@Module({
  imports: [HttpClientModule],
  providers: [QuoteActivityService, QuoteProductsService, SearchCatalogService, SearchMatchRequestProducer],
  exports: [QuoteActivityService, QuoteProductsService, SearchCatalogService, SearchMatchRequestProducer],
})
export class QuoteSharedModule {}
