import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { INVENTORY_PERIOD_DERIVED_SUBSCRIBERS, PERIOD_EVENT_QUEUES } from '@app/period-events-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { CentralStockModule } from './modules/central-stock/central-stock.module'
import { PeriodUpdatedWorker } from './modules/inventory/jobs/period-updated.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    InventoryModule,
    CentralStockModule,
    // Consumes the period event supply and sales publish, and publishes the
    // derived event finance waits on. withKafkaBrokers is
    // explicit for the same reason as everywhere else: the default is true and
    // crashes NestJS at startup.
    HoldItModule.register(
      [PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INVENTORY, ...INVENTORY_PERIOD_DERIVED_SUBSCRIBERS],
      { withKafkaBrokers: false },
    ),
    HoldItModule.registerWorker({ processors: [PeriodUpdatedWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
