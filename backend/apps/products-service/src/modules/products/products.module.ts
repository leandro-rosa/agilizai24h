import { Module } from '@nestjs/common'
import { ProductsController } from './controllers/products.controller'
import { EanService } from './services/ean.service'
import { TimelineService } from './services/timeline.service'
import { CostService } from './services/cost.service'
import { PriceService } from './services/price.service'
import { CatalogueSyncService } from './services/catalogue-sync.service'
import { SkuLinkService } from './services/sku-link.service'
import { ProductsService } from './services/products.service'

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, EanService, TimelineService, CostService, PriceService, SkuLinkService, CatalogueSyncService],
  exports: [ProductsService, EanService, CostService, PriceService],
})
export class ProductsModule {}
