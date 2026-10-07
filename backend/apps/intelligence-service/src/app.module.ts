import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { PERIOD_EVENT_QUEUES } from '@app/period-events-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { BacktestModule } from './modules/backtest/backtest.module'
import { BacktestWorker } from './modules/backtest/backtest.worker'
import { BACKTEST_QUEUES } from './modules/backtest/backtest.constants'
import { DbClientModule } from './modules/db-client/db-client.module'
import { AnalysisModule } from './modules/analysis/analysis.module'
import { BaselineModule } from './modules/baseline/baseline.module'
import { FlagsModule } from './modules/flags/flags.module'
import { ParametersModule } from './modules/parameters/parameters.module'
import { PricingModule } from './modules/pricing/pricing.module'
import { PricingRunWorker } from './modules/pricing/pricing-run.worker'
import { RefreshModule } from './modules/refresh/refresh.module'
import { REFRESH_QUEUES } from './modules/refresh/refresh.constants'
import { PeriodUpdatedRefreshWorker, RefreshAdvanceWorker, RefreshCheckWorker } from './modules/refresh/refresh.workers'
import { EngineStoreWorker } from './modules/runs/engine-store.worker'
import { INTELLIGENCE_QUEUES } from './modules/runs/runs.constants'
import { RunsModule } from './modules/runs/runs.module'
import { ScheduleModule } from './modules/schedule/schedule.module'
import { SourcesModule } from './modules/sources/sources.module'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    SourcesModule,
    ParametersModule,
    AnalysisModule,
    PricingModule,
    ScheduleModule,
    BaselineModule,
    FlagsModule,
    RefreshModule,
    RunsModule,
    BacktestModule,
    // withKafkaBrokers is explicit for the same reason as everywhere else: the default is true
    // and crashes NestJS at startup.
    HoldItModule.register(
      [
        INTELLIGENCE_QUEUES.ENGINE_STORE,
        INTELLIGENCE_QUEUES.PRICING_RUN,
        BACKTEST_QUEUES.BACKTEST,
        PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INTELLIGENCE,
        REFRESH_QUEUES.CHECK,
        REFRESH_QUEUES.ADVANCE,
      ],
      { withKafkaBrokers: false },
    ),
    HoldItModule.registerWorker({
      processors: [EngineStoreWorker, PricingRunWorker, BacktestWorker, PeriodUpdatedRefreshWorker, RefreshCheckWorker, RefreshAdvanceWorker],
    }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
