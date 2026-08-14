import { Module } from '@nestjs/common'
import { ProductCatalogSeedService } from './product-catalog-seed.service'

@Module({
  providers: [ProductCatalogSeedService],
  exports: [ProductCatalogSeedService],
})
export class ProductCatalogSeedModule {}
