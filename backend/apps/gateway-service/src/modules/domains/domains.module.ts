import { Module } from '@nestjs/common'
import { AwsModule } from '@app/aws'
import { IngestionController } from '../ingestion/ingestion.controller'
import { OverviewController } from './controllers/overview.controller'
import { ProductsController } from './controllers/products.controller'
import { StoresController } from './controllers/stores.controller'

@Module({
  imports: [AwsModule],
  controllers: [StoresController, ProductsController, OverviewController, IngestionController],
})
export class DomainsModule {}
