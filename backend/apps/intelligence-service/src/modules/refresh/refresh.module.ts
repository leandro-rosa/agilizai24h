import { Global, Module } from '@nestjs/common'
import { FreshnessService } from './freshness.service'
import { NotYetAvailableBacktest } from './not-yet-available-backtest'
import { RefreshController } from './refresh.controller'
import { BACKTEST_PORT } from './refresh.ports'
import { RefreshService } from './refresh.service'

/**
 * The freshness probe is global because `RunsService` reads it too (every run states what
 * it covers), and the refresh service is global so the queue workers, which
 * `HoldItModule.registerWorker` instantiates in its own module, can inject it. The workers are
 * deliberately NOT providers here.
 *
 * BACKTEST_PORT: the real backtest (group 8) replaces the placeholder below. When it lands, add
 * its module to `imports` (it must export a provider for `BACKTEST_PORT`) and DELETE the
 * placeholder provider line, so nothing else needs to change.
 */
@Global()
@Module({
  controllers: [RefreshController],
  providers: [FreshnessService, RefreshService, { provide: BACKTEST_PORT, useClass: NotYetAvailableBacktest }],
  exports: [FreshnessService, RefreshService],
})
export class RefreshModule {}
