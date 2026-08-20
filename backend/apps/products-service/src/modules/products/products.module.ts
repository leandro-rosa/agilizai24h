import { Module } from '@nestjs/common'
import { ProductsController } from './controllers/products.controller'
import { CostService } from './services/cost.service'
import { PriceService } from './services/price.service'
import { ProductsService } from './services/products.service'

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, CostService, PriceService],
  exports: [ProductsService, CostService, PriceService],
})
export class ProductsModule {}
