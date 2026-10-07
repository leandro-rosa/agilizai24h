import { Global, Module } from '@nestjs/common'
import { HttpPurchaseSource, PurchaseSource } from '../analysis/purchase-source'
import { PricingController } from './pricing.controller'
import { PricingDecisionsService } from './pricing-decisions.service'
import { PricingProductService } from './pricing-product.service'
import { PricingRunsService } from './pricing-runs.service'
import { PricingParametersService } from './pricing-parameters.service'
import { PricingService } from './pricing.service'

/** The price engine. Isolated from the mix engine: its own parameters, its own routes, read-only sources. */
/**
 * Global so the queue worker, which `HoldItModule.registerWorker` instantiates in its own module, can inject the
 * services. The worker is deliberately NOT a provider here — registering it in both places would create it twice.
 */
@Global()
@Module({
  controllers: [PricingController],
  providers: [PricingService, PricingParametersService, PricingRunsService, PricingProductService, PricingDecisionsService, { provide: PurchaseSource, useClass: HttpPurchaseSource }],
  exports: [PricingService, PricingParametersService, PricingRunsService, PricingProductService, PricingDecisionsService],
})
export class PricingModule {}
