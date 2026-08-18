import { Global, Module } from '@nestjs/common'
import { SupplyController } from './controllers/supply.controller'
import { PeriodEventsPublisher } from './services/period-events.publisher'
import { SupplyService } from './services/supply.service'

/** Global so HoldItModule's worker module can inject these — it does not import this one. */
@Global()
@Module({
  controllers: [SupplyController],
  providers: [SupplyService, PeriodEventsPublisher],
  exports: [SupplyService, PeriodEventsPublisher],
})
export class SupplyModule {}
