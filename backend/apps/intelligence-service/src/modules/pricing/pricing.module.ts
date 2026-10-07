import { Module } from '@nestjs/common'
import { HttpPurchaseSource, PurchaseSource } from '../analysis/purchase-source'
import { PricingController } from './pricing.controller'
import { PricingParametersService } from './pricing-parameters.service'
import { PricingService } from './pricing.service'

/** The price engine. Isolated from the mix engine: its own parameters, its own routes, read-only sources. */
@Module({
  controllers: [PricingController],
  providers: [PricingService, PricingParametersService, { provide: PurchaseSource, useClass: HttpPurchaseSource }],
})
export class PricingModule {}
