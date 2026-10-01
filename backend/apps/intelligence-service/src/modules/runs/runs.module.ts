import { Global, Module } from '@nestjs/common'
import { RunFinalizer } from './run-finalizer'
import { RunInputBuilder } from './run-input.builder'
import { RunsController } from './runs.controller'
import { RunsService } from './runs.service'

/**
 * Global so the queue worker, which `HoldItModule.registerWorker` instantiates in
 * its own module, can inject what it needs. The worker is deliberately NOT a
 * provider here — registering it in both places would create it twice.
 */
@Global()
@Module({
  controllers: [RunsController],
  providers: [RunsService, RunInputBuilder, RunFinalizer],
  exports: [RunsService, RunInputBuilder, RunFinalizer],
})
export class RunsModule {}
