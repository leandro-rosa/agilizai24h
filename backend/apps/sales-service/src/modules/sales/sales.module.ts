import { Global, Module } from '@nestjs/common'
import { SalesController } from './controllers/sales.controller'
import { SalesService } from './services/sales.service'

/**
 * Global because HoldItModule.registerWorker builds workers in a dynamic module
 * of its own — it does not import this one, so a worker injecting SalesService
 * would not see it otherwise.
 */
@Global()
@Module({
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
