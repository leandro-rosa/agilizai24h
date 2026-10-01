import { Global, Module } from '@nestjs/common'
import { FreshnessService } from './freshness.service'
import { RefreshController } from './refresh.controller'
import { RefreshService } from './refresh.service'

/**
 * The freshness probe is global because `RunsService` reads it too (every run states what
 * it covers), and the refresh service is global so the queue workers, which
 * `HoldItModule.registerWorker` instantiates in its own module, can inject it. The workers are
 * deliberately NOT providers here.
 *
 * `BACKTEST_PORT` is provided by the (global) backtest module; the refresh only depends on the port.
 */
@Global()
@Module({
  controllers: [RefreshController],
  providers: [FreshnessService, RefreshService],
  exports: [FreshnessService, RefreshService],
})
export class RefreshModule {}
