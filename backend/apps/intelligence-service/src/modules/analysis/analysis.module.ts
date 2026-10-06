import { Module } from '@nestjs/common'
import { AnalysisController } from './analysis.controller'
import { AnalysisService } from './analysis.service'
import { HttpPurchaseSource, PurchaseSource } from './purchase-source'

/** Purchases come from suppliers-service. `NullPurchaseSource` is only for tests. */
@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService, { provide: PurchaseSource, useClass: HttpPurchaseSource }],
})
export class AnalysisModule {}
