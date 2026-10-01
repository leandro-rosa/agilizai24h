import { Global, Module } from '@nestjs/common'
import { BACKTEST_PORT } from '../refresh/refresh.ports'
import { BacktestController } from './backtest.controller'
import { BacktestRunner } from './backtest.runner'
import { BacktestService } from './backtest.service'

/**
 * Global so the queue worker, which `HoldItModule.registerWorker` instantiates in
 * its own module, can inject what it needs. The worker is deliberately NOT a
 * provider here — registering it in both places would create it twice.
 * `BACKTEST_PORT` is what the monthly refresh depends on.
 */
@Global()
@Module({
  controllers: [BacktestController],
  providers: [BacktestRunner, BacktestService, { provide: BACKTEST_PORT, useExisting: BacktestService }],
  exports: [BacktestRunner, BacktestService, BACKTEST_PORT],
})
export class BacktestModule {}
