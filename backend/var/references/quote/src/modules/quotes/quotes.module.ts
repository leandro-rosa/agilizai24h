import { Module } from '@nestjs/common'
import { HoldItModule } from '@app/hold-it'
import { ElasticsearchModule } from '@app/elasticsearch'
import { AwsModule } from '@app/aws'
import { SEARCH_MATCH_REQUEST_QUEUE, SEARCH_MATCH_RESULT_QUEUE } from '@app/quote-search-match'
import { DbClientModule } from '../db-client/db-client.module'
import { ProductCatalogSeedModule } from '../product-catalog-seed/product-catalog-seed.module'
import { QuoteSharedModule } from './quote-shared.module'
import { QuotesController } from './controllers/quotes.controller'
import { QuotesService } from './services/quotes.service'
import { QuoteItemsService } from './services/quote-items.service'
import { QuoteExportsService } from './services/quote-exports.service'
import { PartnerIntakeService } from './services/partner-intake.service'
import {
  QUOTE_GENERATE_EXPORT_QUEUE,
  QUOTE_MATCH_ITEM_QUEUE,
  QUOTE_PROCESS_UPLOAD_QUEUE,
} from './jobs/quote-job-envelope'
import { ProcessUploadProducer } from './jobs/process-upload.producer'
import { MatchItemProducer } from './jobs/match-item.producer'
import { GenerateExportProducer } from './jobs/generate-export.producer'
import { SearchMatchRequestProducer } from './jobs/search-match-request.producer'
import { ProcessUploadWorker } from './jobs/process-upload.worker'
import { MatchItemWorker } from './jobs/match-item.worker'
import { GenerateExportWorker } from './jobs/generate-export.worker'
import { SearchMatchResultWorker } from './jobs/search-match-result.worker'

@Module({
  imports: [
    DbClientModule,
    ElasticsearchModule,
    AwsModule,
    ProductCatalogSeedModule,
    QuoteSharedModule,
    HoldItModule.register([
      QUOTE_PROCESS_UPLOAD_QUEUE,
      QUOTE_MATCH_ITEM_QUEUE,
      QUOTE_GENERATE_EXPORT_QUEUE,
      SEARCH_MATCH_REQUEST_QUEUE,
      SEARCH_MATCH_RESULT_QUEUE,
    ]),
    HoldItModule.registerWorker({
      processors: [ProcessUploadWorker, MatchItemWorker, GenerateExportWorker, SearchMatchResultWorker],
    }),
  ],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    QuoteItemsService,
    QuoteExportsService,
    PartnerIntakeService,
    ProcessUploadProducer,
    MatchItemProducer,
    GenerateExportProducer,
    SearchMatchRequestProducer,
  ],
  exports: [ProcessUploadProducer, MatchItemProducer, GenerateExportProducer, SearchMatchRequestProducer],
})
export class QuotesModule {}
