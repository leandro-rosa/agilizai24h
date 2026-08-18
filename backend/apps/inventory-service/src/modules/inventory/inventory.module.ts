import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { InventoryController } from './controllers/inventory.controller'
import { InventoryService } from './services/inventory.service'
import { DerivedEventsPublisher } from './services/derived-events.publisher'
import { MovementsClient } from './services/movements.client'

/** Global so the worker, which lives in HoldItModule's own module, can inject these. */
@Global()
@Module({
  imports: [HttpClientModule],
  controllers: [InventoryController],
  providers: [InventoryService, MovementsClient, DerivedEventsPublisher],
  exports: [InventoryService, MovementsClient, DerivedEventsPublisher],
})
export class InventoryModule {}
