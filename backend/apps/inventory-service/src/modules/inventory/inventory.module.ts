import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { InventoryController } from './controllers/inventory.controller'
import { InventoryService } from './services/inventory.service'
import { MovementsClient } from './services/movements.client'

/** Global so the worker, which lives in HoldItModule's own module, can inject these. */
@Global()
@Module({
  imports: [HttpClientModule],
  controllers: [InventoryController],
  providers: [InventoryService, MovementsClient],
  exports: [InventoryService, MovementsClient],
})
export class InventoryModule {}
