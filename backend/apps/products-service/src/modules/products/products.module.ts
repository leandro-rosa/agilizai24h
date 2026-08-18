import { Module } from '@nestjs/common'
import { ProductsController } from './controllers/products.controller'
import { CostService } from './services/cost.service'
import { ProductsService } from './services/products.service'

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, CostService],
  exports: [ProductsService, CostService],
})
export class ProductsModule {}
