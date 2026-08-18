import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { AwsModule } from '@app/aws'
import { SheeterModule } from '@app/sheeter'
import { IngestionController } from './controllers/ingestion.controller'
import { IngestionService } from './services/ingestion.service'
import { UpstreamClient } from './services/upstream.client'

/** Global so the workers, which live in HoldItModule's own module, can inject these. */
@Global()
@Module({
  imports: [HttpClientModule, AwsModule, SheeterModule],
  controllers: [IngestionController],
  providers: [IngestionService, UpstreamClient],
  exports: [IngestionService, UpstreamClient],
})
export class IngestionModule {}
