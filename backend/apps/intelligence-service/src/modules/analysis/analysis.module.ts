import { Module } from '@nestjs/common'
import { AnalysisController } from './analysis.controller'
import { AnalysisService } from './analysis.service'
import { NullPurchaseSource, PurchaseSource } from './purchase-source'

/** Phase 1: no purchase source exists, so the null one is wired. Phase 2 swaps the provider, nothing else. */
@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService, { provide: PurchaseSource, useClass: NullPurchaseSource }],
})
export class AnalysisModule {}
