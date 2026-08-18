import { Module } from '@nestjs/common'
import { OverviewController } from './controllers/overview.controller'
import { ProductsController } from './controllers/products.controller'
import { StoresController } from './controllers/stores.controller'

@Module({
  controllers: [StoresController, ProductsController, OverviewController],
})
export class DomainsModule {}
