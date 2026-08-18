import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { PERIOD_EVENT_QUEUES } from '@app/period-events-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { FinanceModule } from './modules/finance/finance.module'
import { PeriodUpdatedWorker } from './modules/finance/jobs/period-updated.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    FinanceModule,
    // Consumes inventory-service's derived event, NOT the raw period event:
    // reconciliation values remaining stock from what inventory writes, so it
    // must not run concurrently with the service producing it. withKafkaBrokers is
    // explicit for the same reason as everywhere else: the default is true and
    // crashes NestJS at startup.
    HoldItModule.register([PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE], { withKafkaBrokers: false }),
    HoldItModule.registerWorker({ processors: [PeriodUpdatedWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
